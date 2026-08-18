"use client";

import { useEffect, useMemo, useState } from "react";
import { HistoryDateRangeFilter } from "@/components/common/history-date-range-filter";
import { PrintButton } from "@/components/print/print-button";
import { PrintFilters } from "@/components/print/print-filters";
import { PrintFooter } from "@/components/print/print-footer";
import { PrintHeader } from "@/components/print/print-header";
import { PrintReportLayout } from "@/components/print/print-report-layout";
import { PrintSummary } from "@/components/print/print-summary";
import { PrintTable } from "@/components/print/print-table";
import { getHistoryDateRangeLabel, createHistoryDateRange, normalizeHistoryPreset, type HistoryDateRangeValue } from "@/lib/history-date-range";
import { collectionRecord, filterHistoricalOperations, ownershipForArrival, type HistoricalOperationKind, type HistoricalOperationRecord } from "@/lib/reports/historical-operations";
import { resolveHistoricalOwnership, type HistoricalOwnershipSnapshot } from "@/lib/reports/historical-trailer-ownership";
import { supabase } from "@/lib/supabase";
import { getTrailerOwnershipBadgeLabel } from "@/lib/trailer-ownership";

const formatDateTime = (value: string | null) => value ? new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
const formatDate = (value: string | null) => value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "-";

type OwnershipFilter = "all" | "company" | "outsourcing" | "unknown";

const readFilterState = (): { range: HistoryDateRangeValue; ownership: OwnershipFilter; search: string } => {
  if (typeof window === "undefined") return { range: createHistoryDateRange("today"), ownership: "all", search: "" };
  const params = new URLSearchParams(window.location.search);
  const preset = normalizeHistoryPreset(params.get("history"));
  return {
    range: preset === "custom" ? { preset, startDate: params.get("start") ?? "", endDate: params.get("end") ?? "" } : createHistoryDateRange(preset),
    ownership: params.get("ownership") === "company" || params.get("ownership") === "outsourcing" || params.get("ownership") === "unknown" ? params.get("ownership") as OwnershipFilter : "all",
    search: params.get("search") ?? "",
  };
};

