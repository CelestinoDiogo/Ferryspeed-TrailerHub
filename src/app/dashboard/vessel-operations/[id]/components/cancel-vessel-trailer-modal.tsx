"use client";

import { useState } from "react";
import type { VesselOperationTrailerRecord } from "@/lib/vessel-operations";

type CancelVesselTrailerModalProps = {
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  trailer: VesselOperationTrailerRecord | null;
};

export function CancelVesselTrailerModal({ isSubmitting, onClose, onConfirm, trailer }: CancelVesselTrailerModalProps) {
  const [reason, setReason] = useState(trailer?.cancellation_reason ?? trailer?.manifest_change_reason ?? "");

  if (!trailer) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6" role="dialog" aria-modal="true" aria-labelledby="cancel-vessel-trailer-title">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl shadow-black/40">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-rose-300">Cancel Trailer</p>
        <h2 id="cancel-vessel-trailer-title" className="mt-2 text-2xl font-semibold text-white">
          Cancel this trailer from this vessel operation?
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          {trailer.trailer_number ?? "This trailer"} will remain in the vessel history but will no longer be expected for arrival.
        </p>

        <label className="mt-5 block text-sm text-slate-200">
          Reason <span className="text-slate-400">(optional)</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={1000}
            disabled={isSubmitting}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none focus:border-rose-400/60 disabled:opacity-60"
            placeholder="Not shipped, changed sailing, customer cancelled..."
          />
        </label>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
            Keep Trailer
          </button>
          <button type="button" onClick={() => void onConfirm(reason.trim())} disabled={isSubmitting} className="rounded-2xl bg-rose-500 px-4 py-3 text-sm font-semibold text-white hover:bg-rose-400 disabled:opacity-60">
            {isSubmitting ? "Cancelling..." : "Confirm Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}