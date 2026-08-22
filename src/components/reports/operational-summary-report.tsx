"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HistoryDateRangeFilter } from "@/components/common/history-date-range-filter";
import { PrintButton } from "@/components/print/print-button";
import { PrintFilters } from "@/components/print/print-filters";
import { PrintFooter } from "@/components/print/print-footer";
import { PrintHeader } from "@/components/print/print-header";
import { PrintReportLayout } from "@/components/print/print-report-layout";
import { PrintSummary } from "@/components/print/print-summary";
import { PrintTable } from "@/components/print/print-table";
import {
  createHistoryDateRange,
  getHistoryDateRangeLabel,
  normalizeHistoryPreset,
  type HistoryDateRangeValue,
} from "@/lib/history-date-range";
import {
  buildOperationalSummary,
  eventsForKpi,
  mapArrivalEvent,
  mapDeliveryCollectionEvent,
  mapDeliveryEvent,
  mapDepartureEvent,
  mapExportCollectionEvent,
  uniqueSortedNames,
  OPERATIONAL_SUMMARY_TOTAL_MOVEMENTS_DEFINITION,
  type OperationalSummaryEvent,
  type OperationalSummaryMovementType,
} from "@/lib/reports/operational-summary";
import { resolveHistoricalOwnership, type HistoricalOwnershipSnapshot } from "@/lib/reports/historical-trailer-ownership";
import { supabase } from "@/lib/supabase";
import { getTrailerOwnershipBadgeLabel, type TrailerOwnershipType } from "@/lib/trailer-ownership";

type OwnershipFilter = "all" | TrailerOwnershipType;
type KpiKey = "arrivals" | "departures" | "deliveries" | "collections" | "outsourcings";

const formatDateTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

const movementLabel = (type: OperationalSummaryMovementType) => {
  if (type === "arrival") return "Arrival";
  if (type === "departure") return "Departure";
  if (type === "delivery") return "Delivery";
  return "Collection";
};

const readFilterState = (): {
  range: HistoryDateRangeValue;
  ownership: OwnershipFilter;
  movementType: "all" | OperationalSummaryMovementType;
  customer: string;
  haulier: string;
  search: string;
} => {
  if (typeof window === "undefined") {
    return {
      range: createHistoryDateRange("last_7_days"),
      ownership: "all",
      movementType: "all",
      customer: "",
      haulier: "",
      search: "",
    };
  }

  const params = new URLSearchParams(window.location.search);
  const preset = normalizeHistoryPreset(params.get("history") ?? "last_7_days");
  const ownershipValue = params.get("ownership");
  const movementValue = params.get("type");

  return {
    range:
      preset === "custom"
        ? { preset, startDate: params.get("start") ?? "", endDate: params.get("end") ?? "" }
        : createHistoryDateRange(preset === "today" && !params.get("history") ? "last_7_days" : preset),
    ownership:
      ownershipValue === "company" || ownershipValue === "outsourcing" || ownershipValue === "unknown"
        ? ownershipValue
        : "all",
    movementType:
      movementValue === "arrival" || movementValue === "departure" || movementValue === "delivery" || movementValue === "collection"
        ? movementValue
        : "all",
    customer: params.get("customer") ?? "",
    haulier: params.get("haulier") ?? "",
    search: params.get("search") ?? "",
  };
};

