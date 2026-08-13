import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import { z } from "zod";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";
import { DriverMobileIdentityError, resolveDriverMobileReadContext } from "@/lib/driver-mobile-identity";
import { loadDriverMobileTasksForDriver } from "@/lib/driver-mobile-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "driver_mobile", "view");

    const previewDriverIdParam = new URL(request.url).searchParams.get("previewDriverId");
    const previewDriverId = previewDriverIdParam
      ? z.string().uuid().safeParse(previewDriverIdParam)
      : null;
    if (previewDriverId && !previewDriverId.success) {
      throw new DriverMobileIdentityError("The selected Driver is invalid.", "PREVIEW_DRIVER_INVALID");
    }
    const context = await resolveDriverMobileReadContext(supabase, user.id, previewDriverId?.data ?? null);
    const payload = await loadDriverMobileTasksForDriver(supabase, context.driver);

    return Response.json({ ...payload, mode: context.isPreview ? "preview" : "driver", readOnly: context.isPreview }, { status: 200 });
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

    return Response.json({ error: "Unable to load driver tasks right now." }, { status: 500 });
  }
}
