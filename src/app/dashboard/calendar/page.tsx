"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { DAILY_DELIVERY_CAPACITY } from "@/lib/capacity-config";
import {
  addDays,
  calculateDayCapacity,
  CAPACITY_STATE_LABELS,
  capacityStateColours,
  formatDateFull,
  formatDateMedium,
  formatDateShort,
  formatMonthYear,
  formatTime,
  getDayNumber,
  getDaysWaiting,
  getLocalDateKey,
  getDateKey,
  getMonthEnd,
  getMonthStart,
  getWeekdayShort,
  getWeekEnd,
  getWeekStart,
  parseDateParam,
  WORKLOAD_LABELS,
  workloadColours,
  type DayCapacity,
} from "@/lib/calendar-utils";
import {
  calculateOperationalReadiness,
  getReadinessEmoji,
  getReadinessLabel,
} from "@/lib/operational-readiness";

// ============================================================================
// Types
// ============================================================================

export type ViewMode = "day" | "week" | "month";

export type FilterType =
  | "all"
  | "scheduled"
  | "ready"
  | "on_delivery"
  | "waiting_collection"
  | "completed"
  | "escort_required";

type CalendarBooking = {
  id: string;
  trailer_id: string;
  delivery_date: string;
  delivery_time: string | null;
  customer: string | null;
  consignee: string | null;
  delivery_location: string | null;
  booking_reference: string | null;
  escort_required: boolean;
  status: string;
  notes: string | null;
  trailer_number: string | null;
  trailer_compound_position: string | null;
  trailer_departure_date: string | null;
};

// ============================================================================
// Helpers
// ============================================================================

const parseViewParam = (v: string | null): ViewMode | null => {
  if (v === "day" || v === "week" || v === "month") return v;
  return null;
};

const statusLabel = (status: string): string =>
  status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const isCompleted = (status: string) =>
  status === "delivered" || status === "collected";

const STATUS_COLOURS: Record<
  string,
  { bg: string; text: string; border: string; dot: string }
> = {
  scheduled: {
    bg: "bg-slate-500/10",
    text: "text-slate-300",
    border: "border-slate-500/30",
    dot: "bg-slate-400",
  },
  ready: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-200",
    border: "border-emerald-500/30",
    dot: "bg-emerald-400",
  },
  on_delivery: {
    bg: "bg-blue-500/10",
    text: "text-blue-200",
    border: "border-blue-500/30",
    dot: "bg-blue-400",
  },
  delivered: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-300",
    border: "border-emerald-500/30",
    dot: "bg-emerald-300",
  },
  waiting_collection: {
    bg: "bg-purple-500/10",
    text: "text-purple-200",
    border: "border-purple-500/30",
    dot: "bg-purple-400",
  },
  collected: {
    bg: "bg-slate-500/10",
    text: "text-slate-400",
    border: "border-slate-500/30",
    dot: "bg-slate-500",
  },
  cancelled: {
    bg: "bg-rose-500/10",
    text: "text-rose-300",
    border: "border-rose-500/30",
    dot: "bg-rose-500",
  },
};

const bookingColour = (status: string) =>
  STATUS_COLOURS[status] ?? STATUS_COLOURS["scheduled"]!;

const sortBookings = (a: CalendarBooking, b: CalendarBooking): number => {
  const ta = a.delivery_time ?? "99:99";
  const tb = b.delivery_time ?? "99:99";
  if (ta !== tb) return ta < tb ? -1 : 1;
  return (a.trailer_number ?? "").localeCompare(b.trailer_number ?? "");
};

const applyFilter = (
  bookings: CalendarBooking[],
  filter: FilterType
): CalendarBooking[] => {
  switch (filter) {
    case "scheduled":
      return bookings.filter((b) => b.status === "scheduled");
    case "ready":
      return bookings.filter((b) => b.status === "ready");
    case "on_delivery":
      return bookings.filter((b) => b.status === "on_delivery");
    case "waiting_collection":
      return bookings.filter((b) => b.status === "waiting_collection");
    case "completed":
      return bookings.filter((b) => isCompleted(b.status));
    case "escort_required":
      return bookings.filter((b) => b.escort_required);
    default:
      return bookings;
  }
};

// ============================================================================
// Sub-components
// ============================================================================

