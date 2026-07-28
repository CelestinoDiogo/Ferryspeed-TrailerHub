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
import type { Database } from "@/lib/database.types";
import type { VesselOperationComparisonItem, VesselOperationReportLibraryItem } from "@/lib/reports/types";

type ReportRow = Database["public"]["Tables"]["vessel_operation_reports"]["Row"];
type OperationRow = Database["public"]["Tables"]["vessel_operations"]["Row"];

const querySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["all", "draft", "final", "sent"]).default("all"),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  comparisonLimit: z.coerce.number().int().min(1).max(20).default(5),
});

const normalizeStatus = (value?: string | null): "draft" | "final" | "sent" => {
  const status = (value ?? "").trim().toLowerCase();
  if (status === "sent") {
    return "sent";
  }
  if (status === "approved" || status === "final") {
    return "final";
  }
  return "draft";
};

const parseStructuredSnapshot = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
};

const safeNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const extractComparisonFromReport = (
  report: ReportRow,
  operation: OperationRow | null,
): VesselOperationComparisonItem => {
  const snapshot = parseStructuredSnapshot(report.structured_snapshot ?? report.structured_data_snapshot);
  const totals = snapshot && typeof snapshot.totals === "object" ? (snapshot.totals as Record<string, unknown>) : null;
  const expectedTrailers = safeNumber(totals?.expected);
  const arrivedTrailers = safeNumber(totals?.arrived);
  const inspectedTrailers = safeNumber(totals?.inspectionCompleted);
  const pendingInspections = safeNumber(totals?.inspectionPending);
  const damagedTrailers = safeNumber(totals?.damageReports);
  const temperatureAlertTrailers = safeNumber(totals?.temperatureAlerts);
  const completionPercentage = expectedTrailers > 0 ? Math.round((inspectedTrailers / expectedTrailers) * 1000) / 10 : 0;

  return {
    vesselOperationId: report.vessel_operation_id,
    vesselName: operation?.vessel_name ?? null,
    voyageReference: operation?.sailing_reference ?? null,
    operationCompletedAt: operation?.status === "completed" ? operation.updated_at ?? null : null,
    expectedTrailers,
    arrivedTrailers,
    inspectedTrailers,
    pendingInspections,
    damagedTrailers,
    temperatureAlertTrailers,
    completionPercentage,
  };
};

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = paramsSchema.parse(await context.params);
    const parsedQuery = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    await requireAuthenticatedRouteUser(supabase, accessToken);
    await requireReadableVesselOperation(supabase, parsedParams.id);
    const reportData = await getVesselOperationReport(supabase, parsedParams.id);

    let reportsQuery = supabase
      .from("vessel_operation_reports")
      .select("id, vessel_operation_id, report_status, generated_at, created_at, generated_by, subject, title, generated_by_ai")
      .eq("vessel_operation_id", parsedParams.id)
      .order("generated_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(100);

    if (parsedQuery.status !== "all") {
      if (parsedQuery.status === "draft") {
        reportsQuery = reportsQuery.in("report_status", ["draft"]);
      } else if (parsedQuery.status === "final") {
        reportsQuery = reportsQuery.in("report_status", ["final", "approved"]);
      } else {
        reportsQuery = reportsQuery.in("report_status", ["sent"]);
      }
    }

    if (parsedQuery.from) {
      reportsQuery = reportsQuery.gte("generated_at", parsedQuery.from);
    }

    if (parsedQuery.to) {
      reportsQuery = reportsQuery.lte("generated_at", parsedQuery.to);
    }

    const reportsResult = await reportsQuery;
    if (reportsResult.error) {
      throw new Error("Unable to load report library right now.");
    }

    const searchTerm = parsedQuery.search?.toLowerCase() ?? "";
    const reportLibrary: VesselOperationReportLibraryItem[] = (reportsResult.data ?? [])
      .map((item) => ({
        reportId: item.id,
        vesselOperationId: item.vessel_operation_id,
        vesselName: reportData.operation.vesselName,
        voyageReference: reportData.operation.voyageReference,
        operationStatus: reportData.operation.status,
        reportStatus: normalizeStatus(item.report_status),
        generatedAt: item.generated_at ?? item.created_at ?? new Date().toISOString(),
        generatedBy: item.generated_by ?? null,
        subject: item.subject ?? item.title ?? "Vessel Operations Report",
        generationMode: (item.generated_by_ai ? "ai" : "template") as "ai" | "template",
      }))
      .filter((item) => {
        if (!searchTerm) {
          return true;
        }

        const haystack = [
          item.subject,
          item.generatedBy ?? "",
          item.vesselName ?? "",
          item.voyageReference ?? "",
          item.reportStatus,
        ].join(" ").toLowerCase();

        return haystack.includes(searchTerm);
      });

    const historicalReportsResult = await supabase
      .from("vessel_operation_reports")
      .select("id, vessel_operation_id, report_status, generated_at, structured_snapshot, structured_data_snapshot")
      .order("generated_at", { ascending: false, nullsFirst: false })
      .limit(120);

    if (historicalReportsResult.error) {
      throw new Error("Unable to load historical comparisons.");
    }

    const historicalReports = (historicalReportsResult.data ?? []) as Array<Pick<ReportRow, "id" | "vessel_operation_id" | "report_status" | "generated_at" | "structured_snapshot" | "structured_data_snapshot">>;
    const comparisonCandidates = historicalReports.filter((item) => item.vessel_operation_id !== parsedParams.id).slice(0, 80);
    const operationIds = Array.from(new Set(comparisonCandidates.map((item) => item.vessel_operation_id)));

    let operationById = new Map<string, OperationRow>();
    if (operationIds.length > 0) {
      const operationsResult = await supabase
        .from("vessel_operations")
        .select("id, vessel_name, sailing_reference, status, updated_at")
        .in("id", operationIds);

      if (!operationsResult.error) {
        operationById = new Map((operationsResult.data ?? []).map((row) => [row.id, row as OperationRow]));
      }
    }

    const comparisonLibrary = comparisonCandidates
      .map((report) => extractComparisonFromReport(report as ReportRow, operationById.get(report.vessel_operation_id) ?? null))
      .filter((item) => {
        if (!searchTerm) {
          return true;
        }

        const haystack = [item.vesselName ?? "", item.voyageReference ?? ""].join(" ").toLowerCase();
        return haystack.includes(searchTerm);
      })
      .slice(0, parsedQuery.comparisonLimit);

    return Response.json({
      report: null,
      reportData,
      reportLibrary,
      comparisonLibrary,
      hasDataChangedSinceApproval: false,
    });
  } catch (error) {
    console.error("Load report endpoint failed:", error);

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid vessel operation id." }, { status: 400 });
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
