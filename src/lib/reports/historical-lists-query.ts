import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  buildActiveExportStatusByTrailerId,
  isTrailerPresentInCompoundInventory,
} from "@/lib/export-allocation";
import {
  compoundActivityTypes,
  ownershipForCompoundActivity,
  toCompoundSnapshotRecord,
} from "@/lib/reports/compound-historical";
import type { HistoricalOwnershipSnapshot } from "@/lib/reports/historical-trailer-ownership";
import {
  mapArrivalHistoryRecord,
  mapCollectionHistoryRecord,
  mapCompoundEventHistoryRecord,
  mapCompoundSnapshotHistoryRecord,
  mapDeliveryHistoryRecord,
  mapDepartureHistoryRecord,
  paddedQueryWindow,
  type HistoricalListKind,
  type HistoricalListRecord,
} from "@/lib/reports/historical-lists";
import { mapDeliveryCollectionEvent, mapExportCollectionEvent } from "@/lib/reports/operational-summary";
import type { HistoryDateRangeValue } from "@/lib/history-date-range";

type ReportSupabase = SupabaseClient<Database>;

export const HISTORICAL_LIST_PAGE_SIZE = 1000;
export const HISTORICAL_LIST_ID_CHUNK = 200;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllPagedRows<T>(
  loadPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = HISTORICAL_LIST_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) {
      throw new Error(error.message);
    }
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return rows;
}

export async function fetchByIdChunks<T>(
  ids: string[],
  loadChunk: (chunk: string[]) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const rows: T[] = [];

  for (let index = 0; index < uniqueIds.length; index += HISTORICAL_LIST_ID_CHUNK) {
    const chunk = uniqueIds.slice(index, index + HISTORICAL_LIST_ID_CHUNK);
    const { data, error } = await loadChunk(chunk);
    if (error) {
      throw new Error(error.message);
    }
    rows.push(...(data ?? []));
  }

  return rows;
}

const asRecord = (value: unknown) => value as Record<string, unknown>;

const loadSourceSnapshots = async (supabase: ReportSupabase, sourceIds: string[]) => {
  const rows = await fetchByIdChunks(sourceIds, (chunk) =>
    supabase.from("vessel_operation_trailers").select("id, ownership_type, trailer_source, external_company").in("id", chunk),
  );
  return new Map(rows.map((row) => [row.id, row as HistoricalOwnershipSnapshot & { id: string }]));
};

const loadArrivals = async (supabase: ReportSupabase, range: HistoryDateRangeValue): Promise<HistoricalListRecord[]> => {
  const { fromIso, toIso } = paddedQueryWindow(range);
  const [confirmed, arrivedOnly, operations] = await Promise.all([
    fetchAllPagedRows((from, to) =>
      supabase
        .from("vessel_operation_trailers")
        .select("id, trailer_number, customer, booking_reference, load_status, planning_notes, arrived_at, arrival_confirmed_at, discharged_at, assigned_position, arrival_status, status, cancelled_at, no_show_at, vessel_operation_id, ownership_type, trailer_source, external_company")
        .not("arrival_confirmed_at", "is", null)
        .gte("arrival_confirmed_at", fromIso)
        .lte("arrival_confirmed_at", toIso)
        .range(from, to),
    ),
    fetchAllPagedRows((from, to) =>
      supabase
        .from("vessel_operation_trailers")
        .select("id, trailer_number, customer, booking_reference, load_status, planning_notes, arrived_at, arrival_confirmed_at, discharged_at, assigned_position, arrival_status, status, cancelled_at, no_show_at, vessel_operation_id, ownership_type, trailer_source, external_company")
        .is("arrival_confirmed_at", null)
        .not("arrived_at", "is", null)
        .gte("arrived_at", fromIso)
        .lte("arrived_at", toIso)
        .range(from, to),
    ),
    fetchAllPagedRows((from, to) => supabase.from("vessel_operations").select("id, vessel_name, sailing_reference, origin_port").range(from, to)),
  ]);

  const byId = new Map<string, (typeof confirmed)[number]>();
  for (const row of [...confirmed, ...arrivedOnly]) {
    byId.set(row.id, row);
  }
  const operationsById = new Map(operations.map((row) => [row.id, row]));

  return Array.from(byId.values())
    .map((row) => mapArrivalHistoryRecord(row, operationsById.get(row.vessel_operation_id) ?? null))
    .filter((row): row is HistoricalListRecord => Boolean(row));
};

