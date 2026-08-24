import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { EXPORT_ACTIVE_STATUS_QUERY_VALUES, UNASSIGNED_EXPORT_TRAILER_LABEL } from "@/lib/export-allocation";
import {
  confirmRowsToParsedRows,
  previewExportAllocationImportRows,
  type ExportAllocationImportCandidate,
  type ExportAllocationImportConfirmRow,
} from "@/lib/imports/export-allocation-import";
import { toExportPersistTimestamp } from "@/lib/imports/import-normalize";
import {
  DELIVERY_BOOKING_RELEASE_STATUS_QUERY,
  getTrailerIdsReservedByActiveDeliveryBookings,
} from "@/lib/delivery-booking-availability";
import { createTrailerActivity } from "@/lib/trailer-activity";
import { getActiveExportStatusByTrailerId, withTrailerJobCommitments } from "@/lib/trailer-job-eligibility";

type RouteSupabase = SupabaseClient<Database>;

type PersistAllocationInput = {
  trailerId: string | null;
  trailerNumber: string | null;
  customer: string;
  collectionAddress: string | null;
  haulier: string | null;
  bookingReference: string | null;
  loadType: string | null;
  collectionDate: string;
  expectedReturnAt: string | null;
  priority: string;
  notes: string | null;
};

export type ExportAllocationImportPersistResult = {
  created: Array<{ id: string; trailerNumber: string | null; customer: string; unassigned: boolean }>;
  blockedUnassigned: Array<{ customer: string; reason: string }>;
  conflicts: Array<{ trailerNumber?: string; reason: string }>;
  invalid: Array<{ reason: string }>;
  duplicates: Array<{ reason: string }>;
};

const insertExportAllocation = async (input: {
  supabase: RouteSupabase;
  operatorName: string;
  nowIso: string;
  row: PersistAllocationInput;
}): Promise<{ id: string }> => {
  const insertPayload = {
    trailer_id: input.row.trailerId,
    trailer_number: input.row.trailerNumber,
    customer: input.row.customer,
    collection_address: input.row.collectionAddress,
    haulier: input.row.haulier,
    booking_reference: input.row.bookingReference,
    load_type: input.row.loadType,
    collection_date: input.row.collectionDate,
    expected_return_at: input.row.expectedReturnAt,
    priority: input.row.priority,
    status: "allocated",
    notes: input.row.notes,
    allocated_at: input.nowIso,
    updated_at: input.nowIso,
  };

  const { data: allocationData, error: insertError } = await input.supabase
    .from("export_allocations")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insertError || !allocationData) {
    throw new Error(
      insertError?.message
      || `Unable to create export allocation for ${input.row.trailerNumber ?? UNASSIGNED_EXPORT_TRAILER_LABEL}.`,
    );
  }

  if (input.row.trailerId) {
    await input.supabase
      .from("compound_waiting_list")
      .update({
        status: "cancelled",
        notes: "Automatically removed after export allocation creation.",
        updated_at: input.nowIso,
      } as never)
      .eq("trailer_id", input.row.trailerId)
      .eq("status", "waiting");
  }

  const unassigned = !input.row.trailerId;
  await input.supabase.from("trailer_events").insert({
    trailer_id: input.row.trailerId,
    trailer_number: input.row.trailerNumber ?? UNASSIGNED_EXPORT_TRAILER_LABEL,
    event_type: "export_allocation_created",
    event_description: unassigned
      ? `Unassigned export allocation created for ${input.row.customer} from Excel import.`
      : `Trailer allocated to ${input.row.customer} from Excel import.`,
    old_value: null,
    new_value: {
      export_allocation_id: allocationData.id,
      customer: insertPayload.customer,
      collection_date: insertPayload.collection_date,
      source: "excel_import",
      status: "allocated",
      unassigned,
    },
  });

  try {
    await createTrailerActivity({
      supabaseClient: input.supabase,
      trailerId: input.row.trailerId,
      trailerNumber: input.row.trailerNumber ?? UNASSIGNED_EXPORT_TRAILER_LABEL,
      eventType: "export_allocated",
      eventTitle: unassigned ? "Unassigned export allocation created" : "Export allocation created",
      eventDescription: unassigned
        ? `Unassigned export allocation created for ${input.row.customer} from Excel import.`
        : `Trailer allocated to ${input.row.customer} from Excel import.`,
      sourceModule: "export",
      sourceRecordId: allocationData.id,
      newStatus: "allocated",
      performedBy: input.operatorName,
      createdAt: input.nowIso,
    });
  } catch {
    // History insert is best-effort; the allocation itself is already persisted.
  }

  return { id: allocationData.id };
};

