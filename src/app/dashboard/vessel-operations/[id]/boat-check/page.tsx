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

type ViewFilter = "pending" | "progress" | "completed" | "damage" | "temperature" | "priority" | "all";

type ViewTrailer = VesselOperationTrailerRecord & {
  damageCount?: number;
  temperatureAlertCount?: number;
};

const filters: Array<{ key: ViewFilter; label: string }> = [
  { key: "pending", label: "Pending" },
  { key: "progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
  { key: "damage", label: "Damage" },
  { key: "temperature", label: "Temperature Alert" },
  { key: "priority", label: "Priority" },
  { key: "all", label: "All" },
];

function VesselBoatCheckPageContent() {
  const params = useParams();
  const operationId = typeof params?.id === "string" ? params.id : "";

  const [operation, setOperation] = useState<VesselOperationRecord | null>(null);
  const [trailers, setTrailers] = useState<ViewTrailer[]>([]);
  const [activeFilter, setActiveFilter] = useState<ViewFilter>("pending");
  const [actioningTrailerId, setActioningTrailerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBoatCheck = useCallback(async () => {
    if (!operationId) {
      setError("Invalid vessel operation id.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [operationResult, trailersResult, damagesResult, temperaturesResult] = await Promise.all([
        supabase
          .from("vessel_operations")
          .select("id, vessel_name, sailing_reference, origin_port, berth, expected_arrival_at, actual_arrival_at, status, notes, created_at, updated_at")
          .eq("id", operationId)
          .single(),
        supabase
          .from("vessel_operation_trailers")
          .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, load_description, temperature_required, priority_level, priority_reason, planned_destination, planning_notes, status, arrived_at, arrival_confirmed_by, inspection_started_at, inspection_completed_at, position_assigned_at, assigned_position, has_damage, has_temperature_alert, created_at, updated_at")
          .eq("vessel_operation_id", operationId)
          .in("status", ["arrived", "inspection_pending", "inspection_in_progress", "inspected", "positioned"])
          .order("created_at", { ascending: true }),
        Promise.resolve({ data: [], error: null }),
        Promise.resolve({ data: [], error: null }),
      ]);

      if (operationResult.error || !operationResult.data) throw operationResult.error ?? new Error("Operation not found.");
      if (trailersResult.error) throw trailersResult.error;
      if (damagesResult.error) throw damagesResult.error;
      if (temperaturesResult.error) throw temperaturesResult.error;

      setOperation(operationResult.data as VesselOperationRecord);
      setTrailers(
        sortVesselOperationTrailersForArrivals(
          ((trailersResult.data ?? []) as VesselOperationTrailerRecord[]).map((row) => ({
            ...row,
            damageCount: row.has_damage ? 1 : 0,
            temperatureAlertCount: row.has_temperature_alert ? 1 : 0,
          })),
        ),
      );
    } catch (error) {
      console.error("Unable to load boat check:", error);
      setError("Unable to load boat check.");
    } finally {
      setIsLoading(false);
    }
  }, [operationId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadBoatCheck();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadBoatCheck]);

  const summary = useMemo(() => computeVesselOperationSummary(trailers), [trailers]);

  const visibleTrailers = useMemo(() => {
    if (activeFilter === "pending") return trailers.filter((item) => item.status === "arrived" || item.status === "inspection_pending");
    if (activeFilter === "progress") return trailers.filter((item) => item.status === "inspection_in_progress");
    if (activeFilter === "completed") return trailers.filter((item) => item.status === "inspected" || item.status === "positioned");
    if (activeFilter === "damage") return trailers.filter((item) => item.has_damage || (item.damageCount ?? 0) > 0);
    if (activeFilter === "temperature") return trailers.filter((item) => item.has_temperature_alert || (item.temperatureAlertCount ?? 0) > 0);
    if (activeFilter === "priority") return trailers.filter((item) => item.priority_level === "priority");
    return trailers;
  }, [activeFilter, trailers]);

  const startInspection = async (trailer: ViewTrailer) => {
    setActioningTrailerId(trailer.id);
    setError(null);

    try {
      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("vessel_operation_trailers")
        .update({ status: "inspection_in_progress" as VesselTrailerStatus, inspection_started_at: nowIso, updated_at: nowIso })
        .eq("id", trailer.id);

      if (updateError) throw updateError;

      const { error: eventError } = await supabase.from("trailer_events").insert({
        trailer_id: trailer.trailer_id ?? null,
        trailer_number: trailer.trailer_number,
        event_type: "vessel_inspection_started",
        event_description: `Inspection started for ${trailer.trailer_number ?? "trailer"}.`,
        old_value: { vessel_operation_trailer_id: trailer.id, status: trailer.status },
        new_value: { vessel_operation_trailer_id: trailer.id, status: "inspection_in_progress", inspection_started_at: nowIso },
      });

      if (eventError) console.error("Failed to save vessel inspection started event:", eventError);

      setTrailers((current) =>
        sortVesselOperationTrailersForArrivals(current.map((item) => (item.id === trailer.id ? { ...item, status: "inspection_in_progress", inspection_started_at: nowIso } : item))),
      );
    } catch (error) {
      console.error("Unable to start inspection:", error);
      setError("Unable to start inspection.");
    } finally {
      setActioningTrailerId(null);
    }
  };

  const completeInspection = async (trailer: ViewTrailer) => {
    const confirmed = window.confirm(`Complete inspection for ${trailer.trailer_number ?? "trailer"}?`);
    if (!confirmed) return;

    setActioningTrailerId(trailer.id);
    setError(null);

    try {
      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("vessel_operation_trailers")
        .update({ status: "inspected" as VesselTrailerStatus, inspection_completed_at: nowIso, updated_at: nowIso })
        .eq("id", trailer.id);

      if (updateError) throw updateError;

      const { error: eventError } = await supabase.from("trailer_events").insert({
        trailer_id: trailer.trailer_id ?? null,
        trailer_number: trailer.trailer_number,
        event_type: "vessel_inspection_completed",
        event_description: `Inspection completed for ${trailer.trailer_number ?? "trailer"}.`,
        old_value: { vessel_operation_trailer_id: trailer.id, status: trailer.status },
        new_value: { vessel_operation_trailer_id: trailer.id, status: "inspected", inspection_completed_at: nowIso },
      });

      if (eventError) console.error("Failed to save vessel inspection completed event:", eventError);

      setTrailers((current) =>
        sortVesselOperationTrailersForArrivals(current.map((item) => (item.id === trailer.id ? { ...item, status: "inspected", inspection_completed_at: nowIso } : item))),
      );
    } catch (error) {
      console.error("Unable to complete inspection:", error);
      setError("Unable to complete inspection.");
    } finally {
      setActioningTrailerId(null);
    }
  };

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">Loading boat check...</div>
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
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Boat Check</h1>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">{operation.vessel_name ?? "Unnamed vessel"} - inspection workflow.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/dashboard/vessel-operations/${operation.id}/planning`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Planning</Link>
              <Link href={`/dashboard/vessel-operations/${operation.id}/arrivals`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Arrivals</Link>
              <Link href={`/dashboard/vessel-operations/${operation.id}/summary`} className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20">Summary</Link>
            </div>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Expected</p><p className="mt-2 text-lg font-semibold text-white">{summary.expected}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Arrived</p><p className="mt-2 text-lg font-semibold text-amber-200">{summary.arrived}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Pending Inspection</p><p className="mt-2 text-lg font-semibold text-cyan-200">{summary.pendingInspection}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Damages</p><p className="mt-2 text-lg font-semibold text-rose-200">{summary.damagedTrailers}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Temperature Alerts</p><p className="mt-2 text-lg font-semibold text-orange-200">{summary.temperatureAlerts}</p></div>
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

        <section className="grid gap-4">
          {visibleTrailers.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-300">No trailers match the current filter.</div>
          ) : (
            visibleTrailers.map((trailer) => (
              <article key={trailer.id} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-bold text-white">{trailer.trailer_number ?? "-"}</h2>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselPriorityClass(trailer.priority_level)}`}>{getVesselPriorityLabel(trailer.priority_level)}</span>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselTrailerStatusClass(trailer.status)}`}>{getVesselTrailerStatusLabel(trailer.status)}</span>
                    </div>
                    <p className="text-sm text-slate-300">Planned Destination: {trailer.planned_destination ?? "-"}</p>
                    <p className="text-sm text-slate-300">Arrived Time: {formatVesselDateTime(trailer.arrived_at)}</p>
                    <p className="text-sm text-slate-300">Inspection Status: {getVesselTrailerStatusLabel(trailer.status)}</p>
                    <div className="flex flex-wrap gap-2">
                      {(trailer.has_damage || (trailer.damageCount ?? 0) > 0) ? <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200">Damage</span> : null}
                      {(trailer.has_temperature_alert || (trailer.temperatureAlertCount ?? 0) > 0) ? <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-semibold text-orange-200">Temperature Alert</span> : null}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 lg:min-w-64">
                    {trailer.status === "arrived" || trailer.status === "inspection_pending" ? (
                      <button type="button" onClick={() => void startInspection(trailer)} disabled={actioningTrailerId === trailer.id} className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60">
                        {actioningTrailerId === trailer.id ? "Starting..." : "Start Inspection"}
                      </button>
                    ) : null}

                    <Link href={`/dashboard/vessel-operations/${operation.id}/boat-check/${trailer.id}`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-slate-700">
                      Open Inspection
                    </Link>

                    {(trailer.status === "inspection_in_progress" || trailer.status === "inspection_pending" || trailer.status === "arrived") ? (
                      <button type="button" onClick={() => void completeInspection(trailer)} disabled={actioningTrailerId === trailer.id} className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60">
                        {actioningTrailerId === trailer.id ? "Completing..." : "Complete Inspection"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </main>
  );
}

export default function VesselBoatCheckPage() {
  return <VesselBoatCheckPageContent />;
}
