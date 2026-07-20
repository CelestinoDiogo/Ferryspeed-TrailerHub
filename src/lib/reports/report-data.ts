import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ExportAllocationRecord } from "@/lib/export-allocation";
import { getVesselOperationReport } from "@/lib/vessel-report";

export type ReportSupabase = SupabaseClient<Database>;
const UUID_V4_OR_V1_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const assertValidVesselOperationId = (operationId: string) => {
  const normalized = operationId.trim();
  if (!UUID_V4_OR_V1_REGEX.test(normalized)) {
    throw new Error("Invalid vessel operation id.");
  }

  return normalized;
};

export async function loadExportAllocationsForReport(supabase: ReportSupabase) {
  const queryColumns = `
    id,
    trailer_id,
    trailer_number,
    customer,
    collection_address,
    haulier,
    booking_reference,
    load_type,
    collection_date,
    expected_return_at,
    priority,
    status,
    notes,
    allocated_at,
    delivered_empty_at,
    waiting_loading_at,
    collected_loaded_at,
    completed_at,
    collected_by_haulier_at,
    loading_started_at,
    loaded_at,
    returned_at,
    shipped_at,
    cancelled_at,
    created_at,
    updated_at
  `;

  const fallbackColumns = `
    id,
    trailer_id,
    trailer_number,
    customer,
    collection_address,
    haulier,
    booking_reference,
    load_type,
    collection_date,
    expected_return_at,
    priority,
    status,
    notes,
    allocated_at,
    delivered_empty_at,
    waiting_loading_at,
    collected_loaded_at,
    completed_at,
    created_at,
    updated_at
  `;

  const runQuery = async (columns: string) =>
    supabase
      .from("export_allocations")
      .select(columns)
      .order("collection_date", { ascending: true })
      .order("created_at", { ascending: false });

  let result = await runQuery(queryColumns);

  if (result.error) {
    result = await runQuery(fallbackColumns);

    if (result.error) {
      throw new Error([result.error.message, result.error.details, result.error.hint].filter(Boolean).join(" - "));
    }
  }

  return (result.data ?? []) as unknown as ExportAllocationRecord[];
}

export async function loadDeliveriesForReport(supabase: ReportSupabase) {
  const { data, error } = await supabase
    .from("delivery_bookings")
    .select(
      `id, trailer_id, delivery_date, delivery_time, customer, consignee,
       delivery_location, booking_reference, escort_required, status, notes, created_at,
       delivered_at, waiting_collection_since, collection_due_date, collected_at,
       demurrage_free_days, demurrage_daily_rate, demurrage_currency, demurrage_notes,
       trailers(trailer_number, compound_position, departure_date)`,
    )
    .order("delivery_date", { ascending: true })
    .order("delivery_time", { ascending: true });

  if (error) {
    throw new Error(error.message || "Unable to load delivery bookings report data.");
  }

  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function loadCompoundReportData(
  supabase: ReportSupabase,
  todayKey: string,
  exportActiveStatuses: readonly string[],
) {
  const [
    { data: trailersData, error: trailersError },
    { data: bookingsData, error: bookingsError },
    { data: exportAllocationsData, error: exportAllocationsError },
  ] = await Promise.all([
    supabase
      .from("trailers")
      .select(
        "id, trailer_number, load_status, customer, consignee, container_number, compound_position, departure_date, is_local, trailer_source, external_company",
      )
      .is("departure_date", null)
      .neq("is_local", true)
      .order("compound_position", { ascending: true }),
    supabase
      .from("delivery_bookings")
      .select(
        "id, trailer_id, delivery_date, delivery_time, customer, consignee, delivery_location, booking_reference, escort_required, status, notes",
      )
      .not("status", "in", '("collected","cancelled")')
      .gte("delivery_date", todayKey),
    supabase
      .from("export_allocations")
      .select("trailer_id, status, updated_at")
      .in("status", [...exportActiveStatuses]),
  ]);

  if (trailersError) {
    throw new Error(trailersError.message || "Unable to load compound trailers.");
  }

  if (bookingsError) {
    throw new Error(bookingsError.message || "Unable to load compound deliveries.");
  }

  if (exportAllocationsError) {
    throw new Error(exportAllocationsError.message || "Unable to load export allocation status for compound report.");
  }

  return {
    trailersData: (trailersData ?? []) as Array<Record<string, unknown>>,
    bookingsData: (bookingsData ?? []) as Array<Record<string, unknown>>,
    exportAllocationsData: (exportAllocationsData ?? []) as Array<Record<string, unknown>>,
  };
}

export async function loadVesselArrivalsReportData(
  supabase: ReportSupabase,
  operationId: string,
) {
  const [operationResult, trailersResult] = await Promise.all([
    supabase
      .from("vessel_operations")
      .select("id, vessel_name, sailing_reference, origin_port, berth, expected_arrival_at, actual_arrival_at, status, list_status, list_confirmed_at, list_confirmed_by, notes, created_at, updated_at")
      .eq("id", operationId)
      .single(),
    supabase
      .from("vessel_operation_trailers")
      .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, load_description, temperature_required, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, priority_level, priority_reason, planned_destination, planning_notes, status, arrived_at, arrival_status, arrival_confirmed_at, arrival_record_id, arrival_confirmed_by, inspection_started_at, inspection_completed_at, position_assigned_at, assigned_position, has_damage, has_temperature_alert, created_at, updated_at")
      .eq("vessel_operation_id", operationId)
      .order("created_at", { ascending: true }),
  ]);

  if (operationResult.error || !operationResult.data) {
    throw new Error(operationResult.error?.message || "Unable to load vessel operation record for arrivals report.");
  }

  if (trailersResult.error) {
    throw new Error(trailersResult.error.message || "Unable to load vessel arrival trailers.");
  }

  return {
    operation: operationResult.data,
    trailers: trailersResult.data ?? [],
  };
}

export async function loadVesselOperationSummaryAndPrintReportData(
  supabase: ReportSupabase,
  operationId: string,
) {
  const validatedOperationId = assertValidVesselOperationId(operationId);

  return getVesselOperationReport(supabase, validatedOperationId);
}
