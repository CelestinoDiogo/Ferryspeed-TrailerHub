import { z } from "zod";
import { updateUserRoleSchema } from "@/lib/rbac/client";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import { listUsersWithRoles, updateUserRole } from "@/lib/rbac/service";
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
    await requireRbacPermission(supabase, user.id, "user_management", "view");

    const users = await listUsersWithRoles(supabase);
    return Response.json({ users });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to load users." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);

    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "user_management", "manage_users");

    const payload = updateUserRoleSchema.parse(await request.json().catch(() => ({})));
    const updated = await updateUserRole(supabase, {
      ...payload,
      changedBy: user.id,
    });
    return Response.json({ user: updated.user, auditEvent: updated.auditEvent });
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

    return Response.json({ error: error instanceof Error ? error.message : "Unable to update user role." }, { status: 500 });
  }
}
