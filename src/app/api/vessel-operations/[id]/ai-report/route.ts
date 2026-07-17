import { z } from "zod";
import {
  buildDeterministicVesselOperationAiReportDraft,
  buildVesselOperationAiReportBody,
  buildVesselOperationAiReportSubject,
  generateVesselOperationAiSections,
} from "@/lib/reports/vessel-operation-ai-report";
import { createAuthenticatedRouteSupabaseClient } from "@/lib/supabase-route-client";
import { getVesselOperationReport } from "@/lib/vessel-report";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const requestSchema = z.object({
  reportId: z.string().uuid().optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = paramsSchema.parse(await context.params);
    const supabase = createAuthenticatedRouteSupabaseClient(_request);
    const reportData = await getVesselOperationReport(supabase, parsedParams.id);
    const reportDraft = reportData.operation.status === "completed"
      ? buildDeterministicVesselOperationAiReportDraft(reportData)
      : null;

    return Response.json({
      report: null,
      reportData,
      reportDraft,
      usedFallback: reportDraft?.usedFallback ?? false,
      message: reportDraft ? "Live report preview generated from current vessel operation data." : "AI report preview is available after the vessel operation is completed.",
    });
  } catch (error) {
    console.error("Load AI report failed:", error);

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid vessel operation id." }, { status: 400 });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to load AI report." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = paramsSchema.parse(await context.params);
    requestSchema.parse(await request.json().catch(() => ({})));
    const supabase = createAuthenticatedRouteSupabaseClient(request);

    const liveData = await getVesselOperationReport(supabase, parsedParams.id);

    let reportDraft = buildDeterministicVesselOperationAiReportDraft(liveData);
    let usedFallback = true;
    let aiModel: string | null = null;
    let message: string | null = "A deterministic template report was generated from the live vessel data.";

    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      try {
        const { sections, model } = await generateVesselOperationAiSections(liveData);
        reportDraft = {
          reportId: null,
          subject: buildVesselOperationAiReportSubject(liveData),
          body: buildVesselOperationAiReportBody(sections),
          sections,
          generationMode: "ai",
          usedFallback: false,
          aiModel: model,
          generatedAt: new Date().toISOString(),
        };
        usedFallback = false;
        aiModel = model;
        message = null;
      } catch (error) {
        console.error("AI report generation failed:", error);
        message = "AI generation failed, so a deterministic template was generated from the live vessel data.";
      }
    }

    return Response.json({
      report: null,
      reportData: liveData,
      reportDraft,
      usedFallback,
      message,
    });
  } catch (error) {
    console.error("Generate AI report failed:", error);

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid request payload.", details: error.flatten() }, { status: 400 });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to generate AI report." }, { status: 500 });
  }
}