function CapacityBadge({ cap, compact = false }: { cap: DayCapacity; compact?: boolean }) {
  const c = capacityStateColours(cap.state);
  if (compact) {
    return (
      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${c.text}`}>
        {cap.active}/{DAILY_DELIVERY_CAPACITY}
      </span>
    );
  }
  return (
    <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-widest ${c.bg} ${c.border} ${c.text}`}>
      {CAPACITY_STATE_LABELS[cap.state]} {"\u00b7"} {cap.active}/{DAILY_DELIVERY_CAPACITY}
    </span>
  );
}

function WorkloadBadge({ cap }: { cap: DayCapacity }) {
  const c = workloadColours(cap.workload);
  return (
    <span className={`flex items-center gap-1 text-[10px] font-medium ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {WORKLOAD_LABELS[cap.workload]}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const c = bookingColour(status);
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${c.bg} ${c.border} ${c.text}`}>
      {statusLabel(status)}
    </span>
  );
}

function ReadinessBadge({ booking, todayKey }: { booking: CalendarBooking; todayKey: string }) {
  if (booking.status === "collected" || booking.status === "cancelled") return null;
  const result = calculateOperationalReadiness(
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
    booking.trailer_id
      ? {
          id: booking.trailer_id,
          trailer_number: booking.trailer_number,
          compound_position: booking.trailer_compound_position,
          departure_date: booking.trailer_departure_date,
        }
      : null,
    todayKey
  );
  return (
    <span className="text-xs" title={getReadinessLabel(result.level)}>
      {getReadinessEmoji(result.level)}
    </span>
  );
}

// ============================================================================
// BookingRow - Day view
// ============================================================================

