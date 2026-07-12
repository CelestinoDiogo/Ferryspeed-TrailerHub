"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  getDateKey,
  getLocalDateKey,
  calculateOperationalReadiness,
  getReadinessColor,
  getReadinessEmoji,
  getReadinessLabel,
} from "@/lib/operational-readiness";
import {
  calculateCollectionAging,
  agingColours,
  compareCollections,
} from "@/lib/collection-aging";

type DeliveryBooking = {
  id: string;
  trailer_id: string;
  delivery_date: string;
  delivery_time?: string | null;
  customer?: string | null;
  consignee?: string | null;
  delivery_location?: string | null;
  booking_reference?: string | null;
  escort_required: boolean;
  status: string;
  notes?: string | null;
  created_at?: string | null;
  trailer_number?: string | null;
  trailer_active?: boolean;
  trailer_compound_position?: string | null;
  // Collection fields
  delivered_at?: string | null;
  waiting_collection_since?: string | null;
  collection_due_date?: string | null;
  collected_at?: string | null;
  demurrage_free_days?: number | null;
  demurrage_daily_rate?: number | null;
  demurrage_currency?: string | null;
  demurrage_notes?: string | null;
};

type FilterType = "today" | "tomorrow" | "upcoming" | "waiting";

const formatDate = (value: string) => {
  try {
    return new Date(value).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
};

const formatTime = (value?: string | null) => {
  if (!value) return "—";
  try {
    return value.substring(0, 5);
  } catch {
    return "—";
  }
};

const statusColors: Record<string, { bg: string; text: string; border: string }> = {
  scheduled: { bg: "bg-slate-500/10", text: "text-slate-300", border: "border-slate-500/30" },
  ready: { bg: "bg-emerald-500/10", text: "text-emerald-200", border: "border-emerald-500/30" },
  on_delivery: { bg: "bg-cyan-500/10", text: "text-cyan-200", border: "border-cyan-500/30" },
  delivered: { bg: "bg-emerald-500/10", text: "text-emerald-200", border: "border-emerald-500/30" },
  waiting_collection: { bg: "bg-amber-500/10", text: "text-amber-200", border: "border-amber-500/30" },
  collected: { bg: "bg-emerald-500/10", text: "text-emerald-200", border: "border-emerald-500/30" },
  cancelled: { bg: "bg-rose-500/10", text: "text-rose-200", border: "border-rose-500/30" },
};

const statusLabel = (status: string) => {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

export default function DeliveriesPage() {
  const [bookings, setBookings] = useState<DeliveryBooking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("today");
  const [statusChanging, setStatusChanging] = useState<string | null>(null);
  const [markingCollected, setMarkingCollected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const loadBookings = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error: bookingsError } = await supabase
          .from("delivery_bookings")
          .select(
            `id, trailer_id, delivery_date, delivery_time, customer, consignee,
             delivery_location, booking_reference, escort_required, status, notes, created_at,
             delivered_at, waiting_collection_since, collection_due_date, collected_at,
             demurrage_free_days, demurrage_daily_rate, demurrage_currency, demurrage_notes,
             trailers(trailer_number, compound_position, departure_date)`
          )
          .order("delivery_date", { ascending: true })
          .order("delivery_time", { ascending: true });

        if (bookingsError) throw bookingsError;

        const enriched = ((data ?? []) as Array<Record<string, unknown>>).map((booking) => {
          const trailerFromJoin = booking["trailers"] as Record<string, unknown> | null;
          return {
            ...booking,
            trailer_number: (trailerFromJoin?.["trailer_number"] as string | null) ?? "—",
            trailer_compound_position: (trailerFromJoin?.["compound_position"] as string | null) ?? null,
            trailer_active: !(trailerFromJoin?.["departure_date"] as string | null),
          };
        });

        setBookings(enriched as DeliveryBooking[]);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Unable to load delivery bookings.";
        setError(message);
        setBookings([]);
      } finally {
        setIsLoading(false);
      }
    };

    void loadBookings();
  }, []);

  const filteredBookings = useMemo(() => {
    const today = getDateKey(new Date().toISOString());
    const tomorrowDate = new Date(new Date().toISOString());
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = getDateKey(tomorrowDate.toISOString());

    let filtered = bookings;

    if (filter === "today") {
      filtered = bookings.filter((b) => getDateKey(b.delivery_date) === today);
    } else if (filter === "tomorrow") {
      filtered = bookings.filter((b) => getDateKey(b.delivery_date) === tomorrow);
    } else if (filter === "upcoming") {
      filtered = bookings.filter(
        (b) =>
          getDateKey(b.delivery_date)! > today! &&
          b.status !== "delivered" &&
          b.status !== "collected" &&
          b.status !== "cancelled"
      );
    } else if (filter === "waiting") {
      filtered = bookings.filter((b) => b.status === "waiting_collection");
    }

    return filtered;
  }, [bookings, filter]);

  const handleStatusChange = async (bookingId: string, currentStatus: string, newStatus: string) => {
    setStatusChanging(bookingId);
    setError(null);

    try {
      const booking = bookings.find((b) => b.id === bookingId);
      if (!booking) return;

      const { error: updateError } = await supabase
        .from("delivery_bookings")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", bookingId);

      if (updateError) throw updateError;

      // Create trailer event
      const eventDescription = `Delivery status changed from ${statusLabel(currentStatus)} to ${statusLabel(newStatus)}.`;
      const { error: eventError } = await supabase
        .from("trailer_events")
        .insert({
          trailer_id: booking.trailer_id,
          trailer_number: booking.trailer_number,
          event_type: "delivery_status_changed",
          event_description: eventDescription,
          old_value: { status: currentStatus },
          new_value: { status: newStatus },
        });

      if (eventError) {
        console.error("Event creation failed:", eventError);
        // Don't fail the status change if event creation fails
      }

      // Update local state
      setBookings((prev) =>
        prev.map((b) =>
          b.id === bookingId ? { ...b, status: newStatus } : b
        )
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to update booking status.";
      setError(message);
    } finally {
      setStatusChanging(null);
    }
  };

  const handleMarkCollected = async (bookingId: string) => {
    setMarkingCollected(bookingId);
    setError(null);
    try {
      const booking = bookings.find((b) => b.id === bookingId);
      if (!booking) return;
      const now = new Date().toISOString();
      const { error: updErr } = await supabase
        .from("delivery_bookings")
        .update({ status: "collected", collected_at: booking.collected_at ?? now, updated_at: now })
        .eq("id", bookingId);
      if (updErr) throw updErr;
      await supabase.from("trailer_events").insert({
        trailer_id: booking.trailer_id,
        trailer_number: booking.trailer_number,
        event_type: "trailer_collected",
        event_description: "Trailer has been collected.",
        old_value: { status: booking.status },
        new_value: { status: "collected" },
      });
      setBookings((prev) => prev.map((b) => b.id === bookingId ? { ...b, status: "collected", collected_at: b.collected_at ?? now } : b));
      setNotice("Trailer marked as collected.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to mark collected.");
    } finally {
      setMarkingCollected(null);
    }
  };

  const getNextStatus = (currentStatus: string) => {
    const sequence: Record<string, string> = {
      scheduled: "ready",
      ready: "on_delivery",
      on_delivery: "delivered",
      delivered: "waiting_collection",
      waiting_collection: "collected",
    };
    return sequence[currentStatus] || null;
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">
                Ferryspeed TrailerHub
              </p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
                Delivery Bookings
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300 sm:text-base">
                Schedule and track delivery operations.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/dashboard/calendar"
                className="rounded-2xl border border-white/10 bg-slate-800 px-5 py-3 text-center font-semibold text-white hover:bg-slate-700"
              >
                Calendar
              </Link>
              <Link
                href="/dashboard/deliveries/new"
                className="rounded-2xl bg-cyan-500 px-5 py-3 text-center font-semibold text-slate-950 hover:bg-cyan-400"
              >
                + New Delivery
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

        <section className="flex flex-wrap gap-3">
          {(["today", "tomorrow", "upcoming", "waiting"] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                filter === f
                  ? "bg-cyan-500 text-slate-950"
                  : "border border-white/10 bg-slate-900/70 text-white hover:bg-slate-800"
              }`}
            >
              {f === "today"
                ? "Today"
                : f === "tomorrow"
                  ? "Tomorrow"
                  : f === "upcoming"
                    ? "All Upcoming"
                    : "Waiting Collection"}
            </button>
          ))}
        </section>

        {isLoading ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-center text-slate-400">
            Loading deliveries...
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-center text-slate-400">
            No deliveries scheduled for this filter.
          </div>
        ) : (
          <section className="space-y-3">
            {filteredBookings.map((booking) => {
              const colors = statusColors[booking.status] || statusColors.scheduled;
              const nextStatus = getNextStatus(booking.status);

              // Calculate readiness
              const trailerForReadiness = booking.trailer_id
                ? {
                    id: booking.trailer_id,
                    trailer_number: booking.trailer_number,
                    compound_position: booking.trailer_compound_position,
                    departure_date: booking.trailer_active ? null : new Date().toISOString(),
                  }
                : null;

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
                trailerForReadiness,
                getLocalDateKey()
              );

              const readinessColor = getReadinessColor(readiness.level);

              return (
                <article
                  key={booking.id}
                  className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5"
                >
                  <div className="flex flex-col gap-4 sm:gap-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex-1">
                        <div className="flex items-baseline gap-3">
                          <p className="text-2xl font-bold text-white">
                            {formatTime(booking.delivery_time)}
                          </p>
                          <p className="text-sm text-slate-400">
                            {formatDate(booking.delivery_date)}
                          </p>
                        </div>

                        <p className="mt-3 text-lg font-semibold text-cyan-300">
                          {booking.trailer_number}
                        </p>

                        <div className="mt-3 space-y-2">
                          {booking.customer ? (
                            <p className="text-sm text-slate-300">
                              <span className="text-slate-500">Customer:</span>{" "}
                              {booking.customer}
                            </p>
                          ) : null}
                          {booking.consignee ? (
                            <p className="text-sm text-slate-300">
                              <span className="text-slate-500">Consignee:</span>{" "}
                              {booking.consignee}
                            </p>
                          ) : null}
                          {booking.delivery_location ? (
                            <p className="text-sm text-slate-300">
                              <span className="text-slate-500">Location:</span>{" "}
                              {booking.delivery_location}
                            </p>
                          ) : null}
                          {booking.booking_reference ? (
                            <p className="text-sm text-slate-300">
                              <span className="text-slate-500">Ref:</span>{" "}
                              <span className="font-mono">{booking.booking_reference}</span>
                            </p>
                          ) : null}
                          {booking.escort_required ? (
                            <p className="text-sm text-amber-200">
                              ⚠ Escort Required
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        {/* Operational Readiness */}
                        <div
                          className={`rounded-2xl border px-3 py-2 text-center text-xs font-semibold ${readinessColor.border} ${readinessColor.bg} ${readinessColor.text}`}
                        >
                          <p className="text-lg">{getReadinessEmoji(readiness.level)}</p>
                          <p>{getReadinessLabel(readiness.level)}</p>
                          <p className="text-xs text-opacity-80 mt-1">{readiness.reason}</p>
                        </div>

                        {/* Booking Status */}
                        <div
                          className={`rounded-2xl border px-3 py-1.5 text-center text-xs font-semibold ${colors.border} ${colors.bg} ${colors.text}`}
                        >
                          {statusLabel(booking.status)}
                        </div>

                        {nextStatus && booking.status !== "cancelled" ? (
                          <button
                            onClick={() =>
                              handleStatusChange(
                                booking.id,
                                booking.status,
                                nextStatus
                              )
                            }
                            disabled={statusChanging === booking.id}
                            className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
                          >
                            {statusChanging === booking.id
                              ? "Updating..."
                              : "→ " + statusLabel(nextStatus)}
                          </button>
                        ) : null}

                        {booking.status !== "cancelled" && booking.status !== "delivered" && booking.status !== "collected" ? (
                          <button
                            onClick={() =>
                              handleStatusChange(
                                booking.id,
                                booking.status,
                                "cancelled"
                              )
                            }
                            disabled={statusChanging === booking.id}
                            className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex gap-2 pt-3 border-t border-white/10">
                      <Link
                        href={`/dashboard/deliveries/${booking.id}`}
                        className="flex-1 rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-slate-900"
                      >
                        View
                      </Link>
                      <Link
                        href={`/dashboard/deliveries/${booking.id}?edit=1`}
                        className="flex-1 rounded-xl bg-slate-800 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-slate-700"
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/dashboard/trailers/${booking.trailer_id}`}
                        className="flex-1 rounded-xl bg-slate-800 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-slate-700"
                      >
                        History
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {/* ─── Enhanced Waiting Collection section ─────────────────────── */}
        {!isLoading && filter === "waiting" ? (() => {
          const waitingList = filteredBookings
            .filter((b) => b.status === "waiting_collection")
            .map((b) => {
              const aging = calculateCollectionAging({
                delivery_date: b.delivery_date,
                delivered_at: b.delivered_at,
                waiting_collection_since: b.waiting_collection_since,
                collection_due_date: b.collection_due_date,
              });
              return { booking: b, aging, _rawSince: b.waiting_collection_since ?? b.delivered_at ?? null };
            })
            .sort((a, b) => compareCollections(
              { ...a.aging, _rawSince: a._rawSince },
              { ...b.aging, _rawSince: b._rawSince }
            ));

          if (waitingList.length === 0) return null;

          return (
            <section className="space-y-3">
              <div className="flex items-center gap-3">
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-purple-400">Waiting Collection</p>
                <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-xs text-purple-300">{waitingList.length}</span>
              </div>
              {waitingList.map(({ booking: b, aging }) => {
                const agingC = agingColours(aging.agingLevel);
                return (
                  <article key={b.id} className={`rounded-3xl border p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5 ${agingC.border} ${agingC.bg}`}>
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="text-lg font-bold text-white">{b.customer || b.consignee || "—"}</span>
                            <span className={`text-sm font-semibold ${agingC.text}`}>{b.trailer_number}</span>
                          </div>
                          {b.delivery_location || b.consignee ? (
                            <p className="mt-0.5 text-xs text-slate-400">{b.delivery_location || b.consignee}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${agingC.bg} ${agingC.border} ${agingC.text}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${agingC.dot}`} />
                            {aging.agingLabel}
                          </span>
                          <span className={`text-sm font-bold ${agingC.text}`}>{aging.waitingDays} day{aging.waitingDays !== 1 ? "s" : ""} waiting</span>
                          {aging.isOverdue && aging.overdueDays !== null ? (
                            <span className="text-xs font-semibold text-rose-400">{aging.overdueDays}d overdue</span>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500">Trailer</p>
                          <p className="mt-0.5 text-slate-300">{b.trailer_number ?? "—"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500">Customer</p>
                          <p className="mt-0.5 text-slate-300">{b.customer || b.consignee || "—"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500">Delivered At</p>
                          <p className="mt-0.5 text-slate-300">{b.delivered_at ? formatDate(b.delivered_at) : "—"}</p>
                        </div>
                        {b.waiting_collection_since ? (
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500">Waiting Since</p>
                            <p className="mt-0.5 text-slate-300">{new Date(b.waiting_collection_since).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</p>
                          </div>
                        ) : (
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500">Waiting Since</p>
                            <p className="mt-0.5 text-slate-300">—</p>
                          </div>
                        )}
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500">Days Waiting</p>
                          <p className={`mt-0.5 font-semibold ${agingC.text}`}>{aging.waitingDays}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500">Collection Status</p>
                          <p className={`mt-0.5 font-semibold ${agingC.text}`}>{aging.agingLabel}</p>
                        </div>
                        <div className="sm:col-span-2 lg:col-span-3">
                          <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500">Collection Notes</p>
                          <p className="mt-0.5 text-slate-300">{b.demurrage_notes?.trim() ? b.demurrage_notes : "—"}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
                        <button
                          onClick={() => void handleMarkCollected(b.id)}
                          disabled={markingCollected === b.id}
                          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          {markingCollected === b.id ? "Marking..." : "✓ Mark Collected"}
                        </button>
                        <Link href={`/dashboard/deliveries/${b.id}`} className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">View Booking</Link>
                        <Link href={`/dashboard/trailers/${b.trailer_number ?? b.trailer_id}`} className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">View Trailer</Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })() : null}

        <div className="mt-6">
          <Link
            href="/dashboard"
            className="rounded-2xl border border-white/10 bg-slate-800 px-5 py-3 font-semibold text-white hover:bg-slate-700"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
