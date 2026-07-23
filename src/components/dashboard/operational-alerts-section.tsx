"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Clock3, Eye, Filter, RefreshCw, RotateCcw, X } from "lucide-react";
import { AppCard } from "@/components/layout/app-card";
import type { OperationalAlertRow, OperationalAlertSummary } from "@/lib/operational-alerts";

type AlertStatusView = "active" | "resolved";
type SeverityFilter = "all" | "critical" | "high" | "medium" | "low";

type OperationalAlertsSectionProps = {
  summary: OperationalAlertSummary;
  activeAlerts: OperationalAlertRow[];
  resolvedAlerts: OperationalAlertRow[];
  resolvedAlertsLoaded: boolean;
  resolvedAlertsLoading: boolean;
  statusView: AlertStatusView;
  isLoading?: boolean;
  isRefreshing?: boolean;
  error?: string | null;
  onStatusViewChange: (view: AlertStatusView) => void;
  onRefresh: () => Promise<void> | void;
  onAcknowledge: (alert: OperationalAlertRow) => Promise<void>;
  onResolve: (alert: OperationalAlertRow, resolutionNote: string | null) => Promise<void>;
  onDismiss: (alert: OperationalAlertRow) => Promise<void>;
};

const severityRank = {
  critical: 0,
  high: 1,
  warning: 2,
  info: 3,
} as const;

const severityFilterOrder: SeverityFilter[] = ["all", "critical", "high", "medium", "low"];

const formatAgo = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  const startedAt = new Date(value).getTime();
  if (Number.isNaN(startedAt)) {
    return value;
  }

  const diffMs = Date.now() - startedAt;
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  try {
    return new Date(value).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
};

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const getSeverityLabel = (severity: string) => {
  switch (severity.toLowerCase()) {
    case "critical":
      return "Critical";
    case "high":
      return "High";
    case "warning":
      return "Medium";
    case "info":
      return "Low";
    default:
      return "Medium";
  }
};

const getSeverityFilterLabel = (filter: SeverityFilter) => {
  switch (filter) {
    case "critical":
      return "Critical";
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    default:
      return "All";
  }
};

const getSeverityFilterKey = (severity: string): SeverityFilter => {
  switch (severity.toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "warning":
      return "medium";
    case "info":
      return "low";
    default:
      return "medium";
  }
};

const getStatusLabel = (status?: string | null) => {
  switch (normalizeText(status)) {
    case "acknowledged":
      return "Acknowledged";
    case "resolved":
      return "Resolved";
    case "dismissed":
      return "Dismissed";
    default:
      return "Active";
  }
};

const sortAlerts = (alerts: OperationalAlertRow[]) =>
  [...alerts].sort((left, right) => {
    const severityDelta = severityRank[normalizeText(left.severity) as keyof typeof severityRank] - severityRank[normalizeText(right.severity) as keyof typeof severityRank];
    if (severityDelta !== 0) {
      return severityDelta;
    }

    return new Date(right.created_at ?? 0).getTime() - new Date(left.created_at ?? 0).getTime();
  });

const getAlertViewHref = (alert: OperationalAlertRow) => {
  const metadata = alert.metadata && typeof alert.metadata === "object" && !Array.isArray(alert.metadata) ? (alert.metadata as Record<string, unknown>) : {};
  const trailerId = alert.trailer_id ?? (typeof metadata.trailer_id === "string" ? metadata.trailer_id : null);

  if (alert.alert_key.startsWith("export_waiting_collection")) {
    const exportAllocationId = typeof metadata.export_allocation_id === "string" ? metadata.export_allocation_id : alert.source_record_id;
    return exportAllocationId ? `/dashboard/export-operations/${exportAllocationId}` : "/dashboard/export-operations";
  }

  if (alert.alert_key.startsWith("stock_check_discrepancy")) {
    const stockCheckId = typeof metadata.stock_check_id === "string" ? metadata.stock_check_id : null;
    return stockCheckId
      ? `/dashboard/compound/review-discrepancies?stockCheckId=${stockCheckId}`
      : "/dashboard/compound/stock-check";
  }

  if (alert.alert_key.startsWith("temperature_alert") || alert.alert_key.startsWith("inspection_missing_photos") || alert.alert_key.startsWith("priority_inspection_pending")) {
    const vesselOperationId = typeof metadata.vessel_operation_id === "string" ? metadata.vessel_operation_id : null;
    if (vesselOperationId) {
      return `/dashboard/vessel-operations/${vesselOperationId}`;
    }
    return trailerId ? `/dashboard/trailers/${trailerId}` : "/dashboard/vessel-operations";
  }

  if (alert.alert_key.startsWith("compound_occupancy")) {
    return "/dashboard/compound";
  }

  if (trailerId) {
    return `/dashboard/trailers/${trailerId}`;
  }

  return "/dashboard";
};

