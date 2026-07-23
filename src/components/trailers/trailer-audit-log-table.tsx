"use client";

import { useMemo } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Flag,
  MapPin,
  PackageCheck,
  Route,
  ScanLine,
  Truck,
} from "lucide-react";
import type { Json } from "@/lib/database.types";
import type { TrailerAuditRow } from "@/lib/trailer-audit-log";

type TrailerAuditLogTableProps = {
  rows: TrailerAuditRow[];
  isLoading?: boolean;
  error?: string | null;
  emptyLabel?: string;
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  try {
    return new Date(value).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
};

const stringifyJson = (value: Json | null) => {
  if (value === null || value === undefined) {
    return "-";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "-";
  }
};

const iconForEvent = (eventType: string) => {
  const normalized = eventType.trim().toLowerCase();

  if (normalized.includes("arrival")) {
    return <Truck className="h-4 w-4" />;
  }

  if (normalized.includes("departure") || normalized.includes("departed")) {
    return <Route className="h-4 w-4" />;
  }

  if (normalized.includes("position")) {
    return <MapPin className="h-4 w-4" />;
  }

  if (normalized.includes("load")) {
    return <PackageCheck className="h-4 w-4" />;
  }

  if (normalized.includes("operational")) {
    return <Flag className="h-4 w-4" />;
  }

  if (normalized.includes("stock_check") || normalized.includes("stock check")) {
    return <ClipboardCheck className="h-4 w-4" />;
  }

  if (normalized.includes("present")) {
    return <ScanLine className="h-4 w-4" />;
  }

  if (normalized.includes("confirm")) {
    return <CheckCircle2 className="h-4 w-4" />;
  }

  return <ClipboardCheck className="h-4 w-4" />;
};

const formatEventType = (eventType: string) =>
  eventType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (token) => token.toUpperCase());

export function TrailerAuditLogTable({ rows, isLoading = false, error = null, emptyLabel = "No audit entries found." }: TrailerAuditLogTableProps) {
  const sortedRows = useMemo(
    () =>
      [...rows].sort(
        (left, right) =>
          new Date(right.performed_at ?? right.created_at ?? 0).getTime() - new Date(left.performed_at ?? left.created_at ?? 0).getTime(),
      ),
    [rows],
  );

  if (isLoading) {
    return <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">Loading timeline...</div>;
  }

  if (error) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-700">{error}</div>;
  }

  if (sortedRows.length === 0) {
    return <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">{emptyLabel}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1180px] text-left text-sm text-slate-700">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.2em] text-slate-500">
            <th className="px-2 py-3 font-semibold">Type</th>
            <th className="px-2 py-3 font-semibold">Trailer Number</th>
            <th className="px-2 py-3 font-semibold">Description</th>
            <th className="px-2 py-3 font-semibold">Previous Value</th>
            <th className="px-2 py-3 font-semibold">New Value</th>
            <th className="px-2 py-3 font-semibold">Source Module</th>
            <th className="px-2 py-3 font-semibold">Performed By</th>
            <th className="px-2 py-3 font-semibold">Performed At</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100 align-top last:border-b-0">
              <td className="px-2 py-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                  {iconForEvent(row.event_type)}
                  {formatEventType(row.event_type)}
                </span>
              </td>
              <td className="px-2 py-3 font-semibold text-slate-900">{row.trailer_number ?? "-"}</td>
              <td className="px-2 py-3">{row.description ?? "-"}</td>
              <td className="px-2 py-3">
                <pre className="max-w-[280px] whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">{stringifyJson(row.previous_value)}</pre>
              </td>
              <td className="px-2 py-3">
                <pre className="max-w-[280px] whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">{stringifyJson(row.new_value)}</pre>
              </td>
              <td className="px-2 py-3">{row.source_module ?? "system"}</td>
              <td className="px-2 py-3">{row.performed_by ?? "TrailerHub User"}</td>
              <td className="px-2 py-3">{formatDateTime(row.performed_at ?? row.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
