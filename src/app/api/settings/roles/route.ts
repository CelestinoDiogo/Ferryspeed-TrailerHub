import { z } from "zod";
import { updateRoleSchema } from "@/lib/rbac/client";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import { listRoles, updateRole } from "@/lib/rbac/service";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";

export async function GET(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);

    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "settings", "view");

    const roles = await listRoles(supabase);
    return Response.json({ roles });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to load roles." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);

    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "settings", "manage_settings");

    const payload = updateRoleSchema.parse(await request.json().catch(() => ({})));
    const updated = await updateRole(supabase, payload);
    return Response.json({ role: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid payload." }, { status: 400 });
    }

    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to update role." }, { status: 500 });
  }
}
