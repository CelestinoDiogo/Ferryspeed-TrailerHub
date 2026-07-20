import Link from "next/link";
import {
  getVesselOperationStatusClass,
  getVesselOperationStatusLabel,
  type VesselOperationRecord,
  type VesselOperationSummary,
} from "@/lib/vessel-operations";
import type { CompletionSummary } from "../hooks/use-vessel-operation";

type VesselOperationSummaryProps = {
  operation: VesselOperationRecord;
  summary: VesselOperationSummary;
  completionSummary: CompletionSummary;
  operationStatus: "draft" | "confirmed" | "completed";
};

export function VesselOperationSummary({ operation, summary, completionSummary, operationStatus }: VesselOperationSummaryProps) {
  const isCompleted = operationStatus === "completed";

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-8">
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Operation Status</p>
        <p className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getVesselOperationStatusClass(operation.status)}`}>
          {getVesselOperationStatusLabel(operation.status)}
        </p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">List Status</p>
        <p className="mt-2 text-lg font-semibold text-white capitalize">{operation.list_status ?? "draft"}</p>
      </div>
      {isCompleted ? (
        <>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Trailers</p>
            <p className="mt-2 text-lg font-semibold text-white">{completionSummary.totalTrailers}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Arrived</p>
            <p className="mt-2 text-lg font-semibold text-amber-200">{completionSummary.arrived}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inspected</p>
            <p className="mt-2 text-lg font-semibold text-emerald-200">{completionSummary.inspected}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Not Discharged</p>
            <p className="mt-2 text-lg font-semibold text-fuchsia-200">{completionSummary.notDischarged}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Damages</p>
            <p className="mt-2 text-lg font-semibold text-rose-200">{completionSummary.damages}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Temp Alerts</p>
            <p className="mt-2 text-lg font-semibold text-orange-200">{completionSummary.temperatureAlerts}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 sm:col-span-2 xl:col-span-8">
            <div className="flex flex-wrap gap-2">
              <Link href={`/dashboard/vessel-operations/${operation.id}/summary`} className="rounded-2xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/25">
                AI Report
              </Link>
              <Link href={`/dashboard/vessel-operations/${operation.id}/print`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                Print Report
              </Link>
            </div>
          </div>
        </>
      ) : (
        <>
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Expected</p>
        <p className="mt-2 text-lg font-semibold text-white">{summary.expected}</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Expected Remaining</p>
        <p className="mt-2 text-lg font-semibold text-cyan-200">{summary.remaining}</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Arrived</p>
        <p className="mt-2 text-lg font-semibold text-amber-200">{summary.arrived}</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Not Arrived</p>
        <p className="mt-2 text-lg font-semibold text-fuchsia-200">{summary.notArrived}</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inspected</p>
        <p className="mt-2 text-lg font-semibold text-emerald-200">{summary.inspected}</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inspection Pending</p>
        <p className="mt-2 text-lg font-semibold text-cyan-200">{summary.inspectionPending}</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Damages</p>
        <p className="mt-2 text-lg font-semibold text-rose-200">{summary.damages}</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Temp Alerts</p>
        <p className="mt-2 text-lg font-semibold text-orange-200">{summary.temperatureAlerts}</p>
      </div>
        </>
      )}
    </section>
  );
}
