"use client";

type PwaStatusCardProps = {
  showInstallAction: boolean;
  showIosInstallGuide: boolean;
  isInstalled: boolean;
  updateAvailable: boolean;
  canApplyUpdate: boolean;
  onInstall: () => void;
  onDismissInstall: () => void;
  onApplyUpdate: () => void;
};

export function PwaStatusCard({
  showInstallAction,
  showIosInstallGuide,
  isInstalled,
  updateAvailable,
  canApplyUpdate,
  onInstall,
  onDismissInstall,
  onApplyUpdate,
}: PwaStatusCardProps) {
  if (!showInstallAction && !updateAvailable && !isInstalled) {
    return null;
  }

  return (
    <div className="space-y-3">
      {showInstallAction ? (
        <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-3 py-3 text-sm text-cyan-900">
          <p className="font-semibold">Install TrailerHub</p>
          {showIosInstallGuide ? (
            <p className="mt-1 text-xs text-cyan-800">In Safari, open Share and choose Add to Home Screen.</p>
          ) : (
            <p className="mt-1 text-xs text-cyan-800">Install Master Mobile for a faster app-like experience that opens directly into mobile operations.</p>
          )}
          <div className="mt-3 flex gap-2">
            {!showIosInstallGuide ? (
              <button type="button" onClick={onInstall} className="rounded-xl bg-cyan-700 px-3 py-2 text-xs font-semibold text-white">
                Install TrailerHub
              </button>
            ) : null}
            <button type="button" onClick={onDismissInstall} className="rounded-xl border border-cyan-200 bg-white px-3 py-2 text-xs font-semibold text-cyan-800">
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {isInstalled ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-900">
          TrailerHub is installed and running in standalone mode.
        </div>
      ) : null}

      {updateAvailable ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <p className="font-semibold">Update available</p>
          <p className="mt-1 text-xs text-amber-800">Reload only when no action is pending or syncing.</p>
          <button type="button" onClick={onApplyUpdate} disabled={!canApplyUpdate} className="mt-3 rounded-xl bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-amber-300">
            {canApplyUpdate ? "Reload to update" : "Sync or finish actions first"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
