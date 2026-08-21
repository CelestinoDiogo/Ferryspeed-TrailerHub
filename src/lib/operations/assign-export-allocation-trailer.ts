import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  EXPORT_ACTIVE_STATUS_QUERY_VALUES,
  isTrailerAvailableForExportAllocation,
  UNASSIGNED_EXPORT_TRAILER_LABEL,
} from "@/lib/export-allocation";
import {
  DELIVERY_BOOKING_RELEASE_STATUS_QUERY,
  getTrailerIdsReservedByActiveDeliveryBookings,
} from "@/lib/delivery-booking-availability";
import { createTrailerActivity } from "@/lib/trailer-activity";
import {
  isTrailerEligibleForNewExportJob,
  TRAILER_ACTIVE_EXPORT_ALLOCATION_CODE,
  TRAILER_ACTIVE_EXPORT_ALLOCATION_MESSAGE,
  TRAILER_RESERVED_FOR_DELIVERY_CODE,
  TRAILER_RESERVED_FOR_DELIVERY_MESSAGE,
  TrailerJobConflictError,
} from "@/lib/trailer-job-eligibility";

type RouteSupabase = SupabaseClient<Database>;

export type AssignExportAllocationTrailerResult = {
  allocationId: string;
  trailerId: string;
  trailerNumber: string | null;
  previousTrailerId: string | null;
  previousTrailerNumber: string | null;
};

const isUniqueViolation = (error: { code?: string; message?: string } | null) => {
  if (!error) {
    return false;
  }

  return error.code === "23505" || (error.message ?? "").toLowerCase().includes("idx_export_allocations_one_active_per_trailer");
};

