import { z } from "zod";
import { assignExportAllocationTrailer } from "@/lib/operations/assign-export-allocation-trailer";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";
import { TrailerJobConflictError } from "@/lib/trailer-job-eligibility";

export const runtime = "nodejs";

const requestSchema = z.object({
  allocationId: z.string().uuid(),
  trailerId: z.string().uuid(),
});

const resolveOperatorName = (user: { email?: string | null; user_metadata?: Record<string, unknown> | null }) => {
  const metadataName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim())
    || (typeof user.user_metadata?.name === "string" && user.user_metadata.name.trim());

  return metadataName || user.email || "TrailerHub User";
};

export async function POST(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "export_operations", "edit");

    const payload = requestSchema.parse(await request.json().catch(() => ({})));
    const result = await assignExportAllocationTrailer({
      supabase,
      allocationId: payload.allocationId,
      trailerId: payload.trailerId,
      operatorName: resolveOperatorName(user),
    });

    return Response.json({ result }, { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid trailer assignment request." }, { status: 400 });
    }

    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof TrailerJobConflictError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unable to assign trailer.",
      },
      { status: 400 },
    );
  }
}
