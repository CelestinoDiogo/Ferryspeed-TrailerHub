"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PrintButton } from "@/components/print/print-button";
import { PrintFilters } from "@/components/print/print-filters";
import { PrintFooter } from "@/components/print/print-footer";
import { PrintHeader } from "@/components/print/print-header";
import { PrintReportLayout } from "@/components/print/print-report-layout";
import { PrintSummary } from "@/components/print/print-summary";
import { PrintTable } from "@/components/print/print-table";
import { supabase } from "@/lib/supabase";
import {
  computeVesselOperationSummary,
  formatVesselDateTime,
  getLocalDateInputValue,
  getVesselOperationFilterLabel,
  getVesselOperationStatusClass,
  getVesselOperationStatusLabel,
  logVesselSupabaseError,
  type VesselOperationRecord,
  type VesselOperationTrailerRecord,
  VESSEL_OPERATION_FILTERS,
} from "@/lib/vessel-operations";

type VesselOperationView = VesselOperationRecord & {
  summary: ReturnType<typeof computeVesselOperationSummary>;
  trailerCount: number;
  damageCount: number;
  temperatureCount: number;
  priorityPending: number;
  inspectionPending: number;
};

const filterOperations = (
  items: VesselOperationView[],
  filter: (typeof VESSEL_OPERATION_FILTERS)[number],
) => {
  const todayKey = getLocalDateInputValue();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = getLocalDateInputValueFromDate(tomorrow);
  const upcomingThreshold = tomorrowKey;

  return items.filter((item) => {
    const expectedKey = item.expected_arrival_at?.slice(0, 10) ?? "";

    switch (filter) {
      case "today":
        return expectedKey === todayKey;
      case "tomorrow":
        return expectedKey === tomorrowKey;
      case "upcoming":
        return Boolean(expectedKey && upcomingThreshold && expectedKey > upcomingThreshold && item.status !== "completed");
      case "completed":
        return item.status === "completed";
      case "all":
      default:
        return true;
    }
  });
};

const getLocalDateInputValueFromDate = (date: Date) => {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().split("T")[0];
};

