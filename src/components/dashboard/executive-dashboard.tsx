"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Download, FileSpreadsheet, FileText, RefreshCw, ShieldAlert, Ship, TrendingUp, Truck } from "lucide-react";
import { HistoryDateRangeFilter } from "@/components/common/history-date-range-filter";
import { PrintButton } from "@/components/print/print-button";
import { PrintFooter } from "@/components/print/print-footer";
import { PrintHeader } from "@/components/print/print-header";
import { PrintReportLayout } from "@/components/print/print-report-layout";
import { PrintSummary } from "@/components/print/print-summary";
import { PrintTable } from "@/components/print/print-table";
import { createHistoryDateRange, normalizeHistoryPreset, type HistoryDateRangeValue } from "@/lib/history-date-range";
import { supabase } from "@/lib/supabase";
import type { ExecutiveDashboardReportData, ExecutiveDashboardResponse, ExecutiveDashboardTrendPoint } from "@/lib/reports/types";

type DownloadFormat = "csv" | "excel";

const defaultReport: ExecutiveDashboardReportData | null = null;

const getRangeFromSearchParams = (searchParams: URLSearchParams): HistoryDateRangeValue => {
  const preset = normalizeHistoryPreset(searchParams.get("range"));

  if (preset === "custom") {
    const fallback = createHistoryDateRange("today");
    return {
      preset,
      startDate: searchParams.get("startDate")?.trim() || fallback.startDate,
      endDate: searchParams.get("endDate")?.trim() || fallback.endDate,
    };
  }

  return createHistoryDateRange(preset);
};

const formatHours = (value: number) => `${value.toFixed(1)}h`;

const formatPercent = (value: number) => `${Math.max(0, Math.min(100, Math.round(value)))}%`;

const csvEscape = (value: string | number | null | undefined) => {
  const text = value === null || value === undefined ? "" : String(value);
  const escaped = text.replaceAll("\"", '""');
  return `"${escaped}"`;
};

const buildDelimitedExport = (reportData: ExecutiveDashboardReportData, delimiter = ",") => {
  const lines: string[] = [];
  const pushRow = (cells: Array<string | number | null | undefined>) => {
    lines.push(cells.map((cell) => csvEscape(cell)).join(delimiter));
  };

  lines.push("Executive Dashboard Summary");
  pushRow(["Metric", "Value"]);
  pushRow(["Compound trailers", reportData.summary.compoundTrailers]);
  pushRow(["Compound occupancy", formatPercent(reportData.summary.compoundOccupancyPercent)]);
  pushRow(["Today's arrivals", reportData.summary.todaysArrivals]);
  pushRow(["Today's departures", reportData.summary.todaysDepartures]);
  pushRow(["Inspection completion", formatPercent(reportData.summary.inspectionCompletionRate)]);
  pushRow(["Priority SLA", formatPercent(reportData.summary.prioritySlaPercent)]);
  pushRow(["Temperature alerts", reportData.summary.temperatureAlerts]);
  pushRow(["Stock check accuracy", formatPercent(reportData.summary.stockCheckAccuracyPercent)]);
  pushRow(["Waiting collection overdue", reportData.summary.waitingCollectionOverdue]);
  pushRow(["Active alerts", reportData.summary.activeAlerts]);

  lines.push("");
  lines.push("Customer Metrics");
  pushRow(["Customer", "Trailers", "Export allocations", "Overdue allocations", "Priority trailers", "Avg dwell hours", "Temperature alerts"]);
  reportData.customers.forEach((row) => {
    pushRow([
      row.customer,
      row.trailers,
      row.exportAllocations,
      row.overdueAllocations,
      row.priorityTrailers,
      row.averageCompoundDwellHours.toFixed(1),
      row.temperatureAlerts,
    ]);
  });

  lines.push("");
  lines.push("Trend Series");
  pushRow(["Date", "Arrivals", "Departures", "Inspections", "Alerts", "Risk events", "Compound occupancy"]);
  reportData.trends.forEach((row) => {
    pushRow([row.label, row.arrivals, row.departures, row.inspections, row.alertsRaised, row.riskEvents, row.compoundOccupancy]);
  });

  return lines.join("\n");
};

