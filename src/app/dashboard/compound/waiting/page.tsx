"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { COMPOUND_REFRESH_STORAGE_KEY } from "@/lib/export-allocation";
import { supabase } from "@/lib/supabase";

type CompoundWaitingActiveRow = {
  id: string;
  trailer_id: string;
  trailer_number: string | null;
  customer: string | null;
  load_status: string | null;
  priority_level: "low" | "normal" | "high" | "urgent" | string;
  priority_reason: string | null;
  waiting_reason: string | null;
  arrived_at: string | null;
  waiting_since: string | null;
  waiting_minutes: number | null;
  vessel_operation_id: string | null;
  vessel_trailer_id: string | null;
  notes: string | null;
  created_at: string | null;
};

type CompoundOccupancy = {
  physical_capacity: number;
  occupied_positions: number;
  available_positions: number;
  waiting_trailers: number;
  occupancy_percentage: number;
  compound_status: "available" | "warning" | "critical" | "full" | string;
};

type WaitingFilter = "all" | "urgent" | "high" | "normal" | "low";

type CompoundWaitingAssignmentRpcRow = {
  trailer_number?: string | null;
  assigned_position?: string | null;
};

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 1,
  high: 2,
  normal: 3,
  low: 4,
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatMinutes = (minutes?: number | null) => {
  if (minutes === null || minutes === undefined) return "-";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const rem = Math.round(minutes % 60);
  return `${hours}h ${rem}m`;
};

