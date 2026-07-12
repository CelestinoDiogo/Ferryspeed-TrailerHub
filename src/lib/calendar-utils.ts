// Ferryspeed TrailerHub — Calendar Date & Capacity Utilities
// Reusable helpers for the Operations Calendar. Imports base helpers from
// operational-readiness to avoid duplication.

import { getLocalDateKey, getDateKey } from "./operational-readiness";
import { DAILY_DELIVERY_CAPACITY } from "./capacity-config";

export { getLocalDateKey, getDateKey };

// ─── Date arithmetic ──────────────────────────────────────────────────────────

/** Add N days to a YYYY-MM-DD key and return a new YYYY-MM-DD key. */
export const addDays = (dateKey: string, days: number): string => {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return [
    String(dt.getFullYear()),
    String(dt.getMonth() + 1).padStart(2, "0"),
    String(dt.getDate()).padStart(2, "0"),
  ].join("-");
};

/** Monday of the week containing dateKey. */
export const getWeekStart = (dateKey: string): string => {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay(); // 0 = Sunday
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setDate(dt.getDate() + diff);
  return [
    String(dt.getFullYear()),
    String(dt.getMonth() + 1).padStart(2, "0"),
    String(dt.getDate()).padStart(2, "0"),
  ].join("-");
};

/** Sunday of the week containing dateKey. */
export const getWeekEnd = (dateKey: string): string => addDays(getWeekStart(dateKey), 6);

/** First day of the month of dateKey. */
export const getMonthStart = (dateKey: string): string => {
  const [y, m] = dateKey.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
};

/** Last day of the month of dateKey. */
export const getMonthEnd = (dateKey: string): string => {
  const [y, m] = dateKey.split("-").map(Number);
  const last = new Date(y, m, 0).getDate(); // day 0 of next month
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
};

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Numeric day from a YYYY-MM-DD key. */
export const getDayNumber = (dateKey: string): number => Number(dateKey.split("-")[2]);

/** Short weekday name (Mon, Tue…) from a YYYY-MM-DD key. */
export const getWeekdayShort = (dateKey: string): string => {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short" });
};

/** Long weekday name (Monday, Tuesday…) from a YYYY-MM-DD key. */
export const getWeekdayLong = (dateKey: string): string => {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long" });
};

/** "11 Jul" — short date label. */
export const formatDateShort = (dateKey: string): string => {
  try {
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return dateKey;
  }
};

/** "11 Jul 2026" — medium date label. */
export const formatDateMedium = (dateKey: string): string => {
  try {
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateKey;
  }
};

/** "Saturday, 11 July 2026" — full date label. */
export const formatDateFull = (dateKey: string): string => {
  try {
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return dateKey;
  }
};

/** "July 2026" — month + year label. */
export const formatMonthYear = (dateKey: string): string => {
  try {
    const [y, m] = dateKey.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
    });
  } catch {
    return dateKey;
  }
};

/** Trim HH:MM:SS → HH:MM. */
export const formatTime = (value: string | null | undefined): string => {
  if (!value) return "";
  return value.substring(0, 5);
};

// ─── URL param helpers ────────────────────────────────────────────────────────

/** Validate and return a YYYY-MM-DD string, or null if invalid. */
export const parseDateParam = (param: string | null): string | null => {
  if (!param) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(param)) return null;
  try {
    const [y, m, d] = param.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    if (isNaN(dt.getTime())) return null;
    // Round-trip check to catch e.g. 2026-02-30
    const rebuilt = [
      String(dt.getFullYear()),
      String(dt.getMonth() + 1).padStart(2, "0"),
      String(dt.getDate()).padStart(2, "0"),
    ].join("-");
    return rebuilt === param ? param : null;
  } catch {
    return null;
  }
};

// ─── Waiting collection helpers ───────────────────────────────────────────────

/** Days between the booking's delivery date and today (local). */
export const getDaysWaiting = (deliveryDate: string): number => {
  try {
    const [y, m, d] = deliveryDate.split("-").map(Number);
    const delivery = new Date(y, m - 1, d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = today.getTime() - delivery.getTime();
    return Math.max(0, Math.floor(diff / 86400000));
  } catch {
    return 0;
  }
};

// ─── Capacity ─────────────────────────────────────────────────────────────────

export type CapacityState = "available" | "near" | "reached" | "exceeded";
export type WorkloadLevel = "light" | "moderate" | "heavy" | "overloaded";

export interface DayCapacity {
  total: number;       // all excl. cancelled
  active: number;      // counts against capacity (excl. cancelled, delivered, collected)
  completed: number;   // delivered + collected
  cancelled: number;
  remaining: number;   // capacity - active (can be negative)
  percentage: number;  // active / capacity * 100
  state: CapacityState;
  workload: WorkloadLevel;
}

export const calculateDayCapacity = (dayBookings: { status: string }[]): DayCapacity => {
  const cancelled = dayBookings.filter((b) => b.status === "cancelled").length;
  const completed = dayBookings.filter(
    (b) => b.status === "delivered" || b.status === "collected"
  ).length;
  const active = dayBookings.length - cancelled - completed;
  const total = dayBookings.length - cancelled;
  const remaining = DAILY_DELIVERY_CAPACITY - active;
  const percentage =
    DAILY_DELIVERY_CAPACITY > 0
      ? Math.round((active / DAILY_DELIVERY_CAPACITY) * 100)
      : 0;

  let state: CapacityState;
  if (active > DAILY_DELIVERY_CAPACITY) state = "exceeded";
  else if (active === DAILY_DELIVERY_CAPACITY) state = "reached";
  else if (active >= Math.round(DAILY_DELIVERY_CAPACITY * 0.8)) state = "near";
  else state = "available";

  const ratio = DAILY_DELIVERY_CAPACITY > 0 ? active / DAILY_DELIVERY_CAPACITY : 0;
  let workload: WorkloadLevel;
  if (ratio > 1) workload = "overloaded";
  else if (ratio >= 0.8) workload = "heavy";
  else if (ratio >= 0.5) workload = "moderate";
  else workload = "light";

  return { total, active, completed, cancelled, remaining, percentage, state, workload };
};

export const CAPACITY_STATE_LABELS: Record<CapacityState, string> = {
  available: "Available",
  near: "Near Capacity",
  reached: "Capacity Reached",
  exceeded: "Capacity Exceeded",
};

export const WORKLOAD_LABELS: Record<WorkloadLevel, string> = {
  light: "Light",
  moderate: "Moderate",
  heavy: "Heavy",
  overloaded: "Overloaded",
};

export const capacityStateColours = (state: CapacityState) => {
  switch (state) {
    case "exceeded":
      return { bg: "bg-rose-500/10", border: "border-rose-500/30", text: "text-rose-300", bar: "bg-rose-500" };
    case "reached":
      return { bg: "bg-rose-500/10", border: "border-rose-500/30", text: "text-rose-300", bar: "bg-rose-500" };
    case "near":
      return { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-300", bar: "bg-amber-500" };
    default:
      return { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-300", bar: "bg-emerald-500" };
  }
};

export const workloadColours = (level: WorkloadLevel) => {
  switch (level) {
    case "overloaded":
      return { dot: "bg-rose-500", text: "text-rose-300" };
    case "heavy":
      return { dot: "bg-amber-500", text: "text-amber-300" };
    case "moderate":
      return { dot: "bg-yellow-500", text: "text-yellow-300" };
    default:
      return { dot: "bg-emerald-500", text: "text-emerald-300" };
  }
};