const buildExcelMarkup = (reportData: ExecutiveDashboardReportData) => {
  const escapeHtml = (value: string | number | null | undefined) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  const tableRows = (headers: string[], rows: Array<Array<string | number | null | undefined>>) => `
    <table>
      <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; color: #111827; padding: 24px; }
          h1, h2 { margin: 0 0 12px; }
          table { border-collapse: collapse; width: 100%; margin: 0 0 24px; }
          th, td { border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; }
          th { background: #111827; color: #fff; }
        </style>
      </head>
      <body>
        <h1>Executive Dashboard</h1>
        <h2>Summary</h2>
        ${tableRows(
          ["Metric", "Value"],
          [
            ["Compound trailers", reportData.summary.compoundTrailers],
            ["Compound occupancy", formatPercent(reportData.summary.compoundOccupancyPercent)],
            ["Today's arrivals", reportData.summary.todaysArrivals],
            ["Today's departures", reportData.summary.todaysDepartures],
            ["Inspection completion", formatPercent(reportData.summary.inspectionCompletionRate)],
            ["Priority SLA", formatPercent(reportData.summary.prioritySlaPercent)],
            ["Temperature alerts", reportData.summary.temperatureAlerts],
            ["Stock check accuracy", formatPercent(reportData.summary.stockCheckAccuracyPercent)],
            ["Waiting collection overdue", reportData.summary.waitingCollectionOverdue],
            ["Active alerts", reportData.summary.activeAlerts],
          ],
        )}
        <h2>Customers</h2>
        ${tableRows(
          ["Customer", "Trailers", "Export allocations", "Overdue allocations", "Priority trailers", "Avg dwell hours", "Temperature alerts"],
          reportData.customers.map((row) => [
            row.customer,
            row.trailers,
            row.exportAllocations,
            row.overdueAllocations,
            row.priorityTrailers,
            row.averageCompoundDwellHours.toFixed(1),
            row.temperatureAlerts,
          ]),
        )}
        <h2>Trends</h2>
        ${tableRows(
          ["Date", "Arrivals", "Departures", "Inspections", "Alerts", "Risk events", "Compound occupancy"],
          reportData.trends.map((row) => [row.label, row.arrivals, row.departures, row.inspections, row.alertsRaised, row.riskEvents, row.compoundOccupancy]),
        )}
      </body>
    </html>
  `;
};

