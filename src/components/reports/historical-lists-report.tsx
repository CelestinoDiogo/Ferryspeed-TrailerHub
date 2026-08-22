"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
import { buildCsv, downloadCsv, historicalCsvFileName } from "@/lib/reports/csv-export";
import {
  buildHistoricalListTotals,
  compoundEventTypeOptions,
  filterHistoricalListRecords,
  formatHistoricalDateTime,
  historicalCsvHeaders,
  historicalCsvRow,
  historicalCsvType,
  historicalListKindLabel,
  isCompoundSnapshotKind,
  parseHistoricalListKind,
  uniqueHistoricalNames,
  HISTORICAL_TIMESTAMP_SEMANTICS,
  type HistoricalListFilters,
  type HistoricalListKind,
  type HistoricalListRecord,
} from "@/lib/reports/historical-lists";
import { loadHistoricalListRecords } from "@/lib/reports/historical-lists-query";
import { supabase } from "@/lib/supabase";
import { getTrailerOwnershipBadgeLabel, type TrailerOwnershipType } from "@/lib/trailer-ownership";

type HistoricalListsReportProps = {
  lockedType?: HistoricalListKind;
};

const MOVEMENT_TABS: Array<{ kind: HistoricalListKind; label: string }> = [
  { kind: "arrivals", label: "Arrivals" },
  { kind: "departures", label: "Departures" },
  { kind: "deliveries", label: "Deliveries" },
  { kind: "collections", label: "Collections" },
  { kind: "compound_events", label: "Compound" },
];

const readState = (lockedType?: HistoricalListKind) => {
  if (typeof window === "undefined") {
    return {
      kind: lockedType ?? "arrivals",
      range: createHistoryDateRange("last_7_days"),
      ownership: "all" as const,
      customers: [] as string[],
      search: "",
      haulier: "",
      vessel: "",
      collectionSource: "all" as const,
      eventType: "all",
    };
  }

  const params = new URLSearchParams(window.location.search);
  const preset = normalizeHistoryPreset(params.get("history") ?? "last_7_days");
  const ownershipValue = params.get("ownership");

  return {
    kind: lockedType ?? parseHistoricalListKind(params.get("type")),
    range:
      preset === "custom"
        ? { preset, startDate: params.get("start") ?? "", endDate: params.get("end") ?? "" }
        : createHistoryDateRange(preset),
    ownership:
      ownershipValue === "company" || ownershipValue === "outsourcing" || ownershipValue === "unknown"
        ? ownershipValue
        : "all",
    customers: params.getAll("customer").map((value) => value.trim()).filter(Boolean),
    search: params.get("search") ?? "",
    haulier: params.get("haulier") ?? "",
    vessel: params.get("vessel") ?? "",
    collectionSource: params.get("source") === "delivery" || params.get("source") === "export" ? (params.get("source") as "delivery" | "export") : "all",
    eventType: params.get("event") ?? "all",
  } as const;
};

const dash = (value?: string | null) => (value && value.trim() ? value : "—");

