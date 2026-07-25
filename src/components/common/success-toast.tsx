"use client";

type SuccessToastProps = {
  message: string;
  onClose: () => void;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
};

export function SuccessToast({ message, onClose, actionLabel, onAction, actionDisabled = false }: SuccessToastProps) {
  return (
    <div className="fixed right-4 top-4 z-50 w-[min(92vw,26rem)] rounded-2xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-3 shadow-xl shadow-emerald-950/40 backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-emerald-100">{message}</p>
        <div className="flex items-center gap-2">
          {actionLabel && onAction ? (
            <button
              type="button"
              onClick={onAction}
              disabled={actionDisabled}
              className="rounded-lg border border-emerald-200/50 px-2.5 py-1 text-xs font-semibold text-emerald-50 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {actionLabel}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-emerald-300/30 px-2 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/20"
            aria-label="Close success message"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
