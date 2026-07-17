"use client";

import { MapPinned } from "lucide-react";

type OperationsToolsButtonProps = {
  onClick: () => void;
};

export function OperationsToolsButton({ onClick }: OperationsToolsButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
      aria-label="Open Operations Tools"
    >
      <MapPinned className="h-4.5 w-4.5" />
      <span className="hidden sm:inline">Operations Tools</span>
    </button>
  );
}