export async function assignExportAllocationTrailer(input: {
  supabase: RouteSupabase;
  allocationId: string;
  trailerId: string;
  operatorName: string;
}): Promise<AssignExportAllocationTrailerResult> {
  const trailerId = input.trailerId.trim();
  if (!trailerId) {
    throw new Error("Select an eligible trailer before saving.");
  }

  const { data: allocationData, error: allocationError } = await input.supabase
    .from("export_allocations")
    .select("id, trailer_id, trailer_number, status, customer")
    .eq("id", input.allocationId)
    .single();

  if (allocationError || !allocationData) {
    throw new Error(allocationError?.message || "Export allocation was not found.");
  }

  if (allocationData.status !== "allocated") {
    throw new Error("Trailer cannot be changed after status progressed beyond allocated.");
  }

  const previousTrailerId = allocationData.trailer_id ?? null;
  const previousTrailerNumber = allocationData.trailer_number ?? null;

  if (previousTrailerId === trailerId) {
    return {
      allocationId: allocationData.id,
      trailerId,
      trailerNumber: allocationData.trailer_number ?? null,
      previousTrailerId,
      previousTrailerNumber,
    };
  }

  const [{ data: trailerData, error: trailerError }, { data: activeForTrailer, error: activeError }, { data: deliveryForTrailer, error: deliveryError }] = await Promise.all([
    input.supabase
      .from("trailers")
      .select("id, trailer_number, load_status, departure_date, compound_position, trailer_source, is_local, operational_status")
      .eq("id", trailerId)
      .single(),
    input.supabase
      .from("export_allocations")
      .select("id")
      .eq("trailer_id", trailerId)
      .neq("id", allocationData.id)
      .in("status", [...EXPORT_ACTIVE_STATUS_QUERY_VALUES])
      .limit(1),
    input.supabase
      .from("delivery_bookings")
      .select("id, trailer_id, status")
      .eq("trailer_id", trailerId)
      .not("status", "in", DELIVERY_BOOKING_RELEASE_STATUS_QUERY)
      .limit(1),
  ]);

  if (trailerError || !trailerData) {
    throw new Error(trailerError?.message || "Unable to validate selected trailer.");
  }

  if (activeError) {
    throw new Error(activeError.message || "Unable to validate selected trailer.");
  }

  if (deliveryError) {
    throw new Error(deliveryError.message || "Unable to validate selected trailer.");
  }

  const hasActiveDelivery = getTrailerIdsReservedByActiveDeliveryBookings(deliveryForTrailer ?? []).has(trailerId);
  const hasActiveExport = (activeForTrailer ?? []).length > 0;

  if (hasActiveDelivery) {
    throw new TrailerJobConflictError(TRAILER_RESERVED_FOR_DELIVERY_CODE, TRAILER_RESERVED_FOR_DELIVERY_MESSAGE);
  }

  if (hasActiveExport) {
    throw new TrailerJobConflictError(TRAILER_ACTIVE_EXPORT_ALLOCATION_CODE, TRAILER_ACTIVE_EXPORT_ALLOCATION_MESSAGE);
  }

  if (
    !isTrailerAvailableForExportAllocation(trailerData, false)
    || !isTrailerEligibleForNewExportJob({
      hasActiveDelivery: false,
      activeExportStatus: null,
    })
  ) {
    throw new Error("This trailer is no longer available for allocation.");
  }

  const nowIso = new Date().toISOString();
  const trailerNumber = trailerData.trailer_number ?? null;
  let updateQuery = input.supabase
    .from("export_allocations")
    .update({
      trailer_id: trailerId,
      trailer_number: trailerNumber,
      updated_at: nowIso,
    })
    .eq("id", allocationData.id)
    .eq("status", "allocated");

  updateQuery = previousTrailerId
    ? updateQuery.eq("trailer_id", previousTrailerId)
    : updateQuery.is("trailer_id", null);

  const { data: updated, error: updateError } = await updateQuery.select("id").single();

  if (isUniqueViolation(updateError)) {
    throw new TrailerJobConflictError(TRAILER_ACTIVE_EXPORT_ALLOCATION_CODE, TRAILER_ACTIVE_EXPORT_ALLOCATION_MESSAGE);
  }

  if (updateError || !updated) {
    throw new Error(updateError?.message || "Allocation changed by another user. Refresh and try again.");
  }

  await input.supabase
    .from("compound_waiting_list")
    .update({
      status: "cancelled",
      notes: "Automatically removed after export trailer assignment.",
      updated_at: nowIso,
    } as never)
    .eq("trailer_id", trailerId)
    .eq("status", "waiting");

  await input.supabase.from("trailer_events").insert({
    trailer_id: trailerId,
    trailer_number: trailerNumber ?? UNASSIGNED_EXPORT_TRAILER_LABEL,
    event_type: "export_allocation_updated",
    event_description: previousTrailerId
      ? `Export allocation trailer changed to ${trailerNumber ?? trailerId}.`
      : `Trailer ${trailerNumber ?? trailerId} assigned to previously unassigned export allocation.`,
    old_value: {
      export_allocation_id: allocationData.id,
      trailer_id: previousTrailerId,
      trailer_number: previousTrailerNumber,
      status: allocationData.status,
    },
    new_value: {
      export_allocation_id: allocationData.id,
      trailer_id: trailerId,
      trailer_number: trailerNumber,
      status: allocationData.status,
      customer: allocationData.customer ?? null,
    },
  });

  try {
    await createTrailerActivity({
      supabaseClient: input.supabase,
      trailerId,
      trailerNumber: trailerNumber ?? UNASSIGNED_EXPORT_TRAILER_LABEL,
      eventType: "export_allocated",
      eventTitle: "Export trailer assigned",
      eventDescription: previousTrailerId
        ? `Export allocation trailer changed to ${trailerNumber ?? trailerId}.`
        : `Trailer ${trailerNumber ?? trailerId} assigned to previously unassigned export allocation.`,
      sourceModule: "export",
      sourceRecordId: allocationData.id,
      previousStatus: allocationData.status,
      newStatus: allocationData.status,
      performedBy: input.operatorName,
      createdAt: nowIso,
    });
  } catch {
    // History insert is best-effort; the trailer assignment itself is already persisted.
  }

  return {
    allocationId: allocationData.id,
    trailerId,
    trailerNumber,
    previousTrailerId,
    previousTrailerNumber,
  };
}
