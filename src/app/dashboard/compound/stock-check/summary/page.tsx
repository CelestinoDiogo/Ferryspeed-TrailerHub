"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppCard } from "@/components/layout/app-card";
import { EmptyState } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import { supabase } from "@/lib/supabase";
import {
  formatDateTime,
  formatStatusLabel,
  normalizeTrailerNumber,
  type StockCheck,
  type StockCheckItem,
} from "@/lib/compound-stock-check";

type SummaryActionRow = {
  itemId: string;
  trailerNumber: string;
  discrepancyType: string | null;
  resolutionAction: string | null;
  resolutionStatus: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  checkedAt: string | null;
  checkedBy: string | null;
};

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";

export default function CompoundStockCheckSummaryPage() {
  const searchParams = useSearchParams();
  const requestedStockCheckId = searchParams.get("stockCheckId") ?? "";

  const [checks, setChecks] = useState<StockCheck[]>([]);
  const [selectedStockCheckId, setSelectedStockCheckId] = useState("");
  const [summaryItems, setSummaryItems] = useState<StockCheckItem[]>([]);
  const [isLoadingChecks, setIsLoadingChecks] = useState(true);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadChecks = useCallback(async () => {
    setIsLoadingChecks(true);
    setError(null);

    try {
      const { data, error: loadError } = await supabase
        .from("compound_stock_checks")
        .select(
          "id, status, started_at, completed_at, cancelled_at, started_by, completed_by, expected_total, checked_total, present_total, missing_total, unexpected_total, wrong_position_total, wrong_status_total, notes, created_at, updated_at",
        )
        .order("started_at", { ascending: false })
        .limit(100);

      if (loadError) {
        throw loadError;
      }

      const rows = data ?? [];
      setChecks(rows);

      if (rows.length === 0) {
        setSelectedStockCheckId("");
        return;
      }

      if (requestedStockCheckId && rows.some((row) => row.id === requestedStockCheckId)) {
        setSelectedStockCheckId(requestedStockCheckId);
        return;
      }

      setSelectedStockCheckId(rows[0].id);
    } catch (loadErr) {
      setError(loadErr instanceof Error ? loadErr.message : "Unable to load stock check sessions.");
    } finally {
      setIsLoadingChecks(false);
    }
  }, [requestedStockCheckId]);

  const loadItems = useCallback(async (stockCheckId: string) => {
    if (!stockCheckId) {
      setSummaryItems([]);
      return;
    }

    setIsLoadingItems(true);
    setError(null);

    try {
      const { data, error: itemError } = await supabase
        .from("compound_stock_check_items")
        .select(
          "id, stock_check_id, trailer_id, trailer_number, expected_in_compound, physically_present, expected_position, actual_position, system_load_status, system_operational_status, discrepancy_type, checked_at, checked_by, resolution_status, resolution_action, resolved_at, resolved_by, notes, created_at, updated_at",
        )
        .eq("stock_check_id", stockCheckId)
        .order("checked_at", { ascending: false })
        .order("trailer_number", { ascending: true });

      if (itemError) {
        throw itemError;
      }

      setSummaryItems(data ?? []);
    } catch (itemErr) {
      setError(itemErr instanceof Error ? itemErr.message : "Unable to load stock check summary items.");
    } finally {
      setIsLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    void loadChecks();
  }, [loadChecks]);

  useEffect(() => {
    if (!selectedStockCheckId) {
      setSummaryItems([]);
      return;
    }

    void loadItems(selectedStockCheckId);
  }, [loadItems, selectedStockCheckId]);

  const selectedCheck = useMemo(
    () => checks.find((row) => row.id === selectedStockCheckId) ?? null,
    [checks, selectedStockCheckId],
  );

  const actionRows = useMemo<SummaryActionRow[]>(() => {
    return summaryItems
      .filter((item) => Boolean(item.resolution_action?.trim()) || normalizeText(item.resolution_status) === "resolved")
      .map((item) => ({
        itemId: item.id,
        trailerNumber: normalizeTrailerNumber(item.trailer_number ?? "Unknown"),
        discrepancyType: item.discrepancy_type ?? null,
        resolutionAction: item.resolution_action ?? null,
        resolutionStatus: item.resolution_status ?? null,
        resolvedAt: item.resolved_at ?? null,
        resolvedBy: item.resolved_by ?? null,
        checkedAt: item.checked_at ?? null,
        checkedBy: item.checked_by ?? null,
      }));
  }, [summaryItems]);

  const summaryStats = useMemo(() => {
    return {
      expected: selectedCheck?.expected_total ?? 0,
      found: selectedCheck?.present_total ?? 0,
      missing: selectedCheck?.missing_total ?? 0,
      unexpected: selectedCheck?.unexpected_total ?? 0,
      wrongPosition: selectedCheck?.wrong_position_total ?? 0,
      wrongStatus: selectedCheck?.wrong_status_total ?? 0,
      checked: selectedCheck?.checked_total ?? 0,
      actions: actionRows.length,
    };
  }, [actionRows.length, selectedCheck]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Compound"
        title="Stock Check Summary"
        description="Session-level totals, discrepancies, operators, timestamps, and reconciliation actions performed."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/compound/stock-check"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back to Stock Check
            </Link>
            <Link
              href="/dashboard/compound/review-discrepancies"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Review Discrepancies
            </Link>
          </div>
        }
      />

      {error ? (
        <AppCard className="border border-rose-200 bg-rose-50">
          <div className="px-4 py-3 text-sm text-rose-700">{error}</div>
        </AppCard>
      ) : null}

      {isLoadingChecks ? <LoadingState label="Loading stock check sessions..." /> : null}

      {!isLoadingChecks && checks.length === 0 ? (
        <EmptyState
          title="No stock check sessions available"
          description="Start a stock check session first to generate summary reporting."
        />
      ) : null}

      {!isLoadingChecks && checks.length > 0 ? (
        <>
          <AppCard>
            <div className="p-5 md:p-6">
              <label className="text-sm font-semibold text-slate-900" htmlFor="stockCheckSessionSelect">
                Stock Check Session
                <select
                  id="stockCheckSessionSelect"
                  value={selectedStockCheckId}
                  onChange={(event) => setSelectedStockCheckId(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-500"
                >
                  {checks.map((check) => (
                    <option key={check.id} value={check.id}>
                      {`${formatDateTime(check.started_at)} | ${formatStatusLabel(check.status)} | ${check.started_by ?? "Unknown"}`}
                    </option>
                  ))}
                </select>
              </label>

              {selectedCheck ? (
                <dl className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Session ID</dt>
                    <dd className="mt-1 break-all font-mono text-xs text-slate-900">{selectedCheck.id}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Status</dt>
                    <dd className="mt-1">{formatStatusLabel(selectedCheck.status)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Operator</dt>
                    <dd className="mt-1">{selectedCheck.started_by ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Completed By</dt>
                    <dd className="mt-1">{selectedCheck.completed_by ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Started</dt>
                    <dd className="mt-1">{formatDateTime(selectedCheck.started_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Ended</dt>
                    <dd className="mt-1">{formatDateTime(selectedCheck.completed_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Updated</dt>
                    <dd className="mt-1">{formatDateTime(selectedCheck.updated_at)}</dd>
                  </div>
                </dl>
              ) : null}
            </div>
          </AppCard>

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Expected" value={String(summaryStats.expected)} />
            <StatCard label="Checked" value={String(summaryStats.checked)} />
            <StatCard label="Found" value={String(summaryStats.found)} />
            <StatCard label="Missing" value={String(summaryStats.missing)} />
            <StatCard label="Unexpected" value={String(summaryStats.unexpected)} />
            <StatCard label="Position Mismatch" value={String(summaryStats.wrongPosition)} />
            <StatCard label="Status Mismatch" value={String(summaryStats.wrongStatus)} />
            <StatCard label="Actions Performed" value={String(summaryStats.actions)} />
          </section>

          <AppCard>
            <div className="p-5 md:p-6">
              <h2 className="text-lg font-semibold text-slate-950">Reconciliation Actions</h2>
              <p className="mt-1 text-sm text-slate-500">Actions captured in stock check item resolution records.</p>

              {isLoadingItems ? (
                <p className="mt-4 text-sm text-slate-500">Loading actions...</p>
              ) : actionRows.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">No reconciliation actions recorded for this session.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-sm text-slate-700">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.2em] text-slate-500">
                        <th className="px-2 py-3 font-semibold">Trailer</th>
                        <th className="px-2 py-3 font-semibold">Discrepancy</th>
                        <th className="px-2 py-3 font-semibold">Action</th>
                        <th className="px-2 py-3 font-semibold">Resolution</th>
                        <th className="px-2 py-3 font-semibold">Resolved At</th>
                        <th className="px-2 py-3 font-semibold">Resolved By</th>
                        <th className="px-2 py-3 font-semibold">Checked At</th>
                        <th className="px-2 py-3 font-semibold">Checked By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {actionRows.map((row) => (
                        <tr key={row.itemId} className="border-b border-slate-100 align-top last:border-b-0">
                          <td className="px-2 py-3 font-semibold text-slate-900">{row.trailerNumber}</td>
                          <td className="px-2 py-3">{formatStatusLabel(row.discrepancyType)}</td>
                          <td className="px-2 py-3">{row.resolutionAction ?? "-"}</td>
                          <td className="px-2 py-3">{formatStatusLabel(row.resolutionStatus)}</td>
                          <td className="px-2 py-3">{formatDateTime(row.resolvedAt)}</td>
                          <td className="px-2 py-3">{row.resolvedBy ?? "-"}</td>
                          <td className="px-2 py-3">{formatDateTime(row.checkedAt)}</td>
                          <td className="px-2 py-3">{row.checkedBy ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </AppCard>
        </>
      ) : null}
    </div>
  );
}
