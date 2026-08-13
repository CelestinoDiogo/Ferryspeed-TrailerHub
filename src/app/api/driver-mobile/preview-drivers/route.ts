import { bootstrapCurrentUserRole, RbacPermissionError } from "@/lib/rbac/route";
import { listActiveDrivers } from "@/lib/driver-access";
import { DriverMobileIdentityError } from "@/lib/driver-mobile-identity";
import { requireDriverMobileReadAccess } from "@/lib/driver-mobile-read-access";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await bootstrapCurrentUserRole(supabase, user);
    const role = await requireDriverMobileReadAccess(supabase, user.id);
    if (role?.role_key !== "administrator" && role?.role_key !== "supervisor") {
      throw new DriverMobileIdentityError("Driver preview is available only to Administrators and Supervisors.", "PREVIEW_NOT_ALLOWED", 403);
    }

    const drivers = await listActiveDrivers(supabase);
    return Response.json({ drivers: drivers.map((driver) => ({ id: driver.id, displayName: driver.display_name })) });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message, code: "UNAUTHENTICATED" }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }

    if (error instanceof DriverMobileIdentityError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }

    return Response.json({ error: "Unable to load preview Drivers." }, { status: 500 });
  }
}