const loadDepartures = async (supabase: ReportSupabase, range: HistoryDateRangeValue): Promise<HistoricalListRecord[]> => {
  const { fromIso, toIso } = paddedQueryWindow(range);
  const rows = await fetchAllPagedRows((from, to) =>
    supabase
      .from("trailers")
      .select("id, trailer_number, departure_date, departure_time, customer, load_status, notes, operational_status, trailer_source, external_company, is_local, source_vessel_operation_trailer_id")
      .not("departure_date", "is", null)
      .gte("departure_date", fromIso)
      .lte("departure_date", toIso)
      .range(from, to),
  );
  const sourceMap = await loadSourceSnapshots(
    supabase,
    rows.map((row) => row.source_vessel_operation_trailer_id).filter((value): value is string => Boolean(value)),
  );

  return rows
    .map((row) => {
      const source = row.source_vessel_operation_trailer_id ? sourceMap.get(row.source_vessel_operation_trailer_id) : null;
      return mapDepartureHistoryRecord({
        id: row.id,
        trailer_number: row.trailer_number,
        departure_date: row.departure_date,
        departure_time: row.departure_time,
        customer: row.customer,
        load_status: row.load_status,
        notes: row.notes,
        operational_status: row.operational_status,
        ownership_type: source?.ownership_type ?? null,
        trailer_source: row.trailer_source ?? source?.trailer_source ?? null,
        external_company: row.external_company ?? source?.external_company ?? null,
        is_local: row.is_local,
      });
    })
    .filter((row): row is HistoricalListRecord => Boolean(row));
};