const getHealthState = (summary: OperationalAlertSummary) => {
  if (summary.criticalCount > 0) {
    return { label: "Critical", tone: "critical" as const };
  }

  if (summary.totalActiveAlerts > 0) {
    return { label: "Needs Attention", tone: "warning" as const };
  }

  return { label: "Healthy", tone: "healthy" as const };
};

const getToneClasses = (tone: "critical" | "warning" | "healthy") => {
  switch (tone) {
    case "critical":
      return {
        card: "border-rose-200 bg-rose-50",
        badge: "bg-rose-600 text-white",
        title: "text-rose-950",
      };
    case "warning":
      return {
        card: "border-amber-200 bg-amber-50",
        badge: "bg-amber-600 text-white",
        title: "text-amber-950",
      };
    default:
      return {
        card: "border-emerald-200 bg-emerald-50",
        badge: "bg-emerald-600 text-white",
        title: "text-emerald-950",
      };
  }
};

const getSeverityBadgeClasses = (severity: string) => {
  switch (severity.toLowerCase()) {
    case "critical":
      return "border-rose-200 bg-rose-50 text-rose-900";
    case "high":
      return "border-orange-200 bg-orange-50 text-orange-900";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-900";
    default:
      return "border-cyan-200 bg-cyan-50 text-cyan-900";
  }
};

