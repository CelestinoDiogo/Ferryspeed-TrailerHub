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
 * - under 24 hours: Green
 * - 24 to 48 hours: Orange
 * - over 48 hours: Red
 */
export const COLLECTION_STATUS_RULES = {
  green: { minHours: 0, maxHours: 24, label: "Green" },
  orange: { minHours: 24, maxHours: 48, label: "Orange" },
  red: { minHours: 48, maxHours: Number.POSITIVE_INFINITY, label: "Red" },
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgingLevel = "green" | "orange" | "red";

export interface CollectionAging {
  waitingHours: number;
  waitingDays: number;
  agingLevel: AgingLevel;
  agingLabel: string;
  waitingSince: string | null;
  dueDate: string | null;
  daysUntilDue: number | null;
  overdueDays: number | null;
  isOverdue: boolean;
}

/** Input shape — only the fields needed for calculations. */
export interface CollectionBookingInput {
  delivery_date: string;
  delivered_at?: string | null;
  waiting_collection_since?: string | null;
  pending_since?: string | null;
  collection_due_date?: string | null;
  collection_due_at?: string | null;
  collected_at?: string | null;
  referenceAt?: string | Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a YYYY-MM-DD or ISO timestamp, preserving time when present. */
const toDateTime = (value: string): Date => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  return new Date(value);
};

/** Difference in whole days between two dates. */
const daysBetween = (from: Date, to: Date): number => {
  const diff = to.getTime() - from.getTime();
  return Math.floor(diff / 86_400_000);
};

/** Difference in hours between two dates. */
const hoursBetween = (from: Date, to: Date): number => {
  const diff = to.getTime() - from.getTime();
  return diff / 3_600_000;
};

const getReferenceDate = (booking: CollectionBookingInput): Date => {
  if (booking.referenceAt instanceof Date) {
    return booking.referenceAt;
  }

  if (typeof booking.referenceAt === "string" && booking.referenceAt.trim()) {
    return new Date(booking.referenceAt);
  }

  const todayKey = getLocalDateKey();
  return toDateTime(todayKey);
};

// ─── Status mapping helper ───────────────────────────────────────────────────

export const getCollectionStatus = (waitingHours: number): { level: AgingLevel; label: string } => {
  if (waitingHours < COLLECTION_STATUS_RULES.orange.minHours) {
    return { level: "green", label: COLLECTION_STATUS_RULES.green.label };
  }

  if (waitingHours <= COLLECTION_STATUS_RULES.orange.maxHours) {
    return { level: "orange", label: COLLECTION_STATUS_RULES.orange.label };
  }

  return { level: "red", label: COLLECTION_STATUS_RULES.red.label };
};

export const formatCollectionDuration = (waitingHours: number): string => {
  const safeHours = Math.max(0, Math.floor(waitingHours));

  if (safeHours < 24) {
    return `${safeHours}h`;
  }

  const days = Math.floor(safeHours / 24);
  const remainingHours = safeHours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
};

// ─── calculateCollectionAging ─────────────────────────────────────────────────

/**
 * Calculate how long a trailer has been waiting for collection.
 *
 * Fallback order for the start date:
 *   waiting_collection_since → pending_since → delivered_at → delivery_date
 */
export const calculateCollectionAging = (booking: CollectionBookingInput): CollectionAging => {
  const rawStart =
    booking.waiting_collection_since ??
    booking.pending_since ??
    booking.delivered_at ??
    booking.delivery_date;

  const startDate = toDateTime(rawStart);
  const referenceDate = getReferenceDate(booking);
  const waitingHours = Math.max(0, hoursBetween(startDate, referenceDate));
  const waitingDays = Math.max(0, Math.floor(waitingHours / 24));

  const status = getCollectionStatus(waitingHours);

  let daysUntilDue: number | null = null;
  let overdueDays: number | null = null;
  let isOverdue = false;

  const dueDateValue = booking.collection_due_at ?? booking.collection_due_date ?? null;

  if (dueDateValue) {
    const due = toDateTime(dueDateValue);
    daysUntilDue = daysBetween(referenceDate, due);

    if (daysUntilDue < 0) {
      isOverdue = true;
      overdueDays = Math.abs(daysUntilDue);
    }
  }

  return {
    waitingHours,
    waitingDays,
    agingLevel: status.level,
    agingLabel: status.label,
    waitingSince: booking.waiting_collection_since ?? booking.pending_since ?? booking.delivered_at ?? null,
    dueDate: dueDateValue,
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
export const getCollectionSeverity = (aging: CollectionAging): CollectionSeverity => {
  if (aging.isOverdue || aging.agingLevel === "red") {
    return "critical";
  }

  if (aging.agingLevel === "orange" || aging.daysUntilDue === 0) {
    return "warning";
  }

  return "info";
};

// ─── Aging colour helpers ─────────────────────────────────────────────────────

export const agingColours = (level: AgingLevel) => {
  switch (level) {
    case "red":
      return { bg: "bg-rose-500/10", border: "border-rose-500/30", text: "text-rose-300", dot: "bg-rose-500" };
    case "orange":
      return { bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-300", dot: "bg-orange-500" };
    default:
      return { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-300", dot: "bg-emerald-500" };
  }
};

// ─── Sorting comparator ───────────────────────────────────────────────────────

/**
 * Sort waiting collections:
 * 1. Overdue first
 * 2. Highest waiting hours
 * 3. Oldest waiting timestamp
 */
export const compareCollections = (
  a: CollectionAging & { _rawSince: string | null },
  b: CollectionAging & { _rawSince: string | null }
): number => {
  if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
  if (b.waitingHours !== a.waitingHours) return b.waitingHours - a.waitingHours;
  const ta = a._rawSince ?? "";
  const tb = b._rawSince ?? "";
  return ta < tb ? -1 : ta > tb ? 1 : 0;
};
