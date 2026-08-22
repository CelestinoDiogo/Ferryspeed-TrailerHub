"use client";

import Link from "next/link";

const reports = [
  { title: "Operational Summary", description: "Last 7 days arrivals, departures, deliveries, collections and outsourcing totals.", href: "/dashboard/reports/operational-summary" },
  { title: "Historical Reports", description: "Arrivals, departures, deliveries, collections and Compound history with shared filters, print and CSV.", href: "/dashboard/reports/historical" },
  { title: "Trailers Stopped >3 Days", description: "Daily ageing list of trailers physically stopped in Compound for more than 3 days.", href: "/dashboard/reports/stopped-trailers" },
  { title: "Export Operations Report", description: "Filter export allocations by period, customers, status, priority, and haulier.", href: "/dashboard/export-operations" },
  { title: "Arrivals History", description: "Confirmed vessel receptions. Discharge time is shown separately from arrival.", href: "/dashboard/reports/historical?type=arrivals" },
  { title: "Departures History", description: "Recorded trailer departures by period and ownership.", href: "/dashboard/reports/historical?type=departures" },
  { title: "Deliveries History", description: "Completed deliveries using delivered_at.", href: "/dashboard/reports/historical?type=deliveries" },
  { title: "Collections History", description: "Completed Delivery and Export collections, kept as distinct events.", href: "/dashboard/reports/historical?type=collections" },
  { title: "Compound History", description: "Recorded Compound event history, with a separate current snapshot view.", href: "/dashboard/reports/historical?type=compound_events" },
] as const;

export default function ReportsPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400">Ferryspeed TrailerHub</p>
          <h1 className="mt-2 text-3xl font-semibold">Reports</h1>
          <p className="mt-2 text-sm text-slate-300">Open a read-only operational report without preloading report data.</p>
        </header>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((report) => (
            <Link key={report.href} href={report.href} className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 transition hover:border-cyan-400/60 hover:bg-slate-900">
              <h2 className="text-lg font-semibold text-white">{report.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{report.description}</p>
              <span className="mt-4 inline-block text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Open report</span>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