export function HistoricalOperationsReport({ kind }: { kind: HistoricalOperationKind }) {
  const [records, setRecords] = useState<HistoricalOperationRecord[]>([]);
  const [range, setRange] = useState<HistoryDateRangeValue>(() => readFilterState().range);
  const [ownership, setOwnership] = useState<OwnershipFilter>(() => readFilterState().ownership);
  const [search, setSearch] = useState(() => readFilterState().search);
  const [collectionState, setCollectionState] = useState<"all" | "pending" | "collected">("all");
  const [aging, setAging] = useState<"all" | "green" | "orange" | "red">("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        if (kind === "departures") {
          const { data, error: queryError } = await supabase.from("trailers")
            .select("id, trailer_number, departure_date, departure_time, customer, load_status, notes, source_vessel_operation_trailer_id")
            .not("departure_date", "is", null);
          if (queryError) throw queryError;
          const sourceIds = Array.from(new Set((data ?? []).map((row) => row.source_vessel_operation_trailer_id).filter((value): value is string => Boolean(value))));
          const { data: sourceRows, error: sourceError } = sourceIds.length
            ? await supabase.from("vessel_operation_trailers").select("id, ownership_type, trailer_source, external_company").in("id", sourceIds)
            : { data: [], error: null };
          if (sourceError) throw sourceError;
          const sourceMap = new Map((sourceRows ?? []).map((row) => [row.id, row]));
          setRecords(((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
            id: row.id as string,
            trailerNumber: row.trailer_number as string | null,
            occurredAt: row.departure_date ? `${String(row.departure_date).slice(0, 10)}T${row.departure_time ?? "00:00:00"}` : null,
            ownershipType: resolveHistoricalOwnership({ sourceSnapshot: sourceMap.get(row.source_vessel_operation_trailer_id as string) ?? null }),
            customer: row.customer as string | null,
            sourceOrDestination: null,
            reference: null,
            loadStatus: row.load_status as string | null,
            notes: row.notes as string | null,
          })));
        } else if (kind === "arrivals") {
          const [{ data: vesselRows, error: vesselError }, { data: operationRows, error: operationError }] = await Promise.all([
            supabase.from("vessel_operation_trailers").select("id, trailer_id, trailer_number, customer, booking_reference, load_status, arrived_at, arrival_confirmed_at, arrival_status, planning_notes, vessel_operation_id, ownership_type, trailer_source, external_company"),
            supabase.from("vessel_operations").select("id, vessel_name, sailing_reference, origin_port"),
          ]);
          if (vesselError) throw vesselError;
          if (operationError) throw operationError;
          const operations = new Map((operationRows ?? []).map((row) => [row.id, row]));
          setRecords((vesselRows ?? []).filter((row) => row.arrival_confirmed_at || row.arrived_at).map((row) => {
            const operation = operations.get(row.vessel_operation_id) as { vessel_name?: string | null; sailing_reference?: string | null; origin_port?: string | null } | undefined;
            return { id: row.id, trailerNumber: row.trailer_number ?? null, occurredAt: row.arrival_confirmed_at ?? row.arrived_at ?? null, ownershipType: ownershipForArrival(row), customer: row.customer, sourceOrDestination: [operation?.vessel_name, operation?.origin_port].filter(Boolean).join(" / ") || null, reference: row.booking_reference, loadStatus: row.load_status, notes: row.planning_notes };
          }));
        } else {
          const { data, error: queryError } = await supabase.from("delivery_bookings").select("id, trailer_id, delivery_date, delivery_time, customer, booking_reference, status, notes, delivered_at, waiting_collection_since, collection_due_date, collected_at, driver:drivers(display_name), trailers(trailer_number, source_vessel_operation_trailer_id)").order("delivery_date", { ascending: true });
          if (queryError) throw queryError;
          const bookingRows = (data ?? []) as Array<Record<string, unknown>>;
          const sourceIds = Array.from(new Set(bookingRows.map((row) => (row.trailers as { source_vessel_operation_trailer_id?: string | null } | null)?.source_vessel_operation_trailer_id).filter((value): value is string => Boolean(value))));
          const { data: sourceRows, error: sourceError } = sourceIds.length
            ? await supabase.from("vessel_operation_trailers").select("id, ownership_type, trailer_source, external_company").in("id", sourceIds)
            : { data: [], error: null };
          if (sourceError) throw sourceError;
          const sourceMap = new Map((sourceRows ?? []).map((row) => [row.id, row as HistoricalOwnershipSnapshot & { id: string }]));
          setRecords(bookingRows.filter((row) => kind === "deliveries" || row.status === "waiting_collection" || row.collected_at).map((row) => {
            const driver = row.driver as { display_name?: string | null } | null;
            const trailer = row.trailers as { trailer_number?: string | null; source_vessel_operation_trailer_id?: string | null } | null;
            const collection = collectionRecord({ id: row.id as string, trailer_number: trailer?.trailer_number, customer: row.customer as string | null, booking_reference: row.booking_reference as string | null, delivery_date: row.delivery_date as string, delivered_at: row.delivered_at as string | null, waiting_collection_since: row.waiting_collection_since as string | null, collection_due_date: row.collection_due_date as string | null, collected_at: row.collected_at as string | null, notes: row.notes as string | null, driver: driver?.display_name ?? null, historicalOwnership: trailer?.source_vessel_operation_trailer_id ? sourceMap.get(trailer.source_vessel_operation_trailer_id) ?? null : null });
            return kind === "collections" ? collection : { ...collection, occurredAt: (row.delivery_time ? `${String(row.delivery_date).slice(0, 10)}T${String(row.delivery_time)}` : String(row.delivery_date)) as string, collectionState: undefined, agingLevel: undefined, agingLabel: undefined };
          }));
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load historical operations.");
      } finally { setIsLoading(false); }
    };
    void load();
  }, [kind]);

  const filtered = useMemo(() => filterHistoricalOperations(records, { range, ownership, search, collectionState, aging, currentPending: kind === "collections" && collectionState === "pending" }), [records, range, ownership, search, collectionState, aging, kind]);
  const title = kind === "arrivals" ? "ARRIVALS REPORT" : kind === "departures" ? "DEPARTURES REPORT" : kind === "deliveries" ? "DELIVERIES REPORT" : "COLLECTIONS REPORT";
  const label = kind === "arrivals" ? "Arrivals" : kind === "departures" ? "Departures" : kind === "deliveries" ? "Deliveries" : "Collections";
  const printAt = new Date().toLocaleString("en-GB");
  const ownCount = filtered.filter((row) => row.ownershipType === "company").length;
  const outsourcedCount = filtered.filter((row) => row.ownershipType === "outsourcing").length;

  const updateUrl = (updates: { range?: HistoryDateRangeValue; ownership?: typeof ownership; search?: string }) => {
    const params = new URLSearchParams(window.location.search);
    const nextRange = updates.range ?? range;
    params.set("history", nextRange.preset);
    if (nextRange.preset === "custom") { params.set("start", nextRange.startDate); params.set("end", nextRange.endDate); } else { params.delete("start"); params.delete("end"); }
    const nextOwnership = updates.ownership ?? ownership;
    if (nextOwnership === "all") params.delete("ownership"); else params.set("ownership", nextOwnership);
    const nextSearch = updates.search ?? search;
    if (nextSearch.trim()) params.set("search", nextSearch.trim()); else params.delete("search");
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  };

  const updateRange = (next: HistoryDateRangeValue) => {
    setRange(next);
    updateUrl({ range: next });
  };

  const clearFilters = () => {
    const next = createHistoryDateRange("today");
    setRange(next); setOwnership("all"); setSearch(""); setCollectionState("all"); setAging("all");
    window.history.replaceState({}, "", window.location.pathname);
  };

  return <>
    <div className="screen-only bg-slate-950 px-4 pt-6 sm:px-6">
      <div className="mx-auto flex max-w-7xl justify-end">
        <PrintButton disabled={isLoading || filtered.length === 0} />
      </div>
    </div>
    <main className="screen-only min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="rounded-3xl border border-white/10 bg-slate-900/80 p-5"><p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400">Historical Operations</p><h1 className="mt-2 text-3xl font-semibold">{label}</h1><p className="mt-2 text-sm text-slate-300">Read-only historical operational records.</p></header>
        <section className="rounded-3xl border border-white/10 bg-slate-900/80 p-4"><div className="flex flex-wrap items-end gap-4"><HistoryDateRangeFilter value={range} onChange={updateRange} label="Period" /><label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Ownership<select value={ownership} onChange={(event) => { const value = event.target.value as typeof ownership; setOwnership(value); updateUrl({ ownership: value }); }} className="mt-2 block h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white"><option value="all">All</option><option value="company">Own / Ferryspeed</option><option value="outsourcing">Outsourced / External</option></select></label>{kind === "collections" ? <><label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Collection state<select value={collectionState} onChange={(event) => setCollectionState(event.target.value as typeof collectionState)} className="mt-2 block h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white"><option value="all">All</option><option value="pending">Pending</option><option value="collected">Collected</option></select></label><label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Aging<select value={aging} onChange={(event) => setAging(event.target.value as typeof aging)} className="mt-2 block h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white"><option value="all">All</option><option value="green">GREEN</option><option value="orange">ORANGE</option><option value="red">RED</option></select></label></> : null}<label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Trailer search<input value={search} onChange={(event) => { const value = event.target.value; setSearch(value); updateUrl({ search: value }); }} placeholder="Trailer or reference" className="mt-2 block h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white" /></label><button type="button" onClick={clearFilters} className="h-11 rounded-xl border border-white/10 bg-slate-800 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-white">Clear Filters</button></div></section>
        {error ? <p className="rounded-xl border border-rose-300 bg-rose-950/40 p-3 text-sm text-rose-200">Unable to load {label.toLowerCase()}. Please try again.</p> : null}
        {isLoading ? <p className="rounded-xl bg-slate-900 p-4 text-sm text-slate-300">Loading report...</p> : null}
        {!isLoading && filtered.length === 0 ? <p className="rounded-xl bg-slate-900 p-4 text-sm text-slate-300">No records found for the selected filters.</p> : null}
        {!isLoading && filtered.length > 0 ? <><section className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-slate-900 p-4"><p className="text-xs uppercase text-slate-400">Total {label}</p><p className="mt-2 text-2xl font-bold">{filtered.length}</p></div><div className="rounded-2xl bg-slate-900 p-4"><p className="text-xs uppercase text-slate-400">Own</p><p className="mt-2 text-2xl font-bold">{ownCount}</p></div><div className="rounded-2xl bg-slate-900 p-4"><p className="text-xs uppercase text-slate-400">Outsourced</p><p className="mt-2 text-2xl font-bold">{outsourcedCount}</p></div></section><div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900"><table className="min-w-full text-left text-sm"><thead className="border-b border-white/10 text-xs uppercase text-slate-400"><tr><th className="p-3">Trailer</th><th className="p-3">{kind === "arrivals" ? "Arrival" : kind === "departures" ? "Departure" : kind === "collections" ? "Due / Pending" : "Delivery"}</th><th className="p-3">Ownership</th><th className="p-3">Customer</th><th className="p-3">Booking</th><th className="p-3">{kind === "collections" ? "Age" : kind === "arrivals" ? "Vessel / Origin" : "Driver / Context"}</th><th className="p-3">Status</th><th className="p-3">Notes</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id} className={`border-b border-white/5 ${row.agingLevel === "red" ? "bg-rose-950/20" : row.agingLevel === "orange" ? "bg-orange-950/20" : ""}`}><td className="p-3 font-semibold">{row.trailerNumber ?? "-"}</td><td className="p-3">{formatDateTime(row.occurredAt)}</td><td className="p-3">{getTrailerOwnershipBadgeLabel(row.ownershipType)}</td><td className="p-3">{row.customer ?? "-"}</td><td className="p-3">{row.reference ?? "-"}</td><td className="p-3">{kind === "collections" ? <><span className="font-semibold">{row.agingLabel?.toUpperCase()}</span><br />{row.waitingSince ? formatDateTime(row.waitingSince) : "-"}</> : row.sourceOrDestination ?? row.driver ?? "-"}</td><td className="p-3">{kind === "collections" ? row.collectionState : row.loadStatus ?? "-"}</td><td className="p-3">{row.notes ?? "-"}</td></tr>)}</tbody></table></div></> : null}
      </div>
    </main>
    <div className="print-only"><PrintReportLayout orientation="landscape"><PrintHeader title={title} printedAt={printAt} totalRecords={filtered.length}><PrintFilters items={[{ label: "Period", value: getHistoryDateRangeLabel(range) }, { label: "Ownership", value: ownership }, { label: "Search", value: search || "All records" }]} /></PrintHeader><PrintSummary items={[{ label: `Total ${label}`, value: filtered.length }, { label: "Own", value: ownCount }, { label: "Outsourced", value: outsourcedCount }]} /><PrintTable rows={filtered} columns={[{ key: "trailer", header: "Trailer", render: (row) => row.trailerNumber ?? "-" }, { key: "occurred", header: kind === "arrivals" ? "Arrival" : "Departure", render: (row) => formatDate(row.occurredAt) }, { key: "ownership", header: "Ownership", render: (row) => getTrailerOwnershipBadgeLabel(row.ownershipType) }, { key: "customer", header: "Customer", render: (row) => row.customer ?? "-" }, { key: "context", header: "Context", render: (row) => row.sourceOrDestination ?? row.reference ?? "-" }, { key: "load", header: "Load Status", render: (row) => row.loadStatus ?? "-" }, { key: "notes", header: "Notes", render: (row) => row.notes ?? "-" }]} /><PrintFooter /></PrintReportLayout></div>
  </>;
}
