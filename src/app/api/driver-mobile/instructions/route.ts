import { z } from "zod";
import { bootstrapCurrentUserRole, RbacPermissionError } from "@/lib/rbac/route";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";
import { DriverMobileIdentityError, resolveDriverMobileReadContext } from "@/lib/driver-mobile-identity";
import { requireDriverMobileReadAccess } from "@/lib/driver-mobile-read-access";
import { listDriverOperationalInstructionsForPreview } from "@/lib/driver-mobile-preview-instructions";
import { listDriverOperationalInstructionsForUser } from "@/lib/driver-operational-instructions";

export const runtime = "nodejs";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  previewDriverId: z.string().uuid().optional(),
});

export async function GET(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await bootstrapCurrentUserRole(supabase, user);
    await requireDriverMobileReadAccess(supabase, user.id);

    const params = new URL(request.url).searchParams;
    const query = querySchema.parse({
      limit: params.get("limit") ?? undefined,
      previewDriverId: params.get("previewDriverId") ?? undefined,
    });

    const context = await resolveDriverMobileReadContext(supabase, user.id, query.previewDriverId);
    const payload = context.isPreview
      ? await listDriverOperationalInstructionsForPreview(supabase, context.driver, { limit: query.limit })
      : await listDriverOperationalInstructionsForUser(supabase, user.id, { limit: query.limit });

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

    if (error instanceof z.ZodError) {
      const hasPreviewDriverId = new URL(request.url).searchParams.has("previewDriverId");
      return hasPreviewDriverId
        ? Response.json({ error: "The selected Driver is invalid.", code: "PREVIEW_DRIVER_INVALID" }, { status: 400 })
        : Response.json({ error: "Invalid instructions query." }, { status: 400 });
    }

    return Response.json({ error: "Unable to load operational instructions right now." }, { status: 500 });
  }
}
