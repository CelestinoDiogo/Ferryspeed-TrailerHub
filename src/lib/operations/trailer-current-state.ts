import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isExportAllocationOffCompoundStatus } from "@/lib/export-allocation";

type StateSupabase = SupabaseClient<Database>;

export const IN_COMPOUND_OPERATIONAL_STATUS = "In Compound";
export const AWAITING_POSITION_OPERATIONAL_STATUS = "Awaiting Position";
export const LOCAL_TRAILER_OPERATIONAL_STATUS = "Local Trailer";
export const DEPARTED_OPERATIONAL_STATUS = "Departed";

export type TrailerCurrentStateIntent = "sync" | "place_on_compound";

export type TrailerCurrentStateInput = {
  departure_date?: string | null;
  departure_time?: string | null;
  operational_status?: string | null;
  is_local?: boolean | null;
  compound_position?: string | null;
  activeExportStatus?: string | null;
};

export type TrailerCurrentStatePatch = {
  operational_status?: string | null;
  departure_date?: string | null;
  departure_time?: string | null;
};

export type TrailerCurrentStateResult = {
  operational_status: string | null;
  departure_date: string | null;
  departure_time: string | null;
  patch: TrailerCurrentStatePatch;
  changed: boolean;
  reason: string;
  clearDepartureTime: boolean;
};

const STALE_COMPOUND_LABELS = new Set([
  "departed",
  "awaiting position",
  "local trailer",
  "waiting for compound",
]);

const PRESERVED_LABELS = new Set([
  "maintenance",
  "cancelled",
  "canceled",
  "on delivery",
  "allocated",
  "delivered empty",
  "waiting loading",
  "collected loaded",
  "waiting collection",
  "ready for shipping",
]);

const hasText = (value?: string | null) => Boolean((value ?? "").toString().trim());

const statusKey = (value?: string | null) =>
  (value ?? "").trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");

export const hasValidCompoundBay = (value?: string | null) => {
  const trimmed = (value ?? "").trim().toUpperCase();
  const match = trimmed.match(/^(P|A)?0*(\d{1,2})$/);
  if (!match) {
    return false;
  }

  const numericValue = Number(match[2]);
  return Number.isFinite(numericValue) && numericValue >= 1 && numericValue <= 50;
};

export const isStaleCompoundOperationalStatus = (value?: string | null) => {
  const trimmed = (value ?? "").trim().toLowerCase();
  return STALE_COMPOUND_LABELS.has(statusKey(value)) || trimmed === "in_compound";
};

export function normalizeTrailerCurrentOperationalState(
  input: TrailerCurrentStateInput,
  options?: { intent?: TrailerCurrentStateIntent },
): TrailerCurrentStateResult {
  const intent = options?.intent ?? "sync";
  const isLocal = input.is_local === true;
  const hasDepartureDate = hasText(input.departure_date);
  const hasValidBay = hasValidCompoundBay(input.compound_position);
  const offCompoundExport = isExportAllocationOffCompoundStatus(input.activeExportStatus);
  const currentStatus = (input.operational_status ?? "").trim() || null;
  const currentKey = statusKey(currentStatus);
  const currentTime = input.departure_time ?? null;

  let nextStatus = currentStatus;
  let nextDate: string | null = hasDepartureDate ? (input.departure_date ?? null) : null;
  let nextTime: string | null = currentTime;
  let reason = "unchanged";

  const preserveCurrent = PRESERVED_LABELS.has(currentKey);

  if (isLocal) {
    if (!preserveCurrent && (!currentStatus || isStaleCompoundOperationalStatus(currentStatus))) {
      nextStatus = LOCAL_TRAILER_OPERATIONAL_STATUS;
      reason = "local_trailer";
    }
  } else if (intent === "place_on_compound" || (!hasDepartureDate && hasValidBay && !offCompoundExport)) {
    if (intent === "place_on_compound" && hasDepartureDate) {
      nextDate = null;
      nextTime = null;
      reason = "returned_to_compound";
    }

    if (!hasDepartureDate || intent === "place_on_compound") {
      if (!preserveCurrent && (!currentStatus || isStaleCompoundOperationalStatus(currentStatus))) {
        nextStatus = IN_COMPOUND_OPERATIONAL_STATUS;
        reason = reason === "returned_to_compound" ? reason : "compound_present";
      }
    }

    if (!nextDate && nextTime) {
      nextTime = null;
      if (reason === "unchanged") {
        reason = "clear_stale_departure_time";
      }
    }
  } else if (!hasDepartureDate && !hasValidBay) {
    if (!preserveCurrent && (!currentStatus || currentKey === "departed" || currentKey === "local trailer")) {
      nextStatus = AWAITING_POSITION_OPERATIONAL_STATUS;
      reason = "awaiting_position";
    }

    if (nextTime) {
      nextTime = null;
      if (reason === "unchanged") {
        reason = "clear_stale_departure_time";
      }
    }
  }

  const patch: TrailerCurrentStatePatch = {};
  if ((nextStatus ?? null) !== (currentStatus ?? null)) {
    patch.operational_status = nextStatus;
  }
  if ((nextDate ?? null) !== (hasDepartureDate ? (input.departure_date ?? null) : null)) {
    patch.departure_date = nextDate;
  }
  const originalTime = currentTime;
  if ((nextTime ?? null) !== (originalTime ?? null)) {
    patch.departure_time = nextTime;
  }

  const changed = Object.keys(patch).length > 0;

  return {
    operational_status: nextStatus,
    departure_date: nextDate,
    departure_time: nextTime,
    patch,
    changed,
    reason: changed ? reason : "unchanged",
    clearDepartureTime: (originalTime ?? null) !== null && nextTime === null,
  };
}

export function planTrailerCurrentStateRepair(
  rows: Array<TrailerCurrentStateInput & { trailer_number?: string | null }>,
) {
  return rows
    .map((row) => {
      const result = normalizeTrailerCurrentOperationalState(row, { intent: "sync" });
      return {
        trailer_number: row.trailer_number ?? null,
        current_status: row.operational_status ?? null,
        proposed_status: result.operational_status,
        departure_time_clear: result.clearDepartureTime ? "YES" : "NO",
        reason: result.reason,
        patch: result.patch,
      };
    })
    .filter((row) => row.reason !== "unchanged");
}

export async function syncTrailerCurrentOperationalState(
  supabase: StateSupabase,
  trailerId: string,
  options?: { intent?: TrailerCurrentStateIntent; activeExportStatus?: string | null },
) {
  const { data, error } = await supabase
    .from("trailers")
    .select("id, trailer_number, compound_position, operational_status, departure_date, departure_time, is_local")
    .eq("id", trailerId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to load trailer current state.");
  }

  if (!data) {
    return null;
  }

  const result = normalizeTrailerCurrentOperationalState(
    {
      ...data,
      activeExportStatus: options?.activeExportStatus ?? null,
    },
    { intent: options?.intent ?? "sync" },
  );

  if (!result.changed) {
    return data;
  }

  const { data: updated, error: updateError } = await supabase
    .from("trailers")
    .update(result.patch)
    .eq("id", trailerId)
    .select("id, trailer_number, compound_position, operational_status, departure_date, departure_time, is_local")
    .maybeSingle();

  if (updateError) {
    throw new Error(updateError.message || "Unable to synchronize trailer operational status.");
  }

  return updated ?? { ...data, ...result.patch };
}
