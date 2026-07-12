"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  calculateOperationalReadiness,
  getDateKey,
  getLocalDateKey,
  getReadinessEmoji,
  getReadinessLabel,
} from "@/lib/operational-readiness";
import { calculateCollectionAging } from "@/lib/collection-aging";
import { buildPriorityQueue, type OpsBooking, type OpsTrailer } from "@/lib/operations-centre-utils";

type DeliveryRow = OpsBooking;

type WorkloadSummary = {
  totalPlannedMovements: number;
  deliveriesToday: number;
  collectionsPending: number;
  plannedArrivals: number;
  plannedDepartures: number;
};

type YardStatus = {
  trailersInCompound: number;
  compoundOccupancy: number;
  waitingCollections: number;
  needPreparation: number;
  attentionRequired: number;
};

const COMPOUND_CAPACITY = 50;

const formatTime = (value?: string | null) => {
  if (!value) return "--:--";
  return value.substring(0, 5);
};

const statusLabel = (status: string) =>
  status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const sortTodayDeliveries = (a: DeliveryRow, b: DeliveryRow) => {
  const ta = a.delivery_time ?? "99:99";
  const tb = b.delivery_time ?? "99:99";
  if (ta !== tb) return ta < tb ? -1 : 1;
  const an = (a.trailer_number ?? "").toUpperCase();
  const bn = (b.trailer_number ?? "").toUpperCase();
  return an.localeCompare(bn);
};

