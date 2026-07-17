"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmReceptionModal } from "../components/confirm-reception-modal";
import { useVesselReception } from "../hooks/use-vessel-reception";
import { supabase } from "@/lib/supabase";
import {
  canConfirmVesselTrailerReception,
  formatVesselDateTime,
  getVesselArrivalWorkflowLabel,
  getVesselArrivalWorkflowState,
  getVesselInspectionProgressLabel,
  getVesselInspectionProgressState,
  getVesselPriorityClass,
  getVesselPriorityLabel,
  getVesselTrailerStatusClass,
  getVesselTrailerStatusLabel,
  sortVesselOperationTrailersForArrivals,
  type VesselOperationRecord,
  type VesselOperationTrailerRecord,
} from "@/lib/vessel-operations";

type StatusFilter = "all" | "expected" | "arrived" | "inspection_pending" | "ready_for_reception" | "received" | "cancelled";
type DateFilter = "all" | "today" | "tomorrow" | "custom";

type ArrivalKpi = {
  expected: number;
  arrived: number;
  inspectionPending: number;
  readyForReception: number;
  received: number;
  cancelled: number;
};

const statusFilters: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "expected", label: "Expected" },
  { key: "arrived", label: "Arrived" },
  { key: "inspection_pending", label: "Inspection Pending" },
  { key: "ready_for_reception", label: "Ready for Reception" },
  { key: "received", label: "Received" },
  { key: "cancelled", label: "Cancelled" },
];

const getDateKey = (value?: string | null) => {
  if (!value) return null;

  try {
    return new Date(value).toISOString().split("T")[0] ?? null;
  } catch {
    return null;
  }
};

const resolveOperatorName = async () => {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) {
    return "TrailerHub User";
  }

  const metadataName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name.trim());

  return metadataName || user.email || user.id || "TrailerHub User";
};

const buildArrivalKpis = (trailers: VesselOperationTrailerRecord[]): ArrivalKpi => {
  const kpis: ArrivalKpi = {
    expected: 0,
    arrived: 0,
    inspectionPending: 0,
    readyForReception: 0,
    received: 0,
    cancelled: 0,
  };

  for (const trailer of trailers) {
    const workflowState = getVesselArrivalWorkflowState(trailer);

    if (workflowState === "expected") {
      kpis.expected += 1;
    } else if (workflowState === "arrived") {
      kpis.arrived += 1;
    } else if (workflowState === "inspection_pending") {
      kpis.inspectionPending += 1;
    } else if (workflowState === "ready_for_reception") {
      kpis.readyForReception += 1;
    } else if (workflowState === "received") {
      kpis.received += 1;
    } else if (workflowState === "cancelled") {
      kpis.cancelled += 1;
    }
  }

  return kpis;
};

