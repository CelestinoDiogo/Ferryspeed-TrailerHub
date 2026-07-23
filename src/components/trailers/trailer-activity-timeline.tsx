"use client";

import type { TrailerActivityRow } from "@/lib/trailer-activity";

type TrailerActivityTimelineProps = {
  rows: TrailerActivityRow[];
  isLoading?: boolean;
  error?: string | null;
  emptyLabel?: string;
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

const formatLabel = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/_/g, " ").replace(/\b\w/g, (token) => token.toUpperCase());
};

const getEventTone = (row: TrailerActivityRow) => {
  const eventType = row.event_type.trim().toLowerCase();

  if (eventType.includes("cancel") || eventType.includes("undone")) {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }

  if (eventType.includes("damage") || eventType.includes("temperature")) {
    return "border-rose-200 bg-rose-50 text-rose-950";
  }

  if (eventType.includes("completed") || eventType.includes("arrived") || eventType.includes("allocated") || eventType.includes("uploaded")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }

  return "border-cyan-200 bg-cyan-50 text-slate-950";
};

const renderTransition = (label: string, previousValue?: string | null, nextValue?: string | null) => {
  if (!previousValue && !nextValue) {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs text-slate-700">
      <span className="font-semibold text-slate-900">{label}:</span> {previousValue ?? "-"} -&gt; {nextValue ?? "-"}
    </div>
  );
};

export function TrailerActivityTimeline({
  rows,
  isLoading = false,
  error = null,
  emptyLabel = "No activity has been recorded for this trailer yet.",
}: TrailerActivityTimelineProps) {
  const sortedRows = [...rows].sort((left, right) => new Date(right.created_at ?? 0).getTime() - new Date(left.created_at ?? 0).getTime());

  if (isLoading) {
    return <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">Loading trailer activity...</div>;
  }

  if (error) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-700">{error}</div>;
  }

  if (sortedRows.length === 0) {
    return <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">{emptyLabel}</div>;
  }

  return (
    <div className="space-y-4">
      {sortedRows.map((row) => {
        const sourceLabel = formatLabel(row.source_module) ?? "System";

        return (
          <article key={row.id} className={`rounded-2xl border p-4 shadow-sm ${getEventTone(row)}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-950">{row.event_title}</h3>
                  <span className="rounded-full border border-slate-300 bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                    {sourceLabel}
                  </span>
                  <span className="rounded-full border border-slate-300 bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                    {formatLabel(row.event_type) ?? row.event_type}
                  </span>
                </div>

                {row.event_description ? <p className="mt-2 text-sm text-slate-700">{row.event_description}</p> : null}
              </div>

              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{formatDateTime(row.created_at)}</p>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {renderTransition("Status", row.previous_status, row.new_status)}
              {renderTransition("Position", row.previous_compound_position, row.new_compound_position)}
              {row.performed_by ? (
                <div className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs text-slate-700">
                  <span className="font-semibold text-slate-900">Performed By:</span> {row.performed_by}
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}