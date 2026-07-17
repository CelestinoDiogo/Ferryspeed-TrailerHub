import { z } from "zod";
import { generateAIReportNarrative } from "@/lib/reports/generate-ai-report-narrative";
import { buildDeterministicNarrative } from "@/lib/reports/report-utils";
import { createAuthenticatedRouteSupabaseClient } from "@/lib/supabase-route-client";
import { getVesselOperationReport } from "@/lib/vessel-report";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const requestSchema = z.object({
  reportId: z.string().uuid().optional(),
  preserveSnapshot: z.boolean().optional().default(true),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = paramsSchema.parse(await context.params);
    requestSchema.parse(await request.json().catch(() => ({})));

    const supabase = createAuthenticatedRouteSupabaseClient(request);

    const liveData = await getVesselOperationReport(supabase, parsedParams.id);

    let generatedByAI = true;
    let aiModel: string | null = null;

    let narrative;
    try {
      const aiResult = await generateAIReportNarrative(liveData);
      narrative = aiResult.narrative;
      aiModel = aiResult.model;
    } catch (error) {
      console.error("AI report generation failed:", error);
      generatedByAI = false;
      aiModel = null;
      narrative = buildDeterministicNarrative(liveData);
    }

    return Response.json({
      report: null,
      reportData: liveData,
      narrative,
      aiModel,
      usedFallback: !generatedByAI,
    });
  } catch (error) {
    console.error("Generate report endpoint failed:", error);

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid request payload.", details: error.flatten() }, { status: 400 });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to generate report." }, { status: 500 });
  }
}
