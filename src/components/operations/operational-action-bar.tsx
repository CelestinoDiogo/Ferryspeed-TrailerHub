"use client";

import type { ReactNode } from "react";

type ActionBarOption = {
  value: string;
  label: string;
};

type OperationalActionBarProps = {
  moduleLabel: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  prefixOptions?: ActionBarOption[];
  prefixValue?: string;
  onPrefixChange?: (value: string) => void;
  statusOptions?: ActionBarOption[];
  statusValue?: string;
  onStatusChange?: (value: string) => void;
  sortOptions?: ActionBarOption[];
  sortValue?: string;
  onSortChange?: (value: string) => void;
  selectedCount?: number;
  primaryActions?: ReactNode;
  secondaryActions?: ReactNode;
  className?: string;
};

export function OperationalActionBar({
  moduleLabel,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search trailer",
  prefixOptions,
  prefixValue,
  onPrefixChange,
  statusOptions,
  statusValue,
  onStatusChange,
  sortOptions,
  sortValue,
  onSortChange,
  selectedCount = 0,
  primaryActions,
  secondaryActions,
  className = "",
}: OperationalActionBarProps) {
  return (
    <section className={`sticky top-3 z-40 rounded-3xl border border-white/10 bg-slate-900/95 p-4 shadow-2xl shadow-black/30 backdrop-blur ${className}`.trim()}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="rounded-full border border-cyan-500/40 bg-cyan-500/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100">
              {moduleLabel}
            </span>
            <input
              type="search"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-11 w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-950/85 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400/50"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-1.5 text-xs font-semibold text-slate-300">
              {selectedCount} selected
            </span>
            {primaryActions}
          </div>
        </div>

        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {prefixOptions && onPrefixChange ? (
              <label className="text-xs uppercase tracking-[0.18em] text-slate-500">
                Prefix
                <select
                  value={prefixValue ?? "all"}
                  onChange={(event) => onPrefixChange(event.target.value)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-slate-950/85 px-3 text-sm text-slate-100"
                >
                  {prefixOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {statusOptions && onStatusChange ? (
              <label className="text-xs uppercase tracking-[0.18em] text-slate-500">
                Status
                <select
                  value={statusValue ?? "all"}
                  onChange={(event) => onStatusChange(event.target.value)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-slate-950/85 px-3 text-sm text-slate-100"
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {sortOptions && onSortChange ? (
              <label className="text-xs uppercase tracking-[0.18em] text-slate-500">
                Sort
                <select
                  value={sortValue ?? ""}
                  onChange={(event) => onSortChange(event.target.value)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-slate-950/85 px-3 text-sm text-slate-100"
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {secondaryActions ? <div className="flex flex-wrap items-center gap-2">{secondaryActions}</div> : null}
        </div>
      </div>
    </section>
  );
}