const downloadFile = (fileName: string, mimeType: string, content: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

function TrendBars({ points, series }: { points: ExecutiveDashboardTrendPoint[]; series: Array<{ key: keyof ExecutiveDashboardTrendPoint; label: string; className: string }> }) {
  const maxValue = Math.max(1, ...points.flatMap((point) => series.map((item) => Number(point[item.key]) || 0)));

  return (
    <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {series.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${item.className}`} />
            {item.label}
          </span>
        ))}
      </div>
      <div className="flex h-48 items-end gap-2 overflow-x-auto pb-1">
        {points.map((point) => (
          <div key={point.date} className="flex min-w-14 flex-1 flex-col items-center gap-2">
            <div className="flex h-36 w-full items-end gap-1 rounded-xl bg-white p-2 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
              {series.map((item) => {
                const value = Number(point[item.key]) || 0;
                const height = `${Math.max(6, (value / maxValue) * 100)}%`;
                return <div key={item.label} className={`w-full rounded-lg ${item.className}`} style={{ height }} title={`${item.label}: ${value}`} />;
              })}
            </div>
            <div className="text-[11px] font-medium text-slate-500">{point.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ExecutiveDashboard() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchParamsString = searchParams.toString();
  const range = useMemo(() => getRangeFromSearchParams(new URLSearchParams(searchParamsString)), [searchParamsString]);
  const [reportData, setReportData] = useState<ExecutiveDashboardReportData | null>(defaultReport);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const unresolvedValue = isLoading ? "..." : "--";

  const updateRange = useCallback((nextRange: HistoryDateRangeValue) => {
    const params = new URLSearchParams();
    params.set("range", nextRange.preset);
    if (nextRange.preset === "custom") {
      params.set("startDate", nextRange.startDate);
      params.set("endDate", nextRange.endDate);
    }

    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }, [pathname, router]);

  const loadReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const sessionResult = await supabase.auth.getSession();
      const accessToken = sessionResult.data.session?.access_token;

      if (!accessToken) {
        throw new Error("You must be signed in to load the executive dashboard.");
      }

      const params = new URLSearchParams();
      params.set("range", range.preset);
      if (range.preset === "custom") {
        params.set("startDate", range.startDate);
        params.set("endDate", range.endDate);
      }

      const response = await fetch(`/api/reports/executive-dashboard?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const payload = (await response.json()) as ExecutiveDashboardResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load executive dashboard.");
      }

      setReportData(payload.reportData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load executive dashboard.");
      setReportData(null);
    } finally {
      setIsLoading(false);
    }
  }, [range.endDate, range.preset, range.startDate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReport();
  }, [loadReport]);

  const handleDownload = useCallback((format: DownloadFormat) => {
    if (!reportData) {
      return;
    }

    const label = reportData.range.preset === "custom" ? `${reportData.range.startDate}_to_${reportData.range.endDate}` : reportData.range.preset;
    if (format === "csv") {
      downloadFile(`executive-dashboard-${label}.csv`, "text/csv;charset=utf-8", buildDelimitedExport(reportData));
      return;
    }

    downloadFile(
      `executive-dashboard-${label}.xls`,
      "application/vnd.ms-excel;charset=utf-8",
      buildExcelMarkup(reportData),
    );
  }, [reportData]);

  const summaryItems = reportData
    ? [
        { label: "Compound", value: reportData.summary.compoundTrailers },
        { label: "Occupancy", value: formatPercent(reportData.summary.compoundOccupancyPercent) },
        { label: "Arrivals", value: reportData.summary.todaysArrivals },
        { label: "Departures", value: reportData.summary.todaysDepartures },
        { label: "Inspection", value: formatPercent(reportData.summary.inspectionCompletionRate) },
        { label: "Priority SLA", value: formatPercent(reportData.summary.prioritySlaPercent) },
        { label: "Alerts", value: reportData.summary.activeAlerts },
        { label: "Stock Accuracy", value: formatPercent(reportData.summary.stockCheckAccuracyPercent) },
      ]
    : [];

  const printedAt = reportData?.generatedAt ? new Date(reportData.generatedAt).toLocaleString("en-GB") : new Date().toLocaleString("en-GB");

  return (
    <div className="space-y-6 bg-[linear-gradient(180deg,#F8FAFC_0%,#EEF2F7_100%)]">
      <section className="rounded-[2rem] border border-slate-200 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Executive Intelligence</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Business Intelligence & Executive Dashboard</h1>
            <p className="max-w-2xl text-sm leading-6 text-slate-600">A read-only executive view over the same live operational data used by the yard, vessel, export and alerts workflows.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PrintButton label="Print / PDF" disabled={isLoading || !reportData} />
            <button type="button" onClick={() => handleDownload("csv")} disabled={isLoading || !reportData} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50">
              <FileText className="h-4 w-4" /> CSV
            </button>
            <button type="button" onClick={() => handleDownload("excel")} disabled={isLoading || !reportData} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50">
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </button>
            <button type="button" onClick={() => void loadReport()} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-800">
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <HistoryDateRangeFilter value={range} onChange={updateRange} label="Reporting Period" />
        </div>
      </section>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div> : null}

      <PrintReportLayout orientation="landscape">
        <PrintHeader title="Executive Dashboard" printedAt={printedAt} userName="Ferryspeed Management" totalRecords={reportData?.summary.compoundTrailers ?? 0}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Range</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{reportData ? `${reportData.range.startDate} to ${reportData.range.endDate}` : "Loading..."}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Generated</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{printedAt}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Data Model</p>
              <p className="mt-2 text-sm font-medium text-slate-900">Live operational records</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Access</p>
              <p className="mt-2 text-sm font-medium text-slate-900">Authenticated reports module</p>
            </div>
          </div>
        </PrintHeader>

        <PrintSummary items={summaryItems} />

        <PrintTable
          rows={reportData?.customers ?? []}
          columns={[
            { key: "customer", header: "Customer", render: (row) => row.customer },
            { key: "trailers", header: "Trailers", render: (row) => row.trailers },
            { key: "exportAllocations", header: "Export Allocations", render: (row) => row.exportAllocations },
            { key: "overdueAllocations", header: "Overdue", render: (row) => row.overdueAllocations },
            { key: "averageCompoundDwellHours", header: "Avg Dwell", render: (row) => formatHours(row.averageCompoundDwellHours) },
          ]}
        />

        <PrintTable
          rows={reportData?.alerts ?? []}
          columns={[
            { key: "title", header: "Active Alerts", render: (row) => row.title },
            { key: "severity", header: "Severity", render: (row) => row.severity },
            { key: "trailerNumber", header: "Trailer", render: (row) => row.trailerNumber ?? "—" },
            { key: "sourceModule", header: "Source", render: (row) => row.sourceModule },
          ]}
        />

        <PrintFooter />
      </PrintReportLayout>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<Truck className="h-5 w-5" />} label="Compound Trailers" value={reportData?.summary.compoundTrailers ?? unresolvedValue} accent="from-slate-950 to-slate-700" />
        <MetricCard icon={<BarChart3 className="h-5 w-5" />} label="Occupancy" value={reportData ? formatPercent(reportData.summary.compoundOccupancyPercent) : unresolvedValue} accent="from-emerald-600 to-teal-500" />
        <MetricCard icon={<TrendingUp className="h-5 w-5" />} label="Priority SLA" value={reportData ? formatPercent(reportData.summary.prioritySlaPercent) : unresolvedValue} accent="from-amber-500 to-orange-500" />
        <MetricCard icon={<ShieldAlert className="h-5 w-5" />} label="Stock Accuracy" value={reportData ? formatPercent(reportData.summary.stockCheckAccuracyPercent) : unresolvedValue} accent="from-indigo-600 to-cyan-500" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Panel title="Operational Trend" subtitle="Arrivals, departures, inspections and alerts">
          <TrendBars
            points={reportData?.trends ?? []}
            series={[
              { key: "arrivals", label: "Arrivals", className: "bg-emerald-500" },
              { key: "departures", label: "Departures", className: "bg-slate-900" },
              { key: "inspections", label: "Inspections", className: "bg-indigo-500" },
              { key: "alertsRaised", label: "Alerts", className: "bg-rose-500" },
            ]}
          />
        </Panel>
        <Panel title="Compound Occupancy" subtitle="Historical occupancy reconstruction from live movement data">
          <TrendBars
            points={reportData?.trends ?? []}
            series={[{ key: "compoundOccupancy", label: "Occupancy", className: "bg-gradient-to-t from-amber-500 to-emerald-500" }]}
          />
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
        <Panel title="Compound Analytics" subtitle="Dwell bands and longest-staying trailers">
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <MetricLine label="Available empty" value={reportData?.compound.availableEmptyTrailers ?? 0} />
              <MetricLine label="Loaded" value={reportData?.compound.loadedTrailers ?? 0} />
              <MetricLine label="Maintenance" value={reportData?.compound.maintenanceTrailers ?? 0} />
              <MetricLine label="Position utilisation" value={reportData ? formatPercent(reportData.compound.positionUtilisationPercent) : unresolvedValue} />
              <MetricLine label="Under 24h" value={reportData?.compound.dwellBands.under24h ?? 0} />
              <MetricLine label="1-3 days" value={reportData?.compound.dwellBands.oneToThreeDays ?? 0} />
              <MetricLine label="4-7 days" value={reportData?.compound.dwellBands.fourToSevenDays ?? 0} />
              <MetricLine label="Over 7 days" value={reportData?.compound.dwellBands.overSevenDays ?? 0} />
            </div>
            <PrintTable
              rows={reportData?.compound.topDwellTrailers ?? []}
              columns={[
                { key: "trailerNumber", header: "Trailer", render: (row) => row.trailerNumber },
                { key: "customer", header: "Customer", render: (row) => row.customer ?? "—" },
                { key: "compoundPosition", header: "Position", render: (row) => row.compoundPosition ?? "—" },
                { key: "dwellHours", header: "Dwell", render: (row) => formatHours(row.dwellHours) },
              ]}
            />
          </div>
        </Panel>

        <Panel title="Vessel Performance" subtitle="Operations, inspection completion and risk flags">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCard icon={<Ship className="h-5 w-5" />} label="Operations" value={reportData?.vessel.totalOperations ?? unresolvedValue} accent="from-slate-950 to-slate-700" compact />
              <MetricCard icon={<TrendingUp className="h-5 w-5" />} label="Inspection Pending" value={reportData?.vessel.inspectionPending ?? unresolvedValue} accent="from-rose-600 to-orange-500" compact />
            </div>
            <PrintTable
              rows={reportData?.vessel.topOperations ?? []}
              columns={[
                { key: "vesselName", header: "Vessel", render: (row) => row.vesselName },
                { key: "trailers", header: "Trailers", render: (row) => row.trailers },
                { key: "completionRate", header: "Completion", render: (row) => formatPercent(row.completionRate) },
                { key: "temperatureAlerts", header: "Temp", render: (row) => row.temperatureAlerts },
              ]}
            />
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
        <Panel title="Customer Metrics" subtitle="Operational concentration by customer">
          <PrintTable
            rows={reportData?.customers ?? []}
            columns={[
              { key: "customer", header: "Customer", render: (row) => row.customer },
              { key: "trailers", header: "Trailers", render: (row) => row.trailers },
              { key: "exportAllocations", header: "Exports", render: (row) => row.exportAllocations },
              { key: "priorityTrailers", header: "Priority", render: (row) => row.priorityTrailers },
              { key: "averageCompoundDwellHours", header: "Avg Dwell", render: (row) => formatHours(row.averageCompoundDwellHours) },
            ]}
          />
        </Panel>

        <Panel title="SLA & Risk" subtitle="Waiting collection, alerts and stock check quality">
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <MetricLine label="Waiting collection overdue" value={reportData?.summary.waitingCollectionOverdue ?? 0} />
            <MetricLine label="Temperature alerts" value={reportData?.summary.temperatureAlerts ?? 0} />
            <MetricLine label="Active alerts" value={reportData?.summary.activeAlerts ?? 0} />
            <MetricLine label="Export overdue" value={reportData?.exportSla.overdue ?? 0} />
            <MetricLine label="Delivered empty" value={reportData?.exportSla.deliveredEmpty ?? 0} />
            <MetricLine label="Collected loaded" value={reportData?.exportSla.collectedLoaded ?? 0} />
            <MetricLine label="Latest check discrepancies" value={reportData?.stockCheck.discrepancyTotal ?? 0} />
          </div>
        </Panel>
      </section>

      <section className="flex flex-wrap gap-3 rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
        <Link href="/dashboard/operations-command-centre" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white">
          <Truck className="h-4 w-4" /> Operations Command Centre
        </Link>
        <Link href="/dashboard/compound?filter=waiting_collection" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white">
          <BarChart3 className="h-4 w-4" /> Compound
        </Link>
        <Link href="/dashboard/vessel-operations?filter=today" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white">
          <Ship className="h-4 w-4" /> Vessel Operations
        </Link>
        <Link href="/dashboard/export-operations" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white">
          <Download className="h-4 w-4" /> Export Operations
        </Link>
      </section>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-950">{title}</h2>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function MetricCard({ icon, label, value, accent, compact = false }: { icon: React.ReactNode; label: string; value: string | number; accent: string; compact?: boolean }) {
  return (
    <div className={`rounded-[1.5rem] border border-slate-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.05)] ${compact ? "p-4" : "p-5"}`}>
      <div className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${accent} text-white`}>
        {icon}
      </div>
      <p className="mt-3 text-sm font-medium text-slate-500">{label}</p>
      <p className={`${compact ? "text-2xl" : "text-3xl"} mt-1 font-semibold tracking-tight text-slate-950`}>{value}</p>
    </div>
  );
}

function MetricLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200/80 py-2 last:border-b-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-semibold text-slate-950">{value}</span>
    </div>
  );
}