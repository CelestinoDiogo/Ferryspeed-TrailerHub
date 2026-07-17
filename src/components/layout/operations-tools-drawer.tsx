"use client";

import { X } from "lucide-react";
import { operationsToolCategories, operationsTools } from "@/config/operations-tools";
import { OperationsToolItem } from "@/components/layout/operations-tool-item";

type OperationsToolsDrawerProps = {
  open: boolean;
  onClose: () => void;
};

export function OperationsToolsDrawer({ open, onClose }: OperationsToolsDrawerProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Operations Tools panel">
      <button type="button" className="absolute inset-0 bg-black/35" onClick={onClose} aria-label="Close Operations Tools panel" />
      <aside className="absolute right-0 top-0 h-full w-full max-w-[92vw] overflow-y-auto border-l border-slate-200 bg-[#F8FAFC] p-4 shadow-2xl sm:max-w-[460px]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Operations Tools</p>
            <p className="text-sm text-slate-600">Open live services in a separate tab.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700"
            aria-label="Close Operations Tools"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 pb-4">
          {operationsToolCategories.map((category) => {
            const tools = operationsTools.filter((tool) => tool.enabled && tool.category === category.id);
            if (tools.length === 0) return null;

            return (
              <section key={category.id} className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{category.label}</p>
                <div className="space-y-2">
                  {tools.map((tool) => (
                    <OperationsToolItem key={tool.id} tool={tool} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </aside>
    </div>
  );
}