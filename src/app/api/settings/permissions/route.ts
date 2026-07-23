import { z } from "zod";
import { updatePermissionSchema } from "@/lib/rbac/client";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import { listPermissions, updatePermission } from "@/lib/rbac/service";
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

    const permissions = await listPermissions(supabase);
    return Response.json({ permissions });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to load permissions." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);

    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "settings", "edit");

    const payload = updatePermissionSchema.parse(await request.json().catch(() => ({})));
    const updated = await updatePermission(supabase, payload);
    return Response.json({ permission: updated });
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

    return Response.json({ error: error instanceof Error ? error.message : "Unable to update permissions." }, { status: 500 });
  }
}