function BookingRow({ booking, todayKey }: { booking: CalendarBooking; todayKey: string }) {
  const c = bookingColour(booking.status);
  return (
    <Link
      href={`/dashboard/deliveries/${booking.id}`}
      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 transition hover:ring-1 hover:ring-cyan-400/50 ${c.bg} ${c.border}`}
    >
      <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${c.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {booking.delivery_time ? (
            <span className="text-sm font-bold text-white">{formatTime(booking.delivery_time)}</span>
          ) : null}
          <span className="truncate text-sm font-semibold text-white">
            {booking.customer || booking.consignee || "\u2014"}
          </span>
          {booking.trailer_number ? (
            <Link
              href={`/dashboard/trailers/${booking.trailer_number}`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-cyan-400 hover:underline"
            >
              {booking.trailer_number}
            </Link>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {booking.consignee && booking.consignee !== booking.customer ? (
            <span className="text-xs text-slate-400">{booking.consignee}</span>
          ) : null}
          {booking.delivery_location ? (
            <span className="text-xs text-slate-400">{booking.delivery_location}</span>
          ) : null}
          {booking.booking_reference ? (
            <span className="text-xs text-slate-500">Ref: {booking.booking_reference}</span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-1">
        <StatusBadge status={booking.status} />
        <div className="flex items-center gap-1">
          <ReadinessBadge booking={booking} todayKey={todayKey} />
          {booking.escort_required ? (
            <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-300">
              Escort
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

// ============================================================================
// BookingChip - Week/Month compact view
// ============================================================================

function BookingChip({ booking }: { booking: CalendarBooking }) {
  const c = bookingColour(booking.status);
  return (
    <Link
      href={`/dashboard/deliveries/${booking.id}`}
      className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition hover:ring-1 hover:ring-cyan-400/40 ${c.bg} ${c.border}`}
    >
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${c.dot}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-white">
          {booking.customer || booking.consignee || "\u2014"}
        </p>
        <div className="flex items-center gap-1">
          {booking.delivery_time ? (
            <span className="text-[10px] text-slate-400">{formatTime(booking.delivery_time)}</span>
          ) : null}
          {booking.trailer_number ? (
            <span className="text-[10px] text-slate-500">{booking.trailer_number}</span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

// ============================================================================
// DayView
// ============================================================================

function DayView({
  dateKey,
  bookings,
  todayKey,
  activeFilter,
  cap,
}: {
  dateKey: string;
  bookings: CalendarBooking[];
  todayKey: string;
  activeFilter: FilterType;
  cap: DayCapacity;
}) {
  const filtered = useMemo(() => applyFilter(bookings, activeFilter), [bookings, activeFilter]);
  const timed = useMemo(() => filtered.filter((b) => b.delivery_time).sort(sortBookings), [filtered]);
  const unscheduled = useMemo(() => filtered.filter((b) => !b.delivery_time).sort(sortBookings), [filtered]);
  const capC = capacityStateColours(cap.state);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className={`text-sm font-semibold uppercase tracking-[0.3em] ${dateKey === todayKey ? "text-cyan-400" : "text-slate-400"}`}>
            {dateKey === todayKey ? "Today" : getWeekdayShort(dateKey)}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">{formatDateFull(dateKey)}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CapacityBadge cap={cap} />
          <WorkloadBadge cap={cap} />
        </div>
        <Link
          href={`/dashboard/deliveries/new?date=${dateKey}`}
          className="ml-auto rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
        >
          + Create Booking
        </Link>
      </div>

      <div className={`rounded-2xl border p-4 ${capC.bg} ${capC.border}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className={`font-semibold ${capC.text}`}>{CAPACITY_STATE_LABELS[cap.state]}</span>
          <span className="text-slate-400">
            {cap.active} active {"\u00b7"} {cap.completed} completed {"\u00b7"} {Math.max(0, cap.remaining)} remaining of {DAILY_DELIVERY_CAPACITY}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div className={`h-full rounded-full transition-all ${capC.bar}`} style={{ width: `${Math.min(cap.percentage, 100)}%` }} />
        </div>
      </div>

      {timed.length > 0 ? (
        <div className="space-y-2">
          {timed.map((b) => <BookingRow key={b.id} booking={b} todayKey={todayKey} />)}
        </div>
      ) : null}

      {unscheduled.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
            Unscheduled Time
          </p>
          <div className="space-y-2">
            {unscheduled.map((b) => <BookingRow key={b.id} booking={b} todayKey={todayKey} />)}
          </div>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 p-6 text-center text-sm text-slate-500">
          No bookings for this day.
        </div>
      ) : null}
    </div>
  );
}

// ============================================================================
// WeekView
// ============================================================================

function WeekView({
  weekStart,
  bookingsByDate,
  todayKey,
  activeFilter,
  capByDate,
  onDayClick,
}: {
  weekStart: string;
  bookingsByDate: Map<string, CalendarBooking[]>;
  todayKey: string;
  activeFilter: FilterType;
  capByDate: Map<string, DayCapacity>;
  onDayClick: (dateKey: string) => void;
}) {
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const dateKey = addDays(weekStart, i);
        const all = bookingsByDate.get(dateKey) ?? [];
        const filtered = applyFilter(all, activeFilter).sort(sortBookings);
        const cap = capByDate.get(dateKey) ?? calculateDayCapacity([]);
        return { dateKey, filtered, cap };
      }),
    [weekStart, bookingsByDate, activeFilter, capByDate]
  );

  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-7">
      {days.map(({ dateKey, filtered, cap }) => {
        const isToday = dateKey === todayKey;
        const capC = capacityStateColours(cap.state);

        return (
          <div
            key={dateKey}
            className={`rounded-2xl border p-3 ${isToday ? "border-cyan-400/50 bg-cyan-500/5" : "border-white/10 bg-slate-950/60"}`}
          >
            <button className="w-full text-left" onClick={() => onDayClick(dateKey)}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${isToday ? "text-cyan-400" : "text-slate-500"}`}>
                    {getWeekdayShort(dateKey)}
                  </p>
                  <p className={`text-lg font-bold ${isToday ? "text-white" : "text-slate-300"}`}>
                    {getDayNumber(dateKey)}
                  </p>
                </div>
                {cap.active > 0 ? <CapacityBadge cap={cap} compact /> : null}
              </div>
              {cap.active > 0 ? (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-800">
                  <div className={`h-full rounded-full ${capC.bar}`} style={{ width: `${Math.min(cap.percentage, 100)}%` }} />
                </div>
              ) : null}
            </button>

            <div className="mt-2 space-y-1.5">
              {filtered.length === 0 ? (
                <p className="text-[10px] text-slate-700">No deliveries</p>
              ) : (
                filtered.map((b) => <BookingChip key={b.id} booking={b} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// MonthView
// ============================================================================

function MonthView({
  anchorDate,
  bookingsByDate,
  todayKey,
  activeFilter,
  capByDate,
  onDayClick,
}: {
  anchorDate: string;
  bookingsByDate: Map<string, CalendarBooking[]>;
  todayKey: string;
  activeFilter: FilterType;
  capByDate: Map<string, DayCapacity>;
  onDayClick: (dateKey: string) => void;
}) {
  const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const monthStart = getMonthStart(anchorDate);
  const monthEnd = getMonthEnd(anchorDate);
  const gridStart = getWeekStart(monthStart);
  const [ay, am] = anchorDate.split("-").map(Number);
  const MAX_VISIBLE = 3;

  const cells = useMemo(() => {
    const result: Array<{ dateKey: string; inMonth: boolean; filtered: CalendarBooking[]; cap: DayCapacity }> = [];
    let d = gridStart;
    while (d <= monthEnd || result.length % 7 !== 0) {
      const [dy, dm] = d.split("-").map(Number);
      const inMonth = dy === ay && dm === am;
      const all = bookingsByDate.get(d) ?? [];
      const filtered = applyFilter(all, activeFilter).sort(sortBookings);
      const cap = capByDate.get(d) ?? calculateDayCapacity([]);
      result.push({ dateKey: d, inMonth, filtered, cap });
      d = addDays(d, 1);
      if (result.length > 42) break;
    }
    return result;
  }, [gridStart, monthEnd, ay, am, bookingsByDate, activeFilter, capByDate]);

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAY_HEADERS.map((w) => (
          <div key={w} className="py-2 text-center text-[10px] font-bold uppercase tracking-widest text-slate-600">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map(({ dateKey, inMonth, filtered, cap }) => {
          const isToday = dateKey === todayKey;
          const capC = capacityStateColours(cap.state);
          const visible = filtered.slice(0, MAX_VISIBLE);
          const overflow = filtered.length - MAX_VISIBLE;
          const waitingCount = filtered.filter((b) => b.status === "waiting_collection").length;

          return (
            <button
              key={dateKey}
              onClick={() => onDayClick(dateKey)}
              className={`flex min-h-[6rem] flex-col rounded-xl border p-1.5 text-left transition hover:ring-1 hover:ring-cyan-400/40 ${
                isToday ? "border-cyan-400/50 bg-cyan-500/10"
                  : cap.active > 0 && inMonth ? `${capC.bg} ${capC.border}`
                  : "border-white/5 bg-slate-950/40"
              } ${!inMonth ? "opacity-30" : ""}`}
            >
              <div className="flex items-start justify-between gap-0.5">
                <span className={`text-sm font-bold ${isToday ? "text-cyan-300" : inMonth ? "text-slate-200" : "text-slate-600"}`}>
                  {getDayNumber(dateKey)}
                </span>
                <div className="flex flex-col items-end gap-0.5">
                  {cap.active > 0 ? (
                    <span className={`rounded-full px-1 py-0.5 text-[9px] font-bold ${capC.text}`}>{cap.active}</span>
                  ) : null}
                  {waitingCount > 0 ? (
                    <span className="rounded-full bg-purple-500/20 px-1 py-0.5 text-[9px] font-bold text-purple-300">W{waitingCount}</span>
                  ) : null}
                </div>
              </div>
              {cap.active > 0 && inMonth ? (
                <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-slate-800">
                  <div className={`h-full rounded-full ${capC.bar}`} style={{ width: `${Math.min(cap.percentage, 100)}%` }} />
                </div>
              ) : null}
              {inMonth ? (
                <div className="mt-1 space-y-0.5 text-[9px]">
                  {visible.map((b) => {
                    const col = bookingColour(b.status);
                    return (
                      <div key={b.id} className={`flex items-center gap-0.5 truncate ${col.text}`}>
                        <span className={`h-1 w-1 flex-shrink-0 rounded-full ${col.dot}`} />
                        <span className="truncate">{b.customer || b.consignee || "\u2014"}</span>
                      </div>
                    );
                  })}
                  {overflow > 0 ? <p className="text-slate-500">+{overflow} more</p> : null}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/30" /> Available</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500/30" /> Near Capacity</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rose-500/30" /> At / Over ({DAILY_DELIVERY_CAPACITY})</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-cyan-400/50 bg-cyan-500/10" /> Today</span>
        <span className="flex items-center gap-1.5"><span className="rounded-full bg-purple-500/20 px-1 text-purple-300">W</span> Waiting Collection</span>
      </div>
    </div>
  );
}

// ============================================================================
// WaitingCollectionList
// ============================================================================

function WaitingCollectionList({ bookings }: { bookings: CalendarBooking[] }) {
  if (bookings.length === 0) return null;

  return (
    <section className="rounded-3xl border border-purple-500/20 bg-purple-500/5 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
      <div className="flex items-center gap-3">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-purple-400">Waiting Collection</p>
        <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-xs text-purple-300">
          {bookings.length}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {bookings.map((b) => {
          const days = getDaysWaiting(b.delivery_date);
          return (
            <div key={b.id} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-purple-500/20 bg-slate-950/60 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-semibold text-white">{b.customer || b.consignee || "\u2014"}</span>
                  {b.trailer_number ? (
                    <Link href={`/dashboard/trailers/${b.trailer_number}`} className="text-xs text-cyan-400 hover:underline">
                      {b.trailer_number}
                    </Link>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-slate-400">Delivery date: {formatDateMedium(b.delivery_date)}</p>
                <p className={`mt-0.5 text-xs font-semibold ${days >= 3 ? "text-rose-400" : "text-amber-400"}`}>
                  Waiting {days} day{days !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Link href={`/dashboard/deliveries/${b.id}`} className="rounded-xl bg-purple-500/20 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-500/30">
                  Booking
                </Link>
                {b.trailer_number ? (
                  <Link href={`/dashboard/trailers/${b.trailer_number}`} className="rounded-xl border border-white/10 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
                    Trailer
                  </Link>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ============================================================================
// FilterBar
// ============================================================================

const FILTERS: { value: FilterType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "scheduled", label: "Scheduled" },
  { value: "ready", label: "Ready" },
  { value: "on_delivery", label: "On Delivery" },
  { value: "waiting_collection", label: "Waiting Collection" },
  { value: "completed", label: "Completed" },
  { value: "escort_required", label: "Escort Required" },
];

function FilterBar({ active, onChange }: { active: FilterType; onChange: (f: FilterType) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {FILTERS.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
            active === value ? "bg-cyan-500 text-slate-950" : "border border-white/10 bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// CalendarContent (uses useSearchParams)
// ============================================================================

function CalendarContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const todayKey = useMemo(() => getLocalDateKey(), []);

  const view: ViewMode = parseViewParam(searchParams.get("view")) ?? "week";
  const anchorDate: string = parseDateParam(searchParams.get("date")) ?? todayKey;

  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [waitingBookings, setWaitingBookings] = useState<CalendarBooking[]>([]);
  const [todayCount, setTodayCount] = useState(0);
  const [tomorrowCount, setTomorrowCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");

  const { rangeStart, rangeEnd } = useMemo(() => {
    if (view === "day") return { rangeStart: anchorDate, rangeEnd: anchorDate };
    if (view === "week") {
      const ws = getWeekStart(anchorDate);
      return { rangeStart: ws, rangeEnd: getWeekEnd(ws) };
    }
    return { rangeStart: getMonthStart(anchorDate), rangeEnd: getMonthEnd(anchorDate) };
  }, [view, anchorDate]);

  const enrich = useCallback((raw: unknown[]): CalendarBooking[] =>
    raw.map((b) => {
      const booking = b as Record<string, unknown>;
      const trailer = booking["trailers"] as Record<string, unknown> | null;
      return {
        id: booking["id"] as string,
        trailer_id: booking["trailer_id"] as string,
        delivery_date: booking["delivery_date"] as string,
        delivery_time: (booking["delivery_time"] as string | null) ?? null,
        customer: (booking["customer"] as string | null) ?? null,
        consignee: (booking["consignee"] as string | null) ?? null,
        delivery_location: (booking["delivery_location"] as string | null) ?? null,
        booking_reference: (booking["booking_reference"] as string | null) ?? null,
        escort_required: (booking["escort_required"] as boolean) ?? false,
        status: booking["status"] as string,
        notes: (booking["notes"] as string | null) ?? null,
        trailer_number: (trailer?.["trailer_number"] as string | null) ?? null,
        trailer_compound_position: (trailer?.["compound_position"] as string | null) ?? null,
        trailer_departure_date: (trailer?.["departure_date"] as string | null) ?? null,
      };
    }), []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const tomorrowKey = addDays(todayKey, 1);

      const [
        { data: rangeData, error: rangeErr },
        { data: waitingData, error: waitingErr },
        { count: todayCountData, error: todayErr },
        { count: tomorrowCountData, error: tomorrowErr },
      ] = await Promise.all([
        supabase
          .from("delivery_bookings")
          .select(`id, trailer_id, delivery_date, delivery_time, customer, consignee, delivery_location, booking_reference, escort_required, status, notes, trailers(trailer_number, compound_position, departure_date)`)
          .gte("delivery_date", rangeStart)
          .lte("delivery_date", rangeEnd)
          .order("delivery_date", { ascending: true })
          .order("delivery_time", { ascending: true, nullsFirst: false }),

        supabase
          .from("delivery_bookings")
          .select(`id, trailer_id, delivery_date, delivery_time, customer, consignee, delivery_location, booking_reference, escort_required, status, notes, trailers(trailer_number, compound_position, departure_date)`)
          .eq("status", "waiting_collection")
          .order("delivery_date", { ascending: true }),

        supabase
          .from("delivery_bookings")
          .select("id", { count: "exact", head: true })
          .eq("delivery_date", todayKey)
          .neq("status", "cancelled"),

        supabase
          .from("delivery_bookings")
          .select("id", { count: "exact", head: true })
          .eq("delivery_date", tomorrowKey)
          .neq("status", "cancelled"),
      ]);

      if (rangeErr) {
        console.error("[Calendar] Range error:", { message: rangeErr.message, details: rangeErr.details, hint: rangeErr.hint, code: rangeErr.code });
        throw rangeErr;
      }
      if (waitingErr) {
        console.error("[Calendar] Waiting error:", { message: waitingErr.message, details: waitingErr.details, hint: waitingErr.hint, code: waitingErr.code });
      }
      if (todayErr) console.error("[Calendar] Today count error:", todayErr);
      if (tomorrowErr) console.error("[Calendar] Tomorrow count error:", tomorrowErr);

      setBookings(enrich(rangeData ?? []));
      setWaitingBookings(enrich(waitingData ?? []));
      setTodayCount(todayCountData ?? 0);
      setTomorrowCount(tomorrowCountData ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load calendar data.");
    } finally {
      setIsLoading(false);
    }
  }, [rangeStart, rangeEnd, todayKey, enrich]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadData(); }, [loadData]);

  const bookingsByDate = useMemo(() => {
    const map = new Map<string, CalendarBooking[]>();
    bookings.forEach((b) => {
      const key = getDateKey(b.delivery_date) ?? b.delivery_date.substring(0, 10);
      const list = map.get(key) ?? [];
      list.push(b);
      map.set(key, list);
    });
    return map;
  }, [bookings]);

  const capByDate = useMemo(() => {
    const map = new Map<string, DayCapacity>();
    bookingsByDate.forEach((list, key) => { map.set(key, calculateDayCapacity(list)); });
    return map;
  }, [bookingsByDate]);

  const periodCount = useMemo(() => bookings.filter((b) => b.status !== "cancelled").length, [bookings]);

  const todayCap = useMemo(() => calculateDayCapacity(bookingsByDate.get(todayKey) ?? []), [bookingsByDate, todayKey]);

  const periodLabel = view === "day" ? "Deliveries This Day" : view === "week" ? "Deliveries This Week" : "Deliveries This Month";

  const viewTitle = useMemo(() => {
    if (view === "day") return formatDateFull(anchorDate);
    if (view === "week") {
      const ws = getWeekStart(anchorDate);
      return `${formatDateShort(ws)} \u2013 ${formatDateShort(getWeekEnd(ws))}`;
    }
    return formatMonthYear(anchorDate);
  }, [view, anchorDate]);

  const navigate = (dir: -1 | 1) => {
    let newDate = anchorDate;
    if (view === "day") newDate = addDays(anchorDate, dir);
    else if (view === "week") newDate = addDays(anchorDate, dir * 7);
    else {
      const [y, m] = anchorDate.split("-").map(Number);
      const dt = new Date(y, m - 1 + dir, 1);
      newDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-01`;
    }
    router.push(`/dashboard/calendar?view=${view}&date=${newDate}`);
  };

  const switchView = (v: ViewMode) => router.push(`/dashboard/calendar?view=${v}&date=${anchorDate}`);
  const goToDay = (dateKey: string) => router.push(`/dashboard/calendar?view=day&date=${dateKey}`);

  const capC = capacityStateColours(todayCap.state);

  const VIEWS: { value: ViewMode; label: string }[] = [
    { value: "day", label: "Day" },
    { value: "week", label: "Week" },
    { value: "month", label: "Month" },
  ];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">

        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Operations Calendar</h1>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">Plan deliveries, review workload and identify capacity issues.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard" className="self-start rounded-2xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">Dashboard</Link>
              <Link href="/dashboard/deliveries" className="self-start rounded-2xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">Deliveries</Link>
              <Link href="/dashboard/operations" className="self-start rounded-2xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">Operations</Link>
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
        ) : null}

        <section className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Deliveries Today</p>
            <p className="mt-2 text-2xl font-bold text-cyan-300">{todayCount}</p>
          </article>
          <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Deliveries Tomorrow</p>
            <p className="mt-2 text-2xl font-bold text-slate-200">{tomorrowCount}</p>
          </article>
          <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{periodLabel}</p>
            <p className="mt-2 text-2xl font-bold text-slate-200">{periodCount}</p>
          </article>
          <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Waiting Collection</p>
            <p className="mt-2 text-2xl font-bold text-purple-300">{waitingBookings.length}</p>
          </article>
          <article className={`rounded-2xl border p-4 shadow-lg shadow-black/20 backdrop-blur ${capC.bg} ${capC.border}`}>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Today Capacity</p>
            <div className="mt-2 flex items-baseline gap-2">
              <p className={`text-2xl font-bold ${capC.text}`}>{todayCap.active}</p>
              <p className="text-sm text-slate-500">/ {DAILY_DELIVERY_CAPACITY}</p>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div className={`h-full rounded-full ${capC.bar}`} style={{ width: `${Math.min(todayCap.percentage, 100)}%` }} />
            </div>
            <p className={`mt-1 text-[10px] font-semibold uppercase tracking-widest ${capC.text}`}>{CAPACITY_STATE_LABELS[todayCap.state]}</p>
          </article>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-2xl border border-white/10 bg-slate-950/60 p-1">
              {VIEWS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => switchView(value)}
                  className={`rounded-xl px-4 py-2 text-sm font-medium transition ${view === value ? "bg-cyan-500 text-slate-950" : "text-slate-400 hover:text-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => navigate(-1)} className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700">{"\u2039"}</button>
              <span className="min-w-[14rem] text-center text-sm font-semibold text-white">{viewTitle}</span>
              <button onClick={() => navigate(1)} className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700">{"\u203a"}</button>
            </div>
            <button onClick={() => router.push(`/dashboard/calendar?view=${view}&date=${todayKey}`)} className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700">Today</button>
          </div>
          <div className="mt-3">
            <FilterBar active={activeFilter} onChange={setActiveFilter} />
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-slate-400">Loading {view} view{"\u2026"}</div>
          ) : (
            <>
              {view === "day" ? (
                <DayView
                  dateKey={anchorDate}
                  bookings={bookingsByDate.get(anchorDate) ?? []}
                  todayKey={todayKey}
                  activeFilter={activeFilter}
                  cap={capByDate.get(anchorDate) ?? calculateDayCapacity([])}
                />
              ) : null}
              {view === "week" ? (
                <WeekView
                  weekStart={getWeekStart(anchorDate)}
                  bookingsByDate={bookingsByDate}
                  todayKey={todayKey}
                  activeFilter={activeFilter}
                  capByDate={capByDate}
                  onDayClick={goToDay}
                />
              ) : null}
              {view === "month" ? (
                <MonthView
                  anchorDate={anchorDate}
                  bookingsByDate={bookingsByDate}
                  todayKey={todayKey}
                  activeFilter={activeFilter}
                  capByDate={capByDate}
                  onDayClick={goToDay}
                />
              ) : null}
            </>
          )}
        </section>

        {!isLoading ? <WaitingCollectionList bookings={waitingBookings} /> : null}

        <div className="flex justify-end">
          <Link
            href={`/dashboard/deliveries/new${view === "day" ? `?date=${anchorDate}` : ""}`}
            className="rounded-2xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-400"
          >
            + New Booking
          </Link>
        </div>
      </div>
    </main>
  );
}

// ============================================================================
// Page export with Suspense (required for useSearchParams in Next.js)
// ============================================================================

function CalendarLoading() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400 shadow-2xl backdrop-blur">
          Loading Operations Calendar{"\u2026"}
        </div>
      </div>
    </main>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<CalendarLoading />}>
      <CalendarContent />
    </Suspense>
  );
}