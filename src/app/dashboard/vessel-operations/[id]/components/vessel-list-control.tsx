import { formatVesselDateTime, type VesselOperationRecord } from "@/lib/vessel-operations";

type VesselListControlProps = {
  operation: VesselOperationRecord;
  operationStatus: "draft" | "confirmed" | "completed";
  isChangingListState: boolean;
  isSaving: boolean;
  trailersCount: number;
  onConfirmList: () => Promise<void>;
};

export function VesselListControl({
  operation,
  operationStatus,
  isChangingListState,
  isSaving,
  trailersCount,
  onConfirmList,
}: VesselListControlProps) {
  const isDraft = operationStatus === "draft";

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
          {isDraft ? (
            <button
              type="button"
              onClick={() => void onConfirmList()}
              disabled={isChangingListState || isSaving || trailersCount === 0}
              className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
            >
              Confirm Expected Arrival List
            </button>
          ) : (
            <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100">
              {operationStatus === "completed" ? "Operation completed - read only" : "List confirmed - editing locked"}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
