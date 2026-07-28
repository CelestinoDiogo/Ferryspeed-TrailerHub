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
import { loadVesselReportDraftById } from "@/lib/reports/vessel-operation-ai-report-store";
import type { Database } from "@/lib/database.types";

type ReportRow = Database["public"]["Tables"]["vessel_operation_reports"]["Row"];

const normalizeStatus = (value?: string | null): "draft" | "final" | "sent" => {
  const status = (value ?? "").trim().toLowerCase();
  if (status === "sent") return "sent";
  if (status === "approved" || status === "final") return "final";
  return "draft";
};

const toNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const buildComparisonDelta = (liveData: Awaited<ReturnType<typeof getVesselOperationReport>>, row: ReportRow) => {
  const snapshotRaw = row.structured_snapshot ?? row.structured_data_snapshot;
  const snapshot = snapshotRaw && typeof snapshotRaw === "object" ? (snapshotRaw as Record<string, unknown>) : null;
  const totals = snapshot && typeof snapshot.totals === "object" ? (snapshot.totals as Record<string, unknown>) : null;

  const baseline = {
    expectedTrailers: toNumber(totals?.expected),
    arrivedTrailers: toNumber(totals?.arrived),
    inspectedTrailers: toNumber(totals?.inspectionCompleted),
    pendingInspections: toNumber(totals?.inspectionPending),
    damagedTrailers: toNumber(totals?.damageReports),
    temperatureAlertTrailers: toNumber(totals?.temperatureAlerts),
  };

  const current = {
    expectedTrailers: liveData.statistics.expectedTrailers,
    arrivedTrailers: liveData.statistics.arrivedTrailers,
    inspectedTrailers: liveData.statistics.inspectedTrailers,
    pendingInspections: liveData.statistics.pendingInspections,
    damagedTrailers: liveData.statistics.damagedTrailers,
    temperatureAlertTrailers: liveData.statistics.temperatureAlertTrailers,
  };

  const delta = {
    expectedTrailers: current.expectedTrailers - baseline.expectedTrailers,
    arrivedTrailers: current.arrivedTrailers - baseline.arrivedTrailers,
    inspectedTrailers: current.inspectedTrailers - baseline.inspectedTrailers,
    pendingInspections: current.pendingInspections - baseline.pendingInspections,
    damagedTrailers: current.damagedTrailers - baseline.damagedTrailers,
    temperatureAlertTrailers: current.temperatureAlertTrailers - baseline.temperatureAlertTrailers,
  };

  return {
    baseline,
    current,
    delta,
  };
};

const paramsSchema = z.object({
  id: z.string().uuid(),
  reportId: z.string().uuid(),
});

const updateSchema = z.object({
  action: z.enum(["save_draft", "approve"]),
});

export async function GET(request: Request, context: { params: Promise<{ id: string; reportId: string }> }) {
  try {
    const parsedParams = paramsSchema.parse(await context.params);

    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    await requireAuthenticatedRouteUser(supabase, accessToken);
    await requireReadableVesselOperation(supabase, parsedParams.id);
    const reportData = await getVesselOperationReport(supabase, parsedParams.id);

    const reportResult = await supabase
      .from("vessel_operation_reports")
      .select("*")
      .eq("id", parsedParams.reportId)
      .eq("vessel_operation_id", parsedParams.id)
      .maybeSingle();

    if (reportResult.error) {
      throw new Error("Unable to load stored report for comparison.");
    }

    if (!reportResult.data) {
      return Response.json({ error: "Report not found." }, { status: 404 });
    }

    const row = reportResult.data as ReportRow;
    const reportDraft = await loadVesselReportDraftById(supabase, parsedParams.id, parsedParams.reportId);
    const comparison = buildComparisonDelta(reportData, row);

    return Response.json({
      report: {
        reportId: row.id,
        status: normalizeStatus(row.report_status),
        generatedAt: row.generated_at ?? row.created_at,
        generatedBy: row.generated_by ?? null,
        subject: row.subject ?? row.title,
      },
      reportDraft,
      reportData,
      comparison,
      message: "Historical report loaded for comparison.",
    });
  } catch (error) {
    console.error("Load report by id endpoint failed:", error);

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid request payload.", details: error.flatten() }, { status: 400 });
    }

    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof SupabaseRouteNotFoundError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to load report." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; reportId: string }> }) {
  try {
    const parsedParams = paramsSchema.parse(await context.params);
    updateSchema.parse(await request.json());

    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    await requireAuthenticatedRouteUser(supabase, accessToken);
    await requireReadableVesselOperation(supabase, parsedParams.id);
    const reportData = await getVesselOperationReport(supabase, parsedParams.id);

    const reportResult = await supabase
      .from("vessel_operation_reports")
      .select("*")
      .eq("id", parsedParams.reportId)
      .eq("vessel_operation_id", parsedParams.id)
      .maybeSingle();

    if (reportResult.error) {
      throw new Error("Unable to load stored report for comparison.");
    }

    if (!reportResult.data) {
      return Response.json({ error: "Report not found." }, { status: 404 });
    }

    const row = reportResult.data as ReportRow;
    const reportDraft = await loadVesselReportDraftById(supabase, parsedParams.id, parsedParams.reportId);
    const comparison = buildComparisonDelta(reportData, row);

    return Response.json({
      report: {
        reportId: row.id,
        status: normalizeStatus(row.report_status),
        generatedAt: row.generated_at ?? row.created_at,
        generatedBy: row.generated_by ?? null,
        subject: row.subject ?? row.title,
      },
      reportDraft,
      reportData,
      comparison,
      message: "Historical report loaded for comparison.",
    });
  } catch (error) {
    console.error("Update report endpoint failed:", error);

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid request payload.", details: error.flatten() }, { status: 400 });
    }

    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof SupabaseRouteNotFoundError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to update report." }, { status: 500 });
  }
}
