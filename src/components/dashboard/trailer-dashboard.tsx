"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  calculateCollectionAging,
} from "@/lib/collection-aging";

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
  trailer_number?: string | null;
  load_status?: string | null;
  arrival_date?: string | null;
  departure_date?: string | null;
  compound_position?: string | null;
  customer?: string | null;
  load_description?: string | null;
};

type TrailerEvent = {
  id: string;
  trailer_number: string;
  event_type: string;
  event_description?: string | null;
  created_at?: string | null;
};

type DeliveryBooking = {
  id: string;
  trailer_id: string;
  delivery_date: string;
  delivery_time?: string | null;
  customer?: string | null;
  consignee?: string | null;
  delivery_location?: string | null;
  booking_reference?: string | null;
  status: string;
  trailer_number?: string | null;
};

type WaitingCollectionSummary = {
  count: number;
  attentionRequiredCount: number;
  oldestTrailer: string | null;
  oldestDays: number;
};

type OperationalAlert = {
  id: string;
  type: "missing_position" | "high_occupancy" | "loaded_no_customer" | "incomplete_info";
  severity: "warning" | "alert";
  title: string;
  description: string;
  trailerId?: string;
  trailerNumber?: string;
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
  const [events, setEvents] = useState<TrailerEvent[]>([]);
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);
  const [todayDeliveries, setTodayDeliveries] = useState<DeliveryBooking[]>([]);
  const [waitingCollectionSummary, setWaitingCollectionSummary] = useState<WaitingCollectionSummary>({ count: 0, attentionRequiredCount: 0, oldestTrailer: null, oldestDays: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const saved = searchParams.get("saved");
  const notice = saved === "1" ? "Operation saved successfully. Dashboard refreshed." : null;

  useEffect(() => {
    const loadStats = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const todayKey = getDateKey(new Date().toISOString());

        const [{ data, error: supabaseError }, { data: eventsData, error: eventsError }, { data: deliveriesData, error: deliveriesError }, { data: waitingData }] =
          await Promise.all([
            supabase.from("trailers").select("id, trailer_number, load_status, arrival_date, departure_date, compound_position, customer, load_description"),
            supabase
              .from("trailer_events")
              .select("id, trailer_number, event_type, event_description, created_at")
              .order("created_at", { ascending: false })
              .limit(10),
            supabase
              .from("delivery_bookings")
              .select(
                `id, trailer_id, delivery_date, delivery_time, customer, consignee,
                 delivery_location, booking_reference, status,
                 trailers(trailer_number)`
              )
              .eq("delivery_date", todayKey!)
              .order("delivery_time", { ascending: true })
              .limit(5),
            supabase
              .from("delivery_bookings")
              .select("id, trailer_id, delivery_date, delivered_at, waiting_collection_since, collection_due_date, trailers(trailer_number)")
              .eq("status", "waiting_collection"),
          ]);

        if (supabaseError) throw supabaseError;
        if (eventsError) throw eventsError;
        if (deliveriesError) throw deliveriesError;

        const trailers = (data ?? []) as TrailerRecord[];

        const activeTrailers = trailers.filter((item) => {
          const departureDate = item.departure_date;
          return departureDate === null || departureDate === undefined || departureDate === "";
        });

        const normalizedLoadStatus = (value?: string | null) => value?.trim().toLowerCase();

        const emptyTrailers = activeTrailers.filter(
          (item) => normalizedLoadStatus(item.load_status) === "empty"
        ).length;

        const loadedTrailers = activeTrailers.filter(
          (item) => normalizedLoadStatus(item.load_status) === "loaded"
        ).length;

        const maintenanceTrailers = activeTrailers.length - emptyTrailers - loadedTrailers;

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

        setEvents((eventsData ?? []) as TrailerEvent[]);

        // Enrich deliveries with trailer numbers
        const enrichedDeliveries = ((deliveriesData ?? []) as Array<Record<string, unknown>>).map((booking) => {
          const joinedTrailer = booking["trailers"] as Record<string, unknown> | null;
          return {
            ...booking,
            trailer_number: (joinedTrailer?.["trailer_number"] as string | null) ?? "—",
          };
        });
        setTodayDeliveries(enrichedDeliveries as DeliveryBooking[]);

        // Waiting collection summary
        const waitingList = (waitingData ?? []) as Array<Record<string, unknown>>;
        let attentionRequiredCount = 0;
        let oldestDays = 0;
        let oldestTrailer: string | null = null;
        waitingList.forEach((b) => {
          const aging = calculateCollectionAging({
            delivery_date: b["delivery_date"] as string,
            delivered_at: b["delivered_at"] as string | null,
            waiting_collection_since: b["waiting_collection_since"] as string | null,
            collection_due_date: b["collection_due_date"] as string | null,
          });
          if (aging.agingLevel === "red") attentionRequiredCount++;
          if (aging.waitingDays > oldestDays) {
            oldestDays = aging.waitingDays;
            oldestTrailer = ((b["trailers"] as Record<string, unknown> | null)?.["trailer_number"] as string | null) ?? null;
          }
        });
        setWaitingCollectionSummary({ count: waitingList.length, attentionRequiredCount, oldestTrailer, oldestDays });

        // Generate operational alerts
        const generatedAlerts: OperationalAlert[] = [];

        // Check for trailers without compound position
        const trailersWithoutPosition = activeTrailers.filter(
          (t) => !t.compound_position || t.compound_position.trim() === ""
        );
        if (trailersWithoutPosition.length > 0) {
          generatedAlerts.push({
            id: "missing_position_alert",
            type: "missing_position",
            severity: "alert",
            title: `${trailersWithoutPosition.length} Trailer${trailersWithoutPosition.length === 1 ? "" : "s"} Without Position`,
            description: `${trailersWithoutPosition.length} trailer${trailersWithoutPosition.length === 1 ? "" : "s"} not yet assigned to a compound position.`,
            trailerNumber: trailersWithoutPosition[0]?.trailer_number ?? undefined,
          });
        }

        // Check for high occupancy (above 80%)
        if (occupancy > 80) {
          generatedAlerts.push({
            id: "high_occupancy_alert",
            type: "high_occupancy",
            severity: "warning",
            title: "Compound Occupancy High",
            description: `Compound is at ${occupancy}% capacity. Plan departures to maintain operations.`,
          });
        }

        // Check for loaded trailers without customer
        const loadedTrailersNoCustomer = activeTrailers.filter((t) => {
          const isLoaded = normalizedLoadStatus(t.load_status) === "loaded";
          const hasCustomer = t.customer && t.customer.trim() !== "";
          return isLoaded && !hasCustomer;
        });
        if (loadedTrailersNoCustomer.length > 0) {
          generatedAlerts.push({
            id: "loaded_no_customer_alert",
            type: "loaded_no_customer",
            severity: "warning",
            title: `${loadedTrailersNoCustomer.length} Loaded Trailer${loadedTrailersNoCustomer.length === 1 ? "" : "s"} Without Customer`,
            description: `${loadedTrailersNoCustomer.length} loaded trailer${loadedTrailersNoCustomer.length === 1 ? "" : "s"} missing customer information.`,
            trailerNumber: loadedTrailersNoCustomer[0]?.trailer_number ?? undefined,
          });
        }

        // Check for incomplete information (loaded without description)
        const loadedTrailersNoDescription = activeTrailers.filter((t) => {
          const isLoaded = normalizedLoadStatus(t.load_status) === "loaded";
          const hasDescription = t.load_description && t.load_description.trim() !== "";
          return isLoaded && !hasDescription;
        });
        if (loadedTrailersNoDescription.length > 0) {
          generatedAlerts.push({
            id: "incomplete_info_alert",
            type: "incomplete_info",
            severity: "warning",
            title: `${loadedTrailersNoDescription.length} Trailer${loadedTrailersNoDescription.length === 1 ? "" : "s"} Missing Load Description`,
            description: `${loadedTrailersNoDescription.length} loaded trailer${loadedTrailersNoDescription.length === 1 ? "" : "s"} without load description.`,
            trailerNumber: loadedTrailersNoDescription[0]?.trailer_number ?? undefined,
          });
        }

        setAlerts(generatedAlerts);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : JSON.stringify(err);
        setError(message);
        setStats(defaultStats);
        setEvents([]);
        setAlerts([]);
        setTodayDeliveries([]);
        setWaitingCollectionSummary({ count: 0, attentionRequiredCount: 0, oldestTrailer: null, oldestDays: 0 });
      } finally {
        setIsLoading(false);
      }
    };

    void loadStats();
  }, [saved]);

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
      title: "Compound Occupancy",
      value: `${stats.occupancy}%`,
      detail: "Space utilization",
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

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-9">
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
                href="/dashboard/edit-trailer"
                className="rounded-2xl bg-violet-500 px-4 py-3 text-center font-semibold text-white hover:bg-violet-400"
              >
                Edit Trailer
              </Link>

              <Link
                href="/dashboard/compound"
                className="rounded-2xl bg-slate-800 px-4 py-3 text-center font-semibold text-white hover:bg-slate-700"
              >
                Compound
              </Link>

              <Link
                href="/dashboard/deliveries"
                className="rounded-2xl bg-emerald-600 px-4 py-3 text-center font-semibold text-white hover:bg-emerald-500"
              >
                Deliveries
              </Link>

              <Link
                href="/dashboard/operations"
                className="rounded-2xl bg-teal-600 px-4 py-3 text-center font-semibold text-white hover:bg-teal-500"
              >
                Operations
              </Link>

              <Link
                href="/dashboard/operations-centre"
                className="rounded-2xl bg-cyan-600 px-4 py-3 text-center font-semibold text-white hover:bg-cyan-500"
              >
                Ops Centre
              </Link>

              <Link
                href="/dashboard/calendar"
                className="rounded-2xl bg-indigo-600 px-4 py-3 text-center font-semibold text-white hover:bg-indigo-500"
              >
                Ops Calendar
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

        {alerts.length > 0 ? (
          <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
                  Operational Alerts
                </p>
                <h2 className="mt-2 text-xl font-semibold text-white">
                  Action required
                </h2>
              </div>
              <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200">
                {alerts.length} alert{alerts.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`rounded-2xl border p-4 ${
                    alert.severity === "alert"
                      ? "border-rose-500/30 bg-rose-500/10"
                      : "border-amber-500/30 bg-amber-500/10"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 h-2 w-2 rounded-full ${
                        alert.severity === "alert" ? "bg-rose-400" : "bg-amber-400"
                      }`}
                    />
                    <div className="flex-1">
                      <p
                        className={`text-sm font-semibold ${
                          alert.severity === "alert"
                            ? "text-rose-200"
                            : "text-amber-200"
                        }`}
                      >
                        {alert.title}
                      </p>
                      <p className="mt-1 text-sm text-slate-300">
                        {alert.description}
                      </p>
                      {alert.trailerNumber ? (
                        <p className="mt-2 text-xs text-slate-400">
                          Trailer: <span className="font-mono font-semibold">{alert.trailerNumber}</span>
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

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
              Today Focus
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

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">
                Recent Activity
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white">
                Latest trailer events
              </h2>
            </div>
            <span className="rounded-full border border-slate-500/20 bg-slate-950/60 px-3 py-1 text-xs font-medium text-slate-300">
              Latest 10
            </span>
          </div>

          <div className="mt-5 space-y-3">
            {events.length === 0 ? (
              <div className="rounded-2xl bg-slate-950/80 p-4 text-sm text-slate-400">
                No recent activity available.
              </div>
            ) : (
              events.map((event) => (
                <div
                  key={event.id}
                  className="rounded-3xl border border-white/10 bg-slate-950/80 p-4"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{event.trailer_number}</p>
                      <p className="mt-1 text-sm text-slate-400">{event.event_type}</p>
                    </div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                      {event.created_at ? new Date(event.created_at).toLocaleString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }) : "Unknown"}
                    </p>
                  </div>
                  <p className="mt-3 text-sm text-slate-300">{event.event_description ?? "No description"}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-emerald-300">
                Today Schedule
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white">
                Planned deliveries
              </h2>
            </div>
            <span className="rounded-full border border-slate-500/20 bg-slate-950/60 px-3 py-1 text-xs font-medium text-slate-300">
              {todayDeliveries.length} booking{todayDeliveries.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="mt-5 space-y-3">
            {todayDeliveries.length === 0 ? (
              <div className="rounded-2xl bg-slate-950/80 p-4 text-sm text-slate-400">
                No deliveries scheduled for today.
              </div>
            ) : (
              todayDeliveries.map((booking) => (
                <Link
                  key={booking.id}
                  href={`/dashboard/deliveries/${booking.id}`}
                  className="block rounded-3xl border border-white/10 bg-slate-950/80 p-4 hover:bg-slate-900/50"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-white">
                        {booking.delivery_time ? booking.delivery_time.substring(0, 5) : "—"} · {booking.trailer_number}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">
                        {booking.customer || booking.consignee || booking.delivery_location || "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        booking.status === "delivered"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                          : booking.status === "on_delivery"
                            ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
                            : booking.status === "waiting_collection"
                              ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                              : "border-slate-500/30 bg-slate-500/10 text-slate-300"
                      }`}>
                        {booking.status.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>
                </Link>
              ))
            )}

            {todayDeliveries.length > 0 ? (
              <Link
                href="/dashboard/deliveries"
                className="mt-4 block text-center text-sm font-semibold text-cyan-300 hover:text-cyan-200"
              >
                View all deliveries →
              </Link>
            ) : null}
          </div>
        </section>

        {/* Waiting Collection summary */}
        {waitingCollectionSummary.count > 0 ? (
          <section className="rounded-3xl border border-purple-500/20 bg-purple-500/5 p-5 shadow-lg shadow-black/20 backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-purple-400">
                  Waiting Collections
                </p>
                <h2 className="mt-2 text-xl font-semibold text-white">Operational Summary</h2>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 p-3">
                <p className="text-[10px] uppercase tracking-[0.25em] text-purple-200">Waiting Collections</p>
                <p className="mt-1 text-xl font-bold text-white">{waitingCollectionSummary.count}</p>
              </div>
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-[10px] uppercase tracking-[0.25em] text-amber-200">Oldest Waiting</p>
                <p className="mt-1 text-xl font-bold text-white">{waitingCollectionSummary.oldestDays}d</p>
                {waitingCollectionSummary.oldestTrailer ? (
                  <p className="mt-1 text-xs text-slate-300">{waitingCollectionSummary.oldestTrailer}</p>
                ) : null}
              </div>
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3">
                <p className="text-[10px] uppercase tracking-[0.25em] text-rose-200">Attention Required</p>
                <p className="mt-1 text-xl font-bold text-white">{waitingCollectionSummary.attentionRequiredCount}</p>
              </div>
            </div>

            <Link
              href="/dashboard/deliveries"
              className="mt-4 block text-center text-sm font-semibold text-purple-300 hover:text-purple-200"
            >
              View Waiting Collections →
            </Link>
          </section>
        ) : null}
      </div>
    </main>
  );
}