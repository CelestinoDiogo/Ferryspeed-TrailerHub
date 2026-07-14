import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { generateAIReportNarrative } from "@/lib/reports/generate-ai-report-narrative";
import { getVesselOperationReportData } from "@/lib/reports/get-vessel-operation-report-data";
import { buildDeterministicNarrative, buildSnapshot, parseRecommendations, stringifyRecommendations } from "@/lib/reports/report-utils";
import type { VesselOperationReportSnapshot } from "@/lib/reports/types";
import { getSupabaseServiceClient } from "@/lib/supabase-server";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const requestSchema = z.object({
  reportId: z.string().uuid().optional(),
  preserveSnapshot: z.boolean().optional().default(true),
});

const reportSelect = "id, vessel_operation_id, report_type, report_status, report_number, title, executive_summary, operational_analysis, recommendations, conclusion, structured_snapshot, generated_by_ai, ai_model, approved_at, approved_by, sent_at, sent_by, created_at, updated_at";

function parseSnapshot(snapshot: Json | null): VesselOperationReportSnapshot | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }

  const payload = snapshot as { data?: unknown; snapshotHash?: unknown; generatedAt?: unknown };
  if (!payload.data || typeof payload.snapshotHash !== "string" || typeof payload.generatedAt !== "string") {
    return null;
  }

  return payload as VesselOperationReportSnapshot;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = paramsSchema.parse(await context.params);
    const parsedBody = requestSchema.parse(await request.json().catch(() => ({})));

    const supabase = getSupabaseServiceClient();

    let existingReport: {
      id: string;
      structured_snapshot: Json;
    } | null = null;

    if (parsedBody.reportId) {
      const { data: existingData, error: existingError } = await supabase
        .from("vessel_operation_reports")
        .select("id, structured_snapshot")
        .eq("id", parsedBody.reportId)
        .eq("vessel_operation_id", parsedParams.id)
        .single();

      if (existingError || !existingData) {
        return Response.json({ error: "Report not found." }, { status: 404 });
      }

      existingReport = existingData;
    }

    const liveData = await getVesselOperationReportData(parsedParams.id);
    const liveSnapshot = buildSnapshot(liveData);

    const existingSnapshot = parseSnapshot(existingReport?.structured_snapshot ?? null);
    const effectiveSnapshot = parsedBody.preserveSnapshot && existingSnapshot ? existingSnapshot : liveSnapshot;

    let generatedByAI = true;
    let aiModel: string | null = null;
    let reportStatus = "generated";

    let narrative;
    try {
      const aiResult = await generateAIReportNarrative(effectiveSnapshot.data);
      narrative = aiResult.narrative;
      aiModel = aiResult.model;
    } catch (error) {
      console.error("AI report generation failed:", error);
      generatedByAI = false;
      aiModel = null;
      reportStatus = "failed";
      narrative = buildDeterministicNarrative(effectiveSnapshot.data);
    }

    let reportNumber: string | null = null;
    if (!existingReport) {
      const { data: rpcNumber, error: numberError } = await supabase.rpc("next_vessel_operation_report_number");
      if (numberError || !rpcNumber) {
        console.error("Report number generation failed:", numberError);
        const year = new Date().getFullYear();
        reportNumber = `VOR-${year}-${Date.now().toString().slice(-5)}`;
      } else {
        reportNumber = rpcNumber;
      }
    }

    const nowIso = new Date().toISOString();

    if (existingReport) {
      const { data: updated, error: updateError } = await supabase
        .from("vessel_operation_reports")
        .update({
          report_status: reportStatus,
          executive_summary: narrative.executiveSummary,
          operational_analysis: narrative.operationalAnalysis,
          recommendations: stringifyRecommendations(narrative.recommendations),
          conclusion: narrative.conclusion,
          generated_by_ai: generatedByAI,
          ai_model: aiModel,
          updated_at: nowIso,
        })
        .eq("id", existingReport.id)
        .eq("vessel_operation_id", parsedParams.id)
        .select(reportSelect)
        .single();

      if (updateError || !updated) {
        throw new Error(updateError?.message || "Unable to update report narrative.");
      }

      return Response.json({
        report: {
          ...updated,
          recommendations_list: parseRecommendations(updated.recommendations),
        },
        usedFallback: !generatedByAI,
      });
    }

    const { data: inserted, error: insertError } = await supabase
      .from("vessel_operation_reports")
      .insert({
        vessel_operation_id: parsedParams.id,
        report_type: "operational",
        report_status: reportStatus,
        report_number: reportNumber,
        title: `Vessel Operations Report - ${effectiveSnapshot.data.operation.vesselName}`,
        executive_summary: narrative.executiveSummary,
        operational_analysis: narrative.operationalAnalysis,
        recommendations: stringifyRecommendations(narrative.recommendations),
        conclusion: narrative.conclusion,
        structured_snapshot: effectiveSnapshot as unknown as Json,
        generated_by_ai: generatedByAI,
        ai_model: aiModel,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select(reportSelect)
      .single();

    if (insertError || !inserted) {
      throw new Error(insertError?.message || "Unable to save report.");
    }

    return Response.json({
      report: {
        ...inserted,
        recommendations_list: parseRecommendations(inserted.recommendations),
      },
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
