"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  computeVesselOperationSummary,
  formatVesselDateTime,
  getVesselOperationStatusClass,
  getVesselOperationStatusLabel,
  getVesselPriorityClass,
  getVesselPriorityLabel,
  type VesselInspectionDamageRecord,
  type VesselInspectionTemperatureRecord,
  type VesselOperationRecord,
  type VesselOperationTrailerRecord,
} from "@/lib/vessel-operations";

type SummaryRow = VesselOperationTrailerRecord & {
  damageCount?: number;
  temperatureCount?: number;
};

function VesselSummaryPageContent() {
  const params = useParams();
  const router = useRouter();
  const operationId = typeof params?.id === "string" ? params.id : "";

  const [operation, setOperation] = useState<VesselOperationRecord | null>(null);
  const [trailers, setTrailers] = useState<SummaryRow[]>([]);
  const [damages, setDamages] = useState<VesselInspectionDamageRecord[]>([]);
  const [temperatures, setTemperatures] = useState<VesselInspectionTemperatureRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
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
          .order("created_at", { ascending: true }),
        supabase.from("vessel_inspection_damages").select("id, vessel_operation_id, vessel_operation_trailer_id, damage_type, damage_location, severity, description, recorded_at, recorded_by").eq("vessel_operation_id", operationId),
        supabase.from("vessel_inspection_temperatures").select("id, vessel_operation_id, vessel_operation_trailer_id, temperature_value, unit, reading_point, notes, out_of_range, recorded_at, recorded_by").eq("vessel_operation_id", operationId),
      ]);

      if (operationResult.error || !operationResult.data) throw operationResult.error ?? new Error("Operation not found.");
      if (trailersResult.error) throw trailersResult.error;
      if (damagesResult.error) throw damagesResult.error;
      if (temperaturesResult.error) throw temperaturesResult.error;

      const damageCounts = new Map<string, number>();
      (damagesResult.data ?? []).forEach((item) => {
        const trailerId = item.vessel_operation_trailer_id;
        if (trailerId) damageCounts.set(trailerId, (damageCounts.get(trailerId) ?? 0) + 1);
      });

      const temperatureCounts = new Map<string, number>();
      (temperaturesResult.data ?? []).forEach((item) => {
        const trailerId = item.vessel_operation_trailer_id;
        if (trailerId) temperatureCounts.set(trailerId, (temperatureCounts.get(trailerId) ?? 0) + 1);
      });

      setOperation(operationResult.data as VesselOperationRecord);
      setTrailers(
        (trailersResult.data ?? []).map((row) => ({
          ...(row as VesselOperationTrailerRecord),
          damageCount: damageCounts.get(row.id) ?? 0,
          temperatureCount: temperatureCounts.get(row.id) ?? 0,
        })),
      );
      setDamages((damagesResult.data ?? []) as VesselInspectionDamageRecord[]);
      setTemperatures((temperaturesResult.data ?? []) as VesselInspectionTemperatureRecord[]);
    } catch (loadErr) {
      console.error("Unable to load summary:", loadErr);
      setError("Unable to load summary.");
    } finally {
      setIsLoading(false);
    }
  }, [operationId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadSummary();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadSummary]);

  const summary = useMemo(() => computeVesselOperationSummary(trailers), [trailers]);

  let durationText = "—";
  if (operation?.actual_arrival_at && operation?.updated_at && operation.status === "completed") {
    const started = new Date(operation.actual_arrival_at).getTime();
    const finished = new Date(operation.updated_at).getTime();
    const minutes = Math.max(0, Math.round((finished - started) / 60000));
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    durationText = hours > 0 ? `${hours}h ${remainder}m` : `${minutes}m`;
  }

  const completeOperation = async () => {
    if (!operation || trailers.some((trailer) => trailer.status === "inspection_in_progress")) {
      setError("Complete all inspections before closing the vessel operation.");
      return;
    }

    const confirmed = window.confirm(`Complete vessel operation ${operation.vessel_name ?? ""}?`);
    if (!confirmed) return;

    setIsSaving(true);
    setError(null);

    try {
      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("vessel_operations")
        .update({ status: "completed", updated_at: nowIso })
        .eq("id", operation.id);

      if (updateError) throw updateError;

      const { error: eventError } = await supabase.from("trailer_events").insert({
        trailer_id: null,
        trailer_number: operation.vessel_name ?? operation.sailing_reference ?? "Vessel Operation",
        event_type: "vessel_operation_completed",
        event_description: `Vessel operation completed for ${operation.vessel_name ?? "operation"}.`,
        old_value: { vessel_operation_id: operation.id, status: operation.status },
        new_value: { vessel_operation_id: operation.id, status: "completed", updated_at: nowIso },
      });

      if (eventError) console.error("Failed to save vessel completion event:", eventError);

      setOperation((current) => (current ? { ...current, status: "completed", updated_at: nowIso } : current));
      setSuccess("Vessel operation completed.");
      router.refresh();
    } catch (completeErr) {
      console.error("Unable to complete vessel operation:", completeErr);
      setError("Unable to complete vessel operation.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">Loading summary...</div>
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

  const allDone = summary.remaining === 0 && summary.pendingInspection === 0 && summary.inProgress === 0;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Vessel Summary</h1>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">{operation.vessel_name ?? "Unnamed vessel"} - {operation.sailing_reference ?? "No sailing reference"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/dashboard/vessel-operations/${operation.id}/planning`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Planning</Link>
              <Link href={`/dashboard/vessel-operations/${operation.id}/arrivals`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Arrivals</Link>
              <Link href={`/dashboard/vessel-operations/${operation.id}/boat-check`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Boat Check</Link>
            </div>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
        {success ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div> : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Operation Status</p><p className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getVesselOperationStatusClass(operation.status)}`}>{getVesselOperationStatusLabel(operation.status)}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Duration</p><p className="mt-2 text-lg font-semibold text-white">{durationText}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Trailer Count</p><p className="mt-2 text-lg font-semibold text-white">{summary.expected}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Last Updated</p><p className="mt-2 text-lg font-semibold text-white">{formatVesselDateTime(operation.updated_at)}</p></div>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Operational Breakdown</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Expected</p><p className="mt-1 text-2xl font-bold text-white">{summary.expected}</p></div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Arrived</p><p className="mt-1 text-2xl font-bold text-amber-200">{summary.arrived}</p></div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Remaining</p><p className="mt-1 text-2xl font-bold text-cyan-200">{summary.remaining}</p></div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Positioned</p><p className="mt-1 text-2xl font-bold text-violet-200">{summary.positioned}</p></div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Inspection Breakdown</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Pending</p><p className="mt-1 text-2xl font-bold text-cyan-200">{summary.pendingInspection}</p></div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">In Progress</p><p className="mt-1 text-2xl font-bold text-orange-200">{summary.inProgress}</p></div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inspected</p><p className="mt-1 text-2xl font-bold text-emerald-200">{summary.inspected}</p></div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Damaged</p><p className="mt-1 text-2xl font-bold text-rose-200">{summary.damagedTrailers}</p></div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Priority</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Priority</p><p className={`mt-1 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getVesselPriorityClass("priority")}`}>{getVesselPriorityLabel("priority")}</p><p className="mt-2 text-2xl font-bold text-white">{summary.priority}</p></div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Normal</p><p className={`mt-1 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getVesselPriorityClass("normal")}`}>{getVesselPriorityLabel("normal")}</p><p className="mt-2 text-2xl font-bold text-white">{summary.normal}</p></div>
            </div>
            <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm text-slate-300">Priority remaining: <span className="font-semibold text-white">{summary.priorityRemaining}</span></div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Damages</p>
            <div className="mt-4 space-y-3">
              {damages.length === 0 ? <p className="text-sm text-slate-400">No damages recorded.</p> : damages.map((damage) => (
                <div key={damage.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-sm text-slate-200">
                  <p className="font-semibold text-white">{damage.damage_type ?? "Damage"}</p>
                  <p className="mt-1 text-slate-300">{damage.description ?? "-"}</p>
                  <p className="mt-1 text-xs text-slate-400">{formatVesselDateTime(damage.recorded_at)}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Temperature Alerts</p>
            <div className="mt-4 space-y-3">
              {temperatures.length === 0 ? <p className="text-sm text-slate-400">No temperatures recorded.</p> : temperatures.map((reading) => (
                <div key={reading.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-sm text-slate-200">
                  <p className="font-semibold text-white">{reading.temperature_value}{reading.unit ?? "C"} - {reading.reading_point ?? "-"}</p>
                  <p className="mt-1 text-slate-300">{reading.notes ?? "-"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {reading.out_of_range ? <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-200">Out of Range</span> : null}
                    <span className="rounded-full border border-white/10 bg-slate-900 px-2.5 py-1 text-xs">{formatVesselDateTime(reading.recorded_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Final Action</p>
          <p className="mt-3 text-sm text-slate-300">{allDone ? "All trailers are ready to close." : "Finish inspection and positioning before closing the vessel operation."}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void completeOperation()} disabled={isSaving || !allDone} className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60">
              {isSaving ? "Completing..." : "Complete Vessel Operation"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function VesselSummaryPage() {
  return <VesselSummaryPageContent />;
}