const loadDeliveriesAndCollections = async (
  supabase: ReportSupabase,
  range: HistoryDateRangeValue,
  kind: "deliveries" | "collections",
): Promise<HistoricalListRecord[]> => {
  const { fromIso, toIso } = paddedQueryWindow(range);

  if (kind === "deliveries") {
    const bookings = await fetchAllPagedRows((from, to) =>
      supabase
        .from("delivery_bookings")
        .select("id, trailer_id, customer, booking_reference, delivery_location, status, delivered_at, notes, driver:drivers(display_name), trailers(trailer_number, trailer_source, external_company, is_local, source_vessel_operation_trailer_id)")
        .not("delivered_at", "is", null)
        .gte("delivered_at", fromIso)
        .lte("delivered_at", toIso)
        .range(from, to),
    );
    const sourceIds = bookings
      .map((row) => (asRecord(row.trailers) as { source_vessel_operation_trailer_id?: string | null } | null)?.source_vessel_operation_trailer_id)
      .filter((value): value is string => Boolean(value));
    const sourceMap = await loadSourceSnapshots(supabase, sourceIds);

    return bookings
      .map((row) => {
        const trailer = asRecord(row.trailers) as {
          trailer_number?: string | null;
          trailer_source?: string | null;
          external_company?: string | null;
          is_local?: boolean | null;
          source_vessel_operation_trailer_id?: string | null;
        } | null;
        const source = trailer?.source_vessel_operation_trailer_id ? sourceMap.get(trailer.source_vessel_operation_trailer_id) : null;
        const driver = asRecord(row.driver) as { display_name?: string | null } | null;
        return mapDeliveryHistoryRecord({
          id: row.id,
          trailer_number: trailer?.trailer_number ?? null,
          customer: row.customer,
          booking_reference: row.booking_reference,
          delivery_location: row.delivery_location,
          status: row.status,
          delivered_at: row.delivered_at,
          notes: row.notes,
          driver_name: driver?.display_name ?? null,
          ownership_type: source?.ownership_type ?? null,
          trailer_source: trailer?.trailer_source ?? source?.trailer_source ?? null,
          external_company: trailer?.external_company ?? source?.external_company ?? null,
          is_local: trailer?.is_local ?? null,
        });
      })
      .filter((row): row is HistoricalListRecord => Boolean(row));
  }

  const [deliveryCollections, exportCollections] = await Promise.all([
    fetchAllPagedRows((from, to) =>
      supabase
        .from("delivery_bookings")
        .select("id, trailer_id, customer, booking_reference, status, collected_at, notes, driver:drivers(display_name), trailers(trailer_number, trailer_source, external_company, is_local, source_vessel_operation_trailer_id)")
        .eq("status", "collected")
        .not("collected_at", "is", null)
        .gte("collected_at", fromIso)
        .lte("collected_at", toIso)
        .range(from, to),
    ),
    fetchAllPagedRows((from, to) =>
      supabase
        .from("export_allocations")
        .select("id, trailer_id, trailer_number, customer, booking_reference, haulier, status, collected_loaded_at, cancelled_at, notes")
        .not("collected_loaded_at", "is", null)
        .gte("collected_loaded_at", fromIso)
        .lte("collected_loaded_at", toIso)
        .range(from, to),
    ),
  ]);

  const exportTrailerIds = exportCollections.map((row) => row.trailer_id).filter((value): value is string => Boolean(value));
  const exportTrailers = await fetchByIdChunks(exportTrailerIds, (chunk) =>
    supabase.from("trailers").select("id, trailer_source, external_company, is_local, source_vessel_operation_trailer_id").in("id", chunk),
  );
  const exportTrailerMap = new Map(exportTrailers.map((row) => [row.id, row]));
  const sourceIds = [
    ...deliveryCollections.map((row) => (asRecord(row.trailers) as { source_vessel_operation_trailer_id?: string | null } | null)?.source_vessel_operation_trailer_id),
    ...exportTrailers.map((row) => row.source_vessel_operation_trailer_id),
  ].filter((value): value is string => Boolean(value));
  const sourceMap = await loadSourceSnapshots(supabase, sourceIds);

  const deliveryRows = deliveryCollections
    .map((row) => {
      const trailer = asRecord(row.trailers) as {
        trailer_number?: string | null;
        trailer_source?: string | null;
        external_company?: string | null;
        is_local?: boolean | null;
        source_vessel_operation_trailer_id?: string | null;
      } | null;
      const source = trailer?.source_vessel_operation_trailer_id ? sourceMap.get(trailer.source_vessel_operation_trailer_id) : null;
      const driver = asRecord(row.driver) as { display_name?: string | null } | null;
      return mapCollectionHistoryRecord(
        mapDeliveryCollectionEvent({
          id: row.id,
          trailer_number: trailer?.trailer_number ?? null,
          customer: row.customer,
          booking_reference: row.booking_reference,
          status: row.status,
          collected_at: row.collected_at,
          notes: row.notes,
          driver_name: driver?.display_name ?? null,
          ownership_type: source?.ownership_type ?? null,
          trailer_source: trailer?.trailer_source ?? source?.trailer_source ?? null,
          external_company: trailer?.external_company ?? source?.external_company ?? null,
          is_local: trailer?.is_local ?? null,
        }),
        row.status,
      );
    })
    .filter((row): row is HistoricalListRecord => Boolean(row));

  const exportRows = exportCollections
    .map((row) => {
      const trailer = row.trailer_id ? exportTrailerMap.get(row.trailer_id) : null;
      const source = trailer?.source_vessel_operation_trailer_id ? sourceMap.get(trailer.source_vessel_operation_trailer_id) : null;
      return mapCollectionHistoryRecord(
        mapExportCollectionEvent({
          id: row.id,
          trailer_number: row.trailer_number,
          customer: row.customer,
          booking_reference: row.booking_reference,
          haulier: row.haulier,
          status: row.status,
          collected_loaded_at: row.collected_loaded_at,
          cancelled_at: row.cancelled_at,
          notes: row.notes,
          ownership_type: source?.ownership_type ?? null,
          trailer_source: trailer?.trailer_source ?? source?.trailer_source ?? null,
          external_company: trailer?.external_company ?? source?.external_company ?? null,
          is_local: trailer?.is_local ?? null,
        }),
        row.status,
      );
    })
    .filter((row): row is HistoricalListRecord => Boolean(row));

  return [...deliveryRows, ...exportRows];
};

