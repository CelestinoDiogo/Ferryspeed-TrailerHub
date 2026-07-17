"use client";

import { useMemo, useState } from "react";
import type { OperationalEvent } from "@/lib/operations/operational-events";

type TrailerTimelineProps = {
  events: OperationalEvent[];
  isLoading?: boolean;
  error?: string | null;
};

type TimelineSortOrder = "newest" | "oldest";

const formatDate = (value: string) => {
  try {
    return new Date(value).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return value;
  }
};

const formatDateTime = (value: string) => {
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

const getEventTone = (event: OperationalEvent) => {
  const normalizedEventType = event.eventType.trim().toLowerCase();

  if (normalizedEventType.includes("reversed") || normalizedEventType.includes("cancelled")) {
    return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  }

  if (normalizedEventType.includes("issue") || normalizedEventType.includes("damage") || normalizedEventType.includes("maintenance")) {
    return "border-rose-500/30 bg-rose-500/10 text-rose-100";
  }

  if (normalizedEventType.includes("completed") || normalizedEventType.includes("received") || normalizedEventType.includes("assigned") || normalizedEventType.includes("collected") || normalizedEventType.includes("departed")) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  }

  return "border-cyan-500/30 bg-cyan-500/10 text-cyan-100";
};

const getEventMarkerClassName = (event: OperationalEvent) => {
  const normalizedEventType = event.eventType.trim().toLowerCase();

  if (normalizedEventType.includes("reversed") || normalizedEventType.includes("cancelled")) {
    return "bg-amber-300";
  }

  if (normalizedEventType.includes("issue") || normalizedEventType.includes("damage") || normalizedEventType.includes("maintenance")) {
    return "bg-rose-300";
  }

  if (normalizedEventType.includes("completed") || normalizedEventType.includes("received") || normalizedEventType.includes("assigned") || normalizedEventType.includes("collected") || normalizedEventType.includes("departed")) {
    return "bg-emerald-300";
  }

  return "bg-cyan-300";
};

const getSourceLabel = (sourceModule: OperationalEvent["sourceModule"]) => {
  switch (sourceModule) {
    case "vessel":
      return "Vessel";
    case "arrival":
      return "Arrival";
    case "inspection":
      return "Inspection";
    case "compound":
      return "Compound";
    case "delivery":
      return "Delivery";
    case "collection":
      return "Collection";
    case "export":
      return "Export";
    case "departure":
      return "Departure";
    case "maintenance":
      return "Maintenance";
    default:
      return "System";
  }
};

export function TrailerTimeline({ events, isLoading = false, error = null }: TrailerTimelineProps) {
  const [sortOrder, setSortOrder] = useState<TimelineSortOrder>("newest");

  const groupedEvents = useMemo(() => {
    const sortedEvents = [...events].sort((left, right) => {
      const leftMs = new Date(left.occurredAt).getTime();
      const rightMs = new Date(right.occurredAt).getTime();
      return sortOrder === "newest" ? rightMs - leftMs : leftMs - rightMs;
    });

    const groups = new Map<string, OperationalEvent[]>();
    sortedEvents.forEach((event) => {
      const dateKey = formatDate(event.occurredAt);
      const existing = groups.get(dateKey) ?? [];
      existing.push(event);
      groups.set(dateKey, existing);
    });

    return Array.from(groups.entries()).map(([date, grouped]) => ({
      date,
      events: grouped,
    }));
  }, [events, sortOrder]);

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Operational Timeline</p>
          <p className="mt-2 text-sm text-slate-300">Real audit history and derived operational milestones for this trailer.</p>
        </div>

        <div className="flex gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setSortOrder("newest")}
            className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${
              sortOrder === "newest"
                ? "border border-cyan-400/40 bg-cyan-500/15 text-cyan-100"
                : "border border-white/10 bg-slate-950/80 text-slate-300 hover:bg-slate-800"
            }`}
          >
            Newest First
          </button>
          <button
            type="button"
            onClick={() => setSortOrder("oldest")}
            className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${
              sortOrder === "oldest"
                ? "border border-cyan-400/40 bg-cyan-500/15 text-cyan-100"
                : "border border-white/10 bg-slate-950/80 text-slate-300 hover:bg-slate-800"
            }`}
          >
            Oldest First
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-5 text-sm text-slate-300">Loading operational timeline...</div>
      ) : error ? (
        <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-5 text-sm text-rose-200">{error}</div>
      ) : groupedEvents.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-5 text-sm text-slate-400">No operational history is available for this trailer yet.</div>
      ) : (
        <div className="mt-5 space-y-6">
          {groupedEvents.map((group) => (
            <div key={group.date}>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">{group.date}</p>
              <div className="mt-3 space-y-4">
                {group.events.map((event) => (
                  <div key={event.id} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className={`mt-1 h-3 w-3 rounded-full ${getEventMarkerClassName(event)}`} />
                      <div className="mt-2 h-full w-px bg-slate-700" />
                    </div>

                    <div className={`flex-1 rounded-2xl border px-4 py-4 ${getEventTone(event)}`}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-white">{event.title}</p>
                            <span className="rounded-full border border-white/10 bg-slate-950/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                              {getSourceLabel(event.sourceModule)}
                            </span>
                          </div>
                          {event.description ? <p className="mt-2 text-sm text-slate-200">{event.description}</p> : null}
                        </div>
                        <p className="text-xs text-slate-300">{formatDateTime(event.occurredAt)}</p>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                        {event.userName ? <span className="rounded-full border border-white/10 bg-slate-950/40 px-2.5 py-1">User: {event.userName}</span> : null}
                        {event.sourceRecordId ? <span className="rounded-full border border-white/10 bg-slate-950/40 px-2.5 py-1">Record: {event.sourceRecordId}</span> : null}
                        <span className="rounded-full border border-white/10 bg-slate-950/40 px-2.5 py-1">Type: {event.eventType}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}