function VesselArrivalsPageContent() {
  const params = useParams();
  const operationId = typeof params?.id === "string" ? params.id : "";

  const [operation, setOperation] = useState<VesselOperationRecord | null>(null);
  const [trailers, setTrailers] = useState<VesselOperationTrailerRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [customDate, setCustomDate] = useState("");
  const [searchText, setSearchText] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<"all" | "priority" | "normal">("all");
  const [actioningTrailerId, setActioningTrailerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadArrivals = useCallback(async () => {
    if (!operationId) {
      setError("Invalid vessel operation id.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [operationResult, trailersResult] = await Promise.all([
        supabase
          .from("vessel_operations")
          .select("id, vessel_name, sailing_reference, origin_port, berth, expected_arrival_at, actual_arrival_at, status, list_status, list_confirmed_at, list_confirmed_by, notes, created_at, updated_at")
          .eq("id", operationId)
          .single(),
        supabase
          .from("vessel_operation_trailers")
          .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, load_description, temperature_required, priority_level, priority_reason, planned_destination, planning_notes, status, arrived_at, arrival_status, arrival_confirmed_at, arrival_record_id, arrival_confirmed_by, inspection_started_at, inspection_completed_at, position_assigned_at, assigned_position, has_damage, has_temperature_alert, created_at, updated_at")
          .eq("vessel_operation_id", operationId)
          .order("created_at", { ascending: true }),
      ]);

      if (operationResult.error || !operationResult.data) {
        throw operationResult.error ?? new Error("Operation not found.");
      }

      if (trailersResult.error) {
        throw trailersResult.error;
      }

      setOperation(operationResult.data as VesselOperationRecord);
      setTrailers(sortVesselOperationTrailersForArrivals((trailersResult.data ?? []) as VesselOperationTrailerRecord[]));
    } catch (loadErr) {
      console.error("Unable to load arrivals:", loadErr);
      setError("Unable to load arrivals.");
    } finally {
      setIsLoading(false);
    }
  }, [operationId]);

  const reception = useVesselReception({
    operation,
    onSuccess: async (message) => {
      setError(null);
      setSuccess(message);
      await loadArrivals();
    },
  });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadArrivals();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadArrivals]);

  const summary = useMemo(() => buildArrivalKpis(trailers), [trailers]);

  const visibleTrailers = useMemo(() => {
    const todayKey = getDateKey(new Date().toISOString());
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowKey = getDateKey(tomorrowDate.toISOString());
    const search = searchText.trim().toLowerCase();

    return trailers.filter((item) => {
      const workflowState = getVesselArrivalWorkflowState(item);
      const searchHaystack = [
        item.trailer_number,
        item.booking_reference,
        item.customer,
        item.planning_notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (statusFilter !== "all" && workflowState !== statusFilter) {
        return false;
      }

      if (priorityFilter !== "all" && (item.priority_level ?? "normal") !== priorityFilter) {
        return false;
      }

      if (search && !searchHaystack.includes(search)) {
        return false;
      }

      const comparisonDate = getDateKey(item.arrival_confirmed_at ?? item.arrived_at ?? operation?.expected_arrival_at ?? null);

      if (dateFilter === "today" && comparisonDate !== todayKey) {
        return false;
      }

      if (dateFilter === "tomorrow" && comparisonDate !== tomorrowKey) {
        return false;
      }

      if (dateFilter === "custom" && customDate && comparisonDate !== customDate) {
        return false;
      }

      return true;
    });
  }, [customDate, dateFilter, operation?.expected_arrival_at, priorityFilter, searchText, statusFilter, trailers]);

  const handleMarkArrived = useCallback(
    async (trailer: VesselOperationTrailerRecord) => {
      if (!operation) {
        return;
      }

      if ((operation.list_status ?? "draft") !== "confirmed") {
        setError("List must be confirmed before arrivals.");
        return;
      }

      if (trailer.arrival_status === "arrived") {
        setError("Arrival already confirmed.");
        return;
      }

      if (trailer.arrival_status !== "available_for_arrival") {
        setError("Trailer is not available for arrival.");
        return;
      }

      setActioningTrailerId(trailer.id);
      setError(null);
      setSuccess(null);

      try {
        const nowIso = new Date().toISOString();
        const operatorName = await resolveOperatorName();

        const { data: updatedTrailer, error: updateError } = await supabase
          .from("vessel_operation_trailers")
          .update({
            arrival_status: "arrived",
            status: "arrived",
            arrival_confirmed_at: nowIso,
            arrived_at: nowIso,
            arrival_confirmed_by: operatorName,
            updated_at: nowIso,
          })
          .eq("id", trailer.id)
          .eq("arrival_status", "available_for_arrival")
          .is("arrival_record_id", null)
          .select("id, trailer_number")
          .maybeSingle();

        if (updateError) {
          throw updateError;
        }

        if (!updatedTrailer) {
          setError("Arrival already confirmed.");
          return;
        }

        const { error: eventError } = await supabase.from("trailer_events").insert({
          trailer_id: null,
          trailer_number: trailer.trailer_number ?? null,
          event_type: "vessel_trailer_marked_arrived",
          event_description: "Expected trailer marked as arrived.",
          old_value: {
            vessel_operation_trailer_id: trailer.id,
            arrival_status: trailer.arrival_status,
          },
          new_value: {
            vessel_operation_trailer_id: trailer.id,
            arrival_status: "arrived",
            arrived_at: nowIso,
            arrived_by: operatorName,
          },
        });

        if (eventError) {
          console.error("Unable to save mark arrived event:", eventError);
        }

        setSuccess(`Arrival confirmed for ${trailer.trailer_number ?? "trailer"}.`);
        await loadArrivals();
      } catch (confirmErr) {
        console.error("Unable to confirm arrival:", confirmErr);
        setError("Unable to confirm arrival.");
      } finally {
        setActioningTrailerId(null);
      }
    },
    [loadArrivals, operation],
  );

  const handleUndoArrived = useCallback(
    async (trailer: VesselOperationTrailerRecord) => {
      if (!operation) {
        return;
      }

      if ((operation.list_status ?? "draft") !== "confirmed") {
        setError("List must be confirmed before editing arrival statuses.");
        return;
      }

      const canUndo = trailer.arrival_status === "arrived" && !trailer.arrival_record_id && !trailer.inspection_started_at && !trailer.inspection_completed_at;
      if (!canUndo) {
        setError("Arrival undo is only available before inspection and before reception.");
        return;
      }

      const confirmed = window.confirm(`Undo Arrived for ${trailer.trailer_number ?? "this trailer"}?`);
      if (!confirmed) {
        return;
      }

      setActioningTrailerId(trailer.id);
      setError(null);
      setSuccess(null);

      try {
        const nowIso = new Date().toISOString();
        const operatorName = await resolveOperatorName();

        const { data: revertedTrailer, error: updateError } = await supabase
          .from("vessel_operation_trailers")
          .update({
            status: "expected",
            arrival_status: "available_for_arrival",
            arrived_at: null,
            arrival_confirmed_at: null,
            arrival_confirmed_by: null,
            inspection_started_at: null,
            inspection_completed_at: null,
            updated_at: nowIso,
          })
          .eq("id", trailer.id)
          .eq("arrival_status", "arrived")
          .is("arrival_record_id", null)
          .is("inspection_started_at", null)
          .is("inspection_completed_at", null)
          .select("id")
          .maybeSingle();

        if (updateError) {
          throw updateError;
        }

        if (!revertedTrailer) {
          setError("Arrival undo is no longer available for this trailer.");
          return;
        }

        const { error: eventError } = await supabase.from("trailer_events").insert({
          trailer_id: null,
          trailer_number: trailer.trailer_number ?? null,
          event_type: "vessel_arrival_undo",
          event_description: "Arrival status reverted to expected queue.",
          old_value: {
            vessel_operation_trailer_id: trailer.id,
            arrival_status: "arrived",
          },
          new_value: {
            vessel_operation_trailer_id: trailer.id,
            arrival_status: "available_for_arrival",
            reverted_by: operatorName,
          },
        });

        if (eventError) {
          console.error("Unable to save arrival undo event:", eventError);
        }

        setSuccess(`Arrival reverted for ${trailer.trailer_number ?? "trailer"}.`);
        await loadArrivals();
      } catch (undoErr) {
        console.error("Unable to undo arrival:", undoErr);
        setError("Unable to undo arrival.");
      } finally {
        setActioningTrailerId(null);
      }
    },
    [loadArrivals, operation],
  );

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">Loading vessel arrivals...</div>
      </main>
    );
  }

  if (!operation) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-rose-500/30 bg-rose-500/10 p-6 text-sm text-rose-200">{error ?? "Vessel operation not found."}</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Arrivals</h1>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">
                {operation.vessel_name ?? "Unnamed vessel"} - Expected {formatVesselDateTime(operation.expected_arrival_at)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/dashboard/vessel-operations/${operation.id}`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Operation</Link>
              <Link href={`/dashboard/vessel-operations/${operation.id}/boat-check`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Boat Check</Link>
            </div>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
        {success ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div> : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Expected</p><p className="mt-2 text-lg font-semibold text-white">{summary.expected}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Arrived</p><p className="mt-2 text-lg font-semibold text-amber-200">{summary.arrived}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inspection Pending</p><p className="mt-2 text-lg font-semibold text-cyan-200">{summary.inspectionPending}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Ready for Reception</p><p className="mt-2 text-lg font-semibold text-emerald-200">{summary.readyForReception}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Received</p><p className="mt-2 text-lg font-semibold text-emerald-200">{summary.received}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Cancelled</p><p className="mt-2 text-lg font-semibold text-rose-200">{summary.cancelled}</p></div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Vessel
              <input value={operation.vessel_name ?? "Unnamed vessel"} disabled className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-300" />
            </label>

            <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Date
              <div className="mt-2 grid grid-cols-2 gap-2">
                <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DateFilter)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100">
                  <option value="all">All</option>
                  <option value="today">Today</option>
                  <option value="tomorrow">Tomorrow</option>
                  <option value="custom">Custom</option>
                </select>
                <input type="date" value={customDate} onChange={(event) => setCustomDate(event.target.value)} disabled={dateFilter !== "custom"} className="rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 disabled:opacity-50" />
              </div>
            </label>

            <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Status
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100">
                {statusFilters.map((filter) => (
                  <option key={filter.key} value={filter.key}>{filter.label}</option>
                ))}
              </select>
            </label>

            <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Priority
              <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as "all" | "priority" | "normal")} className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100">
                <option value="all">All</option>
                <option value="priority">Priority</option>
                <option value="normal">Normal</option>
              </select>
            </label>

            <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Trailer Search
              <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Trailer / Booking / Customer" className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100" />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {statusFilters.map((filter) => (
              <button
                key={`chip-${filter.key}`}
                type="button"
                onClick={() => setStatusFilter(filter.key)}
                className={`rounded-2xl px-3 py-2 text-sm font-semibold transition ${
                  statusFilter === filter.key
                    ? "border border-cyan-400/40 bg-cyan-500/15 text-cyan-100"
                    : "border border-white/10 bg-slate-950/80 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </section>

        {(operation.list_status ?? "draft") !== "confirmed" ? (
          <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
            Vessel list is not confirmed. Confirm the list on the Vessel Operation page before trailers appear as available.
          </div>
        ) : null}

        <section className="grid gap-4">
          {visibleTrailers.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-300">No trailers match the current filter.</div>
          ) : (
            visibleTrailers.map((trailer) => {
              const workflowState = getVesselArrivalWorkflowState(trailer);
              const workflowLabel = getVesselArrivalWorkflowLabel(workflowState);
              const inspectionState = getVesselInspectionProgressState(trailer);
              const inspectionLabel = getVesselInspectionProgressLabel(inspectionState);
              const canMarkArrived = (operation.list_status ?? "draft") === "confirmed" && trailer.arrival_status === "available_for_arrival" && !trailer.arrival_record_id;
              const canUndo = trailer.arrival_status === "arrived" && !trailer.arrival_record_id && !trailer.inspection_started_at && !trailer.inspection_completed_at;

              return (
                <article key={trailer.id} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-bold text-white">{trailer.trailer_number ?? "-"}</h2>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselPriorityClass(trailer.priority_level)}`}>{getVesselPriorityLabel(trailer.priority_level)}</span>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselTrailerStatusClass((trailer.arrival_status === "available_for_arrival" ? "available_for_arrival" : trailer.status) ?? "expected")}`}>
                          {workflowLabel}
                        </span>
                      </div>

                      <p className="text-sm text-slate-300">Vessel: {operation.vessel_name ?? "Unnamed vessel"}</p>
                      <p className="text-sm text-slate-300">Voyage: {operation.sailing_reference ?? "-"}</p>
                      <p className="text-sm text-slate-300">ETA: {formatVesselDateTime(operation.expected_arrival_at)}</p>
                      <p className="text-sm text-slate-300">Current Arrival Status: {workflowLabel}</p>
                      <p className="text-sm text-slate-300">Inspection Status: {inspectionLabel}</p>
                      {trailer.customer?.trim() ? <p className="text-sm text-slate-300">Customer: {trailer.customer}</p> : null}
                      {trailer.booking_reference?.trim() ? <p className="text-sm text-slate-300">Booking Reference: {trailer.booking_reference}</p> : null}
                      {trailer.planning_notes?.trim() ? <p className="text-sm text-slate-300">Notes: {trailer.planning_notes}</p> : null}
                      <p className="text-sm text-emerald-200">Arrived Time: {formatVesselDateTime(trailer.arrival_confirmed_at ?? trailer.arrived_at)}</p>
                      <p className="text-sm text-slate-300">Raw Status: {getVesselTrailerStatusLabel((trailer.status ?? "expected") as VesselOperationTrailerRecord["status"])}</p>
                    </div>

                    <div className="flex flex-col gap-2 lg:min-w-56">
                      {canMarkArrived ? (
                        <button
                          type="button"
                          onClick={() => void handleMarkArrived(trailer)}
                          disabled={actioningTrailerId === trailer.id}
                          className="rounded-2xl bg-cyan-500 px-5 py-4 text-lg font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                        >
                          {actioningTrailerId === trailer.id ? "Updating..." : "Mark Arrived"}
                        </button>
                      ) : null}

                      {trailer.arrival_status === "arrived" ? (
                        <Link
                          href={`/dashboard/vessel-operations/${operation.id}/boat-check/${trailer.id}`}
                          className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-slate-700"
                        >
                          Open Boat Check
                        </Link>
                      ) : null}

                      {canUndo ? (
                        <button
                          type="button"
                          onClick={() => void handleUndoArrived(trailer)}
                          disabled={actioningTrailerId === trailer.id}
                          className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-60"
                        >
                          {actioningTrailerId === trailer.id ? "Reverting..." : "Undo Arrived"}
                        </button>
                      ) : null}

                      {canConfirmVesselTrailerReception(trailer, operation) ? (
                        <button
                          type="button"
                          onClick={() => void reception.openReception(trailer)}
                          disabled={actioningTrailerId === trailer.id}
                          className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-60"
                        >
                          Confirm Reception
                        </button>
                      ) : null}

                      {trailer.arrival_record_id ? (
                        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                          <p className="font-semibold">Received</p>
                          <p className="mt-1 text-emerald-200">
                            {trailer.assigned_position ? `Compound Position: ${trailer.assigned_position}` : "Local Trailer"}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>

      <ConfirmReceptionModal
        error={reception.error}
        formState={reception.formState}
        isLoadingOptions={reception.isLoadingOptions}
        isOpen={reception.isOpen}
        isSubmitting={reception.isSubmitting}
        nextAvailablePosition={reception.nextAvailablePosition}
        onClose={reception.closeReception}
        onConfirm={reception.submitReception}
        onFieldChange={reception.updateField}
        trailer={reception.selectedTrailer}
      />
    </main>
  );
}

export default function VesselArrivalsPage() {
  return <VesselArrivalsPageContent />;
}