export async function persistExportAllocationImport(input: {
  supabase: RouteSupabase;
  operatorName: string;
  rows: ExportAllocationImportConfirmRow[];
}): Promise<ExportAllocationImportPersistResult> {
  const { data: trailerData, error: trailerError } = await input.supabase
    .from("trailers")
    .select("id, trailer_number, load_status, departure_date, operational_status, is_local, compound_position");

  if (trailerError) {
    throw new Error(trailerError.message || "Unable to load trailers for export import.");
  }

  const [{ data: activeDeliveries, error: deliveryError }, { data: activeExports, error: exportError }] = await Promise.all([
    input.supabase
      .from("delivery_bookings")
      .select("trailer_id, status")
      .not("status", "in", DELIVERY_BOOKING_RELEASE_STATUS_QUERY),
    input.supabase
      .from("export_allocations")
      .select("trailer_id, status")
      .in("status", [...EXPORT_ACTIVE_STATUS_QUERY_VALUES]),
  ]);

  if (deliveryError) {
    throw new Error(deliveryError.message || "Unable to check delivery reservations.");
  }

  if (exportError) {
    throw new Error(exportError.message || "Unable to check export reservations.");
  }

  const candidates = withTrailerJobCommitments((trailerData ?? []) as ExportAllocationImportCandidate[], {
    reservedByDelivery: getTrailerIdsReservedByActiveDeliveryBookings(activeDeliveries ?? []),
    exportStatusByTrailerId: getActiveExportStatusByTrailerId(activeExports ?? []),
  });

  const preview = previewExportAllocationImportRows(confirmRowsToParsedRows(input.rows), candidates);
  const created: ExportAllocationImportPersistResult["created"] = [];
  const nowIso = new Date().toISOString();

  for (const row of preview.accepted) {
    const expectedReturnAt = toExportPersistTimestamp(row.expected_return_at);

    const inserted = await insertExportAllocation({
      supabase: input.supabase,
      operatorName: input.operatorName,
      nowIso,
      row: {
        trailerId: row.trailer.id,
        trailerNumber: row.trailer_number,
        customer: row.customer,
        collectionAddress: row.collection_address || null,
        haulier: row.haulier || null,
        bookingReference: row.booking_reference || null,
        loadType: row.load_type || null,
        collectionDate: row.collection_date,
        expectedReturnAt,
        priority: row.priority,
        notes: row.notes || null,
      },
    });

    created.push({
      id: inserted.id,
      trailerNumber: row.trailer_number,
      customer: row.customer,
      unassigned: false,
    });
  }

  for (const row of preview.unassigned) {
    const expectedReturnAt = toExportPersistTimestamp(row.expected_return_at);

    const inserted = await insertExportAllocation({
      supabase: input.supabase,
      operatorName: input.operatorName,
      nowIso,
      row: {
        trailerId: null,
        trailerNumber: null,
        customer: row.customer,
        collectionAddress: row.collection_address || null,
        haulier: row.haulier || null,
        bookingReference: row.booking_reference || null,
        loadType: row.load_type || null,
        collectionDate: row.collection_date,
        expectedReturnAt,
        priority: row.priority,
        notes: row.notes || null,
      },
    });

    created.push({
      id: inserted.id,
      trailerNumber: null,
      customer: row.customer,
      unassigned: true,
    });
  }

  return {
    created,
    blockedUnassigned: [],
    conflicts: preview.conflicts.map((item) => ({
      trailerNumber: item.trailerNumber,
      reason: item.reason,
    })),
    invalid: preview.invalid.map((item) => ({ reason: item.reason })),
    duplicates: preview.duplicates.map((item) => ({ reason: item.reason })),
  };
}
