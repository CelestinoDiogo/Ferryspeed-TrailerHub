"use client";

import { useEffect, useRef } from "react";
import {
  createHistoryDateRange,
  type HistoryDateRangePreset,
  type HistoryDateRangeValue,
} from "@/lib/history-date-range";

type HistoryDateRangeFilterProps = {
  value: HistoryDateRangeValue;
  onChange: (nextValue: HistoryDateRangeValue) => void;
  label?: string;
};

const PRESET_OPTIONS: Array<{ value: HistoryDateRangePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7_days", label: "Last 7 Days" },
  { value: "last_30_days", label: "Last 30 Days" },
  { value: "custom", label: "Custom Date Range" },
];

type DateFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

function DateField({ label, value, onChange }: DateFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (input && document.activeElement !== input && input.value !== value) {
      input.value = value;
    }
  }, [value]);

  return (
    <label className="flex flex-col gap-2 text-sm text-slate-300">
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</span>
      <input
        ref={inputRef}
        type="date"
        defaultValue={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-2xl border border-white/10 bg-slate-950/80 px-3 text-slate-100 outline-none ring-0 focus:border-cyan-400/50"
      />
    </label>
  );
}

export function HistoryDateRangeFilter({
  value,
  onChange,
  label = "Period",
}: HistoryDateRangeFilterProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(220px,280px)_1fr]">
      <label className="flex flex-col gap-2 text-sm text-slate-300">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</span>
        <select
          value={value.preset}
          onChange={(event) => {
            const preset = event.target.value as HistoryDateRangePreset;
            if (preset === "custom") {
              onChange({
                preset,
                startDate: value.startDate,
                endDate: value.endDate,
              });
              return;
            }

            onChange(createHistoryDateRange(preset));
          }}
          className="h-11 rounded-2xl border border-white/10 bg-slate-950/80 px-3 text-slate-100 outline-none ring-0 focus:border-cyan-400/50"
        >
          {PRESET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {value.preset === "custom" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <DateField
            label="Start Date"
            value={value.startDate}
            onChange={(startDate) => onChange({ ...value, startDate })}
          />
          <DateField
            label="End Date"
            value={value.endDate}
            onChange={(endDate) => onChange({ ...value, endDate })}
          />
        </div>
      ) : null}
    </div>
  );
}