function ResolveAlertDialog({
  alert,
  isSubmitting,
  error,
  onClose,
  onConfirm,
}: {
  alert: OperationalAlertRow;
  isSubmitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
}) {
  const [resolutionNote, setResolutionNote] = useState("");

  useEffect(() => {
    setResolutionNote("");
  }, [alert.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-slate-900 p-5 shadow-2xl shadow-black/40">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-400">Resolve Alert</p>
            <h3 className="mt-2 text-xl font-semibold text-white">{alert.title}</h3>
            <p className="mt-2 text-sm text-slate-300">{alert.description ?? "No description provided."}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error ? <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

        <label className="mt-4 block text-sm font-medium text-slate-200">
          Resolution note
          <textarea
            value={resolutionNote}
            onChange={(event) => setResolutionNote(event.target.value)}
            rows={4}
            placeholder="Optional note for the resolution history"
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
            disabled={isSubmitting}
          />
        </label>

        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onConfirm(resolutionNote)}
            className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Resolving..." : "Resolve Alert"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OperationalAlertsSection({
  summary,
  activeAlerts,
  resolvedAlerts,
  resolvedAlertsLoaded,
  resolvedAlertsLoading,
  statusView,
  isLoading = false,
  isRefreshing = false,
  error = null,
  onStatusViewChange,
  onRefresh,
  onAcknowledge,
  onResolve,
  onDismiss,
}: OperationalAlertsSectionProps) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<OperationalAlertRow | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolveSubmitting, setResolveSubmitting] = useState(false);

  useEffect(() => {
    setShowAll(false);
  }, [statusView]);

  const currentAlerts = statusView === "resolved" ? resolvedAlerts : activeAlerts;
  const loadingCurrentView = statusView === "resolved" ? resolvedAlertsLoading : isLoading;
  const filteredBySeverity = useMemo(() => {
    if (severityFilter === "all") {
      return sortAlerts(currentAlerts);
    }

    return sortAlerts(
      currentAlerts.filter((alert) => getSeverityFilterKey(alert.severity) === severityFilter),
    );
  }, [currentAlerts, severityFilter]);

  const visibleAlerts = showAll ? filteredBySeverity : filteredBySeverity.slice(0, 4);
  const severityCounts = useMemo(() => {
    return currentAlerts.reduce(
      (counts, alert) => {
        counts.all += 1;
        counts[getSeverityFilterKey(alert.severity)] += 1;
        return counts;
      },
      { all: 0, critical: 0, high: 0, medium: 0, low: 0 },
    );
  }, [currentAlerts]);

  const latestAlertTime = summary.latestAlertAt ?? filteredBySeverity[0]?.created_at ?? null;
  const healthState = getHealthState(summary);
  const healthTone = getToneClasses(healthState.tone);

  const handleRefresh = async () => {
    await onRefresh();
  };

  const handleResolve = async (note: string) => {
    if (!resolveTarget) {
      return;
    }

    setResolveSubmitting(true);
    setResolveError(null);
    try {
      await onResolve(resolveTarget, note.trim() ? note.trim() : null);
      setResolveTarget(null);
      setResolveError(null);
      await onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to resolve alert.";
      setResolveError(message);
    } finally {
      setResolveSubmitting(false);
    }
  };

  return (
    <AppCard className="overflow-hidden border-slate-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
      <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Operational Alerts</p>
            <p className="mt-1 text-sm text-slate-600">Compact live alert workflow for supervisors.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={isRefreshing || loadingCurrentView}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing || loadingCurrentView ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 border-b border-slate-200 px-5 py-4 sm:grid-cols-2 xl:grid-cols-5 sm:px-6">
        <div className={`rounded-2xl border px-4 py-3 ${healthTone.card}`}>
          <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Operational Health</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${healthTone.badge}`}>{healthState.label}</span>
            <span className={`text-xl font-semibold ${healthTone.title}`}>{summary.totalActiveAlerts}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-rose-500">Critical</p>
          <p className="mt-1 text-2xl font-semibold text-rose-900">{summary.criticalCount}</p>
        </div>

        <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-orange-500">High</p>
          <p className="mt-1 text-2xl font-semibold text-orange-900">{summary.highCount}</p>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-amber-500">Medium</p>
          <p className="mt-1 text-2xl font-semibold text-amber-900">{summary.warningCount}</p>
        </div>

        <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-cyan-500">Low</p>
          <p className="mt-1 text-2xl font-semibold text-cyan-900">{summary.infoCount}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-5 py-4 sm:px-6">
        <button
          type="button"
          onClick={() => onStatusViewChange("active")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${statusView === "active" ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
        >
          Active <span className="ml-1 text-[10px] opacity-75">{summary.totalActiveAlerts}</span>
        </button>
        <button
          type="button"
          onClick={() => onStatusViewChange("resolved")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${statusView === "resolved" ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
        >
          Resolved <span className="ml-1 text-[10px] opacity-75">{resolvedAlertsLoaded ? resolvedAlerts.length : resolvedAlertsLoading ? "..." : 0}</span>
        </button>

        <div className="ml-0 flex items-center gap-2 sm:ml-auto">
          <Filter className="h-4 w-4 text-slate-400" />
          {severityFilterOrder.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setSeverityFilter(filter)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${severityFilter === filter ? "bg-cyan-600 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {getSeverityFilterLabel(filter)} <span className="ml-1 text-[10px] opacity-75">{severityCounts[filter]}</span>
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="mx-5 mt-4 flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 sm:mx-6">
          <span>{error}</span>
          <button type="button" onClick={() => void handleRefresh()} className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100">
            <RotateCcw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      ) : null}

      <div className="space-y-3 px-5 py-5 sm:px-6">
        {loadingCurrentView ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">Loading alerts...</div>
        ) : visibleAlerts.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
            {statusView === "resolved" ? "No resolved alerts yet." : "No active alerts right now."}
          </div>
        ) : (
          visibleAlerts.map((alert) => {
            const isResolved = normalizeText(alert.status) === "resolved";
            const alertHref = getAlertViewHref(alert);
            const toneClasses = getSeverityBadgeClasses(alert.severity);
            const isActionDisabled = normalizeText(alert.status) !== "active";

            return (
              <article key={alert.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${toneClasses}`}>
                        {getSeverityLabel(alert.severity)}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                        {getStatusLabel(alert.status)}
                      </span>
                      {alert.trailer_number ? (
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                          Trailer {alert.trailer_number}
                        </span>
                      ) : (
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                          {alert.source_module}
                        </span>
                      )}
                    </div>

                    <h3 className="mt-3 text-sm font-semibold text-slate-950 sm:text-base">{alert.title}</h3>
                    <p className="mt-1 text-sm text-slate-700">{alert.description ?? "No alert description available."}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{formatAgo(alert.created_at)}</span>
                      {isResolved ? (
                        <span>Resolved {formatDateTime(alert.resolved_at)} by {alert.resolved_by ?? "system"}</span>
                      ) : null}
                    </div>

                    {isResolved && alert.resolution_note ? (
                      <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                        <span className="font-semibold text-slate-900">Resolution note:</span> {alert.resolution_note}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <Link
                      href={alertHref}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                    >
                      <Eye className="h-4 w-4" />
                      View
                    </Link>

                    {!isResolved ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void onAcknowledge(alert)}
                          disabled={isActionDisabled}
                          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Acknowledge
                        </button>
                        <button
                          type="button"
                          onClick={() => setResolveTarget(alert)}
                          className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
                        >
                          <ChevronDown className="h-4 w-4" />
                          Resolve
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDismiss(alert)}
                          disabled={isActionDisabled}
                          className="inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <X className="h-4 w-4" />
                          Dismiss
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })
        )}

        {filteredBySeverity.length > visibleAlerts.length ? (
          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={() => setShowAll((current) => !current)}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {showAll ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  Show Less
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  Show More
                </>
              )}
            </button>
          </div>
        ) : null}
      </div>

      {resolveTarget ? (
        <ResolveAlertDialog
          alert={resolveTarget}
          isSubmitting={resolveSubmitting}
          error={resolveError}
          onClose={() => {
            setResolveTarget(null);
            setResolveError(null);
          }}
          onConfirm={handleResolve}
        />
      ) : null}
    </AppCard>
  );
}
