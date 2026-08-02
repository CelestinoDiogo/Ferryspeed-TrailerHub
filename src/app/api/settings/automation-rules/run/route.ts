import { z } from "zod";
import {
  listEnabledSchedulerRules,
  runAutomationForRecentActivityEvents,
} from "@/lib/automation/engine";
import { dispatchSchedulerRules } from "@/lib/automation/scheduler-dispatch";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";

const runSchema = z
  .object({
    mode: z.enum(["events", "scheduler"]),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);

    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "settings", "manage_settings");

    const payload = runSchema.parse(await request.json().catch(() => ({})));

    if (payload.mode === "events") {
      const summaries = await runAutomationForRecentActivityEvents(supabase, payload.limit ?? 120);
      return Response.json({ mode: payload.mode, summaries });
    }

    const rules = await listEnabledSchedulerRules(supabase);
    const summaries = await dispatchSchedulerRules(request, rules);
    return Response.json({ mode: payload.mode, summaries });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid run payload." }, { status: 400 });
    }

    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to run automation." }, { status: 500 });
  }
}
