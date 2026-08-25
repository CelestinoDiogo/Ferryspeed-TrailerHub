"use client";

import { ESCORT_FILTER_OPTIONS, type EscortFilter } from "@/lib/operations/escort-flags";

type EscortYesNoFieldProps = {
  id: string;
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
};

export function EscortYesNoField({ id, label, value, onChange, disabled }: EscortYesNoFieldProps) {
  return (
    <div>
      <p id={id} className="mb-2 block text-sm font-medium text-slate-200">{label}</p>
      <div className="flex gap-2" role="group" aria-labelledby={id}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(false)}
          className={`rounded-2xl px-4 py-2 text-sm font-semibold disabled:opacity-60 ${
            !value ? "bg-cyan-500 text-slate-950" : "border border-white/10 bg-slate-950/80 text-white"
          }`}
        >
          No
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(true)}
          className={`rounded-2xl px-4 py-2 text-sm font-semibold disabled:opacity-60 ${
            value ? "bg-cyan-500 text-slate-950" : "border border-white/10 bg-slate-950/80 text-white"
          }`}
        >
          Yes
        </button>
      </div>
    </div>
  );
}

export function EscortBadge() {
  return (
    <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-100">
      ESCORT
    </span>
  );
}

type EscortFilterControlProps = {
  value: EscortFilter;
  onChange: (value: EscortFilter) => void;
};

export function EscortFilterButtons({ value, onChange }: EscortFilterControlProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {ESCORT_FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
            value === option.value
              ? "bg-cyan-500 text-slate-950"
              : "border border-white/10 bg-slate-900/70 text-white hover:bg-slate-800"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
