import Link from "next/link";
import type { VesselOperationRecord, VesselWorkflowStep } from "@/lib/vessel-operations";

type VesselOperationHeaderProps = {
  operation: VesselOperationRecord;
  workflowStep: VesselWorkflowStep;
};

const workflowSteps: Array<{ key: VesselWorkflowStep; label: string }> = [
  { key: "vessel", label: "Vessel" },
  { key: "boat_list", label: "Boat List" },
  { key: "planning", label: "Planning" },
  { key: "confirmed", label: "Confirmed" },
  { key: "discharge", label: "Discharge" },
  { key: "checks", label: "Checks" },
  { key: "completed", label: "Completed" },
];

const stepLinks = (operationId: string) => ({
  vessel: `/dashboard/vessel-operations/${operationId}`,
  boat_list: `/dashboard/vessel-operations/${operationId}`,
  planning: `/dashboard/vessel-operations/${operationId}/planning`,
  confirmed: `/dashboard/vessel-operations/${operationId}`,
  discharge: `/dashboard/vessel-operations/${operationId}/arrivals`,
  checks: `/dashboard/vessel-operations/${operationId}/boat-check`,
  completed: `/dashboard/vessel-operations/${operationId}/summary`,
});

export function VesselOperationHeader({ operation, workflowStep }: VesselOperationHeaderProps) {
  const activeIndex = Math.max(workflowSteps.findIndex((step) => step.key === workflowStep), 0);
  const links = stepLinks(operation.id);

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

      <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-7">
        {workflowSteps.map((step, index) => {
          const isDone = index < activeIndex;
          const isActive = index === activeIndex;
          const className = isActive
            ? "border-cyan-400/40 bg-cyan-500/20 text-cyan-100"
            : isDone
              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-100"
              : "border-white/10 bg-slate-950/70 text-slate-300";

          return (
            <Link
              key={step.key}
              href={links[step.key]}
              className={`rounded-2xl border px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.14em] ${className}`}
            >
              {index + 1}. {step.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
