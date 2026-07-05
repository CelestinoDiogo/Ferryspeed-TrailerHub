"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type DashboardStats = {
  totalTrailers: number;
  emptyTrailers: number;
  loadedTrailers: number;
  maintenanceTrailers: number;
  arrivalsToday: number;
  departuresToday: number;
  occupancy: number;
};

type TrailerRecord = {
  id: string;
  load_status?: string | null;
  arrival_date?: string | null;
  departure_date?: string | null;
};

const defaultStats: DashboardStats = {
  totalTrailers: 0,
  emptyTrailers: 0,
  loadedTrailers: 0,
  maintenanceTrailers: 0,
  arrivalsToday: 0,
  departuresToday: 0,
  occupancy: 0,
};

const COMPOUND_POSITIONS = 50;

const getDateKey = (value?: string | null) => {
  if (!value) {
    return null;
  }

  try {
    return new Date(value).toISOString().split("T")[0];
  } catch {
    return null;
  }
};

const actions = [
  { label: "New Arrival", href: "/dashboard/new-arrival", icon: "＋" },
  { label: "Departure", href: "/dashboard/departure", icon: "↗" },
  { label: "Search", href: "/dashboard/search", icon: "⌕" },
  { label: "Compound", href: "/dashboard/compound", icon: "◫" },
];

export function TrailerDashboard() {
  const searchParams = useSearchParams();
  const [stats, setStats] = useState<DashboardStats>(defaultStats);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const saved = searchParams.get("saved");

  useEffect(() => {
    if (saved === "1") {
      setNotice("Arrival saved successfully. Dashboard refreshed.");
    } else {
      setNotice(null);
    }
  }, [saved]);

  useEffect(() => {
    const loadStats = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error: supabaseError } = await supabase
          .from("trailers")
          .select("id, load_status, arrival_date, departure_date");

        if (supabaseError) {
          throw supabaseError;
        }

        const trailers = (data ?? []) as TrailerRecord[];
        console.log("[Dashboard] Fetched trailer rows", trailers);

        const todayKey = getDateKey(new Date().toISOString());
        const activeTrailers = trailers.filter((item) => {
          const departureDate = item.departure_date;
          return departureDate === null || departureDate === undefined || departureDate === "";
        });

        const normalizedLoadStatus = (value?: string | null) => value?.trim().toLowerCase();
        const emptyTrailers = activeTrailers.filter((item) => normalizedLoadStatus(item.load_status) === "empty").length;
        const loadedTrailers = activeTrailers.filter((item) => normalizedLoadStatus(item.load_status) === "loaded").length;
        const maintenanceTrailers = activeTrailers.length - emptyTrailers - loadedTrailers;
        const arrivalsToday = trailers.filter((item) => getDateKey(item.arrival_date) === todayKey).length;
        const departuresToday = trailers.filter((item) => getDateKey(item.departure_date) === todayKey).length;
        const activeCount = activeTrailers.length;
        const occupancy = Math.min(100, Math.round((activeCount / COMPOUND_POSITIONS) * 100));

        setStats({
          totalTrailers: activeCount,
          emptyTrailers,
          loadedTrailers,
          maintenanceTrailers,
          arrivalsToday,
          departuresToday,
          occupancy,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to load dashboard statistics.";
        setError(message);
        setStats(defaultStats);
      } finally {
        setIsLoading(false);
      }
    };

    void loadStats();
  }, [saved]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const statsCards = [
    { title: "Trailers in Compound", value: stats.totalTrailers.toString(), detail: "+2 vs yesterday", accent: "from-cyan-500 to-blue-600" },
    { title: "Empty Trailers", value: stats.emptyTrailers.toString(), detail: "Ready for dispatch", accent: "from-emerald-500 to-teal-600" },
    { title: "Loaded Trailers", value: stats.loadedTrailers.toString(), detail: "In transit or staging", accent: "from-amber-500 to-orange-600" },
    { title: "Today's Arrivals", value: stats.arrivalsToday.toString(), detail: "Scheduled before noon", accent: "from-violet-500 to-fuchsia-600" },
    { title: "Today's Departures", value: stats.departuresToday.toString(), detail: "Priority departures", accent: "from-rose-500 to-red-600" },
    { title: "Maintenance", value: stats.maintenanceTrailers.toString(), detail: "Needs attention", accent: "from-slate-600 to-slate-800" },
    { title: "Occupancy", value: `${stats.occupancy}%`, detail: "Capacity trending healthy", accent: "from-slate-600 to-slate-800" },
  ];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Operational control center</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300 sm:text-base">
                Monitor arrivals, departures, and trailer availability in real time with a clean overview built for fast decisions.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              {actions.map((action) => (
                <Link
                  key={action.label}
                  href={action.href}
                  className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-200 transition hover:bg-cyan-500/20"
                >
                  <span className="mr-2 text-base">{action.icon}</span>
                  {action.label}
                </Link>
              ))}
            </div>
          </div>
        </header>

        {notice ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {notice}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {statsCards.map((stat) => (
            <article key={stat.title} className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur">
              <div className={`h-1.5 w-20 rounded-full bg-gradient-to-r ${stat.accent}`} />
              <h2 className="mt-4 text-sm font-medium text-slate-300">{stat.title}</h2>
              <div className="mt-3 flex items-end justify-between gap-3">
                <p className="text-3xl font-semibold text-white">{isLoading ? "—" : stat.value}</p>
                <span className="text-sm text-slate-400">{stat.detail}</span>
              </div>
            </article>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
          <article className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Compound overview</p>
                <h2 className="mt-2 text-xl font-semibold text-white">Live trailer allocation</h2>
              </div>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-sm text-emerald-300">
                Stable
              </span>
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/80 p-4">
              <div className="flex items-center justify-between text-sm text-slate-400">
                <span>Occupancy</span>
                <span>{stats.occupancy}%</span>
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-600" style={{ width: `${Math.min(stats.occupancy, 100)}%` }} />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-slate-900/70 p-3">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Available</p>
                  <p className="mt-1 text-lg font-semibold text-white">{stats.emptyTrailers}</p>
                </div>
                <div className="rounded-2xl bg-slate-900/70 p-3">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">In use</p>
                  <p className="mt-1 text-lg font-semibold text-white">{stats.loadedTrailers}</p>
                </div>
                <div className="rounded-2xl bg-slate-900/70 p-3">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Maintenance</p>
                  <p className="mt-1 text-lg font-semibold text-white">{stats.maintenanceTrailers}</p>
                </div>
              </div>
            </div>
          </article>

          <article className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Today's focus</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Priority operations</h2>

            <div className="mt-6 space-y-3">
              {[
                { title: "Dock 3 inbound", detail: "2 trailers due in 30 mins" },
                { title: "Export load ready", detail: "1 loaded trailer awaiting dispatch" },
                { title: "Driver handoff", detail: "3 departures need confirmation" },
              ].map((item) => (
                <div key={item.title} className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
                  <p className="font-medium text-white">{item.title}</p>
                  <p className="mt-1 text-sm text-slate-400">{item.detail}</p>
                </div>
              ))}
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
