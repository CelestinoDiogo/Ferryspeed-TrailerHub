import { formatVesselDateTime, type VesselOperationRecord } from "@/lib/vessel-operations";

type VesselOperationDetailsProps = {
  operation: VesselOperationRecord;
};

export function VesselOperationDetails({ operation }: VesselOperationDetailsProps) {
  return (
    <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Operation Details</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Voyage / Reference</p>
          <p className="mt-1 text-sm text-white">{operation.sailing_reference ?? "-"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Port</p>
          <p className="mt-1 text-sm text-white">{operation.origin_port ?? "-"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Berth</p>
          <p className="mt-1 text-sm text-white">{operation.berth ?? "-"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Expected Arrival</p>
          <p className="mt-1 text-sm text-white">{formatVesselDateTime(operation.expected_arrival_at)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Actual Arrival</p>
          <p className="mt-1 text-sm text-white">{formatVesselDateTime(operation.actual_arrival_at)}</p>
        </div>
        <div className="sm:col-span-2">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Notes</p>
          <p className="mt-1 text-sm text-white">{operation.notes?.trim() || "-"}</p>
        </div>
      </div>
    </div>
  );
}