export function OperationalSummaryReport() {
  const initial = readFilterState();
  const [events, setEvents] = useState<OperationalSummaryEvent[]>([]);
  const [range, setRange] = useState<HistoryDateRangeValue>(initial.range);
  const [ownership, setOwnership] = useState<OwnershipFilter>(initial.ownership);
  const [movementType, setMovementType] = useState<"all" | OperationalSummaryMovementType>(initial.movementType);
  const [customer, setCustomer] = useState(initial.customer);
  const [haulier, setHaulier] = useState(initial.haulier);
  const [search, setSearch] = useState(initial.search);
  const [drillDown, setDrillDown] = useState<KpiKey | null>(
    initial.movementType === "arrival"
      ? "arrivals"
      : initial.movementType === "departure"
        ? "departures"
        : initial.movementType === "delivery"
          ? "deliveries"
          : initial.movementType === "collection"
            ? "collections"
            : null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [
          { data: vesselRows, error: vesselError },
          { data: operationRows, error: operationError },
          { data: departureRows, error: departureError },
          { data: bookingRows, error: bookingError },
          { data: exportRows, error: exportError },
        ] = await Promise.all([
          supabase
            .from("vessel_operation_trailers")
            .select("id, trailer_number, customer, booking_reference, load_status, planning_notes, arrived_at, arrival_confirmed_at, arrival_status, status, cancelled_at, no_show_at, vessel_operation_id, ownership_type, trailer_source, external_company"),
          supabase.from("vessel_operations").select("id, vessel_name, origin_port"),
          supabase
            .from("trailers")
            .select("id, trailer_number, departure_date, departure_time, customer, load_status, notes, operational_status, trailer_source, external_company, is_local, source_vessel_operation_trailer_id")
            .not("departure_date", "is", null),
          supabase
            .from("delivery_bookings")
            .select("id, trailer_id, customer, booking_reference, delivery_location, status, delivered_at, collected_at, notes, driver:drivers(display_name), trailers(trailer_number, trailer_source, external_company, is_local, source_vessel_operation_trailer_id)"),
          supabase
            .from("export_allocations")
            .select("id, trailer_id, trailer_number, customer, booking_reference, haulier, status, collected_loaded_at, cancelled_at, notes"),
        ]);

        if (vesselError) throw vesselError;
        if (operationError) throw operationError;
        if (departureError) throw departureError;
        if (bookingError) throw bookingError;
        if (exportError) throw exportError;

        const operations = new Map((operationRows ?? []).map((row) => [row.id, row]));
        const bookingList = (bookingRows ?? []) as Array<Record<string, unknown>>;
        const departureList = (departureRows ?? []) as Array<Record<string, unknown>>;
        const exportList = (exportRows ?? []) as Array<Record<string, unknown>>;
        const exportTrailerIds = Array.from(new Set(exportList.map((row) => row.trailer_id).filter((value): value is string => Boolean(value))));
        const { data: exportTrailerRows, error: exportTrailerError } = exportTrailerIds.length
          ? await supabase.from("trailers").select("id, trailer_source, external_company, is_local, source_vessel_operation_trailer_id").in("id", exportTrailerIds)
          : { data: [], error: null };
        if (exportTrailerError) throw exportTrailerError;
        const exportTrailerMap = new Map((exportTrailerRows ?? []).map((row) => [row.id, row]));

        const sourceIds = Array.from(
          new Set(
            [
              ...departureList.map((row) => row.source_vessel_operation_trailer_id),
              ...bookingList.map((row) => (row.trailers as { source_vessel_operation_trailer_id?: string | null } | null)?.source_vessel_operation_trailer_id),
              ...exportList.map((row) => exportTrailerMap.get(row.trailer_id as string)?.source_vessel_operation_trailer_id),
            ].filter((value): value is string => Boolean(value)),
          ),
        );

        const { data: sourceRows, error: sourceError } = sourceIds.length
          ? await supabase.from("vessel_operation_trailers").select("id, ownership_type, trailer_source, external_company").in("id", sourceIds)
          : { data: [], error: null };
        if (sourceError) throw sourceError;
        const sourceMap = new Map((sourceRows ?? []).map((row) => [row.id, row as HistoricalOwnershipSnapshot & { id: string }]));

        const nextEvents: OperationalSummaryEvent[] = [];

        for (const row of vesselRows ?? []) {
          const operation = operations.get(row.vessel_operation_id);
          const mapped = mapArrivalEvent({
            ...row,
            vessel_name: operation?.vessel_name ?? null,
            origin_port: operation?.origin_port ?? null,
          });
          if (mapped) nextEvents.push(mapped);
        }

        for (const row of departureList) {
          const source = sourceMap.get(row.source_vessel_operation_trailer_id as string);
          const mapped = mapDepartureEvent({
            id: row.id as string,
            trailer_number: row.trailer_number as string | null,
            departure_date: row.departure_date as string | null,
            departure_time: row.departure_time as string | null,
            customer: row.customer as string | null,
            load_status: row.load_status as string | null,
            notes: row.notes as string | null,
            operational_status: row.operational_status as string | null,
            ownership_type: source?.ownership_type ?? null,
            trailer_source: (row.trailer_source as string | null) ?? source?.trailer_source ?? null,
            external_company: (row.external_company as string | null) ?? source?.external_company ?? null,
            is_local: row.is_local as boolean | null,
          });
          if (mapped) nextEvents.push(mapped);
        }

        for (const row of bookingList) {
          const trailer = row.trailers as { trailer_number?: string | null; trailer_source?: string | null; external_company?: string | null; is_local?: boolean | null; source_vessel_operation_trailer_id?: string | null } | null;
          const source = trailer?.source_vessel_operation_trailer_id ? sourceMap.get(trailer.source_vessel_operation_trailer_id) : null;
          const ownershipType = resolveHistoricalOwnership({
            sourceSnapshot: source ?? {
              ownership_type: null,
              trailer_source: trailer?.trailer_source,
              external_company: trailer?.external_company,
              is_local: trailer?.is_local,
            },
          });
          const shared = {
            id: row.id as string,
            trailer_number: trailer?.trailer_number ?? null,
            customer: row.customer as string | null,
            booking_reference: row.booking_reference as string | null,
            status: row.status as string | null,
            notes: row.notes as string | null,
            driver_name: (row.driver as { display_name?: string | null } | null)?.display_name ?? null,
            ownership_type: ownershipType,
            trailer_source: trailer?.trailer_source ?? source?.trailer_source ?? null,
            external_company: trailer?.external_company ?? source?.external_company ?? null,
            is_local: trailer?.is_local ?? null,
          };

          const delivery = mapDeliveryEvent({
            ...shared,
            delivery_location: row.delivery_location as string | null,
            delivered_at: row.delivered_at as string | null,
          });
          if (delivery) nextEvents.push(delivery);

          const collection = mapDeliveryCollectionEvent({
            ...shared,
            collected_at: row.collected_at as string | null,
          });
          if (collection) nextEvents.push(collection);
        }

        for (const row of exportList) {
          const trailer = exportTrailerMap.get(row.trailer_id as string);
          const source = trailer?.source_vessel_operation_trailer_id ? sourceMap.get(trailer.source_vessel_operation_trailer_id) : null;
          const mapped = mapExportCollectionEvent({
            id: row.id as string,
            trailer_number: row.trailer_number as string | null,
            customer: row.customer as string | null,
            booking_reference: row.booking_reference as string | null,
            haulier: row.haulier as string | null,
            status: row.status as string | null,
            collected_loaded_at: row.collected_loaded_at as string | null,
            cancelled_at: row.cancelled_at as string | null,
            notes: row.notes as string | null,
            ownership_type: source?.ownership_type ?? null,
            trailer_source: trailer?.trailer_source ?? source?.trailer_source ?? null,
            external_company: trailer?.external_company ?? source?.external_company ?? null,
            is_local: trailer?.is_local ?? null,
          });
          if (mapped) nextEvents.push(mapped);
        }

        setEvents(nextEvents);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load operational summary.");
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, []);

  const updateUrl = (updates: Partial<{
    range: HistoryDateRangeValue;
    ownership: OwnershipFilter;
    movementType: "all" | OperationalSummaryMovementType;
    customer: string;
    haulier: string;
    search: string;
  }>) => {
    const params = new URLSearchParams(window.location.search);
    const nextRange = updates.range ?? range;
    params.set("history", nextRange.preset);
    if (nextRange.preset === "custom") {
      params.set("start", nextRange.startDate);
      params.set("end", nextRange.endDate);
    } else {
      params.delete("start");
      params.delete("end");
    }

    const nextOwnership = updates.ownership ?? ownership;
    if (nextOwnership === "all") params.delete("ownership");
    else params.set("ownership", nextOwnership);

    const nextMovement = updates.movementType ?? movementType;
    if (nextMovement === "all") params.delete("type");
    else params.set("type", nextMovement);

    const nextCustomer = updates.customer ?? customer;
    if (nextCustomer.trim()) params.set("customer", nextCustomer.trim());
    else params.delete("customer");

    const nextHaulier = updates.haulier ?? haulier;
    if (nextHaulier.trim()) params.set("haulier", nextHaulier.trim());
    else params.delete("haulier");

    const nextSearch = updates.search ?? search;
    if (nextSearch.trim()) params.set("search", nextSearch.trim());
    else params.delete("search");

    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  };

  const summary = useMemo(
    () =>
      buildOperationalSummary(events, {
        range,
        ownership,
        movementType,
        customer,
        haulier,
        search,
      }),
    [events, range, ownership, movementType, customer, haulier, search],
  );

  const customers = useMemo(() => uniqueSortedNames(events, "customer"), [events]);
  const hauliers = useMemo(() => uniqueSortedNames(events, "haulier"), [events]);
  const printAt = new Date().toLocaleString("en-GB");
  const periodLabel = getHistoryDateRangeLabel(range);
  const drillEvents = drillDown ? eventsForKpi(summary.events, drillDown) : summary.events;
  const maxDaily = Math.max(1, ...summary.dailyRows.map((row) => row.arrivals + row.departures + row.deliveries + row.collections));

  const openKpi = (key: KpiKey, nextMovement: "all" | OperationalSummaryMovementType) => {
    setDrillDown(key);
    setMovementType(nextMovement);
    updateUrl({ movementType: nextMovement });
    document.getElementById("operational-summary-records")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const clearFilters = () => {
    const next = createHistoryDateRange("last_7_days");
    setRange(next);
    setOwnership("all");
    setMovementType("all");
    setCustomer("");
    setHaulier("");
    setSearch("");
    setDrillDown(null);
    window.history.replaceState({}, "", window.location.pathname);
  };

  const kpiCards: Array<{ key: KpiKey | "total"; label: string; value: number; hint: string; onClick?: () => void }> = [
    { key: "arrivals", label: "Received / Arrivals", value: summary.kpis.arrivals, hint: "Confirmed reception", onClick: () => openKpi("arrivals", "arrival") },
    { key: "departures", label: "Departures", value: summary.kpis.departures, hint: "Recorded departures", onClick: () => openKpi("departures", "departure") },
    { key: "deliveries", label: "Deliveries", value: summary.kpis.deliveries, hint: "Completed deliveries", onClick: () => openKpi("deliveries", "delivery") },
    { key: "collections", label: "Collections", value: summary.kpis.collections, hint: "Delivery + export collections", onClick: () => openKpi("collections", "collection") },
    { key: "outsourcings", label: "Outsourcings", value: summary.kpis.outsourcings, hint: summary.kpis.outsourcingPercent === null ? "Canonical ownership" : `${summary.kpis.outsourcingPercent}% of movements`, onClick: () => openKpi("outsourcings", "all") },
    { key: "total", label: "Total Movements", value: summary.kpis.totalMovements, hint: "Event count, not unique trailers" },
  ];

  return (
    <>
      <div className="screen-only bg-slate-950 px-4 pt-6 sm:px-6">
        <div className="mx-auto flex max-w-7xl justify-end">
          <PrintButton disabled={isLoading} />
        </div>
      </div>
      <main className="screen-only min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <header className="rounded-3xl border border-white/10 bg-slate-900/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400">Ferryspeed TrailerHub</p>
            <h1 className="mt-2 text-3xl font-semibold">Operational Summary</h1>
            <p className="mt-2 text-sm text-slate-300">Read-only view of completed operational movements. Default period is Last 7 Days.</p>
            <p className="mt-3 text-xs text-slate-400">{OPERATIONAL_SUMMARY_TOTAL_MOVEMENTS_DEFINITION}</p>
          </header>

          <section className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
            <div className="flex flex-wrap items-end gap-4">
              <HistoryDateRangeFilter value={range} onChange={(next) => { setRange(next); updateUrl({ range: next }); }} label="Period" />
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Movement
                <select
                  value={movementType}
                  onChange={(event) => {
                    const value = event.target.value as typeof movementType;
                    setMovementType(value);
                    setDrillDown(null);
                    updateUrl({ movementType: value });
                  }}
                  className="mt-2 block h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white"
                >
                  <option value="all">All movements</option>
                  <option value="arrival">Arrivals</option>
                  <option value="departure">Departures</option>
                  <option value="delivery">Deliveries</option>
                  <option value="collection">Collections</option>
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Ownership
                <select
                  value={ownership}
                  onChange={(event) => {
                    const value = event.target.value as OwnershipFilter;
                    setOwnership(value);
                    updateUrl({ ownership: value });
                  }}
                  className="mt-2 block h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white"
                >
                  <option value="all">All</option>
                  <option value="company">Ferryspeed / Own</option>
                  <option value="outsourcing">Outsourced / Third Party</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Customer
                <select
                  value={customer}
                  onChange={(event) => {
                    setCustomer(event.target.value);
                    updateUrl({ customer: event.target.value });
                  }}
                  className="mt-2 block h-11 min-w-[12rem] rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white"
                >
                  <option value="">All customers</option>
                  {customers.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Haulier
                <select
                  value={haulier}
                  onChange={(event) => {
                    setHaulier(event.target.value);
                    updateUrl({ haulier: event.target.value });
                  }}
                  className="mt-2 block h-11 min-w-[12rem] rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white"
                >
                  <option value="">All hauliers</option>
                  {hauliers.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Search
                <input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    updateUrl({ search: event.target.value });
                  }}
                  placeholder="Trailer or reference"
                  className="mt-2 block h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white"
                />
              </label>
              <button type="button" onClick={clearFilters} className="h-11 rounded-xl border border-white/10 bg-slate-800 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-white">
                Clear Filters
              </button>
            </div>
          </section>

          {error ? <p className="rounded-xl border border-rose-300 bg-rose-950/40 p-3 text-sm text-rose-200">Unable to load operational summary. Please try again.</p> : null}
          {isLoading ? <p className="rounded-xl bg-slate-900 p-4 text-sm text-slate-300">Loading operational summary...</p> : null}

          {!isLoading ? (
            <>
              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {kpiCards.map((card) => (
                  card.onClick ? (
                    <button
                      key={card.key}
                      type="button"
                      onClick={card.onClick}
                      className={`rounded-2xl border bg-slate-900 p-4 text-left transition hover:border-cyan-400/60 ${drillDown === card.key ? "border-cyan-400" : "border-white/10"}`}
                    >
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">{card.label}</p>
                      <p className="mt-2 text-3xl font-bold text-white">{card.value}</p>
                      <p className="mt-1 text-xs text-slate-500">{card.hint}</p>
                    </button>
                  ) : (
                    <article key={card.key} className="rounded-2xl border border-white/10 bg-slate-900 p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">{card.label}</p>
                      <p className="mt-2 text-3xl font-bold text-white">{card.value}</p>
                      <p className="mt-1 text-xs text-slate-500">{card.hint}</p>
                    </article>
                  )
                ))}
              </section>

              <section className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-white/10 text-xs uppercase text-slate-400">
                    <tr>
                      <th className="p-3">Date</th>
                      <th className="p-3">Arrivals</th>
                      <th className="p-3">Departures</th>
                      <th className="p-3">Deliveries</th>
                      <th className="p-3">Collections</th>
                      <th className="p-3">Outsourced</th>
                      <th className="p-3">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.dailyRows.map((row) => {
                      const volume = row.arrivals + row.departures + row.deliveries + row.collections;
                      return (
                        <tr key={row.dateKey} className="border-b border-white/5">
                          <td className="p-3 font-semibold">{row.label}</td>
                          <td className="p-3">{row.arrivals}</td>
                          <td className="p-3">{row.departures}</td>
                          <td className="p-3">{row.deliveries}</td>
                          <td className="p-3">{row.collections}</td>
                          <td className="p-3">{row.outsourcings}</td>
                          <td className="p-3">
                            <div className="h-2 w-24 rounded-full bg-slate-800">
                              <div className="h-2 rounded-full bg-cyan-400" style={{ width: `${Math.round((volume / maxDaily) * 100)}%` }} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-slate-950/80 font-semibold">
                      <td className="p-3">{summary.dailyTotal.label}</td>
                      <td className="p-3">{summary.dailyTotal.arrivals}</td>
                      <td className="p-3">{summary.dailyTotal.departures}</td>
                      <td className="p-3">{summary.dailyTotal.deliveries}</td>
                      <td className="p-3">{summary.dailyTotal.collections}</td>
                      <td className="p-3">{summary.dailyTotal.outsourcings}</td>
                      <td className="p-3">{summary.kpis.totalMovements}</td>
                    </tr>
                  </tbody>
                </table>
              </section>

              <section className="grid gap-4 lg:grid-cols-3">
                <article className="rounded-2xl border border-white/10 bg-slate-900 p-4">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Ownership</h2>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between"><dt>Ferryspeed / Own</dt><dd className="font-semibold">{summary.ownershipBreakdown.company}</dd></div>
                    <div className="flex justify-between"><dt>Outsourced / Third Party</dt><dd className="font-semibold">{summary.ownershipBreakdown.outsourcing}</dd></div>
                    <div className="flex justify-between"><dt>Unknown</dt><dd className="font-semibold">{summary.ownershipBreakdown.unknown}</dd></div>
                  </dl>
                </article>
                <article className="rounded-2xl border border-white/10 bg-slate-900 p-4">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Top customers</h2>
                  {summary.customerBreakdown.length === 0 ? <p className="mt-3 text-sm text-slate-500">No customer activity in this period.</p> : (
                    <ul className="mt-3 space-y-2 text-sm">
                      {summary.customerBreakdown.map((row) => (
                        <li key={row.name} className="flex justify-between"><span>{row.name}</span><span className="font-semibold">{row.count}</span></li>
                      ))}
                    </ul>
                  )}
                </article>
                <article className="rounded-2xl border border-white/10 bg-slate-900 p-4">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Hauliers</h2>
                  {summary.haulierBreakdown.length === 0 ? <p className="mt-3 text-sm text-slate-500">No haulier names recorded for this period.</p> : (
                    <ul className="mt-3 space-y-2 text-sm">
                      {summary.haulierBreakdown.map((row) => (
                        <li key={row.name} className="flex justify-between"><span>{row.name}</span><span className="font-semibold">{row.count}</span></li>
                      ))}
                    </ul>
                  )}
                </article>
              </section>

              <section id="operational-summary-records" className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">
                      {drillDown === "arrivals" ? "Arrivals" : drillDown === "departures" ? "Departures" : drillDown === "deliveries" ? "Deliveries" : drillDown === "collections" ? "Collections" : drillDown === "outsourcings" ? "Outsourced movements" : "Movement records"}
                    </h2>
                    <p className="text-sm text-slate-400">{drillEvents.length} record{drillEvents.length === 1 ? "" : "s"} behind the selected total.</p>
                  </div>
                  <Link href="/dashboard/reports/stopped-trailers" className="text-sm font-semibold text-cyan-300 hover:underline">
                    Trailers stopped &gt;3 days →
                  </Link>
                </div>
                {drillEvents.length === 0 ? (
                  <p className="rounded-xl bg-slate-900 p-4 text-sm text-slate-300">No records found for the selected filters.</p>
                ) : (
                  <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900">
                    <table className="min-w-full text-left text-sm">
                      <thead className="border-b border-white/10 text-xs uppercase text-slate-400">
                        <tr>
                          <th className="p-3">Trailer</th>
                          <th className="p-3">When</th>
                          <th className="p-3">Type</th>
                          <th className="p-3">Ownership</th>
                          <th className="p-3">Customer</th>
                          <th className="p-3">Haulier</th>
                          <th className="p-3">Reference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drillEvents.map((row) => (
                          <tr key={row.id} className="border-b border-white/5">
                            <td className="p-3 font-semibold">{row.trailerNumber ?? "-"}</td>
                            <td className="p-3">{formatDateTime(row.occurredAt)}</td>
                            <td className="p-3">{movementLabel(row.movementType)}{row.collectionSource === "export" ? " (export)" : ""}</td>
                            <td className="p-3">{getTrailerOwnershipBadgeLabel(row.ownershipType)}</td>
                            <td className="p-3">{row.customer ?? "-"}</td>
                            <td className="p-3">{row.haulier ?? "-"}</td>
                            <td className="p-3">{row.reference ?? row.sourceOrDestination ?? "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </main>
      <div className="print-only">
        <PrintReportLayout orientation="landscape">
          <PrintHeader title="OPERATIONAL SUMMARY" subtitle={periodLabel} printedAt={printAt} totalRecords={summary.kpis.totalMovements}>
            <PrintFilters
              items={[
                { label: "Period", value: periodLabel },
                { label: "Movement", value: movementType },
                { label: "Ownership", value: ownership },
                { label: "Customer", value: customer || "All" },
                { label: "Haulier", value: haulier || "All" },
                { label: "Search", value: search || "All records" },
              ]}
            />
          </PrintHeader>
          <PrintSummary
            items={[
              { label: "Arrivals", value: summary.kpis.arrivals },
              { label: "Departures", value: summary.kpis.departures },
              { label: "Deliveries", value: summary.kpis.deliveries },
              { label: "Collections", value: summary.kpis.collections },
              { label: "Outsourcings", value: summary.kpis.outsourcings },
              { label: "Total Movements", value: summary.kpis.totalMovements },
            ]}
          />
          <PrintTable
            rows={[...summary.dailyRows, summary.dailyTotal]}
            columns={[
              { key: "date", header: "Date", render: (row) => row.label },
              { key: "arrivals", header: "Arrivals", render: (row) => row.arrivals },
              { key: "departures", header: "Departures", render: (row) => row.departures },
              { key: "deliveries", header: "Deliveries", render: (row) => row.deliveries },
              { key: "collections", header: "Collections", render: (row) => row.collections },
              { key: "outsourced", header: "Outsourced", render: (row) => row.outsourcings },
            ]}
          />
          <div className="avoid-page-break mt-4">
            <PrintTable
              rows={[
                { name: "Ferryspeed / Own", count: summary.ownershipBreakdown.company },
                { name: "Outsourced / Third Party", count: summary.ownershipBreakdown.outsourcing },
                { name: "Unknown", count: summary.ownershipBreakdown.unknown },
                ...summary.customerBreakdown.map((row) => ({ name: `Customer: ${row.name}`, count: row.count })),
                ...summary.haulierBreakdown.map((row) => ({ name: `Haulier: ${row.name}`, count: row.count })),
              ]}
              columns={[
                { key: "name", header: "Ownership / customer / haulier", render: (row) => row.name },
                { key: "count", header: "Movements", render: (row) => row.count },
              ]}
            />
          </div>
          <PrintFooter />
        </PrintReportLayout>
      </div>
    </>
  );
}
