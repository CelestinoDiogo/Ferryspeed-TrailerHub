import { z } from "zod";
import { parseRecommendations, stringifyRecommendations } from "@/lib/reports/report-utils";
import { getSupabaseServiceClient } from "@/lib/supabase-server";

const paramsSchema = z.object({
  id: z.string().uuid(),
  reportId: z.string().uuid(),
});

const updateSchema = z.object({
  action: z.enum(["save_draft", "approve"]),
  executiveSummary: z.string().optional(),
  operationalAnalysis: z.string().optional(),
  recommendations: z.array(z.string()).optional(),
  conclusion: z.string().optional(),
  approvedBy: z.string().optional(),
});

const reportSelect = "id, vessel_operation_id, report_type, report_status, report_number, title, executive_summary, operational_analysis, recommendations, conclusion, structured_snapshot, generated_by_ai, ai_model, approved_at, approved_by, sent_at, sent_by, created_at, updated_at";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; reportId: string }> }) {
  try {
    const parsedParams = paramsSchema.parse(await context.params);
    const body = updateSchema.parse(await request.json());

    const supabase = getSupabaseServiceClient();

    const { data: existing, error: existingError } = await supabase
      .from("vessel_operation_reports")
      .select("id, report_status")
      .eq("id", parsedParams.reportId)
      .eq("vessel_operation_id", parsedParams.id)
      .single();

    if (existingError || !existing) {
      return Response.json({ error: "Report not found." }, { status: 404 });
    }

    const nowIso = new Date().toISOString();

    if (body.action === "save_draft") {
      const { data: updated, error: updateError } = await supabase
        .from("vessel_operation_reports")
        .update({
          executive_summary: body.executiveSummary ?? null,
          operational_analysis: body.operationalAnalysis ?? null,
          recommendations: stringifyRecommendations(body.recommendations ?? []),
          conclusion: body.conclusion ?? null,
          report_status: existing.report_status === "approved" ? "approved" : "draft",
          updated_at: nowIso,
        })
        .eq("id", parsedParams.reportId)
        .eq("vessel_operation_id", parsedParams.id)
        .select(reportSelect)
        .single();

      if (updateError || !updated) {
        throw new Error(updateError?.message || "Unable to save report draft.");
      }

      return Response.json({
        report: {
          ...updated,
          recommendations_list: parseRecommendations(updated.recommendations),
        },
      });
    }

    const { data: approved, error: approveError } = await supabase
      .from("vessel_operation_reports")
      .update({
        report_status: "approved",
        approved_at: nowIso,
        approved_by: body.approvedBy?.trim() || null,
        updated_at: nowIso,
      })
      .eq("id", parsedParams.reportId)
      .eq("vessel_operation_id", parsedParams.id)
      .select(reportSelect)
      .single();

    if (approveError || !approved) {
      throw new Error(approveError?.message || "Unable to approve report.");
    }

    return Response.json({
      report: {
        ...approved,
        recommendations_list: parseRecommendations(approved.recommendations),
      },
    });
  } catch (error) {
    console.error("Update report endpoint failed:", error);

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid request payload.", details: error.flatten() }, { status: 400 });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to update report." }, { status: 500 });
  }
}
