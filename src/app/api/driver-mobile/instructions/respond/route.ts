import { z } from "zod";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";
import {
  createDriverOperationalInstructionResponse,
  DRIVER_RESPONSE_NOTE_MAX_LENGTH,
  type DriverQuickResponseType,
} from "@/lib/driver-operational-instructions";

export const runtime = "nodejs";

const requestSchema = z.object({
  instructionId: z.string().uuid(),
  responseType: z.enum(["OK", "COMPLETED", "ARRIVED", "DELAYED", "PROBLEM", "CALL_ME"]),
  note: z.string().trim().max(DRIVER_RESPONSE_NOTE_MAX_LENGTH).optional(),
}).strict();

const toResponseType = (value: "OK" | "COMPLETED" | "ARRIVED" | "DELAYED" | "PROBLEM" | "CALL_ME"): DriverQuickResponseType => {
  if (value === "CALL_ME") {
    return "call_me";
  }

  return value.toLowerCase() as DriverQuickResponseType;
};

export async function POST(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "driver_mobile", "view");

    const payload = requestSchema.parse(await request.json().catch(() => ({})));
    const responseEvent = await createDriverOperationalInstructionResponse(supabase, user.id, {
      instructionId: payload.instructionId,
      responseType: toResponseType(payload.responseType),
      note: payload.note,
    });

    return Response.json({ ok: true, response: responseEvent }, { status: 200 });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid instruction response payload." }, { status: 400 });
    }

    if (error instanceof Error) {
      const lowered = error.message.toLowerCase();
      if (lowered.includes("not found")) {
        return Response.json({ error: error.message }, { status: 404 });
      }

      if (lowered.includes("invalid response type") || lowered.includes("must be")) {
        return Response.json({ error: error.message }, { status: 400 });
      }

      if (lowered.includes("no active driver profile")) {
        return Response.json({ error: error.message }, { status: 409 });
      }

      return Response.json({ error: error.message }, { status: 403 });
    }

    return Response.json({ error: "Unable to record driver response right now." }, { status: 500 });
  }
}
