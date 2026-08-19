"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock3, RefreshCw } from "lucide-react";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { supabase } from "@/lib/supabase";
import { canPerformAction } from "@/lib/auth/permissions";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { advanceExportAllocationStatus } from "@/lib/operations/export-lifecycle";
import {
  deriveMandatoryCollections,
  type DeliveryCollectionSourceRow,
  type ExportCollectionSourceRow,
  type MandatoryCollection,
} from "@/lib/mandatory-collections";
import type { ExportAllocationRecord } from "@/lib/export-allocation";
import type { Json } from "@/lib/database.types";

type DeliveryQueryRow = DeliveryCollectionSourceRow & {
  temperature_required?: boolean | null;
  trailers?: { trailer_number?: string | null } | null;
};

type ExportQueryRow = ExportCollectionSourceRow & {
  priority?: string | null;
};

const ageStyles = {
  red: "border-rose-500/40 bg-rose-950/30 text-rose-200",
  orange: "border-orange-500/40 bg-orange-950/30 text-orange-200",
  green: "border-emerald-500/40 bg-emerald-950/30 text-emerald-200",
  future: "border-cyan-500/30 bg-cyan-950/20 text-cyan-200",
} as const;

const formatDateTime = (value: string | null) => value
  ? new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" })
  : "-";

const statusLabel = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const metadataLoadStatus = (metadata: Json): "Empty" | "Loaded" | null => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = metadata.new_load_status;
  return value === "Empty" || value === "Loaded" ? value : null;
};

