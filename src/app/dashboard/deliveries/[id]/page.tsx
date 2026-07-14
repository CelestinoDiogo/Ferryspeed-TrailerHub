"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Json } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import {
  calculateOperationalReadiness,
  getReadinessColor,
  getReadinessEmoji,
  getReadinessLabel,
  getLocalDateKey,
} from "@/lib/operational-readiness";
import {
  calculateCollectionAging,
  agingColours,
} from "@/lib/collection-aging";

// ============================================================================
// Types
// ============================================================================

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
  updated_at?: string | null;
  trailer_number?: string | null;
  // Collection tracking
  delivered_at?: string | null;
  waiting_collection_since?: string | null;
  collection_due_date?: string | null;
  collected_at?: string | null;
  demurrage_free_days?: number | null;
  demurrage_daily_rate?: number | null;
  demurrage_currency?: string | null;
  demurrage_notes?: string | null;
};

type FormValues = {
  delivery_date: string;
  delivery_time: string;
  customer: string;
  consignee: string;
  delivery_location: string;
  booking_reference: string;
  escort_required: boolean;
  status: string;
  notes: string;
  collection_due_date: string;
  demurrage_free_days: number;
  demurrage_daily_rate: string;
  demurrage_currency: string;
  demurrage_notes: string;
};

const statuses = [
  "scheduled",
  "ready",
  "on_delivery",
  "delivered",
  "waiting_collection",
  "collected",
  "cancelled",
];

const statusLabel = (status: string) =>
  status.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

const formatDate = (value?: string | null) => {
  if (!value) return "\u2014";
  try {
    return new Date(value).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "\u2014";
  }
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "\u2014";
  try {
    return new Date(value).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "\u2014";
  }
};

// ============================================================================
// Component
// ============================================================================

