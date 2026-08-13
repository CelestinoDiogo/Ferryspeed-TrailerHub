import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";
import { loadDriverMobileTasksForUser } from "@/lib/driver-mobile-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "driver_mobile", "view");

    const payload = await loadDriverMobileTasksForUser(supabase, user.id);

    return Response.json(payload, { status: 200 });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message, code: "UNAUTHENTICATED" }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message, code: "RBAC_PERMISSION_DENIED" }, { status: error.status });
    }

    return Response.json({ error: "Unable to load driver tasks right now." }, { status: 500 });
  }
}
