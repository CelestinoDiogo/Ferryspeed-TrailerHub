"use client";

import { useEffect, useMemo, useState } from "react";
import { PrintButton } from "@/components/print/print-button";
import { PrintFilters } from "@/components/print/print-filters";
import { PrintFooter } from "@/components/print/print-footer";
import { PrintHeader } from "@/components/print/print-header";
import { PrintReportLayout } from "@/components/print/print-report-layout";
import { PrintSummary } from "@/components/print/print-summary";
import { PrintTable } from "@/components/print/print-table";
import { DELIVERY_BOOKING_RELEASE_STATUS_QUERY } from "@/lib/delivery-booking-availability";
import {
  buildActiveExportStatusByTrailerId,
  isExportAllocationActive,
  normalizeExportAllocationRecord,
  type ExportAllocationRecord,
} from "@/lib/export-allocation";
import {
  buildStoppedCompoundTrailers,
  filterStoppedCompoundTrailers,
  formatStoppedDuration,
  stoppedAgeBandLabel,
  type StoppedCompoundAgeBand,
  type StoppedCompoundLoadFilter,
  type StoppedCompoundTrailerRecord,
} from "@/lib/reports/stopped-compound-trailers";
import { supabase } from "@/lib/supabase";
import { getTrailerOwnershipBadgeLabel, type TrailerOwnershipType } from "@/lib/trailer-ownership";

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

const ageBandClass = (band: StoppedCompoundAgeBand) => {
  if (band === "critical") return "border-rose-400/40 bg-rose-950/30 text-rose-100";
  if (band === "warning") return "border-amber-400/40 bg-amber-950/30 text-amber-100";
  return "border-orange-400/40 bg-orange-950/20 text-orange-100";
};

