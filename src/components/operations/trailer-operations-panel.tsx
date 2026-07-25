"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { TrailerActivityTimeline } from "@/components/trailers/trailer-activity-timeline";
import { getTrailerActivity, type TrailerActivityRow } from "@/lib/trailer-activity";

type PanelTrailer = {
  id: string;
  trailerId?: string | null;
  trailerNumber?: string | null;
  customer?: string | null;
  consignee?: string | null;
  loadStatus?: string | null;
  status?: string | null;
  compoundPosition?: string | null;
  arrivalDate?: string | null;
};

type TrailerOperationsPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  moduleLabel: string;
  trailer: PanelTrailer | null;
  inspectionHref?: string | null;
  photosHref?: string | null;
  damageHref?: string | null;
  onArrived?: () => Promise<void> | void;
  onTogglePriority?: () => Promise<void> | void;
  onStartInspection?: () => Promise<void> | void;
  onCompleteInspection?: () => Promise<void> | void;
  onDeparture?: () => Promise<void> | void;
  onDeliveredEmpty?: () => Promise<void> | void;
  onOpenHistory?: () => void;
  onMove?: (nextPosition: string) => Promise<void> | void;
  moveLabel?: string;
  isBusy?: boolean;
};

export function TrailerOperationsPanel({
  isOpen,
  onClose,
  moduleLabel,
  trailer,
  inspectionHref,
  photosHref,
  damageHref,
  onArrived,
  onTogglePriority,
  onStartInspection,
  onCompleteInspection,
  onDeparture,
  onDeliveredEmpty,
  onOpenHistory,
  onMove,
  moveLabel = "Set Position",
  isBusy = false,
}: TrailerOperationsPanelProps) {
  const [rows, setRows] = useState<TrailerActivityRow[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const moveInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen || !trailer) {
      return;
    }

    const loadHistory = async () => {
      setIsLoadingHistory(true);
      setHistoryError(null);

      try {
        const nextRows = await getTrailerActivity({
          trailerId: trailer.trailerId ?? trailer.id,
          trailerNumber: trailer.trailerNumber ?? null,
          limit: 80,
        });
        setRows(nextRows);
      } catch (error) {
        setHistoryError(error instanceof Error ? error.message : "Unable to load trailer history.");
      } finally {
        setIsLoadingHistory(false);
      }
    };

    void loadHistory();
  }, [isOpen, trailer]);

  const actionButtons = useMemo(() => {
    const actions: Array<{ key: string; label: string; onClick: () => Promise<void> | void }> = [];

    if (onArrived) {
      actions.push({ key: "arrived", label: "Arrived", onClick: onArrived });
    }
    if (onTogglePriority) {
      actions.push({ key: "priority", label: "Priority / No Priority", onClick: onTogglePriority });
    }
    if (onStartInspection) {
      actions.push({ key: "start-inspection", label: "Start Inspection", onClick: onStartInspection });
    }
    if (onCompleteInspection) {
      actions.push({ key: "complete-inspection", label: "Complete Inspection", onClick: onCompleteInspection });
    }
    if (onDeparture) {
      actions.push({ key: "departure", label: "Departure", onClick: onDeparture });
    }
    if (onDeliveredEmpty) {
      actions.push({ key: "delivered-empty", label: "Delivered Empty", onClick: onDeliveredEmpty });
    }

    return actions;
  }, [onArrived, onCompleteInspection, onDeliveredEmpty, onDeparture, onStartInspection, onTogglePriority]);

  const handleMove = async () => {
    if (!onMove) {
      return;
    }

    const rawValue = moveInputRef.current?.value ?? "";
    const normalized = rawValue.trim().toUpperCase();
    if (!normalized) {
      setMoveError("Enter a valid compound position.");
      return;
    }

    setMoveError(null);
    setIsMoving(true);
    try {
      await onMove(normalized);
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : "Unable to update position.");
    } finally {
      setIsMoving(false);
    }
  };

  if (!isOpen || !trailer) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-slate-950/70 backdrop-blur-sm sm:items-stretch sm:justify-end" role="dialog" aria-modal="true" aria-label="Trailer operations panel">
      <div className="max-h-[88vh] w-full overflow-hidden rounded-t-3xl border border-white/10 bg-slate-900 text-slate-100 shadow-2xl sm:h-full sm:max-h-none sm:w-[min(100%,44rem)] sm:rounded-none sm:border-l sm:border-t-0">
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">{moduleLabel}</p>
            <h2 className="mt-1 text-lg font-semibold text-white">{trailer.trailerNumber ?? "Trailer"}</h2>
            <p className="mt-1 text-sm text-slate-300">
              {trailer.customer ?? "No customer"}
              {trailer.compoundPosition ? ` • ${trailer.compoundPosition}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/20 bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Close
          </button>
        </header>

        <div className="h-[calc(88vh-4.5rem)] space-y-4 overflow-y-auto p-5 sm:h-[calc(100vh-4.5rem)]">
          <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Quick Actions</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {actionButtons.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  onClick={() => void action.onClick()}
                  disabled={isBusy || isMoving}
                  className="rounded-xl bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                >
                  {action.label}
                </button>
              ))}
              {onOpenHistory ? (
                <button
                  type="button"
                  onClick={onOpenHistory}
                  className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  Open History Drawer
                </button>
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inspection and Media</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {inspectionHref ? (
                <Link href={inspectionHref} className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">
                  Inspection
                </Link>
              ) : null}
              {photosHref ? (
                <Link href={photosHref} className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">
                  Photos
                </Link>
              ) : null}
              {damageHref ? (
                <Link href={damageHref} className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">
                  Damage
                </Link>
              ) : null}
            </div>
          </section>

          {onMove ? (
            <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Move</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  key={trailer.id}
                  ref={moveInputRef}
                  defaultValue={trailer.compoundPosition?.trim() ?? ""}
                  placeholder="e.g. P14"
                  className="h-10 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 text-sm text-slate-100 outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleMove()}
                  disabled={isBusy || isMoving}
                  className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-60"
                >
                  {isMoving ? "Saving..." : moveLabel}
                </button>
              </div>
              {moveError ? <p className="mt-2 text-xs text-rose-300">{moveError}</p> : null}
            </section>
          ) : null}

          <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">History</p>
            <div className="mt-3">
              <TrailerActivityTimeline
                rows={rows}
                isLoading={isLoadingHistory}
                error={historyError}
                emptyLabel="No operational activity has been recorded yet for this trailer."
              />
            </div>
          </section>
        </div>
      </div>
      <button type="button" onClick={onClose} className="hidden h-full flex-1 sm:block" aria-label="Close trailer operations panel" />
    </div>
  );
}
