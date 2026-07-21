"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmReceptionModal } from "../components/confirm-reception-modal";
import { useVesselReception } from "../hooks/use-vessel-reception";
import { supabase } from "@/lib/supabase";
import {
  canConfirmVesselTrailerReception,
  formatTemperatureReading,
  formatVesselDateTime,
  getTrailerTemperaturePair,
  getVesselInspectionProgressLabel,
  getVesselInspectionProgressState,
  getVesselPriorityClass,
  getVesselPriorityLabel,
  getVesselTrailerStatusClass,
  sortVesselOperationTrailersForArrivals,
  type VesselInspectionTemperatureRecord,
  type VesselOperationRecord,
  type VesselOperationTrailerRecord,
} from "@/lib/vessel-operations";

type BoatCheckSummary = {
  arrived: number;
  pendingInspection: number;
  inspected: number;
  damages: number;
  temperatureAlerts: number;
};

type ViewTrailer = VesselOperationTrailerRecord & {
  frontTemperatureReading?: VesselInspectionTemperatureRecord | null;
  rearTemperatureReading?: VesselInspectionTemperatureRecord | null;
};

function VesselBoatCheckPageContent() {
  const params = useParams();
  const router = useRouter();
  const operationId = typeof params?.id === "string" ? params.id : "";

  const [operation, setOperation] = useState<VesselOperationRecord | null>(null);
  const [trailers, setTrailers] = useState<ViewTrailer[]>([]);
  const [actioningTrailerId, setActioningTrailerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadBoatCheck = useCallback(async () => {
    if (!operationId) {
      setError("Invalid vessel operation reference.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [operationResult, trailersResult] = await Promise.all([
        supabase
          .from("vessel_operations")
          .select("id, vessel_name, sailing_reference, origin_port, berth, expected_arrival_at, actual_arrival_at, status, notes, created_at, updated_at")
          .eq("id", operationId)
          .single(),
        supabase
          .from("vessel_operation_trailers")
          .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, load_description, temperature_required, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, priority_level, priority_reason, planned_destination, planning_notes, status, arrived_at, arrival_status, arrival_confirmed_at, arrival_record_id, arrival_confirmed_by, inspection_started_at, inspection_completed_at, position_assigned_at, assigned_position, has_damage, has_temperature_alert, created_at, updated_at")
          .eq("vessel_operation_id", operationId)
          .order("created_at", { ascending: true }),
      ]);

      if (operationResult.error || !operationResult.data) {
        throw operationResult.error ?? new Error("Operation not found.");
      }

      if (trailersResult.error) {
        throw trailersResult.error;
      }

      const trailerRows = (trailersResult.data ?? []) as VesselOperationTrailerRecord[];
      const trailerIds = trailerRows.map((item) => item.id);
      const temperaturesResult = trailerIds.length
        ? await supabase
            .from("vessel_inspection_temperatures")
            .select("id, vessel_trailer_id, trailer_id, trailer_number, temperature_value, temperature_unit, reading_point, notes, is_out_of_range, recorded_at, recorded_by")
            .in("vessel_trailer_id", trailerIds)
            .order("recorded_at", { ascending: false })
        : { data: [], error: null };

      if (temperaturesResult.error) {
        throw temperaturesResult.error;
      }

      const temperaturesByTrailer = new Map<string, VesselInspectionTemperatureRecord[]>();
      ((temperaturesResult.data ?? []) as VesselInspectionTemperatureRecord[]).forEach((row) => {
        const trailerId = row.vessel_trailer_id;
        if (!trailerId) {
          return;
        }

        const collection = temperaturesByTrailer.get(trailerId) ?? [];
        collection.push(row);
        temperaturesByTrailer.set(trailerId, collection);
      });

      setOperation(operationResult.data as VesselOperationRecord);
      setTrailers(sortVesselOperationTrailersForArrivals(trailerRows.map((row) => {
        const pair = getTrailerTemperaturePair(temperaturesByTrailer.get(row.id) ?? []);
        return {
          ...row,
          frontTemperatureReading: pair.front,
          rearTemperatureReading: pair.rear,
        };
      })) as ViewTrailer[]);
    } catch (loadErr) {
      console.error("Unable to load boat check:", loadErr);
      setError("Unable to load boat check.");
    } finally {
      setIsLoading(false);
    }
  }, [operationId]);

  const reception = useVesselReception({
    operation,
    onSuccess: async (message) => {
      setError(null);
      setSuccess(message);
      await loadBoatCheck();
    },
  });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadBoatCheck();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadBoatCheck]);

  const visibleTrailers = useMemo(() => {
    return trailers.filter((item) => item.arrival_status !== "cancelled" && item.arrival_status !== "not_discharged");
  }, [trailers]);

  const summary = useMemo<BoatCheckSummary>(() => {
    const arrived = trailers.filter((item) => item.arrival_status === "arrived").length;
    const inspected = trailers.filter((item) => item.status === "inspected" || Boolean(item.inspection_completed_at)).length;
    const inspectedArrived = trailers.filter((item) => item.arrival_status === "arrived" && (item.status === "inspected" || Boolean(item.inspection_completed_at))).length;
    const pendingInspection = Math.max(arrived - inspectedArrived, 0);
    const damages = trailers.filter((item) => item.has_damage).length;
    const temperatureAlerts = trailers.filter((item) => item.has_temperature_alert).length;

    return {
      arrived,
      pendingInspection,
      inspected,
      damages,
      temperatureAlerts,
    };
  }, [trailers]);

  const handleStartInspection = useCallback(
    async (trailer: ViewTrailer) => {
      if (actioningTrailerId === trailer.id) {
        return;
      }

      setError(null);
      router.push(`/dashboard/vessel-operations/${operationId}/boat-check/${trailer.id}`);
    },
    [actioningTrailerId, operationId, router],
  );

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
              <p className="mt-2 text-sm text-slate-300 sm:text-base">{operation.vessel_name ?? "Unnamed vessel"} - arrived trailers inspection list.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/dashboard/vessel-operations/${operation.id}`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Operation</Link>
              <Link href={`/dashboard/vessel-operations/${operation.id}/arrivals`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Arrivals</Link>
            </div>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
        {success ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div> : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Arrived</p><p className="mt-2 text-lg font-semibold text-amber-200">{summary.arrived}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Pending Inspection</p><p className="mt-2 text-lg font-semibold text-cyan-200">{summary.pendingInspection}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inspected</p><p className="mt-2 text-lg font-semibold text-emerald-200">{summary.inspected}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Damages</p><p className="mt-2 text-lg font-semibold text-rose-200">{summary.damages}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Temperature Alerts</p><p className="mt-2 text-lg font-semibold text-orange-200">{summary.temperatureAlerts}</p></div>
        </section>

        <section className="grid gap-4">
          {visibleTrailers.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-300">No arrived trailers available for boat check.</div>
          ) : (
            visibleTrailers.map((trailer) => {
              const isInspected = trailer.status === "inspected";
              const inspectionState = getVesselInspectionProgressState(trailer);
              const inspectionLabel = getVesselInspectionProgressLabel(inspectionState);
              const isReadOnly = operation.status === "completed" || operation.status === "cancelled";
              const canStartInspection = !isReadOnly && trailer.arrival_status !== "cancelled" && trailer.arrival_status !== "not_discharged";

              return (
                <article key={trailer.id} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-bold text-white">{trailer.trailer_number ?? "-"}</h2>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselPriorityClass(trailer.priority_level)}`}>{getVesselPriorityLabel(trailer.priority_level)}</span>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselTrailerStatusClass(trailer.status)}`}>{inspectionLabel}</span>
                      </div>
                      <p className="text-sm text-slate-300">Arrival Time: {formatVesselDateTime(trailer.arrival_confirmed_at ?? trailer.arrived_at)}</p>
                      <p className="text-sm text-slate-300">Inspection Status: {inspectionLabel}</p>
                      <p className="text-sm text-slate-300">Front Temp: {formatTemperatureReading(trailer.frontTemperatureReading)}</p>
                      <p className="text-sm text-slate-300">Rear Temp: {formatTemperatureReading(trailer.rearTemperatureReading)}</p>
                      <div className="flex flex-wrap gap-2">
                        {trailer.has_damage ? <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200">Damage</span> : null}
                        {trailer.has_temperature_alert ? <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-semibold text-orange-200">Temperature Alert</span> : null}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 lg:min-w-56">
                      {canStartInspection && !isInspected ? (
                        <button
                          type="button"
                          onClick={() => void handleStartInspection(trailer)}
                          disabled={actioningTrailerId === trailer.id}
                          className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                        >
                          {actioningTrailerId === trailer.id ? "Opening..." : "Open Inspection"}
                        </button>
                      ) : null}

                      {isInspected || isReadOnly ? (
                        <Link href={`/dashboard/vessel-operations/${operation.id}/boat-check/${trailer.id}`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-slate-700">
                          {isReadOnly ? "View Inspection" : "Edit Inspection"}
                        </Link>
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

export default function VesselBoatCheckPage() {
  return <VesselBoatCheckPageContent />;
}