export function StoppedTrailersReport() {
  const [records, setRecords] = useState<StoppedCompoundTrailerRecord[]>([]);
  const [ownership, setOwnership] = useState<"all" | TrailerOwnershipType>("all");
  const [load, setLoad] = useState<StoppedCompoundLoadFilter>("all");
  const [ageBand, setAgeBand] = useState<"all" | StoppedCompoundAgeBand>("all");
  const [customer, setCustomer] = useState("");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadRows = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [
          { data: trailerRows, error: trailerError },
          { data: exportRows, error: exportError },
          { data: bookingRows, error: bookingError },
          { data: activityRows, error: activityError },
        ] = await Promise.all([
          supabase
            .from("trailers")
            .select("id, trailer_number, compound_position, load_status, customer, trailer_source, external_company, is_local, arrival_date, created_at, departure_date, operational_status")
            .is("departure_date", null),
          supabase.from("export_allocations").select("id, trailer_id, status, booking_reference, haulier, customer"),
          supabase
            .from("delivery_bookings")
            .select("id, trailer_id, status, booking_reference, customer, delivery_location")
            .not("status", "in", DELIVERY_BOOKING_RELEASE_STATUS_QUERY),
          supabase
            .from("trailer_activity_log")
            .select("trailer_id, normalized_trailer_number, event_type, created_at")
            .in("event_type", ["compound_entered", "compound_position_changed", "arrived", "vessel_arrived"])
            .order("created_at", { ascending: true })
            .limit(5000),
        ]);

        if (trailerError) throw trailerError;
        if (exportError) throw exportError;
        if (bookingError) throw bookingError;
        if (activityError) throw activityError;

        const exportAllocations = ((exportRows ?? []) as ExportAllocationRecord[]).map((row) => normalizeExportAllocationRecord(row));
        const activeExportAllocations = exportAllocations.filter((item) => isExportAllocationActive(item.status));
        const exportStatusByTrailerId = buildActiveExportStatusByTrailerId(activeExportAllocations);

        const jobsByTrailerId = new Map<string, string>();
        for (const booking of bookingRows ?? []) {
          if (!booking.trailer_id || jobsByTrailerId.has(booking.trailer_id)) continue;
          jobsByTrailerId.set(
            booking.trailer_id,
            [booking.booking_reference, booking.customer, booking.delivery_location, booking.status]
              .filter(Boolean)
              .join(" · "),
          );
        }
        for (const allocation of activeExportAllocations) {
          if (!allocation.trailer_id || jobsByTrailerId.has(allocation.trailer_id)) continue;
          jobsByTrailerId.set(
            allocation.trailer_id,
            ["Export", allocation.booking_reference, allocation.customer, allocation.haulier, allocation.status]
              .filter(Boolean)
              .join(" · "),
          );
        }

        setRecords(
          buildStoppedCompoundTrailers(trailerRows ?? [], {
            exportStatusByTrailerId,
            activityRows: activityRows ?? [],
            jobsByTrailerId,
          }),
        );
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load stopped trailers.");
      } finally {
        setIsLoading(false);
      }
    };

    void loadRows();
  }, []);

  const filtered = useMemo(
    () => filterStoppedCompoundTrailers(records, { ownership, load, ageBand, customer, search }),
    [records, ownership, load, ageBand, customer, search],
  );
  const customers = useMemo(
    () => [...new Set(records.map((row) => (row.customer ?? "").trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
    [records],
  );
  const printAt = new Date().toLocaleString("en-GB");
  const attentionCount = filtered.filter((row) => row.ageBand === "attention").length;
  const warningCount = filtered.filter((row) => row.ageBand === "warning").length;
  const criticalCount = filtered.filter((row) => row.ageBand === "critical").length;

  const clearFilters = () => {
    setOwnership("all");
    setLoad("all");
    setAgeBand("all");
    setCustomer("");
    setSearch("");
  };

  return (
    <>
      <div className="screen-only bg-slate-950 px-4 pt-6 sm:px-6">
        <div className="mx-auto flex max-w-7xl justify-end">
          <PrintButton disabled={isLoading || filtered.length === 0} />
        </div>
      </div>
      <main className="screen-only min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <header className="rounded-3xl border border-white/10 bg-slate-900/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400">Ferryspeed TrailerHub</p>
            <h1 className="mt-2 text-3xl font-semibold">Trailers Stopped in Compound &gt;3 Days</h1>
            <p className="mt-2 text-sm text-slate-300">
              Live ageing list for trailers physically present in Compound. Threshold is more than 3 days from canonical arrival / Compound-entry time. This is separate from Mandatory Collection ageing.
            </p>
          </header>

          <section className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Ownership
                <select value={ownership} onChange={(event) => setOwnership(event.target.value as typeof ownership)} className="mt-2 block h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white">
                  <option value="all">All</option>
                  <option value="company">Ferryspeed / Own</option>
                  <option value="outsourcing">Outsourced / Third Party</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Load
                <select value={load} onChange={(event) => setLoad(event.target.value as StoppedCompoundLoadFilter)} className="mt-2 block h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white">
                  <option value="all">All</option>
                  <option value="loaded">Loaded</option>
                  <option value="empty">Empty</option>
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Age band
                <select value={ageBand} onChange={(event) => setAgeBand(event.target.value as typeof ageBand)} className="mt-2 block h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white">
                  <option value="all">All &gt;3 days</option>
                  <option value="attention">&gt;3–5 days</option>
                  <option value="warning">&gt;5–7 days</option>
                  <option value="critical">&gt;7 days</option>
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Customer
                <select value={customer} onChange={(event) => setCustomer(event.target.value)} className="mt-2 block h-11 min-w-[12rem] rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white">
                  <option value="">All customers</option>
                  {customers.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Trailer search
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Trailer, customer or position" className="mt-2 block h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm normal-case tracking-normal text-white" />
              </label>
              <button type="button" onClick={clearFilters} className="h-11 rounded-xl border border-white/10 bg-slate-800 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-white">
                Clear Filters
              </button>
            </div>
          </section>

          {error ? <p className="rounded-xl border border-rose-300 bg-rose-950/40 p-3 text-sm text-rose-200">Unable to load stopped trailers. Please try again.</p> : null}
          {isLoading ? <p className="rounded-xl bg-slate-900 p-4 text-sm text-slate-300">Loading stopped trailers...</p> : null}

          {!isLoading ? (
            <>
              <section className="grid gap-3 sm:grid-cols-4">
                <article className="rounded-2xl bg-slate-900 p-4"><p className="text-xs uppercase text-slate-400">Stopped &gt;3 days</p><p className="mt-2 text-2xl font-bold">{filtered.length}</p></article>
                <article className="rounded-2xl bg-slate-900 p-4"><p className="text-xs uppercase text-slate-400">Attention &gt;3–5d</p><p className="mt-2 text-2xl font-bold text-orange-300">{attentionCount}</p></article>
                <article className="rounded-2xl bg-slate-900 p-4"><p className="text-xs uppercase text-slate-400">Warning &gt;5–7d</p><p className="mt-2 text-2xl font-bold text-amber-300">{warningCount}</p></article>
                <article className="rounded-2xl bg-slate-900 p-4"><p className="text-xs uppercase text-slate-400">Critical &gt;7d</p><p className="mt-2 text-2xl font-bold text-rose-300">{criticalCount}</p></article>
              </section>

              {filtered.length === 0 ? (
                <p className="rounded-xl bg-slate-900 p-4 text-sm text-slate-300">No trailers currently stopped in Compound for more than 3 days.</p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-white/10 text-xs uppercase text-slate-400">
                      <tr>
                        <th className="p-3">Trailer No.</th>
                        <th className="p-3">Position</th>
                        <th className="p-3">Load Status</th>
                        <th className="p-3">Customer</th>
                        <th className="p-3">Ownership</th>
                        <th className="p-3">Arrival / Entry</th>
                        <th className="p-3">Days Stopped</th>
                        <th className="p-3">Reservation / Job</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((row) => (
                        <tr key={row.id} className={`border-b border-white/5 ${ageBandClass(row.ageBand)}`}>
                          <td className="p-3 font-semibold">{row.trailerNumber ?? "-"}</td>
                          <td className="p-3">{row.compoundPosition ?? "-"}</td>
                          <td className="p-3">{row.loadStatus ?? "-"}</td>
                          <td className="p-3">{row.customer ?? "-"}</td>
                          <td className="p-3">{getTrailerOwnershipBadgeLabel(row.ownershipType)}</td>
                          <td className="p-3">{formatDateTime(row.entryAt)}</td>
                          <td className="p-3 font-semibold">{formatStoppedDuration(row.daysStopped)} · {stoppedAgeBandLabel(row.ageBand)}</td>
                          <td className="p-3">{row.reservationLabel ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </div>
      </main>
      <div className="print-only">
        <PrintReportLayout orientation="landscape">
          <PrintHeader title="TRAILERS STOPPED IN COMPOUND >3 DAYS" printedAt={printAt} totalRecords={filtered.length}>
            <PrintFilters
              items={[
                { label: "Ownership", value: ownership },
                { label: "Load", value: load },
                { label: "Age band", value: ageBand === "all" ? "All >3 days" : stoppedAgeBandLabel(ageBand) },
                { label: "Customer", value: customer || "All" },
                { label: "Search", value: search || "All records" },
              ]}
            />
          </PrintHeader>
          <PrintSummary
            items={[
              { label: "Stopped >3 days", value: filtered.length },
              { label: "Attention", value: attentionCount },
              { label: "Warning", value: warningCount },
              { label: "Critical", value: criticalCount },
            ]}
          />
          <PrintTable
            rows={filtered}
            columns={[
              { key: "trailer", header: "Trailer", render: (row) => row.trailerNumber ?? "-" },
              { key: "position", header: "Position", render: (row) => row.compoundPosition ?? "-" },
              { key: "load", header: "Load Status", render: (row) => row.loadStatus ?? "-" },
              { key: "customer", header: "Customer", render: (row) => row.customer ?? "-" },
              { key: "ownership", header: "Ownership", render: (row) => getTrailerOwnershipBadgeLabel(row.ownershipType) },
              { key: "entry", header: "Arrival / Entry", render: (row) => formatDateTime(row.entryAt) },
              { key: "days", header: "Days Stopped", render: (row) => formatStoppedDuration(row.daysStopped) },
              { key: "job", header: "Reservation / Job", render: (row) => row.reservationLabel ?? "-" },
            ]}
          />
          <PrintFooter />
        </PrintReportLayout>
      </div>
    </>
  );
}
