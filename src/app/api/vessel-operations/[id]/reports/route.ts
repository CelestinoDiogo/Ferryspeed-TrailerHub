import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { buildSnapshotHash, parseRecommendations } from "@/lib/reports/report-utils";
import type { VesselOperationReportSnapshot } from "@/lib/reports/types";
import { getVesselOperationReportData } from "@/lib/reports/get-vessel-operation-report-data";
import { getSupabaseServiceClient } from "@/lib/supabase-server";

const paramsSchema = z.object({
  id: z.string().uuid(),
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

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = paramsSchema.parse(await context.params);
    const supabase = getSupabaseServiceClient();

    const { data: report, error } = await supabase
      .from("vessel_operation_reports")
      .select(reportSelect)
      .eq("vessel_operation_id", parsedParams.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message || "Unable to load report.");
    }

    if (!report) {
      return Response.json({ report: null, hasDataChangedSinceApproval: false });
    }

    let hasDataChangedSinceApproval = false;
    const snapshot = parseSnapshot(report.structured_snapshot);

    if (snapshot && report.report_status === "approved") {
      const latest = await getVesselOperationReportData(parsedParams.id);
      const currentHash = buildSnapshotHash(latest);
      hasDataChangedSinceApproval = currentHash !== snapshot.snapshotHash;
    }

    return Response.json({
      report: {
        ...report,
        recommendations_list: parseRecommendations(report.recommendations),
      },
      hasDataChangedSinceApproval,
    });
  } catch (error) {
    console.error("Load report endpoint failed:", error);

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid vessel operation id." }, { status: 400 });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to load report." }, { status: 500 });
  }
}
