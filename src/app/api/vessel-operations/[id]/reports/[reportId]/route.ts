import { z } from "zod";
import { createAuthenticatedRouteSupabaseClient } from "@/lib/supabase-route-client";
import { getVesselOperationReport } from "@/lib/vessel-report";

const paramsSchema = z.object({
  id: z.string().uuid(),
  reportId: z.string().uuid(),
});

const updateSchema = z.object({
  action: z.enum(["save_draft", "approve"]),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string; reportId: string }> }) {
  try {
    const parsedParams = paramsSchema.parse(await context.params);
    updateSchema.parse(await request.json());

    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const reportData = await getVesselOperationReport(supabase, parsedParams.id);

    return Response.json({
      report: null,
      reportData,
      message: "Stored vessel operation reports are not supported. Use the live shared report data instead.",
    });
  } catch (error) {
    console.error("Update report endpoint failed:", error);

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid request payload.", details: error.flatten() }, { status: 400 });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to update report." }, { status: 500 });
  }
}
