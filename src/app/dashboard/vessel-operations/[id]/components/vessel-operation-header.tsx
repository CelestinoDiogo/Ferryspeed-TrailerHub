import Link from "next/link";
import type { VesselOperationRecord } from "@/lib/vessel-operations";

type VesselOperationHeaderProps = {
  operation: VesselOperationRecord;
};

export function VesselOperationHeader({ operation }: VesselOperationHeaderProps) {
  return (
    <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Vessel Operation</h1>
          <p className="mt-2 text-sm text-slate-300 sm:text-base">
            {operation.vessel_name ?? "Unnamed vessel"} - {operation.sailing_reference ?? "No voyage reference"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/vessel-operations" className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            Back to List
          </Link>
        </div>
      </div>
    </header>
  );
}