export function MandatoryCollectionsWorkboard() {
  const { roleKey, isLoading: isLoadingUser } = useCurrentUser();
  const canViewCollections = roleKey ? canPerformAction(roleKey, "dashboard", "view") : false;
  const [deliveries, setDeliveries] = useState<DeliveryQueryRow[]>([]);
  const [exports, setExports] = useState<ExportQueryRow[]>([]);
  const [view, setView] = useState<"outstanding" | "history">("outstanding");
  const [isLoading, setIsLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [temperatureById, setTemperatureById] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadCollections = useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    setError(null);

    try {
      const [deliveryResult, exportResult] = await Promise.all([
        supabase
          .from("delivery_bookings")
          .select("id, trailer_id, customer, delivery_location, booking_reference, delivery_date, delivered_at, waiting_collection_since, collection_due_date, collected_at, status, temperature_required, trailers(trailer_number)")
          .in("status", ["waiting_collection", "delivered", "collected"]),
        supabase
          .from("export_allocations")
          .select("id, trailer_id, trailer_number, customer, collection_address, booking_reference, collection_date, expected_return_at, delivered_empty_at, waiting_loading_at, collected_loaded_at, completed_at, cancelled_at, status, priority")
          .in("status", ["delivered_empty", "waiting_loading", "collected_loaded", "completed"]),
      ]);

      if (deliveryResult.error) throw deliveryResult.error;
      if (exportResult.error) throw exportResult.error;

      const deliveryRows = ((deliveryResult.data ?? []) as DeliveryQueryRow[]).map((row) => ({
        ...row,
        trailer_number: row.trailers?.trailer_number ?? row.trailer_number ?? null,
      }));
      const completedDeliveryIds = deliveryRows.filter((row) => row.collected_at).map((row) => row.id);
      const resultByDeliveryId = new Map<string, "Empty" | "Loaded">();

      if (completedDeliveryIds.length > 0) {
        const { data: activities, error: activityError } = await supabase
          .from("trailer_activity_log")
          .select("source_record_id, metadata, created_at")
          .eq("source_module", "delivery")
          .eq("event_type", "load_status_changed")
          .in("source_record_id", completedDeliveryIds)
          .order("created_at", { ascending: false });
        if (activityError) throw activityError;
        for (const activity of activities ?? []) {
          if (!activity.source_record_id || resultByDeliveryId.has(activity.source_record_id)) continue;
          const result = metadataLoadStatus(activity.metadata);
          if (result) resultByDeliveryId.set(activity.source_record_id, result);
        }
      }

      setDeliveries(deliveryRows.map((row) => ({ ...row, resulting_load_status: resultByDeliveryId.get(row.id) ?? null })));
      setExports((exportResult.data ?? []) as ExportQueryRow[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load mandatory collections.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isLoadingUser || !canViewCollections) return;
    const timeoutId = window.setTimeout(() => void loadCollections(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [canViewCollections, isLoadingUser, loadCollections]);

  const allItems = useMemo(() => deriveMandatoryCollections({ deliveries, exports, includeCompleted: true }), [deliveries, exports]);
  const outstanding = useMemo(() => allItems.filter((item) => item.isOutstanding), [allItems]);
  const completed = useMemo(() => allItems.filter((item) => !item.isOutstanding).sort((left, right) => (right.collectedAt ?? "").localeCompare(left.collectedAt ?? "")), [allItems]);
  const visible = view === "outstanding" ? outstanding : completed;
  const deliveryById = useMemo(() => new Map(deliveries.map((row) => [row.id, row])), [deliveries]);
  const exportById = useMemo(() => new Map(exports.map((row) => [row.id, row])), [exports]);

  const operatorName = async () => {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    const fullName = typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "";
    return fullName || user?.email || user?.id || "TrailerHub User";
  };

  const completeDelivery = async (item: MandatoryCollection, result: "Empty" | "Loaded") => {
    const row = deliveryById.get(item.sourceId);
    if (!row || actionKey) return;
    const temperatureText = temperatureById[row.id]?.trim() ?? "";
    const temperature = temperatureText ? Number(temperatureText) : null;
    if (row.temperature_required && (temperature === null || !Number.isFinite(temperature))) {
      setError("A valid collection temperature is required for this delivery.");
      return;
    }

    setActionKey(item.key);
    setError(null);
    try {
      if (row.status === "delivered") {
        const now = new Date().toISOString();
        const { error: promoteError } = await supabase
          .from("delivery_bookings")
          .update({
            status: "waiting_collection",
            waiting_collection_since: row.waiting_collection_since ?? now,
            delivered_at: row.delivered_at ?? now,
            updated_at: now,
          })
          .eq("id", row.id)
          .eq("status", "delivered");
        if (promoteError) throw promoteError;
      }

      const { error: actionError } = await supabase.rpc("complete_delivery_customer_collection", {
        p_booking_id: row.id,
        p_expected_current_status: "waiting_collection",
        p_resulting_load_status: result,
        p_collected_temperature_c: temperature,
        p_performed_by: await operatorName(),
      });
      if (actionError) throw actionError;
      setNotice(`${item.trailerNumber ?? "Trailer"} collected ${result.toLowerCase()}.`);
      await loadCollections(false);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to complete collection.");
    } finally {
      setActionKey(null);
    }
  };

  const advanceExport = async (item: MandatoryCollection) => {
    const row = exportById.get(item.sourceId);
    if (!row || actionKey) return;
    setActionKey(item.key);
    setError(null);
    try {
      await advanceExportAllocationStatus(supabase, {
        allocation: row as ExportAllocationRecord,
        sourceModule: "export",
        performedBy: await operatorName(),
        skipWaitingAutoAssign: true,
      });
      setNotice(`${item.trailerNumber ?? "Trailer"} moved to ${row.status === "delivered_empty" ? "Waiting Loading" : "Collected Loaded"}.`);
      await loadCollections(false);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to advance export collection.");
    } finally {
      setActionKey(null);
    }
  };

  if (isLoadingUser) {
    return <p className="p-6 text-sm text-slate-400">Checking Collections access...</p>;
  }

  return (
    <PermissionGuard roleKey={roleKey} moduleKey="dashboard" action="view" allowWhenRoleMissing={false}>
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="border-b border-white/10 pb-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-400">Operational Follow-up</p><h1 className="mt-2 text-3xl font-semibold">Collections</h1><p className="mt-2 text-sm text-slate-300">Outstanding Export and Delivery collections remain here until completion.</p></div>
            <button type="button" onClick={() => void loadCollections(false)} disabled={isLoading || Boolean(actionKey)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/15 px-3 text-sm font-semibold hover:bg-white/5 disabled:opacity-50"><RefreshCw className="h-4 w-4" />Refresh</button>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[{ label: "Outstanding", value: outstanding.length }, { label: "Red", value: outstanding.filter((item) => item.ageLevel === "red").length }, { label: "Orange", value: outstanding.filter((item) => item.ageLevel === "orange").length }, { label: "Future", value: outstanding.filter((item) => item.ageLevel === "future").length }].map((stat) => <div key={stat.label} className="border-l-2 border-cyan-400 bg-slate-900/60 px-4 py-3"><p className="text-xs uppercase text-slate-400">{stat.label}</p><p className="mt-1 text-2xl font-semibold">{stat.value}</p></div>)}
        </section>

        <div className="flex gap-2 border-b border-white/10">
          <button type="button" onClick={() => setView("outstanding")} className={`px-4 py-3 text-sm font-semibold ${view === "outstanding" ? "border-b-2 border-cyan-400 text-white" : "text-slate-400"}`}>Today / Outstanding ({outstanding.length})</button>
          <button type="button" onClick={() => setView("history")} className={`px-4 py-3 text-sm font-semibold ${view === "history" ? "border-b-2 border-cyan-400 text-white" : "text-slate-400"}`}>Completed History ({completed.length})</button>
        </div>

        {error ? <p className="border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">{error}</p> : null}
        {notice ? <p className="border border-emerald-500/40 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">{notice}</p> : null}
        {isLoading ? <p className="py-8 text-center text-sm text-slate-400">Loading collections...</p> : null}
        {!isLoading && visible.length === 0 ? <p className="border border-white/10 bg-slate-900/60 px-4 py-8 text-center text-sm text-slate-300">{view === "outstanding" ? "No mandatory collections are currently outstanding." : "No completed collection history is available."}</p> : null}

        {!isLoading && visible.length > 0 ? <section className="space-y-3">{visible.map((item) => {
          const delivery = item.source === "delivery" ? deliveryById.get(item.sourceId) : null;
          const isBusy = actionKey === item.key;
          return <article key={item.key} className={`border p-4 ${ageStyles[item.ageLevel]}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold uppercase tracking-[0.18em]">{item.source}</span><span className="text-xs text-slate-400">{statusLabel(item.status)}</span></div><h2 className="mt-1 text-xl font-semibold text-white">{item.trailerNumber ?? "Unknown trailer"}</h2><p className="mt-1 text-sm text-slate-300">{item.customer ?? "No customer"}{item.location ? ` · ${item.location}` : ""}</p></div>
              <div className="text-right"><p className="inline-flex items-center gap-1 text-sm font-bold"><Clock3 className="h-4 w-4" />{item.ageLabel}</p><p className="mt-1 text-xs text-slate-400">Original due {formatDateTime(item.originalDueAt)}</p></div>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-xs uppercase text-slate-500">Reference</dt><dd className="mt-1 text-slate-200">{item.reference ?? "-"}</dd></div><div><dt className="text-xs uppercase text-slate-500">Pending since</dt><dd className="mt-1 text-slate-200">{formatDateTime(item.pendingSince)}</dd></div><div><dt className="text-xs uppercase text-slate-500">Source job</dt><dd className="mt-1 font-mono text-xs text-slate-300">{item.sourceId}</dd></div></dl>
            {item.isOutstanding ? <div className="mt-4 flex flex-wrap items-end justify-end gap-2 border-t border-white/10 pt-4">
              {delivery?.temperature_required ? <label className="mr-auto text-xs font-semibold uppercase text-slate-300">Collection temperature (C)<input type="number" step="0.1" value={temperatureById[delivery.id] ?? ""} onChange={(event) => setTemperatureById((current) => ({ ...current, [delivery.id]: event.target.value }))} className="mt-1 block h-10 w-40 rounded-lg border border-white/15 bg-slate-950 px-3 text-sm text-white" /></label> : null}
              {item.source === "delivery" ? <><button type="button" disabled={Boolean(actionKey)} onClick={() => void completeDelivery(item, "Empty")} className="rounded-lg border border-white/20 bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Collected Empty</button><button type="button" disabled={Boolean(actionKey)} onClick={() => void completeDelivery(item, "Loaded")} className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{isBusy ? "Updating..." : "Collected Loaded"}</button></> : <button type="button" disabled={Boolean(actionKey)} onClick={() => void advanceExport(item)} className="rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{isBusy ? "Updating..." : item.status === "delivered_empty" ? "Mark Waiting Loading" : "Collected Loaded"}</button>}
              <Link href={item.source === "delivery" ? `/dashboard/deliveries/${item.sourceId}` : `/dashboard/export-operations/${item.sourceId}`} className="rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-white">Open job</Link>
            </div> : <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-sm"><span className="inline-flex items-center gap-1 font-semibold text-emerald-300"><Check className="h-4 w-4" />Collected {item.physicalResult ?? ""}</span><span className="text-slate-400">{formatDateTime(item.collectedAt)}</span></div>}
          </article>;
        })}</section> : null}
      </div>
    </main>
    </PermissionGuard>
  );
}