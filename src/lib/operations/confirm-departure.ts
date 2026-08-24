import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  DELIVERY_BOOKING_RELEASE_STATUS_QUERY,
  getTrailerIdsReservedByActiveDeliveryBookings,
} from "@/lib/delivery-booking-availability";
import { isEligibleForDeparture } from "@/lib/imports/departure-import";
import { createTrailerActivity } from "@/lib/trailer-activity";
import { logTrailerEvent } from "@/lib/trailer-audit-log";
import {
  completeExportAllocationFromConfirmedDeparture,
  type ExportDepartureReconciliation,
} from "@/lib/operations/complete-export-allocation-from-departure";
import {
  TRAILER_NOT_AVAILABLE_FOR_DEPARTURE_CODE,
  TrailerJobConflictError,
} from "@/lib/trailer-job-eligibility";

type RouteSupabase = SupabaseClient<Database>;

export type DepartureTransitionSnapshot = {
  trailerId: string;
  trailerNumber: string | null;
  expectedDepartureAt: string;
  previousDepartureDate: string | null;
  previousDepartureTime: string | null;
  previousCompoundPosition: string | null;
  previousOperationalStatus: string | null;
};

export type ConfirmDepartureResult = {
  alreadyDeparted: boolean;
  trailerId: string;
  trailerNumber: string | null;
  snapshot: DepartureTransitionSnapshot;
  updated: {
    departure_date: string;
    departure_time: string;
    operational_status: string;
    compound_position: null;
  } | null;
  exportReconciliation: ExportDepartureReconciliation;
};

const registerDepartureHistory = async (
  supabase: RouteSupabase,
  trailerId: string,
  trailerNumber: string | null,
  previousValue: DepartureTransitionSnapshot,
  updatePayload: { departure_date: string; departure_time: string; operational_status: string; compound_position: null },
  operatorName: string,
) => {
  const { error: eventError } = await supabase.from("trailer_events").insert({
    trailer_id: trailerId,
    trailer_number: trailerNumber,
    event_type: "departure_registered",
    event_description: "Trailer departure registered.",
    old_value: {
      departure_date: previousValue.previousDepartureDate,
      departure_time: previousValue.previousDepartureTime,
      compound_position: previousValue.previousCompoundPosition,
      operational_status: previousValue.previousOperationalStatus,
    },
    new_value: {
      departure_date: updatePayload.departure_date,
      departure_time: updatePayload.departure_time,
      compound_position: updatePayload.compound_position,
      operational_status: updatePayload.operational_status,
    },
  });

  if (eventError) {
    throw new Error(eventError.message || "Unable to create trailer event history.");
  }

  await logTrailerEvent({
    trailerId,
    trailerNumber,
    eventType: "departure_registered",
    description: "Trailer departure registered.",
    previousValue: {
      departure_date: previousValue.previousDepartureDate,
      departure_time: previousValue.previousDepartureTime,
      compound_position: previousValue.previousCompoundPosition,
      operational_status: previousValue.previousOperationalStatus,
    },
    newValue: {
      departure_date: updatePayload.departure_date,
      departure_time: updatePayload.departure_time,
      compound_position: updatePayload.compound_position,
      operational_status: updatePayload.operational_status,
    },
    sourceModule: "departure",
    performedBy: operatorName,
  });

  await createTrailerActivity({
    supabaseClient: supabase,
    trailerId,
    trailerNumber: trailerNumber ?? trailerId,
    eventType: "departed",
    eventTitle: "Trailer departed",
    eventDescription: "Trailer departure registered from departure list.",
    sourceModule: "operations",
    sourceRecordId: trailerId,
    previousStatus: previousValue.previousOperationalStatus,
    newStatus: "Departed",
    previousCompoundPosition: previousValue.previousCompoundPosition,
    newCompoundPosition: null,
    metadata: {
      departure_date: updatePayload.departure_date,
      departure_time: updatePayload.departure_time,
    },
    performedBy: operatorName,
    createdAt: updatePayload.departure_date,
  });
};

