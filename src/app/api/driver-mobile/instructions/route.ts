import { z } from "zod";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";
import { listDriverOperationalInstructionsForUser } from "@/lib/driver-operational-instructions";

export const runtime = "nodejs";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "driver_mobile", "view");

    const params = new URL(request.url).searchParams;
    const query = querySchema.parse({
      limit: params.get("limit") ?? undefined,
    });

    const payload = await listDriverOperationalInstructionsForUser(supabase, user.id, {
      limit: query.limit,
    });

    return Response.json(payload, { status: 200 });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message, code: "UNAUTHENTICATED" }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message, code: "RBAC_PERMISSION_DENIED" }, { status: error.status });
    }

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid instructions query." }, { status: 400 });
    }

    return Response.json({ error: "Unable to load operational instructions right now." }, { status: 500 });
  }
}
