"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  computeVesselOperationSummary,
  formatVesselDateTime,
  getVesselPriorityClass,
  getVesselPriorityLabel,
  getVesselTrailerStatusClass,
  getVesselTrailerStatusLabel,
  sortVesselOperationTrailersForArrivals,
  type VesselOperationRecord,
  type VesselOperationTrailerRecord,
  type VesselTrailerStatus,
} from "@/lib/vessel-operations";

type ViewFilter = "expected_queue" | "arrived" | "all";

type ArrivalConfirmState = {
  trailer: VesselOperationTrailerRecord;
  receivedAt: string;
  compoundPosition: string;
  arrivalNotes: string;
  conditionOnArrival: string;
};

const filters: Array<{ key: ViewFilter; label: string }> = [
  { key: "expected_queue", label: "Expected from Vessel Operations" },
  { key: "arrived", label: "Arrived" },
  { key: "all", label: "All" },
];

const getDateTimeLocalValue = (date?: Date) => {
  const now = date ?? new Date();
  const offset = now.getTimezoneOffset();
  const localDate = new Date(now.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
};

function VesselArrivalsPageContent() {
  const params = useParams();
  const operationId = typeof params?.id === "string" ? params.id : "";

  const [operation, setOperation] = useState<VesselOperationRecord | null>(null);
  const [trailers, setTrailers] = useState<VesselOperationTrailerRecord[]>([]);
  const [activeFilter, setActiveFilter] = useState<ViewFilter>("expected_queue");
  const [confirmState, setConfirmState] = useState<ArrivalConfirmState | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
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

      if (operationResult.error || !operationResult.data) throw operationResult.error ?? new Error("Operation not found.");
      if (trailersResult.error) throw trailersResult.error;

      setOperation(operationResult.data as VesselOperationRecord);
      setTrailers(sortVesselOperationTrailersForArrivals((trailersResult.data ?? []) as VesselOperationTrailerRecord[]));
    } catch (loadErr) {
      console.error("Unable to load arrivals:", loadErr);
      setError("Unable to load arrivals.");
    } finally {
      setIsLoading(false);
    }
  }, [operationId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadArrivals();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadArrivals]);

  const summary = useMemo(() => computeVesselOperationSummary(trailers), [trailers]);

  const visibleTrailers = useMemo(() => {
    const expectedQueue =
      (operation?.list_status ?? "draft") === "confirmed"
        ? trailers.filter(
            (item) =>
              item.arrival_status === "available_for_arrival" &&
              !item.arrival_record_id,
          )
        : [];

    if (activeFilter === "expected_queue") {
      return expectedQueue;
    }

    if (activeFilter === "arrived") {
      return trailers.filter((item) => item.arrival_status === "arrived");
    }

    return trailers;
  }, [activeFilter, operation?.list_status, trailers]);

  const handleOpenConfirmDialog = (trailer: VesselOperationTrailerRecord) => {
    setConfirmState({
      trailer,
      receivedAt: getDateTimeLocalValue(),
      compoundPosition: trailer.assigned_position?.trim() ?? "",
      arrivalNotes: "",
      conditionOnArrival: "",
    });
  };

  const handleConfirmArrival = async () => {
    if (!operation || !confirmState) return;

    setIsConfirming(true);
    setError(null);
    setSuccess(null);

    try {
      const { trailer } = confirmState;

      if ((operation.list_status ?? "draft") !== "confirmed") {
        throw new Error("Vessel list is not confirmed.");
      }

      if (trailer.arrival_status === "arrived") {
        throw new Error("Trailer arrival has already been confirmed.");
      }

      if (trailer.arrival_record_id) {
        throw new Error("Trailer already has a linked arrival record.");
      }

      const receivedAtIso = new Date(confirmState.receivedAt).toISOString();

      const { data, error: rpcError } = await supabase.rpc("confirm_vessel_trailer_arrival", {
        p_vessel_operation_trailer_id: trailer.id,
        p_received_at: receivedAtIso,
        p_compound_position: confirmState.compoundPosition.trim() || null,
        p_arrival_notes: confirmState.arrivalNotes.trim() || null,
        p_condition_on_arrival: confirmState.conditionOnArrival.trim() || null,
        p_confirmed_by: "TrailerHub User",
      });

      if (rpcError) {
        throw rpcError;
      }

      setSuccess(`Arrival confirmed for ${trailer.trailer_number ?? "trailer"}.`);
      setConfirmState(null);
      await loadArrivals();

      if (data) {
        console.info("Created or linked trailer record id:", data);
      }
    } catch (confirmErr) {
      console.error("Unable to confirm arrival:", confirmErr);
      setError(confirmErr instanceof Error ? confirmErr.message : "Unable to confirm arrival.");
    } finally {
      setIsConfirming(false);
    }
  };

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
              <Link href={`/dashboard/vessel-operations/${operation.id}/summary`} className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20">Summary</Link>
            </div>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
        {success ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div> : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">List Status</p><p className="mt-2 text-lg font-semibold text-white capitalize">{operation.list_status ?? "draft"}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Expected</p><p className="mt-2 text-lg font-semibold text-white">{summary.expected}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Available for Arrival</p><p className="mt-2 text-lg font-semibold text-cyan-200">{summary.availableForArrival}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Arrived</p><p className="mt-2 text-lg font-semibold text-amber-200">{summary.arrived}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Cancelled</p><p className="mt-2 text-lg font-semibold text-rose-200">{summary.cancelled}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Not Discharged</p><p className="mt-2 text-lg font-semibold text-fuchsia-200">{summary.notDischarged}</p></div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
          <div className="flex flex-wrap gap-2">
            {filters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setActiveFilter(filter.key)}
                className={`rounded-2xl px-3 py-2 text-sm font-semibold transition ${
                  activeFilter === filter.key
                    ? "border border-cyan-400/40 bg-cyan-500/15 text-cyan-100"
                    : "border border-white/10 bg-slate-950/80 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </section>

        {(operation.list_status ?? "draft") !== "confirmed" && activeFilter === "expected_queue" ? (
          <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
            Vessel list is not confirmed. Confirm the list on the Vessel Operation page before trailers appear in the arrival queue.
          </div>
        ) : null}

        <section className="grid gap-4">
          {visibleTrailers.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-300">No trailers match the current filter.</div>
          ) : (
            visibleTrailers.map((trailer) => {
              const canConfirmArrival =
                (operation.list_status ?? "draft") === "confirmed" &&
                trailer.arrival_status === "available_for_arrival" &&
                !trailer.arrival_record_id;

              return (
                <article key={trailer.id} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-bold text-white">{trailer.trailer_number ?? "-"}</h2>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselPriorityClass(trailer.priority_level)}`}>{getVesselPriorityLabel(trailer.priority_level)}</span>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselTrailerStatusClass((trailer.arrival_status ?? trailer.status) as VesselTrailerStatus)}`}>{getVesselTrailerStatusLabel((trailer.arrival_status ?? trailer.status) as VesselTrailerStatus)}</span>
                      </div>
                      <p className="text-sm text-slate-300">Vessel: {operation.vessel_name ?? "-"}</p>
                      <p className="text-sm text-slate-300">Sailing Reference: {operation.sailing_reference ?? "-"}</p>
                      <p className="text-sm text-slate-300">Expected Arrival: {formatVesselDateTime(operation.expected_arrival_at)}</p>
                      <p className="text-sm text-slate-300">Customer: {trailer.customer ?? "-"}</p>
                      <p className="text-sm text-slate-300">Booking Reference: {trailer.booking_reference ?? "-"}</p>
                      <p className="text-sm text-slate-300">Load Status: {trailer.load_status ?? "-"}</p>
                      <p className="text-sm text-slate-300">Notes: {trailer.planning_notes ?? "-"}</p>
                      {trailer.arrival_confirmed_at ? <p className="text-sm text-emerald-200">Actual Arrival: {formatVesselDateTime(trailer.arrival_confirmed_at)}</p> : null}
                      {trailer.arrival_record_id ? <Link href={`/dashboard/trailers/${trailer.trailer_number ?? trailer.arrival_record_id}`} className="inline-block text-xs text-cyan-200 underline">Open linked trailer record</Link> : null}
                    </div>

                    <div className="flex flex-col gap-2 lg:min-w-64">
                      {canConfirmArrival ? (
                        <button
                          type="button"
                          onClick={() => handleOpenConfirmDialog(trailer)}
                          className="rounded-2xl bg-cyan-500 px-5 py-4 text-lg font-semibold text-slate-950 hover:bg-cyan-400"
                        >
                          Confirm Arrival
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>

      {confirmState ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-900 p-5 shadow-2xl sm:p-6">
            <h3 className="text-xl font-semibold text-white">Confirm Arrival</h3>
            <p className="mt-2 text-sm text-slate-300">Validate receipt and create the real arrival record from vessel data.</p>

            <div className="mt-4 grid gap-2 text-sm text-slate-200 sm:grid-cols-2">
              <p>Trailer: {confirmState.trailer.trailer_number ?? "-"}</p>
              <p>Vessel: {operation.vessel_name ?? "-"}</p>
              <p>Sailing Reference: {operation.sailing_reference ?? "-"}</p>
              <p>Customer: {confirmState.trailer.customer ?? "-"}</p>
              <p>Load Status: {confirmState.trailer.load_status ?? "-"}</p>
              <p>Priority: {getVesselPriorityLabel(confirmState.trailer.priority_level)}</p>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-200">
                Actual receipt date/time
                <input
                  type="datetime-local"
                  value={confirmState.receivedAt}
                  onChange={(event) => setConfirmState((current) => current ? { ...current, receivedAt: event.target.value } : current)}
                  className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm outline-none"
                />
              </label>

              <label className="text-sm text-slate-200">
                Compound position
                <input
                  value={confirmState.compoundPosition}
                  onChange={(event) => setConfirmState((current) => current ? { ...current, compoundPosition: event.target.value } : current)}
                  className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm outline-none"
                  placeholder="P01"
                />
              </label>

              <label className="text-sm text-slate-200 sm:col-span-2">
                Arrival notes
                <textarea
                  rows={3}
                  value={confirmState.arrivalNotes}
                  onChange={(event) => setConfirmState((current) => current ? { ...current, arrivalNotes: event.target.value } : current)}
                  className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm outline-none"
                />
              </label>

              <label className="text-sm text-slate-200 sm:col-span-2">
                Condition on arrival
                <input
                  value={confirmState.conditionOnArrival}
                  onChange={(event) => setConfirmState((current) => current ? { ...current, conditionOnArrival: event.target.value } : current)}
                  className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm outline-none"
                  placeholder="Optional"
                />
              </label>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setConfirmState(null)} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Cancel</button>
              <button type="button" onClick={() => void handleConfirmArrival()} disabled={isConfirming} className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60">{isConfirming ? "Confirming..." : "Confirm Arrival"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default function VesselArrivalsPage() {
  return <VesselArrivalsPageContent />;
}