export default function DeliveryDetailsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const bookingId = params?.id && typeof params.id === "string" ? params.id : "";
  const isEditMode = searchParams.get("edit") === "1";

  const [booking, setBooking] = useState<DeliveryBooking | null>(null);
  const [trailerData, setTrailerData] = useState<Record<string, unknown> | null>(null);
  const [values, setValues] = useState<FormValues | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isMarkingCollected, setIsMarkingCollected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(isEditMode);
  const [showCollectionChoice, setShowCollectionChoice] = useState(false);

  useEffect(() => {
    const loadBooking = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error: err } = await supabase
          .from("delivery_bookings")
          .select(
            `id, trailer_id, delivery_date, delivery_time, customer, consignee,
             delivery_location, booking_reference, escort_required, status, notes,
             created_at, updated_at,
             delivered_at, waiting_collection_since, collection_due_date, collected_at,
             demurrage_free_days, demurrage_daily_rate, demurrage_currency, demurrage_notes,
             trailers(trailer_number, compound_position, departure_date)`
          )
          .eq("id", bookingId)
          .single();

        if (err) throw err;

        const raw = data as Record<string, unknown>;
        const trailer = raw["trailers"] as Record<string, unknown> | null;

        const enriched: DeliveryBooking = {
          id: raw["id"] as string,
          trailer_id: raw["trailer_id"] as string,
          delivery_date: raw["delivery_date"] as string,
          delivery_time: raw["delivery_time"] as string | null,
          customer: raw["customer"] as string | null,
          consignee: raw["consignee"] as string | null,
          delivery_location: raw["delivery_location"] as string | null,
          booking_reference: raw["booking_reference"] as string | null,
          escort_required: raw["escort_required"] as boolean,
          status: raw["status"] as string,
          notes: raw["notes"] as string | null,
          created_at: raw["created_at"] as string | null,
          updated_at: raw["updated_at"] as string | null,
          trailer_number: (trailer?.["trailer_number"] as string | null) ?? null,
          delivered_at: raw["delivered_at"] as string | null,
          waiting_collection_since: raw["waiting_collection_since"] as string | null,
          collection_due_date: raw["collection_due_date"] as string | null,
          collected_at: raw["collected_at"] as string | null,
          demurrage_free_days: raw["demurrage_free_days"] as number | null,
          demurrage_daily_rate: raw["demurrage_daily_rate"] as number | null,
          demurrage_currency: raw["demurrage_currency"] as string | null,
          demurrage_notes: raw["demurrage_notes"] as string | null,
        };

        setBooking(enriched);
        setTrailerData(trailer);
        setValues({
          delivery_date: enriched.delivery_date,
          delivery_time: enriched.delivery_time ?? "",
          customer: enriched.customer ?? "",
          consignee: enriched.consignee ?? "",
          delivery_location: enriched.delivery_location ?? "",
          booking_reference: enriched.booking_reference ?? "",
          escort_required: enriched.escort_required,
          status: enriched.status,
          notes: enriched.notes ?? "",
          collection_due_date: enriched.collection_due_date ?? "",
          demurrage_free_days: enriched.demurrage_free_days ?? 0,
          demurrage_daily_rate: enriched.demurrage_daily_rate?.toString() ?? "",
          demurrage_currency: enriched.demurrage_currency ?? "GBP",
          demurrage_notes: enriched.demurrage_notes ?? "",
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load delivery booking.");
      } finally {
        setIsLoading(false);
      }
    };

    void loadBooking();
  }, [bookingId]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const handleChange = (field: keyof FormValues, value: string | boolean | number) => {
    setValues((prev) => (prev ? { ...prev, [field]: value } : null));
  };

  // ─── handleSave ──────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!booking || !values) return;
    setIsSaving(true);
    setError(null);

    try {
      const now = new Date().toISOString();
      const prevStatus = booking.status;
      const newStatus  = values.status;

      // Auto-set timestamps on status transitions
      const deliveredAtPatch = newStatus === "delivered" && !booking.delivered_at ? now : null;
      const waitingCollectionSincePatch =
        newStatus === "waiting_collection" && !booking.waiting_collection_since ? now : null;
      const collectedAtPatch = newStatus === "collected" && !booking.collected_at ? now : null;

      const timestampPatch: Partial<Pick<DeliveryBooking, "delivered_at" | "waiting_collection_since" | "collected_at">> = {};
      if (deliveredAtPatch) {
        timestampPatch.delivered_at = deliveredAtPatch;
      }
      if (waitingCollectionSincePatch) {
        timestampPatch.waiting_collection_since = waitingCollectionSincePatch;
      }
      if (collectedAtPatch) {
        timestampPatch.collected_at = collectedAtPatch;
      }

      const dailyRate = values.demurrage_daily_rate === ""
        ? null
        : parseFloat(values.demurrage_daily_rate);

      const { error: updateErr } = await supabase
        .from("delivery_bookings")
        .update({
          delivery_date:   values.delivery_date,
          delivery_time:   values.delivery_time || null,
          customer:        values.customer.trim() || null,
          consignee:       values.consignee.trim() || null,
          delivery_location: values.delivery_location.trim() || null,
          booking_reference: values.booking_reference.trim() || null,
          escort_required: values.escort_required,
          status:          newStatus,
          notes:           values.notes.trim() || null,
          collection_due_date: values.collection_due_date || null,
          demurrage_free_days:  values.demurrage_free_days,
          demurrage_daily_rate: isNaN(dailyRate as number) ? null : dailyRate,
          demurrage_currency:   values.demurrage_currency.trim() || "GBP",
          demurrage_notes:      values.demurrage_notes.trim() || null,
          updated_at: now,
          ...timestampPatch,
        })
        .eq("id", booking.id);

      if (updateErr) throw updateErr;

      // ── Trailer events ────────────────────────────────────────────────────
      const events: { type: string; desc: string; old: Json; next: Json }[] = [];

      if (prevStatus !== newStatus) {
        events.push({
          type: "delivery_status_changed",
          desc: `Delivery status changed from ${statusLabel(prevStatus)} to ${statusLabel(newStatus)}.`,
          old: { status: prevStatus },
          next: { status: newStatus },
        });
      }

      if (deliveredAtPatch) {
        events.push({ type: "delivery_completed", desc: "Delivery marked as completed.", old: null, next: { delivered_at: deliveredAtPatch } });
      }
      if (waitingCollectionSincePatch) {
        events.push({ type: "waiting_collection_started", desc: "Trailer is now waiting for collection.", old: null, next: { waiting_collection_since: waitingCollectionSincePatch } });
      }
      if (collectedAtPatch) {
        events.push({ type: "trailer_collected", desc: "Trailer has been collected.", old: null, next: { collected_at: collectedAtPatch } });
      }

      const dueChanged = (values.collection_due_date || null) !== booking.collection_due_date;
      if (dueChanged) {
        events.push({ type: "collection_due_date_changed", desc: `Collection due date set to ${values.collection_due_date || "not set"}.`, old: { collection_due_date: booking.collection_due_date }, next: { collection_due_date: values.collection_due_date || null } });
      }

      for (const ev of events) {
        const { error: evErr } = await supabase.from("trailer_events").insert({
          trailer_id:        booking.trailer_id,
          trailer_number:    booking.trailer_number,
          event_type:        ev.type,
          event_description: ev.desc,
          old_value:         ev.old,
          new_value:         ev.next,
        });
        if (evErr) console.error("Event insert error:", evErr);
      }

      // Update local state
      const updated: DeliveryBooking = {
        ...booking,
        ...values,
        delivery_time:       values.delivery_time || null,
        customer:            values.customer.trim() || null,
        consignee:           values.consignee.trim() || null,
        delivery_location:   values.delivery_location.trim() || null,
        booking_reference:   values.booking_reference.trim() || null,
        notes:               values.notes.trim() || null,
        collection_due_date: values.collection_due_date || null,
        demurrage_free_days: values.demurrage_free_days,
        demurrage_daily_rate: isNaN(dailyRate as number) ? null : dailyRate,
        demurrage_currency:  values.demurrage_currency || "GBP",
        demurrage_notes:     values.demurrage_notes.trim() || null,
        ...timestampPatch as Partial<DeliveryBooking>,
      };

      setBooking(updated);
      setEditMode(false);

      // Show collection choice if just moved to "delivered"
      if (prevStatus !== "delivered" && newStatus === "delivered") {
        setShowCollectionChoice(true);
      } else {
        setNotice("Booking updated successfully.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update booking.");
    } finally {
      setIsSaving(false);
    }
  };

  // ─── handleDeliveredChoice ────────────────────────────────────────────────

  const handleDeliveredChoice = async (requiresCollection: boolean) => {
    if (!booking) return;
    setShowCollectionChoice(false);

    if (!requiresCollection) {
      setNotice("Booking saved. No collection required.");
      return;
    }

    // Move to waiting_collection
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const { error: updErr } = await supabase
        .from("delivery_bookings")
        .update({ status: "waiting_collection", waiting_collection_since: booking.waiting_collection_since ?? now, updated_at: now })
        .eq("id", booking.id);

      if (updErr) throw updErr;

      await supabase.from("trailer_events").insert({
        trailer_id:        booking.trailer_id,
        trailer_number:    booking.trailer_number,
        event_type:        "waiting_collection_started",
        event_description: "Trailer is now waiting for collection.",
        old_value:         { status: "delivered" },
        new_value:         { status: "waiting_collection" },
      });

      setBooking((prev) => prev ? { ...prev, status: "waiting_collection", waiting_collection_since: prev.waiting_collection_since ?? now } : null);
      setValues((prev) => prev ? { ...prev, status: "waiting_collection" } : null);
      setNotice("Status updated to Waiting Collection.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update status.");
    } finally {
      setIsSaving(false);
    }
  };

  // ─── handleMarkCollected ──────────────────────────────────────────────────

  const handleMarkCollected = async () => {
    if (!booking) return;
    setIsMarkingCollected(true);
    setError(null);

    try {
      const now = new Date().toISOString();
      const { error: updErr } = await supabase
        .from("delivery_bookings")
        .update({ status: "collected", collected_at: booking.collected_at ?? now, updated_at: now })
        .eq("id", booking.id);

      if (updErr) throw updErr;

      await supabase.from("trailer_events").insert({
        trailer_id:        booking.trailer_id,
        trailer_number:    booking.trailer_number,
        event_type:        "trailer_collected",
        event_description: "Trailer has been collected.",
        old_value:         { status: booking.status },
        new_value:         { status: "collected", collected_at: booking.collected_at ?? now },
      });

      setBooking((prev) => prev ? { ...prev, status: "collected", collected_at: prev.collected_at ?? now } : null);
      setValues((prev) => prev ? { ...prev, status: "collected" } : null);
      setNotice("Trailer marked as collected.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to mark collected.");
    } finally {
      setIsMarkingCollected(false);
    }
  };

  // ─── Render guards ────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-center text-slate-400">
            Loading delivery booking...
          </div>
        </div>
      </main>
    );
  }

  if (!booking || !values) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-sm text-amber-100">Delivery booking not found.</div>
          <Link href="/dashboard/deliveries" className="rounded-2xl border border-white/10 bg-slate-800 px-5 py-3 font-semibold text-white hover:bg-slate-700">Back to Deliveries</Link>
        </div>
      </main>
    );
  }

  // ─── Collection aging ─────────────────────────────────────────────────────

  const isWaitingOrDelivered = booking.status === "waiting_collection" || booking.status === "delivered";
  const aging = isWaitingOrDelivered
    ? calculateCollectionAging({
        delivery_date:             booking.delivery_date,
        delivered_at:              booking.delivered_at,
        waiting_collection_since:  booking.waiting_collection_since,
        collection_due_date:       booking.collection_due_date,
      })
    : null;

  const agingC = aging ? agingColours(aging.agingLevel) : null;

  // ─── Readiness ────────────────────────────────────────────────────────────

  const trailerForReadiness = {
    id: booking.trailer_id,
    trailer_number: booking.trailer_number,
    compound_position: trailerData?.["compound_position"] as string | null,
    departure_date:    trailerData?.["departure_date"] as string | null,
  };

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

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">

        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Delivery Details</h1>
            </div>
            <Link href="/dashboard/deliveries" className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700">
              Deliveries
            </Link>
          </div>
        </header>

        {notice ? (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{notice}</div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
        ) : null}

        {/* ─── Post-delivery collection choice ───────────────────────────── */}
        {showCollectionChoice ? (
          <section className="rounded-3xl border border-cyan-500/30 bg-cyan-500/10 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
            <p className="font-semibold text-cyan-300">Delivery Completed</p>
            <p className="mt-1 text-sm text-slate-300">Is a collection required from the customer?</p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => void handleDeliveredChoice(true)}
                className="flex-1 rounded-2xl bg-purple-600 px-4 py-3 font-semibold text-white hover:bg-purple-500"
              >
                Waiting Collection
              </button>
              <button
                onClick={() => void handleDeliveredChoice(false)}
                className="flex-1 rounded-2xl border border-white/10 bg-slate-800 px-4 py-3 font-semibold text-white hover:bg-slate-700"
              >
                No Collection Required
              </button>
            </div>
          </section>
        ) : null}

        {/* ─── View mode ─────────────────────────────────────────────────── */}
        {!editMode ? (
          <>
            {/* Core details */}
            <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
              <div className="grid gap-4 md:grid-cols-2">
                {([
                  ["Trailer", booking.trailer_number],
                  ["Status", statusLabel(booking.status)],
                  ["Delivery Date", formatDate(booking.delivery_date)],
                  ["Delivery Time", booking.delivery_time ?? "\u2014"],
                  ["Customer", booking.customer ?? "\u2014"],
                  ["Consignee", booking.consignee ?? "\u2014"],
                  ["Delivery Location", booking.delivery_location ?? "\u2014"],
                  ["Booking Reference", booking.booking_reference ?? "\u2014"],
                  ["Escort Required", booking.escort_required ? "Yes" : "No"],
                  ["Created", formatDateTime(booking.created_at)],
                ] as [string, string | null | undefined][]).map(([label, val]) => (
                  <div key={label}>
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{label}</p>
                    <p className={`mt-2 text-sm ${label === "Status" ? "font-semibold text-cyan-300" : "text-slate-200"}`}>{val ?? "\u2014"}</p>
                  </div>
                ))}
                {booking.notes ? (
                  <div className="md:col-span-2">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Notes</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{booking.notes}</p>
                  </div>
                ) : null}
              </div>
            </section>

            {/* Readiness checklist */}
            {booking.status !== "collected" && booking.status !== "cancelled" ? (
              <section className={`rounded-3xl border p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6 ${readinessColor.border} ${readinessColor.bg}`}>
                <div className="flex items-start gap-4">
                  <div className="text-4xl">{getReadinessEmoji(readiness.level)}</div>
                  <div className="flex-1">
                    <h2 className={`text-xl font-semibold ${readinessColor.text}`}>{getReadinessLabel(readiness.level)}</h2>
                    <p className="mt-1 text-sm text-slate-300">{readiness.reason}</p>
                    <div className="mt-4 space-y-2">
                      {readiness.details.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-sm">
                          <span className={item.value ? "text-emerald-400" : "text-rose-400"}>{item.value ? "\u2713" : "\u2717"}</span>
                          <span className={item.optional ? "text-slate-400" : "text-slate-200"}>{item.label}{item.optional ? " (optional)" : ""}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {/* Collection section */}
            {(isWaitingOrDelivered || booking.status === "collected") && aging ? (
              <section className={`rounded-3xl border p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6 ${agingC?.border ?? "border-white/10"} ${agingC?.bg ?? "bg-slate-900/70"}`}>
                <p className={`text-sm font-semibold uppercase tracking-[0.3em] ${agingC?.text ?? "text-slate-400"}`}>
                  Collection Status
                </p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {booking.delivered_at ? (
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Delivered At</p>
                      <p className="mt-1 text-sm text-slate-200">{formatDateTime(booking.delivered_at)}</p>
                    </div>
                  ) : null}

                  {booking.waiting_collection_since ? (
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Waiting Since</p>
                      <p className="mt-1 text-sm text-slate-200">{formatDateTime(booking.waiting_collection_since)}</p>
                    </div>
                  ) : null}

                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Days Waiting</p>
                    <p className={`mt-1 text-sm font-bold ${agingC?.text ?? "text-white"}`}>{aging.waitingDays} day{aging.waitingDays !== 1 ? "s" : ""}</p>
                  </div>

                  {booking.collection_due_date ? (
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Collection Due</p>
                      <p className="mt-1 text-sm text-slate-200">{formatDate(booking.collection_due_date)}</p>
                    </div>
                  ) : null}

                  {aging.isOverdue && aging.overdueDays !== null ? (
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Overdue By</p>
                      <p className="mt-1 text-sm font-bold text-rose-300">{aging.overdueDays} day{aging.overdueDays !== 1 ? "s" : ""}</p>
                    </div>
                  ) : null}

                  {booking.collected_at ? (
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Collected At</p>
                      <p className="mt-1 text-sm text-emerald-300">{formatDateTime(booking.collected_at)}</p>
                    </div>
                  ) : null}
                </div>

                {/* Aging badge */}
                <div className="mt-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-widest ${agingC?.bg} ${agingC?.border} ${agingC?.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${agingC?.dot}`} />
                    {aging.agingLabel}
                  </span>
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Collection Control</p>
                  <div className="mt-3 grid gap-2 text-sm">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500">Days Waiting</p>
                      <p className={`mt-1 font-bold ${agingC?.text ?? "text-slate-200"}`}>{aging.waitingDays}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500">Collection Notes</p>
                      <p className="mt-1 text-xs text-slate-400">{booking.demurrage_notes?.trim() ? booking.demurrage_notes : "—"}</p>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {/* Quick actions */}
            <div className="flex flex-col gap-3 sm:flex-row">
              {booking.status === "waiting_collection" ? (
                <button
                  onClick={() => void handleMarkCollected()}
                  disabled={isMarkingCollected}
                  className="flex-1 rounded-2xl bg-emerald-600 px-5 py-3 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {isMarkingCollected ? "Marking..." : "\u2713 Mark Collected"}
                </button>
              ) : null}

              <button
                onClick={() => setEditMode(true)}
                className="flex-1 rounded-2xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-400"
              >
                Edit Booking
              </button>

              <Link
                href={`/dashboard/trailers/${booking.trailer_id}`}
                className="flex-1 rounded-2xl bg-slate-800 px-5 py-3 text-center font-semibold text-white hover:bg-slate-700"
              >
                Trailer History
              </Link>
            </div>
          </>
        ) : (
          /* ─── Edit mode ──────────────────────────────────────────────────── */
          <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
            <div className="space-y-6">
              {/* Booking fields */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-200">Delivery Date</label>
                  <input type="date" value={values.delivery_date} onChange={(e) => handleChange("delivery_date", e.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-200">Delivery Time</label>
                  <input type="time" value={values.delivery_time} onChange={(e) => handleChange("delivery_time", e.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-200">Customer</label>
                  <input type="text" value={values.customer} onChange={(e) => handleChange("customer", e.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-200">Consignee</label>
                  <input type="text" value={values.consignee} onChange={(e) => handleChange("consignee", e.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-200">Delivery Location</label>
                <input type="text" value={values.delivery_location} onChange={(e) => handleChange("delivery_location", e.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-200">Booking Reference</label>
                  <input type="text" value={values.booking_reference} onChange={(e) => handleChange("booking_reference", e.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-200">Status</label>
                  <select value={values.status} onChange={(e) => handleChange("status", e.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none">
                    {statuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                <input type="checkbox" id="escort_required" checked={values.escort_required} onChange={(e) => handleChange("escort_required", e.target.checked)} className="h-5 w-5 cursor-pointer" />
                <label htmlFor="escort_required" className="cursor-pointer text-sm font-semibold text-slate-200">Escort Required</label>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-200">Notes</label>
                <textarea value={values.notes} onChange={(e) => handleChange("notes", e.target.value)} className="min-h-24 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" />
              </div>

              {/* Collection Control fields */}
              <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-4">
                <p className="mb-4 text-sm font-semibold uppercase tracking-[0.25em] text-purple-400">Collection Control</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-200">Collection Due Date</label>
                    <input type="date" value={values.collection_due_date} onChange={(e) => handleChange("collection_due_date", e.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" />
                  </div>
                </div>
                <div className="mt-4">
                  <label className="mb-2 block text-sm font-semibold text-slate-200">Collection Notes</label>
                  <textarea value={values.demurrage_notes} onChange={(e) => handleChange("demurrage_notes", e.target.value)} className="min-h-20 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => void handleSave()} disabled={isSaving} className="flex-1 rounded-2xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50">
                  {isSaving ? "Saving..." : "Save Changes"}
                </button>
                <button onClick={() => setEditMode(false)} className="flex-1 rounded-2xl border border-white/10 bg-slate-800 px-5 py-3 font-semibold text-white hover:bg-slate-700">
                  Cancel
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}