export function HistoricalListsReport({ lockedType }: HistoricalListsReportProps) {
  const initial = readState(lockedType);
  const [kind, setKind] = useState<HistoricalListKind>(initial.kind);
  const [range, setRange] = useState<HistoryDateRangeValue>(initial.range);
  const [ownership, setOwnership] = useState<"all" | TrailerOwnershipType>(initial.ownership);
  const [customers, setCustomers] = useState<string[]>([...initial.customers]);
  const [search, setSearch] = useState(initial.search);
  const [haulier, setHaulier] = useState(initial.haulier);
  const [vessel, setVessel] = useState(initial.vessel);
  const [collectionSource, setCollectionSource] = useState<"all" | "delivery" | "export">(initial.collectionSource);
  const [eventType, setEventType] = useState(initial.eventType);
  const [records, setRecords] = useState<HistoricalListRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filters: HistoricalListFilters = useMemo(
    () => ({
      range,
      customers,
      ownership,
      search,
      haulier,
      vessel,
      collectionSource,
      eventType,
    }),
    [range, customers, ownership, search, haulier, vessel, collectionSource, eventType],
  );

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        setRecords(await loadHistoricalListRecords(supabase, kind, range));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load historical report.");
        setRecords([]);
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [kind, range]);

  const filtered = useMemo(() => filterHistoricalListRecords(records, filters), [records, filters]);
  const totals = useMemo(() => buildHistoricalListTotals(filtered), [filtered]);
  const customerOptions = useMemo(() => uniqueHistoricalNames(records, "customer"), [records]);
  const haulierOptions = useMemo(() => uniqueHistoricalNames(records, "haulier"), [records]);
  const vesselOptions = useMemo(() => uniqueHistoricalNames(records, "vesselName"), [records]);
  const title = historicalListKindLabel(kind);
  const printAt = formatHistoricalDateTime(new Date().toISOString());
  const snapshotMode = isCompoundSnapshotKind(kind);

  const updateUrl = (next: {
    kind?: HistoricalListKind;
    range?: HistoryDateRangeValue;
    ownership?: typeof ownership;
    customers?: string[];
    search?: string;
    haulier?: string;
    vessel?: string;
    collectionSource?: typeof collectionSource;
    eventType?: string;
  }) => {
    const params = new URLSearchParams();
    const nextKind = next.kind ?? kind;
    const nextRange = next.range ?? range;
    if (!lockedType) {
      params.set("type", nextKind);
    }
    params.set("history", nextRange.preset);
    if (nextRange.preset === "custom") {
      params.set("start", nextRange.startDate);
      params.set("end", nextRange.endDate);
    }
    const nextOwnership = next.ownership ?? ownership;
    if (nextOwnership !== "all") {
      params.set("ownership", nextOwnership);
    }
    (next.customers ?? customers).forEach((customer) => params.append("customer", customer));
    const nextSearch = next.search ?? search;
    if (nextSearch.trim()) {
      params.set("search", nextSearch.trim());
    }
    const nextHaulier = next.haulier ?? haulier;
    if (nextHaulier) {
      params.set("haulier", nextHaulier);
    }
    const nextVessel = next.vessel ?? vessel;
    if (nextVessel) {
      params.set("vessel", nextVessel);
    }
    const nextSource = next.collectionSource ?? collectionSource;
    if (nextSource !== "all") {
      params.set("source", nextSource);
    }
    const nextEvent = next.eventType ?? eventType;
    if (nextEvent !== "all") {
      params.set("event", nextEvent);
    }
    const query = params.toString();
    window.history.replaceState({}, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
  };

  const clearFilters = () => {
    const nextRange = createHistoryDateRange("last_7_days");
    setRange(nextRange);
    setOwnership("all");
    setCustomers([]);
    setSearch("");
    setHaulier("");
    setVessel("");
    setCollectionSource("all");
    setEventType("all");
    updateUrl({
      range: nextRange,
      ownership: "all",
      customers: [],
      search: "",
      haulier: "",
      vessel: "",
      collectionSource: "all",
      eventType: "all",
    });
  };

  const handleCsv = () => {
    const csv = buildCsv(historicalCsvHeaders(kind), filtered.map(historicalCsvRow));
    downloadCsv(historicalCsvFileName(historicalCsvType(kind), range.endDate || new Date().toISOString().slice(0, 10)), csv);
  };

  const printFilters = [
    { label: "Report", value: title },
    { label: "Period", value: snapshotMode ? "Current snapshot" : getHistoryDateRangeLabel(range) },
    { label: "Ownership", value: ownership === "all" ? "All" : getTrailerOwnershipBadgeLabel(ownership) },
    { label: "Customers", value: customers.length > 0 ? customers.join(", ") : "All" },
    { label: "Search", value: search.trim() || "All records" },
    ...(haulier ? [{ label: "Haulier", value: haulier }] : []),
    ...(vessel ? [{ label: "Vessel", value: vessel }] : []),
    ...(kind === "collections" && collectionSource !== "all" ? [{ label: "Source", value: collectionSource === "export" ? "Export" : "Delivery" }] : []),
    ...(kind === "compound_events" && eventType !== "all" ? [{ label: "Event", value: eventType }] : []),
  ];

  const tableColumns = columnsForKind(kind);

  return (
    <>
      <div className="screen-only bg-slate-950 px-4 pt-6 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={handleCsv}
            disabled={isLoading || filtered.length === 0}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download CSV
          </button>
          <PrintButton disabled={isLoading || filtered.length === 0} />
        </div>
      </div>

      <main className="screen-only min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <header className="rounded-3xl border border-white/10 bg-slate-900/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400">Historical Reports</p>
            <h1 className="mt-2 text-3xl font-semibold">{title}</h1>
            <p className="mt-2 text-sm text-slate-300">Read-only historical records. Counts always match the filtered list below.</p>
            <p className="mt-2 text-xs text-slate-500">{HISTORICAL_TIMESTAMP_SEMANTICS[kind]}</p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <Link href="/dashboard/reports" className="text-cyan-300 hover:underline">Reports hub</Link>
              <Link href="/dashboard/reports/operational-summary" className="text-cyan-300 hover:underline">Operational Summary</Link>
              <Link href="/dashboard/reports/stopped-trailers" className="text-cyan-300 hover:underline">Stopped &gt;3 Days</Link>
            </div>
          </header>

          {!lockedType ? (
            <nav className="flex flex-wrap gap-2">
              {MOVEMENT_TABS.map((tab) => {
                const active = tab.kind === "compound_events" ? kind === "compound_events" || kind === "compound_snapshot" : kind === tab.kind;
                const nextKind = tab.kind === "compound_events" && kind === "compound_snapshot" ? "compound_snapshot" : tab.kind;
                return (
                  <button
                    key={tab.kind}
                    type="button"
                    onClick={() => {
                      setKind(nextKind);
                      updateUrl({ kind: nextKind });
                    }}
                    className={`rounded-full px-4 py-2 text-sm font-semibold ${active ? "bg-cyan-500 text-slate-950" : "border border-white/10 bg-slate-900 text-slate-200"}`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          ) : null}

          {kind === "compound_events" || kind === "compound_snapshot" ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setKind("compound_events");
                  updateUrl({ kind: "compound_events" });
                }}
                className={`rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] ${kind === "compound_events" ? "bg-cyan-500 text-slate-950" : "border border-white/10 bg-slate-900"}`}
              >
                Event history
              </button>
              <button
                type="button"
                onClick={() => {
                  setKind("compound_snapshot");
                  updateUrl({ kind: "compound_snapshot" });
                }}
                className={`rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] ${kind === "compound_snapshot" ? "bg-cyan-500 text-slate-950" : "border border-white/10 bg-slate-900"}`}
              >
                Current snapshot
              </button>
              <p className="self-center text-xs text-slate-400">
                {kind === "compound_snapshot"
                  ? "Snapshot is current Compound presence, not a reconstructed past date."
                  : "Event history uses recorded activity log events only."}
              </p>
            </div>
          ) : null}

          <section className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
            <div className="flex flex-wrap items-end gap-4">
              {!snapshotMode ? <HistoryDateRangeFilter value={range} onChange={(next) => { setRange(next); updateUrl({ range: next }); }} label="Period" /> : null}
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Ownership
                <select
                  value={ownership}
                  onChange={(event) => {
                    const value = event.target.value as typeof ownership;
                    setOwnership(value);
                    updateUrl({ ownership: value });
                  }}
                  className="mt-2 block h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white"
                >
                  <option value="all">All</option>
                  <option value="company">Own / Ferryspeed</option>
                  <option value="outsourcing">Outsourced</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              {kind !== "compound_events" ? (
                <fieldset className="min-w-[220px] text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <legend>Customers</legend>
                  <div className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-slate-950 p-2 text-sm font-normal normal-case tracking-normal text-white">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={customers.length === 0} onChange={() => { setCustomers([]); updateUrl({ customers: [] }); }} />
                      All customers
                    </label>
                    {customerOptions.map((customer) => (
                      <label key={customer} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={customers.includes(customer)}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...customers, customer]
                              : customers.filter((value) => value !== customer);
                            setCustomers(next);
                            updateUrl({ customers: next });
                          }}
                        />
                        {customer}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              {haulierOptions.length > 0 && (kind === "deliveries" || kind === "collections" || kind === "arrivals" || kind === "departures") ? (
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Haulier / provider
                  <select value={haulier} onChange={(event) => { setHaulier(event.target.value); updateUrl({ haulier: event.target.value }); }} className="mt-2 block h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white">
                    <option value="">All</option>
                    {haulierOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
              ) : null}
              {kind === "arrivals" ? (
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Vessel
                  <select value={vessel} onChange={(event) => { setVessel(event.target.value); updateUrl({ vessel: event.target.value }); }} className="mt-2 block h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white">
                    <option value="">All vessels</option>
                    {vesselOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
              ) : null}
              {kind === "collections" ? (
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Source
                  <select value={collectionSource} onChange={(event) => { const value = event.target.value as typeof collectionSource; setCollectionSource(value); updateUrl({ collectionSource: value }); }} className="mt-2 block h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white">
                    <option value="all">Delivery + Export</option>
                    <option value="delivery">Delivery</option>
                    <option value="export">Export</option>
                  </select>
                </label>
              ) : null}
              {kind === "compound_events" ? (
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Event
                  <select value={eventType} onChange={(event) => { setEventType(event.target.value); updateUrl({ eventType: event.target.value }); }} className="mt-2 block h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white">
                    <option value="all">All events</option>
                    {compoundEventTypeOptions.map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}
                  </select>
                </label>
              ) : null}
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Trailer search
                <input value={search} onChange={(event) => { setSearch(event.target.value); updateUrl({ search: event.target.value }); }} placeholder="Trailer or reference" className="mt-2 block h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white" />
              </label>
              <button type="button" onClick={clearFilters} className="h-11 rounded-xl border border-white/10 bg-slate-800 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-white">Clear Filters</button>
            </div>
          </section>

          {error ? <p className="rounded-xl border border-rose-300 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p> : null}
          {isLoading ? <p className="rounded-xl bg-slate-900 p-4 text-sm text-slate-300">Loading historical report...</p> : null}
          {!isLoading && filtered.length === 0 ? <p className="rounded-xl bg-slate-900 p-4 text-sm text-slate-300">No records found for the selected filters.</p> : null}

          {!isLoading && filtered.length > 0 ? (
            <>
              <section className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-2xl bg-slate-900 p-4">
                  <p className="text-xs uppercase text-slate-400">{title} records</p>
                  <p className="mt-2 text-2xl font-bold">{totals.records}</p>
                </div>
                <div className="rounded-2xl bg-slate-900 p-4">
                  <p className="text-xs uppercase text-slate-400">Own</p>
                  <p className="mt-2 text-2xl font-bold">{totals.company}</p>
                </div>
                <div className="rounded-2xl bg-slate-900 p-4">
                  <p className="text-xs uppercase text-slate-400">Outsourced</p>
                  <p className="mt-2 text-2xl font-bold">{totals.outsourcing}</p>
                </div>
                <div className="rounded-2xl bg-slate-900 p-4">
                  <p className="text-xs uppercase text-slate-400">Unknown</p>
                  <p className="mt-2 text-2xl font-bold">{totals.unknown}</p>
                </div>
              </section>

              <div className="grid gap-3 md:hidden">
                {filtered.map((row) => (
                  <article key={row.id} className="rounded-2xl border border-white/10 bg-slate-900 p-4 text-sm">
                    <p className="font-semibold">{row.trailerNumber ?? "—"}</p>
                    <p className="mt-1 text-slate-400">{formatHistoricalDateTime(row.occurredAt)}</p>
                    <p className="mt-1">{getTrailerOwnershipBadgeLabel(row.ownershipType)} · {dash(row.customer)}</p>
                  </article>
                ))}
              </div>

              <div className="hidden overflow-x-auto rounded-2xl border border-white/10 bg-slate-900 md:block">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-white/10 text-xs uppercase text-slate-400">
                    <tr>
                      {tableColumns.map((column) => (
                        <th key={column.key} className="p-3">{column.header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.id} className="border-b border-white/5">
                        {tableColumns.map((column) => (
                          <td key={column.key} className="p-3">{column.render(row)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      </main>

      <div className="print-only">
        <PrintReportLayout orientation="landscape">
          <PrintHeader title={title.toUpperCase()} printedAt={printAt} totalRecords={filtered.length}>
            <PrintFilters items={printFilters} />
          </PrintHeader>
          <PrintSummary
            items={[
              { label: "Records", value: totals.records },
              { label: "Own", value: totals.company },
              { label: "Outsourced", value: totals.outsourcing },
              { label: "Unknown", value: totals.unknown },
            ]}
          />
          <PrintTable rows={filtered} columns={tableColumns} />
          <PrintFooter />
        </PrintReportLayout>
      </div>
    </>
  );
}

const columnsForKind = (kind: HistoricalListKind) => {
  if (kind === "arrivals") {
    return [
      { key: "when", header: "Date/Time", render: (row: HistoricalListRecord) => formatHistoricalDateTime(row.occurredAt) },
      { key: "trailer", header: "Trailer", render: (row: HistoricalListRecord) => dash(row.trailerNumber) },
      { key: "vessel", header: "Vessel", render: (row: HistoricalListRecord) => dash(row.vesselName) },
      { key: "customer", header: "Customer", render: (row: HistoricalListRecord) => dash(row.customer) },
      { key: "ownership", header: "Ownership", render: (row: HistoricalListRecord) => getTrailerOwnershipBadgeLabel(row.ownershipType) },
      { key: "provider", header: "Provider", render: (row: HistoricalListRecord) => dash(row.haulier) },
      { key: "discharged", header: "Discharged At", render: (row: HistoricalListRecord) => formatHistoricalDateTime(row.dischargedAt) },
      { key: "reception", header: "Reception/Arrival At", render: (row: HistoricalListRecord) => formatHistoricalDateTime(row.receptionAt) },
      { key: "position", header: "Position", render: (row: HistoricalListRecord) => dash(row.position) },
      { key: "notes", header: "Notes", render: (row: HistoricalListRecord) => dash(row.notes) },
    ];
  }
  if (kind === "departures") {
    return [
      { key: "when", header: "Departure Date/Time", render: (row: HistoricalListRecord) => formatHistoricalDateTime(row.occurredAt) },
      { key: "trailer", header: "Trailer", render: (row: HistoricalListRecord) => dash(row.trailerNumber) },
      { key: "customer", header: "Customer", render: (row: HistoricalListRecord) => dash(row.customer) },
      { key: "reference", header: "Booking/reference", render: (row: HistoricalListRecord) => dash(row.bookingReference) },
      { key: "ownership", header: "Ownership", render: (row: HistoricalListRecord) => getTrailerOwnershipBadgeLabel(row.ownershipType) },
      { key: "provider", header: "Provider", render: (row: HistoricalListRecord) => dash(row.haulier) },
      { key: "load", header: "Load status", render: (row: HistoricalListRecord) => dash(row.loadStatus) },
      { key: "notes", header: "Notes", render: (row: HistoricalListRecord) => dash(row.notes) },
    ];
  }
  if (kind === "deliveries") {
    return [
      { key: "when", header: "Delivered At", render: (row: HistoricalListRecord) => formatHistoricalDateTime(row.occurredAt) },
      { key: "trailer", header: "Trailer", render: (row: HistoricalListRecord) => dash(row.trailerNumber) },
      { key: "customer", header: "Customer", render: (row: HistoricalListRecord) => dash(row.customer) },
      { key: "reference", header: "Booking/reference", render: (row: HistoricalListRecord) => dash(row.bookingReference) },
      { key: "haulier", header: "Haulier", render: (row: HistoricalListRecord) => dash(row.haulier) },
      { key: "ownership", header: "Ownership", render: (row: HistoricalListRecord) => getTrailerOwnershipBadgeLabel(row.ownershipType) },
      { key: "status", header: "Status", render: (row: HistoricalListRecord) => dash(row.status) },
      { key: "notes", header: "Notes", render: (row: HistoricalListRecord) => dash(row.notes) },
    ];
  }
  if (kind === "collections") {
    return [
      { key: "when", header: "Collected At", render: (row: HistoricalListRecord) => formatHistoricalDateTime(row.occurredAt) },
      { key: "trailer", header: "Trailer", render: (row: HistoricalListRecord) => dash(row.trailerNumber) },
      { key: "customer", header: "Customer", render: (row: HistoricalListRecord) => dash(row.customer) },
      { key: "source", header: "Source", render: (row: HistoricalListRecord) => row.collectionSource === "export" ? "Export" : "Delivery" },
      { key: "haulier", header: "Haulier", render: (row: HistoricalListRecord) => dash(row.haulier) },
      { key: "ownership", header: "Ownership", render: (row: HistoricalListRecord) => getTrailerOwnershipBadgeLabel(row.ownershipType) },
      { key: "reference", header: "Booking/reference", render: (row: HistoricalListRecord) => dash(row.bookingReference) },
      { key: "status", header: "Status", render: (row: HistoricalListRecord) => dash(row.status) },
    ];
  }
  if (kind === "compound_events") {
    return [
      { key: "when", header: "Date/Time", render: (row: HistoricalListRecord) => formatHistoricalDateTime(row.occurredAt) },
      { key: "trailer", header: "Trailer", render: (row: HistoricalListRecord) => dash(row.trailerNumber) },
      { key: "event", header: "Event", render: (row: HistoricalListRecord) => (row.eventType ?? "").replaceAll("_", " ") || "—" },
      { key: "ownership", header: "Ownership", render: (row: HistoricalListRecord) => getTrailerOwnershipBadgeLabel(row.ownershipType) },
      { key: "previous", header: "Previous position", render: (row: HistoricalListRecord) => dash(row.previousPosition) },
      { key: "next", header: "New position", render: (row: HistoricalListRecord) => dash(row.newPosition) },
      { key: "source", header: "Source", render: (row: HistoricalListRecord) => dash(row.sourceModule) },
      { key: "notes", header: "Description", render: (row: HistoricalListRecord) => dash(row.notes) },
    ];
  }
  return [
    { key: "trailer", header: "Trailer", render: (row: HistoricalListRecord) => dash(row.trailerNumber) },
    { key: "ownership", header: "Ownership", render: (row: HistoricalListRecord) => getTrailerOwnershipBadgeLabel(row.ownershipType) },
    { key: "position", header: "Position", render: (row: HistoricalListRecord) => dash(row.position) },
    { key: "load", header: "Load status", render: (row: HistoricalListRecord) => dash(row.loadStatus) },
    { key: "customer", header: "Customer", render: (row: HistoricalListRecord) => dash(row.customer) },
    { key: "status", header: "Current status", render: (row: HistoricalListRecord) => dash(row.status) },
    { key: "notes", header: "Notes", render: (row: HistoricalListRecord) => dash(row.notes) },
  ];
};
