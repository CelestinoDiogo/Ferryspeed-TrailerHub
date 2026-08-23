"use client";

import { useEffect, useMemo, useState } from "react";
import { AppCard } from "@/components/layout/app-card";
import {
  describeStockCheckDiscrepancy,
  formatStockCheckPhysicalLoadLabel,
  parseStockCheckFindingNotes,
  type StockCheckItem,
} from "@/lib/compound-stock-check";
import type { StockCheckResolutionAction } from "@/lib/compound-stock-check-resolution";
import type { StockCheckTrailerContext } from "@/lib/compound-stock-check-unexpected";
import { getSessionToken } from "@/lib/voice/session";

type StockCheckUnexpectedDialogProps = {
  open: boolean;
  stockCheckId: string;
  surface?: "desktop" | "master_mobile";
  resolveItem?: StockCheckItem | null;
  onClose: () => void;
  onCompleted: () => void;
};

const authorizedFetch = async (url: string, init?: RequestInit) => {
  const token = await getSessionToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "Stock Check request failed.");
  }
  return payload;
};

export function StockCheckUnexpectedDialog({
  open,
  stockCheckId,
  surface = "desktop",
  resolveItem = null,
  onClose,
  onCompleted,
}: StockCheckUnexpectedDialogProps) {
  const initialFinding = resolveItem ? parseStockCheckFindingNotes(resolveItem.notes) : null;
  const [trailerNumber, setTrailerNumber] = useState(resolveItem?.trailer_number ?? "");
  const [actualPosition, setActualPosition] = useState(resolveItem?.actual_position ?? "");
  const [physicalLoad, setPhysicalLoad] = useState<"empty" | "loaded">(initialFinding?.physicalLoad ?? "empty");
  const [note, setNote] = useState(initialFinding?.operatorNote ?? "");
  const [confirmUnknown, setConfirmUnknown] = useState(false);
  const [matches, setMatches] = useState<StockCheckTrailerContext[]>([]);
  const [unknown, setUnknown] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<StockCheckTrailerContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolutionAction, setResolutionAction] = useState<StockCheckResolutionAction>("keep_unresolved");

  useEffect(() => {
    if (!open || resolveItem || trailerNumber.trim().length < 2) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const payload = (await authorizedFetch(
            `/api/stock-check/unexpected/search?q=${encodeURIComponent(trailerNumber)}`,
          )) as {
            matches?: StockCheckTrailerContext[];
            unknown?: boolean;
            exactMatch?: StockCheckTrailerContext | null;
          };
          setMatches(payload.matches ?? []);
          setUnknown(payload.unknown === true);
          setSelectedMatch(payload.exactMatch ?? payload.matches?.[0] ?? null);
        } catch (searchError) {
          setError(searchError instanceof Error ? searchError.message : "Unable to search trailers.");
        }
      })();
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [open, resolveItem, trailerNumber]);

  const finding = useMemo(() => (resolveItem ? parseStockCheckFindingNotes(resolveItem.notes) : null), [resolveItem]);

  if (!open) {
    return null;
  }

  const submitFinding = async () => {
    setBusy(true);
    setError(null);
    try {
      await authorizedFetch("/api/stock-check/unexpected", {
        method: "POST",
        body: JSON.stringify({
          stockCheckId,
          trailerNumber,
          actualPosition,
          physicalLoad,
          note,
          confirmUnknown: confirmUnknown || unknown,
        }),
      });
      onCompleted();
      onClose();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to record finding.";
      if (message.toLowerCase().includes("unknown")) {
        setUnknown(true);
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const submitResolution = async () => {
    if (!resolveItem) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authorizedFetch("/api/stock-check/resolve", {
        method: "POST",
        body: JSON.stringify({
          stockCheckId,
          itemId: resolveItem.id,
          action: resolutionAction,
          note,
          compoundPosition: actualPosition,
          loadStatus: physicalLoad,
          surface,
        }),
      });
      onCompleted();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to resolve discrepancy.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 sm:items-center">
      <AppCard className="w-full max-w-lg">
        <div className="p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            {resolveItem ? "Resolve discrepancy" : "+ Unexpected Trailer"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {resolveItem
              ? "The original finding stays on the Stock Check. Resolution only updates the live operational record."
              : "Record what was physically found. Live Compound data is not changed until Resolve."}
          </p>

          {resolveItem ? (
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <p>
                <span className="font-semibold">{resolveItem.trailer_number}</span> · {describeStockCheckDiscrepancy(resolveItem)}
              </p>
              <p>
                Physical {resolveItem.actual_position ?? "-"} · {formatStockCheckPhysicalLoadLabel(finding?.physicalLoad)}
                {finding?.positionConflictOccupant ? ` · conflict with ${finding.positionConflictOccupant}` : ""}
              </p>
              <label className="block text-sm font-semibold text-slate-900">
                Resolution
                <select
                  value={resolutionAction}
                  onChange={(event) => setResolutionAction(event.target.value as StockCheckResolutionAction)}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="keep_unresolved">Keep unresolved / add note</option>
                  {resolveItem.trailer_id ? (
                    <>
                      <option value="update_compound_position">Update compound position</option>
                      <option value="update_load_status">Update empty / loaded</option>
                      <option value="return_to_main_list">Return to Main List</option>
                      <option value="confirm_compound_presence">Restore / confirm compound presence</option>
                    </>
                  ) : surface === "desktop" ? (
                    <option value="create_trailer">Add to Main List / create trailer</option>
                  ) : (
                    <option value="keep_unresolved">Keep unresolved — create trailer on desktop</option>
                  )}
                </select>
              </label>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-semibold text-slate-900">
                Trailer number
                <input
                  value={trailerNumber}
                  onChange={(event) => setTrailerNumber(event.target.value.toUpperCase())}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm uppercase"
                  placeholder="PFC99"
                />
              </label>
              {selectedMatch ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  <p className="font-semibold text-slate-900">{selectedMatch.trailerNumber}</p>
                  <p>System position: {selectedMatch.compoundPosition ?? "None"}</p>
                  <p>
                    {selectedMatch.list === "local" ? "Local" : "Main List"} · {selectedMatch.loadStatus ?? "-"} · {selectedMatch.operationalStatus ?? "-"}
                  </p>
                  {selectedMatch.activeDelivery ? <p>Active Delivery: {selectedMatch.activeDelivery.reference ?? selectedMatch.activeDelivery.status}</p> : null}
                  {selectedMatch.activeExport ? <p>Active Export: {selectedMatch.activeExport.reference ?? selectedMatch.activeExport.status}</p> : null}
                </div>
              ) : null}
              {unknown ? <p className="text-sm text-amber-800">Unknown trailer number. You can still record the physical finding without creating a trailer.</p> : null}
              {matches.length > 1 ? (
                <div className="flex flex-wrap gap-2">
                  {matches.map((match) => (
                    <button
                      key={match.id}
                      type="button"
                      onClick={() => {
                        setSelectedMatch(match);
                        setTrailerNumber(match.trailerNumber);
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold"
                    >
                      {match.trailerNumber}
                    </button>
                  ))}
                </div>
              ) : null}
              <label className="block text-sm font-semibold text-slate-900">
                Physical position
                <input
                  value={actualPosition}
                  onChange={(event) => setActualPosition(event.target.value.toUpperCase())}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm uppercase"
                  placeholder="P32"
                />
              </label>
              <fieldset>
                <legend className="text-sm font-semibold text-slate-900">Physical empty / loaded</legend>
                <div className="mt-2 flex gap-2">
                  {(["empty", "loaded"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPhysicalLoad(value)}
                      className={`rounded-xl px-3 py-2 text-sm font-semibold ${physicalLoad === value ? "bg-slate-900 text-white" : "border border-slate-200 bg-white"}`}
                    >
                      {value === "empty" ? "Empty" : "Loaded"}
                    </button>
                  ))}
                </div>
              </fieldset>
              {unknown ? (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={confirmUnknown} onChange={(event) => setConfirmUnknown(event.target.checked)} />
                  Confirm unknown trailer finding
                </label>
              ) : null}
            </div>
          )}

          <label className="mt-3 block text-sm font-semibold text-slate-900">
            Note
            <input value={note} onChange={(event) => setNote(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          </label>
          {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void (resolveItem ? submitResolution() : submitFinding())}
              disabled={busy}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? "Saving..." : resolveItem ? "Save resolution" : "Add Finding"}
            </button>
          </div>
        </div>
      </AppCard>
    </div>
  );
}
