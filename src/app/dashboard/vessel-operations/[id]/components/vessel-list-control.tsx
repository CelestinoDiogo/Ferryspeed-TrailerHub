import Link from "next/link";
import { formatVesselDateTime, type VesselOperationRecord } from "@/lib/vessel-operations";
import type { PlanningReadiness } from "@/lib/vessel-operations";

type VesselListControlProps = {
  operation: VesselOperationRecord;
  operationStatus: "draft" | "confirmed" | "completed";
  isChangingListState: boolean;
  isSaving: boolean;
  trailersCount: number;
  planningReadiness: PlanningReadiness;
  onConfirmList: () => Promise<void>;
};

export function VesselListControl({
  operation,
  operationStatus,
  isChangingListState,
  isSaving,
  trailersCount,
  planningReadiness,
  onConfirmList,
}: VesselListControlProps) {
  const isConfirmed = (operation.list_status ?? "draft") === "confirmed";
  const showConfirmAction = operationStatus !== "completed" && !isConfirmed;
  const confirmDisabled =
    isChangingListState ||
    isSaving ||
    trailersCount === 0 ||
    !planningReadiness.canConfirmList;
  const firstIncomplete = planningReadiness.incompleteTrailers[0];

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">List Control</p>
          <p className="mt-1 text-sm text-slate-300">
            Confirmed at: {formatVesselDateTime(operation.list_confirmed_at)}
            {operation.list_confirmed_by ? ` by ${operation.list_confirmed_by}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {showConfirmAction ? (
            <button
              type="button"
              onClick={() => void onConfirmList()}
              disabled={confirmDisabled}
              className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
            >
              {planningReadiness.canConfirmList ? "Confirm Vessel List" : "Confirm Vessel List (Planning Incomplete)"}
            </button>
          ) : (
            <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100">
              {operationStatus === "completed" ? "Operation completed - read only" : "List confirmed - additions still allowed"}
            </p>
          )}
        </div>
      </div>

      {showConfirmAction && !planningReadiness.canConfirmList ? (
        <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <p className="font-semibold">Planning must be completed before list confirmation.</p>
          <p className="mt-1">
            {firstIncomplete
              ? `${firstIncomplete.trailerNumber}: ${firstIncomplete.issues.map((issue) => issue.message).join(" ")}`
              : "Some trailers are missing required planning fields."}
          </p>
          <div className="mt-2">
            <Link
              href={`/dashboard/vessel-operations/${operation.id}/planning`}
              className="inline-flex rounded-xl border border-amber-400/40 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/30"
            >
              Complete Planning
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}
