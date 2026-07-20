import { z } from "zod";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  requireReadableVesselOperation,
  SupabaseRouteAuthError,
  SupabaseRouteNotFoundError,
} from "@/lib/supabase-route-client";
import { getVesselOperationReport } from "@/lib/vessel-report";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = paramsSchema.parse(await context.params);
    const accessToken = getRouteBearerToken(_request);
    const supabase = createAuthenticatedRouteSupabaseClient(_request);
    await requireAuthenticatedRouteUser(supabase, accessToken);
    await requireReadableVesselOperation(supabase, parsedParams.id);
    const reportData = await getVesselOperationReport(supabase, parsedParams.id);

    return Response.json({ reportData });
  } catch (error) {
    console.error("Load vessel summary report failed:", error);

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid vessel operation id." }, { status: 400 });
    }

    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof SupabaseRouteNotFoundError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to load Vessel Operation Report." }, { status: 500 });
  }
}