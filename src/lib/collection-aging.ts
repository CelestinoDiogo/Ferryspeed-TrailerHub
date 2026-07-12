// Ferryspeed TrailerHub — Collection Aging Utilities
//
// Single source of truth for all collection-related calculations.
// Reuse these helpers across Deliveries, Operations Board, Calendar and Dashboard.
// No duplicate logic. No any types. No AI. All calculations are deterministic.

import { getLocalDateKey } from "./operational-readiness";

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * Reusable collection status configuration.
 * Rules:
 * - 0–2 days: Green / Normal
 * - 3–7 days: Amber / Monitor
 * - 8+ days: Red / Attention Required
 */
export const COLLECTION_STATUS_RULES = {
  green: { minDays: 0, maxDays: 2, label: "Normal" },
  amber: { minDays: 3, maxDays: 7, label: "Monitor" },
  red: { minDays: 8, maxDays: Number.POSITIVE_INFINITY, label: "Attention Required" },
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgingLevel = "green" | "amber" | "red";

export interface CollectionAging {
  waitingDays:    number;          // days since waiting_collection_since (or fallback)
  agingLevel:     AgingLevel;
  agingLabel:     string;
  waitingSince:   string | null;   // ISO timestamp used as the start date
  dueDate:        string | null;   // collection_due_date (YYYY-MM-DD)
  daysUntilDue:   number | null;   // negative = overdue
  overdueDays:    number | null;   // null when no due date or not yet due
  isOverdue:      boolean;
}

/** Input shape — only the fields needed for calculations. */
export interface CollectionBookingInput {
  delivery_date:             string;
  delivered_at?:             string | null;
  waiting_collection_since?: string | null;
  collection_due_date?:      string | null;
  collected_at?:             string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a YYYY-MM-DD or ISO timestamp and return a local midnight Date. */
const toLocalDate = (value: string): Date => {
  // If it looks like just a date (YYYY-MM-DD), parse as local midnight
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  // For timestamps, convert to local midnight of that day
  const dt = new Date(value);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
};

/** Difference in whole days between two local-midnight dates. */
const daysBetween = (from: Date, to: Date): number => {
  const diff = to.getTime() - from.getTime();
  return Math.floor(diff / 86_400_000);
};

// ─── Status mapping helper ───────────────────────────────────────────────────

export const getCollectionStatus = (waitingDays: number): { level: AgingLevel; label: string } => {
  if (waitingDays <= COLLECTION_STATUS_RULES.green.maxDays) {
    return { level: "green", label: COLLECTION_STATUS_RULES.green.label };
  }
  if (waitingDays <= COLLECTION_STATUS_RULES.amber.maxDays) {
    return { level: "amber", label: COLLECTION_STATUS_RULES.amber.label };
  }
  return { level: "red", label: COLLECTION_STATUS_RULES.red.label };
};

// ─── calculateCollectionAging ─────────────────────────────────────────────────

/**
 * Calculate how long a trailer has been waiting for collection.
 *
 * Fallback order for the start date:
 *   waiting_collection_since → delivered_at → delivery_date
 */
export const calculateCollectionAging = (
  booking: CollectionBookingInput
): CollectionAging => {
  // Determine the start timestamp
  const rawStart =
    booking.waiting_collection_since ??
    booking.delivered_at ??
    booking.delivery_date;

  const startDate = toLocalDate(rawStart);

  const todayKey  = getLocalDateKey();
  const today     = toLocalDate(todayKey);
  const waitingDays = Math.max(0, daysBetween(startDate, today));

  const status = getCollectionStatus(waitingDays);
  const agingLevel = status.level;

  // Due date logic
  let daysUntilDue: number | null = null;
  let overdueDays:  number | null = null;
  let isOverdue = false;

  const dueDate = booking.collection_due_date ?? null;

  if (dueDate) {
    const due = toLocalDate(dueDate);
    daysUntilDue = daysBetween(today, due);
    if (daysUntilDue < 0) {
      isOverdue   = true;
      overdueDays = Math.abs(daysUntilDue);
    }
  }

  return {
    waitingDays,
    agingLevel,
    agingLabel: status.label,
    waitingSince:  booking.waiting_collection_since ?? booking.delivered_at ?? null,
    dueDate,
    daysUntilDue,
    overdueDays,
    isOverdue,
  };
};

// ─── getCollectionSeverity ────────────────────────────────────────────────────

export type CollectionSeverity = "critical" | "warning" | "info";

/**
 * Map a collection booking to an operational severity level.
 * Used by the Operations Board for alert generation.
 */
export const getCollectionSeverity = (
  aging: CollectionAging
): CollectionSeverity => {
  if (aging.isOverdue || aging.agingLevel === "red") {
    return "critical";
  }
  if (aging.agingLevel === "amber" || aging.daysUntilDue === 0) {
    return "warning";
  }
  return "info";
};

// ─── Aging colour helpers ─────────────────────────────────────────────────────

export const agingColours = (level: AgingLevel) => {
  switch (level) {
    case "red":
      return { bg: "bg-rose-500/10", border: "border-rose-500/30", text: "text-rose-300", dot: "bg-rose-500" };
    case "amber":
      return { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-300", dot: "bg-amber-500" };
    default:
      return { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-300", dot: "bg-emerald-500" };
  }
};

// ─── Sorting comparator ───────────────────────────────────────────────────────

/**
 * Sort waiting collections:
 * 1. Overdue first
 * 2. Highest waiting days
 * 3. Oldest waiting_collection_since
 */
export const compareCollections = (
  a: CollectionAging & { _rawSince: string | null },
  b: CollectionAging & { _rawSince: string | null }
): number => {
  if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
  if (b.waitingDays !== a.waitingDays) return b.waitingDays - a.waitingDays;
  const ta = a._rawSince ?? "";
  const tb = b._rawSince ?? "";
  return ta < tb ? -1 : ta > tb ? 1 : 0;
};