const getPrintedDateTime = () =>
  new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function VesselOperationsPageContent() {
  const [operations, setOperations] = useState<VesselOperationView[]>([]);
  const [activeFilter, setActiveFilter] = useState<(typeof VESSEL_OPERATION_FILTERS)[number]>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOperations = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [operationsResult, trailersResult] = await Promise.all([
        supabase
          .from("vessel_operations")
          .select("id, vessel_name, sailing_reference, origin_port, expected_arrival_at, actual_arrival_at, status, notes, created_at, updated_at")
          .order("expected_arrival_at", { ascending: true, nullsFirst: false }),
        supabase
          .from("vessel_operation_trailers")
          .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_description, priority_level, priority_reason, planned_destination, planning_notes, status, arrived_at, arrival_confirmed_by, inspection_started_at, inspection_completed_at, position_assigned_at, assigned_position, has_damage, has_temperature_alert, created_at, updated_at")
          .order("created_at", { ascending: true }),
      ]);

      if (operationsResult.error) {
        logVesselSupabaseError("Vessel operations query failed", operationsResult.error);
        throw operationsResult.error;
      }
      if (trailersResult.error) {
        logVesselSupabaseError("Vessel operation trailers query failed", trailersResult.error);
        throw trailersResult.error;
      }

      const trailerRows = (trailersResult.data ?? []) as VesselOperationTrailerRecord[];

      const trailerByOperation = new Map<string, VesselOperationTrailerRecord[]>();
      trailerRows.forEach((row) => {
        const collection = trailerByOperation.get(row.vessel_operation_id) ?? [];
        collection.push(row);
        trailerByOperation.set(row.vessel_operation_id, collection);
      });

      const nextOperations = ((operationsResult.data ?? []) as VesselOperationRecord[]).map((operation) => {
        const operationTrailers = trailerByOperation.get(operation.id) ?? [];
        const summary = computeVesselOperationSummary(operationTrailers);
        const damageCount = operationTrailers.filter((trailer) => trailer.has_damage).length;
        const temperatureCount = operationTrailers.filter((trailer) => trailer.has_temperature_alert).length;

        return {
          ...operation,
          summary,
          trailerCount: operationTrailers.length,
          damageCount,
          temperatureCount,
          priorityPending: summary.priorityRemaining,
          inspectionPending: summary.pendingInspection,
        } satisfies VesselOperationView;
      });

      setOperations(nextOperations);
    } catch (loadErr) {
      console.error("Unable to load vessel operations:", loadErr);
      setError("Unable to load vessel operations.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadOperations();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadOperations]);

  const filteredOperations = useMemo(() => filterOperations(operations, activeFilter), [activeFilter, operations]);
  const printedAt = getPrintedDateTime();

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Vessel Operations</h1>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">Plan ferry arrivals, inspections, and downstream positioning.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <PrintButton label="Print / Export" disabled={isLoading || filteredOperations.length === 0} />
              <Link href="/dashboard/vessel-operations/new" className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
                + New Vessel Operation
              </Link>
              <Link href="/dashboard" className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                Back to Dashboard
              </Link>
            </div>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
          <div className="flex flex-wrap gap-2">
            {VESSEL_OPERATION_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setActiveFilter(filter)}
                className={`rounded-2xl px-3 py-2 text-sm font-semibold transition ${
                  activeFilter === filter
                    ? "border border-cyan-400/40 bg-cyan-500/15 text-cyan-100"
                    : "border border-white/10 bg-slate-950/80 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {getVesselOperationFilterLabel(filter)}
              </button>
            ))}
          </div>
        </section>

        {isLoading ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">Loading vessel operations...</div>
        ) : null}

        {!isLoading && filteredOperations.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-300">No vessel operations found for this filter.</div>
        ) : null}

        {!isLoading && filteredOperations.length > 0 ? (
          <>
            <PrintReportLayout orientation="landscape">
              <PrintHeader title="Vessel Operations" printedAt={printedAt} userName="Diogo Ferreira" totalRecords={filteredOperations.length}>
                <PrintFilters
                  items={[
                    { label: "Filter", value: getVesselOperationFilterLabel(activeFilter) },
                    { label: "Expected Date", value: activeFilter === "today" ? getLocalDateInputValue() : "Current filtered dataset" },
                  ]}
                />
              </PrintHeader>

              <PrintSummary
                items={[
                  { label: "Operations", value: filteredOperations.length },
                  { label: "Expected Trailers", value: filteredOperations.reduce((total, item) => total + item.summary.expected, 0) },
                  { label: "Arrived", value: filteredOperations.reduce((total, item) => total + item.summary.arrived, 0) },
                  { label: "Priority", value: filteredOperations.reduce((total, item) => total + item.summary.priority, 0) },
                  { label: "Inspected", value: filteredOperations.reduce((total, item) => total + item.summary.inspected, 0) },
                ]}
              />

              <PrintTable
                rows={filteredOperations}
                columns={[
                  { key: "vessel_name", header: "Vessel", render: (operation) => operation.vessel_name ?? "Unnamed vessel" },
                  { key: "sailing_reference", header: "Voyage / Reference", render: (operation) => operation.sailing_reference ?? "—" },
                  { key: "port", header: "Port", render: (operation) => operation.origin_port ?? "—" },
                  { key: "status", header: "Status", render: (operation) => getVesselOperationStatusLabel(operation.status) },
                  { key: "expected_arrival_at", header: "Expected Arrival", render: (operation) => formatVesselDateTime(operation.expected_arrival_at) },
                  { key: "actual_arrival_at", header: "Actual Arrival", render: (operation) => formatVesselDateTime(operation.actual_arrival_at) },
                  { key: "expected", header: "Expected", render: (operation) => operation.summary.expected },
                  { key: "arrived", header: "Arrived", render: (operation) => operation.summary.arrived },
                  { key: "priority", header: "Priority", render: (operation) => operation.summary.priority },
                  { key: "inspected", header: "Inspected", render: (operation) => operation.summary.inspected },
                  { key: "damages", header: "Damaged", render: (operation) => operation.damageCount },
                ]}
              />

              <PrintFooter />
            </PrintReportLayout>

            <section className="screen-only grid gap-4">
              {filteredOperations.map((operation) => (
                <article key={operation.id} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-semibold text-white">{operation.vessel_name ?? "Unnamed Vessel"}</h2>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselOperationStatusClass(operation.status)}`}>
                          {getVesselOperationStatusLabel(operation.status)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-300">Sailing Reference: {operation.sailing_reference ?? "-"}</p>
                      <p className="text-sm text-slate-300">Origin Port: {operation.origin_port ?? "-"}</p>
                      <p className="text-sm text-slate-300">Expected Arrival: {formatVesselDateTime(operation.expected_arrival_at)}</p>
                      <p className="text-sm text-slate-300">Actual Arrival: {formatVesselDateTime(operation.actual_arrival_at)}</p>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[460px] xl:grid-cols-4">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Expected Trailers</p>
                        <p className="mt-1 text-2xl font-bold text-white">{operation.summary.expected}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Arrived</p>
                        <p className="mt-1 text-2xl font-bold text-amber-200">{operation.summary.arrived}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Priority Pending</p>
                        <p className="mt-1 text-2xl font-bold text-rose-200">{operation.priorityPending}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Inspection Pending</p>
                        <p className="mt-1 text-2xl font-bold text-cyan-200">{operation.inspectionPending}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Priority</p>
                      <p className="mt-1 text-lg font-bold text-white">{operation.summary.priority}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Inspected</p>
                      <p className="mt-1 text-lg font-bold text-emerald-200">{operation.summary.inspected}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Damages</p>
                      <p className="mt-1 text-lg font-bold text-rose-200">{operation.damageCount}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Temperature Alerts</p>
                      <p className="mt-1 text-lg font-bold text-orange-200">{operation.temperatureCount}</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link href={`/dashboard/vessel-operations/${operation.id}`} className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
                      Open Operation
                    </Link>
                    <Link href={`/dashboard/vessel-operations/${operation.id}/planning`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                      Planning
                    </Link>
                    <Link href={`/dashboard/vessel-operations/${operation.id}/arrivals`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                      Open Arrivals
                    </Link>
                    <Link href={`/dashboard/vessel-operations/${operation.id}/summary`} className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20">
                      View Summary
                    </Link>
                  </div>
                </article>
              ))}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

export default function VesselOperationsPage() {
  return <VesselOperationsPageContent />;
}