const loadCompoundEvents = async (supabase: ReportSupabase, range: HistoryDateRangeValue): Promise<HistoricalListRecord[]> => {
  const { fromIso, toIso } = paddedQueryWindow(range);
  const activityRows = await fetchAllPagedRows((from, to) =>
    supabase
      .from("trailer_activity_log")
      .select("id, trailer_id, trailer_number, event_type, previous_compound_position, new_compound_position, previous_status, new_status, source_module, source_record_id, metadata, performed_by, event_description, created_at")
      .in("event_type", [...compoundActivityTypes])
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: false })
      .range(from, to),
  );
  const sourceMap = await loadSourceSnapshots(
    supabase,
    activityRows.map((row) => row.source_record_id).filter((value): value is string => Boolean(value)),
  );

  return activityRows.map((row) =>
    mapCompoundEventHistoryRecord({
      id: row.id,
      occurredAt: row.created_at,
      trailerNumber: row.trailer_number,
      eventType: row.event_type,
      ownershipType: ownershipForCompoundActivity(
        row.source_record_id ? sourceMap.get(row.source_record_id) ?? null : null,
        row.metadata as HistoricalOwnershipSnapshot | null,
      ),
      previousPosition: row.previous_compound_position,
      newPosition: row.new_compound_position,
      sourceModule: row.source_module,
      description: row.event_description,
      loadStatus: row.new_status,
    }),
  );
};

const loadCompoundSnapshot = async (supabase: ReportSupabase): Promise<HistoricalListRecord[]> => {
  const [trailers, allocations] = await Promise.all([
    fetchAllPagedRows((from, to) =>
      supabase
        .from("trailers")
        .select("id, trailer_number, compound_position, load_status, customer, trailer_type, is_local, operational_status, notes, trailer_source, external_company, departure_date")
        .range(from, to),
    ),
    fetchAllPagedRows((from, to) =>
      supabase.from("export_allocations").select("id, trailer_id, status, updated_at").in("status", ["allocated", "delivered_empty", "waiting_loading", "collected_loaded"]).range(from, to),
    ),
  ]);
  const statusByTrailerId = buildActiveExportStatusByTrailerId(allocations);

  return trailers
    .filter((row) =>
      isTrailerPresentInCompoundInventory(
        {
          id: row.id,
          compound_position: row.compound_position,
          departure_date: row.departure_date,
          is_local: row.is_local,
          operational_status: row.operational_status,
        },
        statusByTrailerId.get(row.id) ?? null,
      ),
    )
    .map((row) => mapCompoundSnapshotHistoryRecord(toCompoundSnapshotRecord(row)));
};

export async function loadHistoricalListRecords(
  supabase: ReportSupabase,
  kind: HistoricalListKind,
  range: HistoryDateRangeValue,
): Promise<HistoricalListRecord[]> {
  if (kind === "arrivals") {
    return loadArrivals(supabase, range);
  }
  if (kind === "departures") {
    return loadDepartures(supabase, range);
  }
  if (kind === "deliveries" || kind === "collections") {
    return loadDeliveriesAndCollections(supabase, range, kind);
  }
  if (kind === "compound_events") {
    return loadCompoundEvents(supabase, range);
  }
  return loadCompoundSnapshot(supabase);
}
