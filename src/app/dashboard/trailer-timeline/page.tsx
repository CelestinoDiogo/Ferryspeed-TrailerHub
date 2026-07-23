"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCw } from "lucide-react";
import { AppCard } from "@/components/layout/app-card";
import { PageHeader } from "@/components/layout/page-header";
import { TrailerAuditLogTable } from "@/components/trailers/trailer-audit-log-table";
import { useOperationalRealtime } from "@/lib/realtime/operational-realtime";
import type { TrailerAuditRow, TrailerAuditTimeFilter } from "@/lib/trailer-audit-log";
import { loadTrailerAuditLog } from "@/lib/trailer-audit-log";

const FILTERS: Array<{ key: TrailerAuditTimeFilter; label: string }> = [
  { key: "today", label: "Today" },
  { key: "last_7_days", label: "Last 7 Days" },
  { key: "last_30_days", label: "Last 30 Days" },
  { key: "all", label: "All" },
];

export default function TrailerTimelineDashboardPage() {
  const [rows, setRows] = useState<TrailerAuditRow[]>([]);
  const [search, setSearch] = useState("");
  const [timeFilter, setTimeFilter] = useState<TrailerAuditTimeFilter>("last_30_days");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRows = useCallback(async (refreshOnly = false) => {
    if (refreshOnly) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    setError(null);

    try {
      const data = await loadTrailerAuditLog({
        search,
        timeFilter,
        limit: 800,
      });

      setRows(data);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load trailer timeline.";
      setError(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [search, timeFilter]);

  useEffect(() => {
    void loadRows(false);
  }, [loadRows]);

  useOperationalRealtime(["timeline"], () => {
    void loadRows(true);
  }, { debounceMs: 500 });

  const sortedRows = useMemo(
    () =>
      [...rows].sort(
        (left, right) =>
          new Date(right.performed_at ?? right.created_at ?? 0).getTime() - new Date(left.performed_at ?? left.created_at ?? 0).getTime(),
      ),
    [rows],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Dashboard"
        title="Trailer Timeline"
        description="Centralized audit timeline across trailer operations, sorted by latest activity."
        action={
          <button
            type="button"
            onClick={() => void loadRows(true)}
            disabled={isRefreshing || isLoading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RotateCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        }
      />

      <AppCard>
        <div className="p-5 md:p-6">
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <label className="text-sm font-semibold text-slate-900" htmlFor="timelineSearch">
              Search by Trailer Number
              <input
                id="timelineSearch"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search trailer number..."
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-500"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              {FILTERS.map((filterOption) => (
                <button
                  key={filterOption.key}
                  type="button"
                  onClick={() => setTimeFilter(filterOption.key)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    timeFilter === filterOption.key
                      ? "bg-cyan-600 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {filterOption.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </AppCard>

      <AppCard>
        <div className="p-5 md:p-6">
          <TrailerAuditLogTable rows={sortedRows} isLoading={isLoading} error={error} emptyLabel="No trailer timeline events found for the selected filter." />
        </div>
      </AppCard>
    </div>
  );
}