export async function confirmTrailerDeparture(
  supabase: RouteSupabase,
  input: {
    trailerId: string;
    operatorName: string;
    now?: Date;
  },
): Promise<ConfirmDepartureResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const nowTime = now.toTimeString().slice(0, 8);

  const { data: currentTrailer, error: currentTrailerError } = await supabase
    .from("trailers")
    .select("id, trailer_number, departure_date, departure_time, compound_position, operational_status, is_local")
    .eq("id", input.trailerId)
    .single();

  if (currentTrailerError || !currentTrailer) {
    throw new Error(currentTrailerError?.message || "Unable to load current trailer state before departure.");
  }

  if (currentTrailer.departure_date) {
    const exportReconciliation = await completeExportAllocationFromConfirmedDeparture(supabase, {
      trailerId: currentTrailer.id,
      trailerNumber: currentTrailer.trailer_number ?? null,
      departedAt: currentTrailer.departure_date,
      performedBy: input.operatorName,
    });

    return {
      alreadyDeparted: true,
      trailerId: currentTrailer.id,
      trailerNumber: currentTrailer.trailer_number ?? null,
      snapshot: {
        trailerId: currentTrailer.id,
        trailerNumber: currentTrailer.trailer_number ?? null,
        expectedDepartureAt: currentTrailer.departure_date,
        previousDepartureDate: currentTrailer.departure_date,
        previousDepartureTime: currentTrailer.departure_time ?? null,
        previousCompoundPosition: currentTrailer.compound_position ?? null,
        previousOperationalStatus: currentTrailer.operational_status ?? null,
      },
      updated: null,
      exportReconciliation,
    };
  }

  const { data: activeDeliveries, error: deliveryError } = await supabase
    .from("delivery_bookings")
    .select("trailer_id, status")
    .eq("trailer_id", input.trailerId)
    .not("status", "in", DELIVERY_BOOKING_RELEASE_STATUS_QUERY)
    .limit(1);

  if (deliveryError) {
    throw new Error(deliveryError.message || "Unable to check delivery reservations before departure.");
  }

  if (!isEligibleForDeparture({
    trailer_number: currentTrailer.trailer_number,
    departure_date: currentTrailer.departure_date,
    is_local: currentTrailer.is_local,
    operational_status: currentTrailer.operational_status,
    hasActiveDelivery: getTrailerIdsReservedByActiveDeliveryBookings(activeDeliveries ?? []).has(input.trailerId),
    activeExportStatus: null,
  })) {
    throw new TrailerJobConflictError(
      TRAILER_NOT_AVAILABLE_FOR_DEPARTURE_CODE,
      `Trailer ${currentTrailer.trailer_number ?? input.trailerId} is reserved or is no longer available for departure.`,
    );
  }

  const snapshot: DepartureTransitionSnapshot = {
    trailerId: currentTrailer.id,
    trailerNumber: currentTrailer.trailer_number ?? null,
    expectedDepartureAt: nowIso,
    previousDepartureDate: currentTrailer.departure_date ?? null,
    previousDepartureTime: currentTrailer.departure_time ?? null,
    previousCompoundPosition: currentTrailer.compound_position ?? null,
    previousOperationalStatus: currentTrailer.operational_status ?? null,
  };

  const updatePayload = {
    departure_date: nowIso,
    departure_time: nowTime,
    operational_status: "Departed",
    compound_position: null,
  };

  const { data, error } = await supabase
    .from("trailers")
    .update(updatePayload)
    .eq("id", input.trailerId)
    .is("departure_date", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to confirm departure.");
  }

  if (!data) {
    throw new Error("No trailer was updated. Another operator may have already completed this action.");
  }

  try {
    await registerDepartureHistory(
      supabase,
      currentTrailer.id,
      currentTrailer.trailer_number ?? null,
      snapshot,
      updatePayload,
      input.operatorName,
    );
  } catch {
    const rollbackResult = await supabase
      .from("trailers")
      .update({
        departure_date: snapshot.previousDepartureDate,
        departure_time: snapshot.previousDepartureTime,
        operational_status: snapshot.previousOperationalStatus,
        compound_position: snapshot.previousCompoundPosition,
      })
      .eq("id", currentTrailer.id)
      .eq("departure_date", updatePayload.departure_date)
      .select("id")
      .maybeSingle();

    if (rollbackResult.error || !rollbackResult.data) {
      throw new Error("Departure update succeeded but history logging failed, and automatic rollback could not be completed.");
    }

    throw new Error("Departure was rolled back because history logging failed.");
  }

  const exportReconciliation = await completeExportAllocationFromConfirmedDeparture(supabase, {
    trailerId: currentTrailer.id,
    trailerNumber: currentTrailer.trailer_number ?? null,
    departedAt: updatePayload.departure_date,
    performedBy: input.operatorName,
  });

  return {
    alreadyDeparted: false,
    trailerId: currentTrailer.id,
    trailerNumber: currentTrailer.trailer_number ?? null,
    snapshot,
    updated: updatePayload,
    exportReconciliation,
  };
}
