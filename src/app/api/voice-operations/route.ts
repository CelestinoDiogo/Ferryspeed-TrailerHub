import { z } from "zod";
import { formatAssistantResponse } from "@/lib/ai-assistant-foundation/response-formatter";
import { runIntentQuery } from "@/lib/ai-assistant-foundation/query-service";
import type { AssistantContext } from "@/lib/ai-assistant-foundation/types";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";
import { parseVoiceCommand, resolveNextVoiceContext } from "@/lib/voice/parser";
import {
  initialVoiceContext,
  isVoiceActionIntent,
  isVoiceReadIntent,
  toAssistantIntent,
  type VoiceActionIntentName,
  type VoiceActionPlan,
  type VoiceContext,
  type VoiceEntities,
  type VoiceExecutionResponse,
} from "@/lib/voice/types";

export const runtime = "nodejs";

const requestSchema = z.object({
  commandText: z.string().trim().min(1).max(300),
  context: z
    .object({
      lastTrailerNumber: z.string().nullable(),
      lastIntent: z.string().nullable(),
      lastCustomer: z.string().nullable(),
    })
    .optional(),
  confirmed: z.boolean().optional(),
});

const actionPermissionMap: Record<VoiceActionIntentName, { moduleKey: "arrivals" | "compound" | "departures" | "vessel_operations"; action: "create" | "edit" | "complete" }> = {
  confirm_departure: { moduleKey: "departures", action: "complete" },
  change_load_status: { moduleKey: "compound", action: "edit" },
  change_compound_position: { moduleKey: "compound", action: "edit" },
  start_inspection: { moduleKey: "vessel_operations", action: "edit" },
  complete_inspection: { moduleKey: "vessel_operations", action: "complete" },
  set_priority: { moduleKey: "vessel_operations", action: "edit" },
  mark_arrived: { moduleKey: "arrivals", action: "create" },
};

const resolveTrailerByNumber = async (supabase: ReturnType<typeof createAuthenticatedRouteSupabaseClient>, trailerNumber?: string) => {
  if (!trailerNumber) {
    return null;
  }

  const { data, error } = await supabase
    .from("trailers")
    .select("id, trailer_number")
    .ilike("trailer_number", trailerNumber)
    .order("arrival_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to resolve trailer.");
  }

  return data;
};

const buildActionPlan = (intent: VoiceActionIntentName, entities: VoiceEntities, trailerId: string | null): VoiceActionPlan => {
  const trailerParam = entities.trailerNumber ? `trailer=${encodeURIComponent(entities.trailerNumber)}` : "";
  const trailerIdParam = trailerId ? `trailerId=${encodeURIComponent(trailerId)}` : "";
  const positionParam = entities.compoundPosition ? `position=${encodeURIComponent(entities.compoundPosition)}` : "";
  const loadParam = entities.loadStatus ? `loadStatus=${encodeURIComponent(entities.loadStatus)}` : "";
  const priorityParam = entities.priority ? `priority=${encodeURIComponent(entities.priority)}` : "";
  const withQuery = (basePath: string, params: string[]) => {
    const normalizedParams = params.filter(Boolean);
    if (normalizedParams.length === 0) {
      return basePath;
    }

    return `${basePath}?${normalizedParams.join("&")}`;
  };

  if (intent === "confirm_departure") {
    return {
      intent,
      confirmationText: `Confirm departure for ${entities.trailerNumber ?? "the selected trailer"}.`,
      safetyLevel: "high",
      moduleHref: withQuery("/dashboard/departure", [trailerParam, trailerIdParam]),
      moduleLabel: "Departures",
    };
  }

  if (intent === "change_load_status") {
    return {
      intent,
      confirmationText: `Change load status of ${entities.trailerNumber ?? "the selected trailer"} to ${entities.loadStatus ?? "requested value"}.`,
      safetyLevel: "high",
      moduleHref: withQuery("/dashboard/load-trailer", [trailerParam, trailerIdParam, loadParam]),
      moduleLabel: "Load Trailer",
    };
  }

  if (intent === "change_compound_position") {
    return {
      intent,
      confirmationText: `Move ${entities.trailerNumber ?? "the selected trailer"} to ${entities.compoundPosition ?? "requested position"}.`,
      safetyLevel: "high",
      moduleHref: withQuery("/dashboard/edit-trailer", ["action=move_to_compound", trailerIdParam, trailerParam, positionParam]),
      moduleLabel: "Edit Trailer",
    };
  }

  if (intent === "start_inspection") {
    return {
      intent,
      confirmationText: `Start inspection workflow for ${entities.trailerNumber ?? "the selected trailer"}.`,
      safetyLevel: "medium",
      moduleHref: withQuery("/dashboard/vessel-operations", [trailerParam]),
      moduleLabel: "Vessel Operations",
    };
  }

  if (intent === "complete_inspection") {
    return {
      intent,
      confirmationText: `Complete inspection workflow for ${entities.trailerNumber ?? "the selected trailer"}.`,
      safetyLevel: "high",
      moduleHref: withQuery("/dashboard/vessel-operations", [trailerParam]),
      moduleLabel: "Vessel Operations",
    };
  }

  if (intent === "set_priority") {
    return {
      intent,
      confirmationText: `Set priority of ${entities.trailerNumber ?? "the selected trailer"} to ${entities.priority ?? "requested level"}.`,
      safetyLevel: "medium",
      moduleHref: withQuery("/dashboard/vessel-operations", [trailerParam, priorityParam]),
      moduleLabel: "Vessel Operations",
    };
  }

  return {
    intent,
    confirmationText: `Mark arrival for ${entities.trailerNumber ?? "the selected trailer"}.`,
    safetyLevel: "high",
    moduleHref: withQuery("/dashboard/new-arrival", [trailerParam]),
    moduleLabel: "Arrivals",
  };
};

