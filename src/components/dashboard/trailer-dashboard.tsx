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
  if (!value) return null;

  try {
    return new Date(value).toISOString().split("T")[0];
  } catch {
    return null;
  }
};

export function TrailerDashboard() {
  const searchParams = useSearchParams();
  const [stats, setStats] = useState<DashboardStats>(defaultStats);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const saved = searchParams.get("saved");

  useEffect(() => {
    if (saved === "1") {
      setNotice("Operation saved successfully. Dashboard refreshed.");
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

        if (supabaseError) throw supabaseError;

        const trailers = (data ?? []) as TrailerRecord[];
        const todayKey = getDateKey(new Date().toISOString());

        const activeTrailers = trailers.filter((item) => {
          const departureDate = item.departure_date;
          return departureDate === null || departureDate === undefined || departureDate === "";
        });

        const normalizedLoadStatus = (value?: string | null) =>
          value?.trim().toLowerCase();

        const emptyTrailers = activeTrailers.filter(
          (item) => normalizedLoadStatus(item.load_status) === "empty"
        ).length;

        const loadedTrailers = activeTrailers.filter(
          (item) => normalizedLoadStatus(item.load_status) === "loaded"
        ).length;

        const maintenanceTrailers =
          activeTrailers.length - emptyTrailers - loadedTrailers;

        const arrivalsToday = trailers.filter(
          (item) => getDateKey(item.arrival_date) === todayKey
        ).length;

        const departuresToday = trailers.filter(
          (item) => getDateKey(item.departure_date) === todayKey
        ).length;

        const activeCount = activeTrailers.length;
        const occupancy = Math.min(
          100,
          Math.round((activeCount / COMPOUND_POSITIONS) * 100)
        );

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
        const message =
          err instanceof Error
            ? err.message
            : "Unable to load dashboard statistics.";
        setError(message);
        setStats(defaultStats);
      } finally {
        setIsLoading(false);
      }
    };

    void loadStats();
  }, [saved]);

  useEffect(() => {
    if (!notice) return;

    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const statsCards = [
    {
      title: "Trailers in Compound",
      value: stats.totalTrailers.toString(),
      detail: "Currently active",
      accent: "from-cyan-500 to-blue-600",
    },
    {
      title: "Empty Trailers",
      value: stats.emptyTrailers.toString(),
      detail: "Ready for loading",
      accent: "from-emerald-500 to-teal-600",
    },
    {
      title: "Loaded Trailers",
      value: stats.loadedTrailers.toString(),
      detail: "Ready for departure",
      accent: "from-amber-500 to-orange-600",
    },
    {
      title: "Today's Arrivals",
      value: stats.arrivalsToday.toString(),
      detail: "Arrived today",
      accent: "from-violet-500 to-fuchsia-600",
    },
    {
      title: "Today's Departures",
      value: stats.departuresToday.toString(),
      detail: "Departed today",
      accent: "from-rose-500 to-red-600",
    },
    {
      title: "Maintenance",
      value: stats.maintenanceTrailers.toString(),
      detail: "Needs attention",
      accent: "from-slate-600 to-slate-800",
    },
    {
      title: "Occupancy",
      value: `${stats.occupancy}%`,
      detail: "Compound usage",
      accent: "from-slate-600 to-slate-800",
    },
  ];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">
                Ferryspeed TrailerHub
              </p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
                Operational control center
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300 sm:text-base">
                Monitor arrivals, departures, loading operations and trailer
                availability in real time.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <Link
                href="/dashboard/new-arrival"
                className="rounded-2xl bg-cyan-500 px-4 py-3 text-center font-semibold text-slate-950 hover:bg-cyan-400"
              >
                New Arrival
              </Link>

              <Link
                href="/dashboard/load-trailer"
                className="rounded-2xl bg-orange-500 px-4 py-3 text-center font-semibold text-slate-950 hover:bg-orange-400"
              >
                Load Trailer
              </Link>

              <Link
                href="/dashboard/departure"
                className="rounded-2xl bg-rose-500 px-4 py-3 text-center font-semibold text-white hover:bg-rose-400"
              >
                Departure
              </Link>

              <Link
                href="/dashboard/search"
                className="rounded-2xl bg-slate-800 px-4 py-3 text-center font-semibold text-white hover:bg-slate-700"
              >
                Search
              </Link>

              <Link
                href="/dashboard/compound"
                className="rounded-2xl bg-slate-800 px-4 py-3 text-center font-semibold text-white hover:bg-slate-700"
              >
                Compound
              </Link>

              <Link
                href="/dashboard/company-trailers"
                className="rounded-2xl bg-slate-800 px-4 py-3 text-center font-semibold text-white hover:bg-slate-700"
              >
                Fleet
              </Link>
            </div>
          </div>
        </header>

        {notice ? (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {notice}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {statsCards.map((card) => (
            <article
              key={card.title}
              className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur"
            >
              <div
                className={`mb-5 h-1.5 w-24 rounded-full bg-gradient-to-r ${card.accent}`}
              />
              <p className="text-sm font-medium text-slate-300">{card.title}</p>
              <p className="mt-3 text-3xl font-bold text-white">
                {isLoading ? "..." : card.value}
              </p>
              <p className="mt-2 text-sm text-slate-400">{card.detail}</p>
            </article>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <article className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">
                  Compound Overview
                </p>
                <h2 className="mt-2 text-xl font-semibold text-white">
                  Live trailer allocation
                </h2>
              </div>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200">
                Stable
              </span>
            </div>

            <div className="mt-6">
              <div className="mb-2 flex justify-between text-sm text-slate-300">
                <span>Occupancy</span>
                <span>{stats.occupancy}%</span>
              </div>
              <div className="h-4 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-cyan-400"
                  style={{ width: `${stats.occupancy}%` }}
                />
              </div>
            </div>
          </article>

          <article className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur">
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">
              Today's Focus
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">
              Priority operations
            </h2>

            <div className="mt-5 space-y-3">
              <div className="rounded-2xl bg-slate-950/80 p-4">
                <p className="font-medium text-white">New arrivals</p>
                <p className="text-sm text-slate-400">
                  {stats.arrivalsToday} trailers arrived today.
                </p>
              </div>

              <div className="rounded-2xl bg-slate-950/80 p-4">
                <p className="font-medium text-white">Departures</p>
                <p className="text-sm text-slate-400">
                  {stats.departuresToday} trailers departed today.
                </p>
              </div>

              <div className="rounded-2xl bg-slate-950/80 p-4">
                <p className="font-medium text-white">Load operations</p>
                <p className="text-sm text-slate-400">
                  {stats.emptyTrailers} empty trailers available for loading.
                </p>
              </div>
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}