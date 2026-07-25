"use client";

import { useEffect, useState } from "react";
import { TrailerActivityTimeline } from "@/components/trailers/trailer-activity-timeline";
import { getTrailerActivity, type TrailerActivityRow } from "@/lib/trailer-activity";

type TrailerHistoryDrawerProps = {
  isOpen: boolean;
  trailerId?: string | null;
  trailerNumber?: string | null;
  onClose: () => void;
};

export function TrailerHistoryDrawer({
  isOpen,
  trailerId,
  trailerNumber,
  onClose,
}: TrailerHistoryDrawerProps) {
  const [rows, setRows] = useState<TrailerActivityRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const loadRows = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const activityRows = await getTrailerActivity({
          trailerId: trailerId ?? null,
          trailerNumber: trailerNumber ?? null,
          limit: 150,
        });
        setRows(activityRows);
      } catch (loadErr) {
        const message = loadErr instanceof Error ? loadErr.message : "Unable to load trailer history.";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    void loadRows();
  }, [isOpen, trailerId, trailerNumber]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-slate-950/70 backdrop-blur-sm sm:items-stretch sm:justify-end" role="dialog" aria-modal="true" aria-label="Trailer history">
      <div className="max-h-[88vh] w-full overflow-hidden rounded-t-3xl border border-white/10 bg-slate-900 text-slate-100 shadow-2xl sm:h-full sm:max-h-none sm:w-[min(100%,44rem)] sm:rounded-none sm:border-l sm:border-t-0">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Trailer Activity</p>
            <h2 className="mt-1 text-lg font-semibold text-white">History</h2>
            {trailerNumber ? <p className="mt-1 text-sm text-slate-300">{trailerNumber}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/20 bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Close
          </button>
        </header>

        <div className="h-[calc(88vh-4.5rem)] overflow-y-auto p-5 sm:h-[calc(100vh-4.5rem)]">
          <TrailerActivityTimeline
            rows={rows}
            isLoading={isLoading}
            error={error}
            emptyLabel="No operational activity has been recorded yet for this trailer."
          />
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="hidden h-full flex-1 cursor-default sm:block"
        aria-label="Close trailer history"
      />
    </div>
  );
}