export default function OperationsCentrePage() {
  const [bookings, setBookings] = useState<DeliveryRow[]>([]);
  const [trailers, setTrailers] = useState<OpsTrailer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const todayKey = useMemo(() => getLocalDateKey(), []);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const [{ data: bookingsData, error: bookingsError }, { data: trailersData, error: trailersError }] = await Promise.all([
          supabase
            .from("delivery_bookings")
            .select(
              `id, trailer_id, delivery_date, delivery_time, customer, consignee,
               delivery_location, booking_reference, escort_required, status, notes,
               delivered_at, waiting_collection_since, collection_due_date,
               trailers(trailer_number, compound_position, departure_date)`
            )
            .order("delivery_date", { ascending: true })
            .order("delivery_time", { ascending: true }),
          supabase
            .from("trailers")
            .select("id, trailer_number, load_status, customer, consignee, compound_position, arrival_date, departure_date"),
        ]);

        if (bookingsError) throw bookingsError;
        if (trailersError) throw trailersError;

        const bookingRows = ((bookingsData ?? []) as Array<Record<string, unknown>>).map((row) => {
          const joinedTrailer = row["trailers"] as Record<string, unknown> | null;

          return {
            id: row["id"] as string,
            trailer_id: row["trailer_id"] as string,
            delivery_date: row["delivery_date"] as string,
            delivery_time: (row["delivery_time"] as string | null) ?? null,
            customer: (row["customer"] as string | null) ?? null,
            consignee: (row["consignee"] as string | null) ?? null,
            delivery_location: (row["delivery_location"] as string | null) ?? null,
            booking_reference: (row["booking_reference"] as string | null) ?? null,
            escort_required: Boolean(row["escort_required"]),
            status: row["status"] as string,
            notes: (row["notes"] as string | null) ?? null,
            trailer_number: (joinedTrailer?.["trailer_number"] as string | null) ?? "--",
            trailer_compound_position: (joinedTrailer?.["compound_position"] as string | null) ?? null,
            trailer_departure_date: (joinedTrailer?.["departure_date"] as string | null) ?? null,
            delivered_at: (row["delivered_at"] as string | null) ?? null,
            waiting_collection_since: (row["waiting_collection_since"] as string | null) ?? null,
            collection_due_date: (row["collection_due_date"] as string | null) ?? null,
          };
        });

        setBookings(bookingRows);
        setTrailers((trailersData ?? []) as OpsTrailer[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load operations centre data.");
      } finally {
        setIsLoading(false);
      }
    };

    void loadData();
  }, []);

  const todayDeliveries = useMemo(
    () => bookings.filter((b) => getDateKey(b.delivery_date) === todayKey && b.status !== "cancelled").sort(sortTodayDeliveries),
    [bookings, todayKey]
  );

  const collectionsPending = useMemo(
    () => bookings.filter((b) => b.status === "waiting_collection"),
    [bookings]
  );

  const plannedArrivals = useMemo(
    () => trailers.filter((t) => getDateKey(t.arrival_date) === todayKey).length,
    [trailers, todayKey]
  );

  const plannedDepartures = useMemo(
    () => trailers.filter((t) => getDateKey(t.departure_date) === todayKey).length,
    [trailers, todayKey]
  );

  const workload: WorkloadSummary = useMemo(() => {
    const deliveriesToday = todayDeliveries.length;
    const collectionsCount = collectionsPending.length;
    const totalPlannedMovements = deliveriesToday + collectionsCount + plannedArrivals + plannedDepartures;

    return {
      totalPlannedMovements,
      deliveriesToday,
      collectionsPending: collectionsCount,
      plannedArrivals,
      plannedDepartures,
    };
  }, [todayDeliveries.length, collectionsPending.length, plannedArrivals, plannedDepartures]);

  const priorities = useMemo(() => {
    const queue = buildPriorityQueue(bookings, trailers, todayKey, 12);
    return queue.filter((item) => item.priority === "critical" || item.priority === "high");
  }, [bookings, trailers, todayKey]);

  const yardStatus: YardStatus = useMemo(() => {
    const activeTrailers = trailers.filter((t) => !t.departure_date);
    const waitingCollections = collectionsPending.length;

    let needPreparation = 0;
    let attentionRequired = 0;

    todayDeliveries.forEach((booking) => {
      const readiness = calculateOperationalReadiness(
        {
          id: booking.id,
          trailer_id: booking.trailer_id,
          delivery_date: booking.delivery_date,
          delivery_time: booking.delivery_time,
          customer: booking.customer,
          consignee: booking.consignee,
          delivery_location: booking.delivery_location,
          booking_reference: booking.booking_reference,
          escort_required: booking.escort_required,
          status: booking.status,
          notes: booking.notes,
        },
        {
          id: booking.trailer_id,
          trailer_number: booking.trailer_number,
          compound_position: booking.trailer_compound_position,
          departure_date: booking.trailer_departure_date,
        },
        todayKey
      );

      if (readiness.level === "needs_preparation") needPreparation += 1;
      if (readiness.level === "action_required") attentionRequired += 1;
    });

    const collectionAttention = collectionsPending.filter((b) => {
      const aging = calculateCollectionAging({
        delivery_date: b.delivery_date,
        delivered_at: b.delivered_at,
        waiting_collection_since: b.waiting_collection_since,
        collection_due_date: b.collection_due_date,
      });
      return aging.agingLevel === "red";
    }).length;

    return {
      trailersInCompound: activeTrailers.length,
      compoundOccupancy: Math.min(100, Math.round((activeTrailers.length / COMPOUND_CAPACITY) * 100)),
      waitingCollections,
      needPreparation,
      attentionRequired: attentionRequired + collectionAttention,
    };
  }, [trailers, todayDeliveries, todayKey, collectionsPending]);

  const driverPickList = useMemo(
    () => todayDeliveries.filter((b) => b.status !== "collected" && b.status !== "cancelled"),
    [todayDeliveries]
  );

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Daily Operations Centre</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300 sm:text-base">Operational snapshot for the day in under 30 seconds.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/operations" className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">Operations Board</Link>
              <Link href="/dashboard/deliveries" className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">Deliveries</Link>
              <Link href="/dashboard" className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">Admin Dashboard</Link>
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
        ) : null}

        {isLoading ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-8 text-center text-slate-400">Loading operations centre...</div>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <article className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4"><p className="text-xs uppercase tracking-[0.25em] text-cyan-200">Total Planned Movements</p><p className="mt-2 text-3xl font-bold text-white">{workload.totalPlannedMovements}</p></article>
              <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.25em] text-slate-400">Deliveries Today</p><p className="mt-2 text-3xl font-bold text-cyan-300">{workload.deliveriesToday}</p></article>
              <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.25em] text-slate-400">Collections Pending</p><p className="mt-2 text-3xl font-bold text-purple-300">{workload.collectionsPending}</p></article>
              <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.25em] text-slate-400">Planned Arrivals</p><p className="mt-2 text-3xl font-bold text-emerald-300">{workload.plannedArrivals}</p></article>
              <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.25em] text-slate-400">Planned Departures</p><p className="mt-2 text-3xl font-bold text-amber-300">{workload.plannedDepartures}</p></article>
            </section>

            <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Next Movements</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">Today deliveries by dispatch order</h2>
                </div>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    <tr>
                      <th className="px-2 py-2">Time</th>
                      <th className="px-2 py-2">Trailer</th>
                      <th className="px-2 py-2">Customer</th>
                      <th className="px-2 py-2">Compound Position</th>
                      <th className="px-2 py-2">Operational Readiness</th>
                      <th className="px-2 py-2">Booking Status</th>
                      <th className="px-2 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todayDeliveries.map((booking) => {
                      const readiness = calculateOperationalReadiness(
                        {
                          id: booking.id,
                          trailer_id: booking.trailer_id,
                          delivery_date: booking.delivery_date,
                          delivery_time: booking.delivery_time,
                          customer: booking.customer,
                          consignee: booking.consignee,
                          delivery_location: booking.delivery_location,
                          booking_reference: booking.booking_reference,
                          escort_required: booking.escort_required,
                          status: booking.status,
                          notes: booking.notes,
                        },
                        {
                          id: booking.trailer_id,
                          trailer_number: booking.trailer_number,
                          compound_position: booking.trailer_compound_position,
                          departure_date: booking.trailer_departure_date,
                        },
                        todayKey
                      );

                      return (
                        <tr key={booking.id} className="border-t border-white/10">
                          <td className="px-2 py-3 font-semibold text-white">{formatTime(booking.delivery_time)}</td>
                          <td className="px-2 py-3 text-cyan-300">{booking.trailer_number ?? "--"}</td>
                          <td className="px-2 py-3 text-slate-300">{booking.customer || booking.consignee || "--"}</td>
                          <td className="px-2 py-3 text-slate-300">{booking.trailer_compound_position || "Unassigned"}</td>
                          <td className="px-2 py-3">
                            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-slate-800 px-2 py-1 text-xs font-semibold text-slate-200" title={readiness.reason}>
                              <span>{getReadinessEmoji(readiness.level)}</span>
                              <span>{getReadinessLabel(readiness.level)}</span>
                            </span>
                          </td>
                          <td className="px-2 py-3 text-slate-300">{statusLabel(booking.status)}</td>
                          <td className="px-2 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              <Link href={`/dashboard/trailers/${booking.trailer_id}`} className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-700">View Trailer</Link>
                              <Link href={`/dashboard/deliveries/${booking.id}`} className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-700">View Booking</Link>
                              <button type="button" className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20">Dispatch</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <article className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur">
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-400">Driver Pick List</p>
                <div className="mt-4 space-y-2">
                  {driverPickList.length === 0 ? (
                    <p className="text-sm text-slate-400">No active pick list items for today.</p>
                  ) : (
                    driverPickList.map((item) => (
                      <div key={item.id} className="grid grid-cols-[5rem_1fr_1fr] gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm">
                        <span className="font-bold text-white">{formatTime(item.delivery_time)}</span>
                        <span className="font-semibold text-cyan-300">{item.trailer_number ?? "--"}</span>
                        <span className="text-slate-300">{item.trailer_compound_position || "Unassigned"}</span>
                      </div>
                    ))
                  )}
                </div>
              </article>

              <article className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur">
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-amber-400">Operational Priorities</p>
                <div className="mt-4 space-y-2">
                  {priorities.length === 0 ? (
                    <p className="text-sm text-slate-400">No critical or high priorities.</p>
                  ) : (
                    priorities.map((item) => (
                      <div key={item.id} className={`rounded-xl border px-3 py-2 ${item.priority === "critical" ? "border-rose-500/40 bg-rose-500/10" : "border-amber-500/40 bg-amber-500/10"}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-xs font-bold uppercase tracking-widest ${item.priority === "critical" ? "text-rose-300" : "text-amber-300"}`}>{item.priority}</span>
                          <span className="text-xs text-slate-300">{item.booking.trailer_number ?? "--"}</span>
                        </div>
                        <p className="mt-1 text-sm text-slate-200">{item.reason}</p>
                      </div>
                    ))
                  )}
                </div>
              </article>
            </section>

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.25em] text-slate-500">Trailers in Compound</p><p className="mt-2 text-2xl font-bold text-white">{yardStatus.trailersInCompound}</p></article>
              <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.25em] text-slate-500">Compound Occupancy</p><p className="mt-2 text-2xl font-bold text-cyan-300">{yardStatus.compoundOccupancy}%</p></article>
              <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.25em] text-slate-500">Waiting Collections</p><p className="mt-2 text-2xl font-bold text-purple-300">{yardStatus.waitingCollections}</p></article>
              <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.25em] text-slate-500">Need Preparation</p><p className="mt-2 text-2xl font-bold text-amber-300">{yardStatus.needPreparation}</p></article>
              <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.25em] text-slate-500">Attention Required</p><p className="mt-2 text-2xl font-bold text-rose-300">{yardStatus.attentionRequired}</p></article>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