const normalizeStatusLabel = (value?: string | null) => {
  if (!value) return "Unknown";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const extractAssignmentRpcRow = (value: unknown): CompoundWaitingAssignmentRpcRow | null => {
  if (!value) return null;

  if (Array.isArray(value)) {
    const first = value[0];
    if (!first || typeof first !== "object") return null;
    return first as CompoundWaitingAssignmentRpcRow;
  }

  if (typeof value === "object") {
    return value as CompoundWaitingAssignmentRpcRow;
  }

  return null;
};

const buildAssignmentNotice = (defaultMessage: string, value: unknown) => {
  const row = extractAssignmentRpcRow(value);
  if (!row) return defaultMessage;

  const trailerNumber = row.trailer_number?.trim();
  const assignedPosition = row.assigned_position?.trim();

  if (trailerNumber && assignedPosition) {
    return `Trailer ${trailerNumber} assigned to position ${assignedPosition}.`;
  }

  if (trailerNumber) {
    return `Trailer ${trailerNumber} assigned successfully.`;
  }

  if (assignedPosition) {
    return `Assigned successfully to position ${assignedPosition}.`;
  }

  return defaultMessage;
};

const mapAssignmentErrorMessage = (message: string) => {
  const normalized = message.trim().toLowerCase();

  if (normalized.includes("compound is full") || normalized.includes("no position is available")) {
    return "No compound position is currently available.";
  }

  if (normalized.includes("there are no trailers waiting for compound")) {
    return "There are no trailers waiting for a compound position.";
  }

  return message;
};

export default function CompoundWaitingPage() {
  const [waitingRows, setWaitingRows] = useState<CompoundWaitingActiveRow[]>([]);
  const [occupancy, setOccupancy] = useState<CompoundOccupancy | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<WaitingFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadWaitingData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [{ data: waitingData, error: waitingError }, { data: occupancyData, error: occupancyError }] = await Promise.all([
        supabase
          .from("compound_waiting_active")
          .select("id, trailer_id, trailer_number, customer, load_status, priority_level, priority_reason, waiting_reason, arrived_at, waiting_since, waiting_minutes, vessel_operation_id, vessel_trailer_id, notes, created_at"),
        (supabase as any).rpc("get_compound_occupancy"),
      ]);

      if (waitingError) {
        throw waitingError;
      }
      if (occupancyError) {
        throw occupancyError;
      }

      const sortedRows = ((waitingData ?? []) as CompoundWaitingActiveRow[]).sort((left, right) => {
        const leftPriority = PRIORITY_ORDER[left.priority_level] ?? 99;
        const rightPriority = PRIORITY_ORDER[right.priority_level] ?? 99;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;

        const leftTime = left.waiting_since ? new Date(left.waiting_since).getTime() : 0;
        const rightTime = right.waiting_since ? new Date(right.waiting_since).getTime() : 0;
        return leftTime - rightTime;
      });

      setWaitingRows(sortedRows);
      setOccupancy(((occupancyData ?? [])[0] as CompoundOccupancy | undefined) ?? null);
    } catch (loadErr) {
      const message = loadErr instanceof Error ? loadErr.message : "Unable to load waiting queue.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWaitingData();
  }, [loadWaitingData]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === COMPOUND_REFRESH_STORAGE_KEY) {
        void loadWaitingData();
      }
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [loadWaitingData]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();

    return waitingRows.filter((row) => {
      if (filter !== "all" && row.priority_level !== filter) {
        return false;
      }

      if (!term) {
        return true;
      }

      const haystack = [
        row.trailer_number,
        row.customer,
        row.load_status,
        row.priority_level,
        row.waiting_reason,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(term);
    });
  }, [filter, search, waitingRows]);

  const metrics = useMemo(() => {
    const total = waitingRows.length;
    const urgent = waitingRows.filter((row) => row.priority_level === "urgent").length;
    const high = waitingRows.filter((row) => row.priority_level === "high").length;
    const avgMinutes =
      total > 0
        ? waitingRows.reduce((sum, row) => sum + (row.waiting_minutes ?? 0), 0) / total
        : 0;

    return { total, urgent, high, avgMinutes };
  }, [waitingRows]);

  const runAction = useCallback(
    async (run: () => Promise<string>) => {
      setIsMutating(true);
      setError(null);
      setNotice(null);

      try {
        const successMessage = await run();
        setNotice(successMessage);
        await loadWaitingData();
      } catch (actionErr) {
        const message = actionErr instanceof Error ? mapAssignmentErrorMessage(actionErr.message) : "Action failed.";
        setError(message);
      } finally {
        setActioningId(null);
        setIsMutating(false);
      }
    },
    [loadWaitingData],
  );

  const handleAssignNext = async () => {
    if (isMutating) return;

    if (waitingRows.length === 0) {
      setError(null);
      setNotice("There are no trailers waiting for a compound position.");
      return;
    }

    if ((occupancy?.available_positions ?? 0) <= 0) {
      setError(null);
      setNotice("No compound position is currently available.");
      return;
    }

    await runAction(async () => {
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc("assign_next_waiting_trailer");

      if (rpcError) throw rpcError;
      return buildAssignmentNotice("Next trailer assigned successfully.", rpcData);
    });
  };

  const handleAssign = async (waitingId: string) => {
    if (isMutating) return;

    setActioningId(waitingId);
    await runAction(async () => {
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc("assign_waiting_trailer_to_compound", {
        p_waiting_id: waitingId,
      });

      if (rpcError) throw rpcError;
      return buildAssignmentNotice("Waiting trailer assigned to compound.", rpcData);
    });
  };

  const handleCancel = async (waitingId: string) => {
    if (isMutating) return;

    setActioningId(waitingId);
    await runAction(async () => {
      const { error: rpcError } = await (supabase as any).rpc("cancel_compound_waiting", {
        p_waiting_id: waitingId,
        p_notes: "Cancelled from waiting queue dashboard.",
      });

      if (rpcError) throw rpcError;
      return "Waiting entry cancelled.";
    });
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_35%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Waiting for Compound</h1>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">
                Queue management for trailers waiting on a free compound position.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleAssignNext()}
                disabled={isLoading || isMutating}
                className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
              >
                {isMutating && !actioningId ? "Assigning..." : "Assign Next Trailer"}
              </button>
              <Link
                href="/dashboard/compound"
                className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              >
                Back to Compound
              </Link>
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
        ) : null}

        {notice ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{notice}</div>
        ) : null}

        <section className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Queue</p>
            <p className="mt-2 text-2xl font-bold text-white">{metrics.total}</p>
          </article>
          <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Urgent</p>
            <p className="mt-2 text-2xl font-bold text-rose-300">{metrics.urgent}</p>
          </article>
          <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">High</p>
            <p className="mt-2 text-2xl font-bold text-amber-300">{metrics.high}</p>
          </article>
          <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Avg Wait</p>
            <p className="mt-2 text-2xl font-bold text-cyan-300">{formatMinutes(metrics.avgMinutes)}</p>
          </article>
          <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Occupied</p>
            <p className="mt-2 text-2xl font-bold text-white">{occupancy?.occupied_positions ?? 0}</p>
          </article>
          <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Available</p>
            <p className="mt-2 text-2xl font-bold text-emerald-300">{occupancy?.available_positions ?? 0}</p>
          </article>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search trailer, customer, load or reason..."
              className="flex-1 rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {([
              { key: "all", label: "All" },
              { key: "urgent", label: "Urgent" },
              { key: "high", label: "High" },
              { key: "normal", label: "Normal" },
              { key: "low", label: "Low" },
            ] as Array<{ key: WaitingFilter; label: string }>).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  filter === item.key
                    ? "bg-cyan-500 text-slate-950"
                    : "border border-white/10 bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
          {isLoading ? (
            <p className="text-sm text-slate-400">Loading waiting queue...</p>
          ) : filteredRows.length === 0 ? (
            <p className="text-sm text-slate-400">No waiting trailers match the current filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm text-slate-200">
                <thead className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Trailer</th>
                    <th className="px-3 py-2">Priority</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Load</th>
                    <th className="px-3 py-2">Waiting Since</th>
                    <th className="px-3 py-2">Time in Queue</th>
                    <th className="px-3 py-2">Reason</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const isRowActioning = actioningId === row.id && isMutating;
                    return (
                      <tr key={row.id} className="border-t border-white/10">
                        <td className="px-3 py-3 font-semibold text-white">{row.trailer_number ?? "-"}</td>
                        <td className="px-3 py-3">{normalizeStatusLabel(row.priority_level)}</td>
                        <td className="px-3 py-3">{row.customer ?? "-"}</td>
                        <td className="px-3 py-3">{row.load_status ?? "-"}</td>
                        <td className="px-3 py-3">{formatDateTime(row.waiting_since)}</td>
                        <td className="px-3 py-3">{formatMinutes(row.waiting_minutes)}</td>
                        <td className="px-3 py-3">{normalizeStatusLabel(row.waiting_reason)}</td>
                        <td className="px-3 py-3">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void handleAssign(row.id)}
                              disabled={isMutating}
                              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-60"
                            >
                              {isRowActioning ? "Assigning..." : "Assign Position"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleCancel(row.id)}
                              disabled={isMutating}
                              className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-60"
                            >
                              {isRowActioning ? "Saving..." : "Cancel"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}