const normalizeContext = (raw?: z.infer<typeof requestSchema>["context"]): VoiceContext => {
  if (!raw) {
    return initialVoiceContext;
  }

  return {
    lastIntent: raw.lastIntent ? (raw.lastIntent as VoiceContext["lastIntent"]) : null,
    lastTrailerNumber: raw.lastTrailerNumber,
    lastCustomer: raw.lastCustomer,
  };
};

export async function POST(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await bootstrapCurrentUserRole(supabase, user);

    const payload = requestSchema.parse(await request.json().catch(() => ({})));
    const context = normalizeContext(payload.context);
    const parsed = parseVoiceCommand(payload.commandText, context);
    const nextContext = resolveNextVoiceContext(context, parsed);

    if (parsed.clarification) {
      const response: VoiceExecutionResponse = {
        ok: false,
        mode: isVoiceActionIntent(parsed.intent) ? "action" : "read",
        intent: parsed.intent,
        entities: parsed.entities,
        message: parsed.clarification,
        actionPlan: null,
        assistantResult: null,
        context: nextContext,
      };

      return Response.json(response, { status: 200 });
    }

    if (isVoiceReadIntent(parsed.intent)) {
      await requireRbacPermission(supabase, user.id, "ai_assistant", "view");

      const assistantContext: AssistantContext = {
        supabase,
        question: parsed.sourceText,
        userId: user.id,
      };

      const result = await runIntentQuery(assistantContext, toAssistantIntent(parsed.intent, parsed.entities));
      const formatted = formatAssistantResponse(result);

      const response: VoiceExecutionResponse = {
        ok: true,
        mode: "read",
        intent: parsed.intent,
        entities: parsed.entities,
        message: formatted.answer,
        actionPlan: null,
        assistantResult: {
          title: formatted.title,
          answer: formatted.answer,
          resultType: formatted.resultType,
          dataCount: formatted.data.length,
          links: formatted.links,
        },
        context: nextContext,
      };

      return Response.json(response, { status: 200 });
    }

    if (isVoiceActionIntent(parsed.intent)) {
      const permission = actionPermissionMap[parsed.intent];
      await requireRbacPermission(supabase, user.id, permission.moduleKey, permission.action);

      const trailer = await resolveTrailerByNumber(supabase, parsed.entities.trailerNumber);
      const plan = buildActionPlan(parsed.intent, parsed.entities, trailer?.id ?? null);

      if (!payload.confirmed) {
        const response: VoiceExecutionResponse = {
          ok: true,
          mode: "action",
          intent: parsed.intent,
          entities: parsed.entities,
          message: `${plan.confirmationText} Confirmation is required before continuing.`,
          actionPlan: plan,
          assistantResult: null,
          context: nextContext,
        };

        return Response.json(response, { status: 200 });
      }

      const response: VoiceExecutionResponse = {
        ok: true,
        mode: "action",
        intent: parsed.intent,
        entities: parsed.entities,
        message: `Command confirmed. Open ${plan.moduleLabel} to complete this action using the existing operational workflow.`,
        actionPlan: plan,
        assistantResult: null,
        context: nextContext,
      };

      return Response.json(response, { status: 200 });
    }

    const unknownResponse: VoiceExecutionResponse = {
      ok: false,
      mode: "read",
      intent: "unknown",
      entities: parsed.entities,
      message: "I could not understand this command.",
      actionPlan: null,
      assistantResult: null,
      context: nextContext,
    };

    return Response.json(unknownResponse, { status: 200 });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid voice command payload." }, { status: 400 });
    }

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Voice command failed.",
      },
      { status: 500 },
    );
  }
}
