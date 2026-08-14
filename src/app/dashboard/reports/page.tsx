"use client";

import Link from "next/link";

const reports = [
  { title: "Export Operations Report", description: "Filter export allocations by period, customers, status, priority, and haulier.", href: "/dashboard/export-operations" },
  { title: "Arrivals Report", description: "Review confirmed vessel arrivals with ownership and vessel context.", href: "/dashboard/arrivals" },
  { title: "Departures Report", description: "Review recorded trailer departures by period and ownership.", href: "/dashboard/departures" },
  { title: "Deliveries Report", description: "Review delivery bookings and lifecycle status history.", href: "/dashboard/deliveries/history" },
  { title: "Collections Report", description: "Review pending and collected work with aging visibility.", href: "/dashboard/collections" },
  { title: "Compound Snapshot", description: "View the current read-only Compound state.", href: "/dashboard/compound/snapshot" },
  { title: "Compound Activity", description: "Review recorded Compound movements and stock-check events.", href: "/dashboard/compound/history" },
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
