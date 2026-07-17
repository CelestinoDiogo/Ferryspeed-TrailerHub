"use client";

import {
  formatVesselDateTime,
  hasCompletedBoatCheck,
  type VesselOperationTrailerRecord,
} from "@/lib/vessel-operations";
import type { ReceptionFormState } from "../hooks/use-vessel-reception";

type ConfirmReceptionModalProps = {
  error: string | null;
  formState: ReceptionFormState;
  isLoadingOptions: boolean;
  isOpen: boolean;
  isSubmitting: boolean;
  nextAvailablePosition: string | null;
  onClose: () => void;
  onConfirm: () => Promise<unknown>;
  onFieldChange: <K extends keyof ReceptionFormState>(field: K, value: ReceptionFormState[K]) => void;
  trailer: VesselOperationTrailerRecord | null;
};

export function ConfirmReceptionModal({
  error,
  formState,
  isLoadingOptions,
  isOpen,
  isSubmitting,
  nextAvailablePosition,
  onClose,
  onConfirm,
  onFieldChange,
  trailer,
}: ConfirmReceptionModalProps) {
  if (!isOpen || !trailer) {
    return null;
  }

  const inspected = hasCompletedBoatCheck(trailer);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl shadow-black/40">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Confirm Reception</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{trailer.trailer_number ?? "Trailer"}</h2>
            <p className="mt-2 text-sm text-slate-300">Arrival confirmed {formatVesselDateTime(trailer.arrival_confirmed_at ?? trailer.arrived_at)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            Cancel
          </button>
        </div>

        {error ? <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

        {!inspected ? (
          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            Boat Check is not complete. Reception cannot be confirmed until inspection is completed.
          </div>
        ) : null}

        {isLoadingOptions ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">Loading reception options...</div>
        ) : (
          <div className="mt-5 grid gap-4">
            <label className="text-sm text-slate-200">
              Destination
              <select
                value={formState.destination}
                onChange={(event) => onFieldChange("destination", event.target.value as ReceptionFormState["destination"])}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                disabled={isSubmitting}
              >
                <option value="compound">Compound</option>
                <option value="local">Local Trailer</option>
                <option value="hold">Hold / Awaiting Position</option>
              </select>
            </label>

            {formState.destination === "compound" ? (
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
                <p className="font-semibold text-white">Position</p>
                <p className="mt-1">Automatically assigned</p>
                <p className="mt-2 text-xs text-slate-400">
                  {nextAvailablePosition ? `Next available position: ${nextAvailablePosition}` : "The Compound is full. No position is available."}
                </p>
              </div>
            ) : null}

            {formState.destination === "hold" ? (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                Trailer will be received without a Compound position and set to Awaiting Position.
              </div>
            ) : null}

            <label className="text-sm text-slate-200">
              Load Status
              <select
                value={formState.loadStatus}
                onChange={(event) => onFieldChange("loadStatus", event.target.value as ReceptionFormState["loadStatus"])}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                disabled={isSubmitting}
              >
                <option value="Empty">Empty</option>
                <option value="Loaded">Loaded</option>
              </select>
            </label>

            <label className="text-sm text-slate-200">
              Customer
              <input
                value={formState.customer}
                onChange={(event) => onFieldChange("customer", event.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Optional customer"
                disabled={isSubmitting}
              />
            </label>

            <label className="text-sm text-slate-200">
              Notes
              <textarea
                rows={3}
                value={formState.notes}
                onChange={(event) => onFieldChange("notes", event.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Optional reception notes"
                disabled={isSubmitting}
              />
            </label>

          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            disabled={!inspected || isLoadingOptions || isSubmitting || (formState.destination === "compound" && !nextAvailablePosition)}
          >
            {isSubmitting ? "Confirming..." : "Confirm Reception"}
          </button>
        </div>
      </div>
    </div>
  );
}