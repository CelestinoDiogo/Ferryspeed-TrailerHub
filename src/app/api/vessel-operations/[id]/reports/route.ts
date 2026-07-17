import { z } from "zod";
import { createAuthenticatedRouteSupabaseClient } from "@/lib/supabase-route-client";
import { getVesselOperationReport } from "@/lib/vessel-report";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = paramsSchema.parse(await context.params);
    const supabase = createAuthenticatedRouteSupabaseClient(_request);
    const reportData = await getVesselOperationReport(supabase, parsedParams.id);

    return Response.json({
      report: null,
      reportData,
      hasDataChangedSinceApproval: false,
    });
  } catch (error) {
    console.error("Load report endpoint failed:", error);

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid vessel operation id." }, { status: 400 });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to load report." }, { status: 500 });
  }
}
