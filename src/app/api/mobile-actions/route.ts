import { z } from "zod";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";
import { executeMobileAction } from "@/lib/mobile/mobile-actions-service";
import { mobileActionRequestSchema, type MobileActionRequest } from "@/lib/mobile/mobile-actions";

export const runtime = "nodejs";

const requestSchema = z.object({
  actionId: z.string().trim().min(1).max(120).optional(),
  action: mobileActionRequestSchema,
});

const permissionByActionType: Record<MobileActionRequest["actionType"], { moduleKey: "arrivals" | "compound" | "vessel_operations"; action: "create" | "edit" | "complete" }> = {
  MARK_ARRIVED: { moduleKey: "arrivals", action: "create" },
  MOVE_COMPOUND_POSITION: { moduleKey: "compound", action: "edit" },
  CHANGE_LOAD_STATUS: { moduleKey: "compound", action: "edit" },
  START_INSPECTION: { moduleKey: "vessel_operations", action: "edit" },
  SAVE_INSPECTION_PROGRESS: { moduleKey: "vessel_operations", action: "edit" },
  COMPLETE_INSPECTION: { moduleKey: "vessel_operations", action: "complete" },
};

export async function POST(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await bootstrapCurrentUserRole(supabase, user);

    const payload = requestSchema.parse(await request.json().catch(() => ({})));
    const permission = permissionByActionType[payload.action.actionType];

    await requireRbacPermission(supabase, user.id, permission.moduleKey, permission.action);

    const result = await executeMobileAction(supabase, user, payload.action);

    return Response.json(
      {
        ok: result.ok,
        actionId: payload.actionId ?? null,
        status: result.status,
        message: result.message,
        retryable: result.retryable,
        conflict: result.conflict ?? null,
        updatedTrailer: result.updatedTrailer ?? null,
        updatedVesselTrailer: result.updatedVesselTrailer ?? null,
      },
      { status: result.status === "failed" ? 400 : 200 },
    );
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid mobile action payload." }, { status: 400 });
    }

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unable to execute mobile action.",
      },
      { status: 500 },
    );
  }
}
