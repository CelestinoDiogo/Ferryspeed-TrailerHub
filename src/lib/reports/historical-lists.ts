import {
  isDateWithinHistoryRange,
  type HistoryDateRangeValue,
} from "@/lib/history-date-range";
import {
  mapArrivalEvent,
  mapDeliveryCollectionEvent,
  mapDeliveryEvent,
  mapDepartureEvent,
  mapExportCollectionEvent,
} from "@/lib/reports/operational-summary";
import { resolveHistoricalOwnership, type HistoricalOwnershipSnapshot } from "@/lib/reports/historical-trailer-ownership";
import { getTrailerOwnershipType, type TrailerOwnershipType } from "@/lib/trailer-ownership";
import {
  formatVesselDateTime,
  getVesselTrailerDischargedAt,
  getVesselTrailerReceptionAt,
  VESSEL_OPERATIONAL_TIMEZONE,
} from "@/lib/vessel-operations";
import { compoundActivityTypes } from "@/lib/reports/compound-historical";

export const HISTORICAL_LIST_KINDS = [
  "arrivals",
  "departures",
  "deliveries",
  "collections",
  "compound_events",
  "compound_snapshot",
] as const;

export type HistoricalListKind = (typeof HISTORICAL_LIST_KINDS)[number];

export const parseHistoricalListKind = (value?: string | null): HistoricalListKind => {
  const normalized = (value ?? "").trim();
  return HISTORICAL_LIST_KINDS.includes(normalized as HistoricalListKind) ? (normalized as HistoricalListKind) : "arrivals";
};

export const HISTORICAL_TIMESTAMP_SEMANTICS = {
  arrivals: "arrival_confirmed_at ?? arrived_at (Compound reception). discharged_at is a separate display field only.",
  departures: "trailers.departure_date (date key) plus optional departure_time. Cancelled operational_status excluded.",
  deliveries: "delivery_bookings.delivered_at. Never delivered / cancelled rows excluded. Collection is a separate event.",
  collections:
    "Delivery collections use collected_at. Export collections use collected_loaded_at. Distinct IDs prevent double-count. Pending/cancelled excluded.",
  compound_events: "trailer_activity_log.created_at for recorded Compound events. Not reconstructed from current stock.",
  compound_snapshot: "Current Compound inventory snapshot. Not a historical date reconstruction.",
} as const;

export type HistoricalListRecord = {
  id: string;
  kind: HistoricalListKind;
  occurredAt: string | null;
  localDateKey: string | null;
  trailerNumber: string | null;
  customer: string | null;
  haulier: string | null;
  ownershipType: TrailerOwnershipType;
  vesselName: string | null;
  sailingReference: string | null;
  bookingReference: string | null;
  status: string | null;
  notes: string | null;
  sourceModule: string;
  dischargedAt?: string | null;
  receptionAt?: string | null;
  position?: string | null;
  collectionSource?: "delivery" | "export" | null;
  eventType?: string | null;
  previousPosition?: string | null;
  newPosition?: string | null;
  loadStatus?: string | null;
};

export type HistoricalListFilters = {
  range: HistoryDateRangeValue;
  customers: string[];
  ownership: "all" | TrailerOwnershipType;
  search: string;
  haulier: string;
  vessel: string;
  collectionSource: "all" | "delivery" | "export";
  eventType: string;
};

export type HistoricalListTotals = {
  records: number;
  company: number;
  outsourcing: number;
  unknown: number;
};

const normalizeName = (value?: string | null) => (value ?? "").trim().toLowerCase();

export const toGuernseyDateKey = (value?: string | null): string | null => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed.slice(0, 10) || null;
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VESSEL_OPERATIONAL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    return null;
  }
  return `${year}-${month}-${day}`;
};

export const formatHistoricalDateTime = (value?: string | null) => formatVesselDateTime(value);

export const paddedQueryWindow = (range: HistoryDateRangeValue) => {
  const start = new Date(`${range.startDate}T00:00:00.000Z`);
  const end = new Date(`${range.endDate}T23:59:59.999Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  end.setUTCDate(end.getUTCDate() + 1);
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
};

export const historicalListKindLabel = (kind: HistoricalListKind) => {
  if (kind === "arrivals") return "Arrivals";
  if (kind === "departures") return "Departures";
  if (kind === "deliveries") return "Deliveries";
  if (kind === "collections") return "Collections";
  if (kind === "compound_events") return "Compound Event History";
  return "Compound Snapshot";
};

export const historicalCsvType = (kind: HistoricalListKind) => {
  if (kind === "compound_events") return "compound-events";
  if (kind === "compound_snapshot") return "compound-snapshot";
  return kind;
};

export const isCompoundSnapshotKind = (kind: HistoricalListKind) => kind === "compound_snapshot";

export const mapArrivalHistoryRecord = (
  row: {
    id: string;
    trailer_number?: string | null;
    customer?: string | null;
    booking_reference?: string | null;
    load_status?: string | null;
    planning_notes?: string | null;
    arrival_confirmed_at?: string | null;
    arrived_at?: string | null;
    discharged_at?: string | null;
    assigned_position?: string | null;
    arrival_status?: string | null;
    status?: string | null;
    cancelled_at?: string | null;
    no_show_at?: string | null;
    ownership_type?: string | null;
    trailer_source?: string | null;
    external_company?: string | null;
    vessel_operation_id?: string | null;
  },
  operation?: { vessel_name?: string | null; sailing_reference?: string | null; origin_port?: string | null } | null,
): HistoricalListRecord | null => {
  const mapped = mapArrivalEvent({
    ...row,
    vessel_name: operation?.vessel_name ?? null,
    origin_port: operation?.origin_port ?? null,
  });
  if (!mapped) {
    return null;
  }

  return {
    id: mapped.id,
    kind: "arrivals",
    occurredAt: mapped.occurredAt,
    localDateKey: toGuernseyDateKey(mapped.occurredAt) ?? mapped.localDateKey,
    trailerNumber: mapped.trailerNumber,
    customer: mapped.customer,
    haulier: mapped.haulier,
    ownershipType: mapped.ownershipType,
    vesselName: operation?.vessel_name ?? null,
    sailingReference: operation?.sailing_reference ?? null,
    bookingReference: mapped.reference,
    status: row.arrival_status ?? row.status ?? null,
    notes: mapped.notes,
    sourceModule: "vessel_operation_trailers",
    dischargedAt: getVesselTrailerDischargedAt(row),
    receptionAt: getVesselTrailerReceptionAt(row),
    position: row.assigned_position ?? null,
    loadStatus: mapped.loadStatus,
  };
};

export const mapDepartureHistoryRecord = (row: {
  id: string;
  trailer_number?: string | null;
  departure_date?: string | null;
  departure_time?: string | null;
  customer?: string | null;
  load_status?: string | null;
  notes?: string | null;
  operational_status?: string | null;
  ownership_type?: string | null;
  trailer_source?: string | null;
  external_company?: string | null;
  is_local?: boolean | null;
}): HistoricalListRecord | null => {
  const mapped = mapDepartureEvent(row);
  if (!mapped) {
    return null;
  }

  return {
    id: mapped.id,
    kind: "departures",
    occurredAt: mapped.occurredAt,
    localDateKey: mapped.localDateKey,
    trailerNumber: mapped.trailerNumber,
    customer: mapped.customer,
    haulier: mapped.haulier,
    ownershipType: mapped.ownershipType,
    vesselName: null,
    sailingReference: null,
    bookingReference: mapped.reference,
    status: row.operational_status ?? null,
    notes: mapped.notes,
    sourceModule: "trailers",
    loadStatus: mapped.loadStatus,
  };
};

export const mapDeliveryHistoryRecord = (row: {
  id: string;
  trailer_number?: string | null;
  customer?: string | null;
  booking_reference?: string | null;
  delivery_location?: string | null;
  status?: string | null;
  delivered_at?: string | null;
  notes?: string | null;
  driver_name?: string | null;
  ownership_type?: string | null;
  trailer_source?: string | null;
  external_company?: string | null;
  is_local?: boolean | null;
}): HistoricalListRecord | null => {
  const mapped = mapDeliveryEvent(row);
  if (!mapped) {
    return null;
  }

  return {
    id: mapped.id,
    kind: "deliveries",
    occurredAt: mapped.occurredAt,
    localDateKey: toGuernseyDateKey(mapped.occurredAt) ?? mapped.localDateKey,
    trailerNumber: mapped.trailerNumber,
    customer: mapped.customer,
    haulier: mapped.haulier,
    ownershipType: mapped.ownershipType,
    vesselName: null,
    sailingReference: null,
    bookingReference: mapped.reference,
    status: row.status ?? null,
    notes: mapped.notes,
    sourceModule: "delivery_bookings",
  };
};

export const mapCollectionHistoryRecord = (
  mapped: ReturnType<typeof mapDeliveryCollectionEvent> | ReturnType<typeof mapExportCollectionEvent>,
  status?: string | null,
): HistoricalListRecord | null => {
  if (!mapped) {
    return null;
  }

  return {
    id: mapped.id,
    kind: "collections",
    occurredAt: mapped.occurredAt,
    localDateKey: toGuernseyDateKey(mapped.occurredAt) ?? mapped.localDateKey,
    trailerNumber: mapped.trailerNumber,
    customer: mapped.customer,
    haulier: mapped.haulier,
    ownershipType: mapped.ownershipType,
    vesselName: null,
    sailingReference: null,
    bookingReference: mapped.reference,
    status: status ?? null,
    notes: mapped.notes,
    sourceModule: mapped.collectionSource === "export" ? "export_allocations" : "delivery_bookings",
    collectionSource: mapped.collectionSource ?? null,
  };
};

export const mapCompoundEventHistoryRecord = (row: {
  id: string;
  occurredAt: string | null;
  trailerNumber: string | null;
  eventType: string;
  ownershipType: TrailerOwnershipType;
  previousPosition: string | null;
  newPosition: string | null;
  sourceModule: string | null;
  description: string | null;
  loadStatus?: string | null;
  customer?: string | null;
}): HistoricalListRecord => ({
  id: `compound-event:${row.id}`,
  kind: "compound_events",
  occurredAt: row.occurredAt,
  localDateKey: toGuernseyDateKey(row.occurredAt),
  trailerNumber: row.trailerNumber,
  customer: row.customer ?? null,
  haulier: null,
  ownershipType: row.ownershipType,
  vesselName: null,
  sailingReference: null,
  bookingReference: null,
  status: row.eventType,
  notes: row.description,
  sourceModule: row.sourceModule ?? "trailer_activity_log",
  eventType: row.eventType,
  previousPosition: row.previousPosition,
  newPosition: row.newPosition,
  position: row.newPosition ?? row.previousPosition,
  loadStatus: row.loadStatus ?? null,
});

export const mapCompoundSnapshotHistoryRecord = (row: {
  id: string;
  trailerNumber: string | null;
  ownershipType: TrailerOwnershipType;
  position: string | null;
  loadStatus: string | null;
  customer: string | null;
  currentStatus: string | null;
  notes: string | null;
}): HistoricalListRecord => ({
  id: `compound-snapshot:${row.id}`,
  kind: "compound_snapshot",
  occurredAt: null,
  localDateKey: null,
  trailerNumber: row.trailerNumber,
  customer: row.customer,
  haulier: null,
  ownershipType: row.ownershipType,
  vesselName: null,
  sailingReference: null,
  bookingReference: null,
  status: row.currentStatus,
  notes: row.notes,
  sourceModule: "trailers",
  position: row.position,
  loadStatus: row.loadStatus,
});

export const ownershipFromSnapshots = (input: {
  sourceSnapshot?: HistoricalOwnershipSnapshot | null;
  eventSnapshot?: HistoricalOwnershipSnapshot | null;
}) => resolveHistoricalOwnership(input);

export const filterHistoricalListRecords = (
  records: HistoricalListRecord[],
  filters: HistoricalListFilters,
): HistoricalListRecord[] => {
  const customers = filters.customers.map(normalizeName).filter(Boolean);
  const search = filters.search.trim().toLowerCase();
  const haulier = normalizeName(filters.haulier);
  const vessel = normalizeName(filters.vessel);

  return records
    .filter((record) => {
      if (!isCompoundSnapshotKind(record.kind) && !isDateWithinHistoryRange(record.localDateKey, filters.range)) {
        return false;
      }
      if (filters.ownership !== "all" && record.ownershipType !== filters.ownership) {
        return false;
      }
      if (customers.length > 0 && !customers.includes(normalizeName(record.customer))) {
        return false;
      }
      if (haulier && normalizeName(record.haulier) !== haulier) {
        return false;
      }
      if (vessel) {
        const haystack = [record.vesselName, record.sailingReference].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(vessel)) {
          return false;
        }
      }
      if (filters.collectionSource !== "all" && record.kind === "collections" && record.collectionSource !== filters.collectionSource) {
        return false;
      }
      if (filters.eventType !== "all" && record.kind === "compound_events" && record.eventType !== filters.eventType) {
        return false;
      }
      if (search) {
        const haystack = [
          record.trailerNumber,
          record.customer,
          record.haulier,
          record.bookingReference,
          record.vesselName,
          record.sailingReference,
          record.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) {
          return false;
        }
      }
      return true;
    })
    .sort((left, right) => {
      const time = (right.occurredAt ?? "").localeCompare(left.occurredAt ?? "");
      if (time !== 0) {
        return time;
      }
      return (left.trailerNumber ?? "").localeCompare(right.trailerNumber ?? "", undefined, { numeric: true });
    });
};

export const buildHistoricalListTotals = (records: HistoricalListRecord[]): HistoricalListTotals => ({
  records: records.length,
  company: records.filter((record) => record.ownershipType === "company").length,
  outsourcing: records.filter((record) => record.ownershipType === "outsourcing").length,
  unknown: records.filter((record) => record.ownershipType === "unknown").length,
});

export const uniqueHistoricalNames = (records: HistoricalListRecord[], field: "customer" | "haulier" | "vesselName") =>
  [...new Set(records.map((record) => (record[field] ?? "").trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );

export const historicalCsvHeaders = (kind: HistoricalListKind): string[] => {
  if (kind === "arrivals") {
    return [
      "Date/Time",
      "Trailer",
      "Vessel",
      "Sailing",
      "Customer",
      "Ownership",
      "Outsourced provider",
      "Discharged At",
      "Reception/Arrival At",
      "Position",
      "Status",
      "Notes",
    ];
  }
  if (kind === "departures") {
    return ["Departure Date/Time", "Trailer", "Customer", "Booking/reference", "Ownership", "Outsourced provider", "Load status", "Notes"];
  }
  if (kind === "deliveries") {
    return ["Delivered At", "Trailer", "Customer", "Booking/reference", "Haulier", "Ownership", "Outsourced provider", "Status", "Notes"];
  }
  if (kind === "collections") {
    return ["Collected At", "Trailer", "Customer", "Source", "Haulier", "Ownership", "Booking/reference", "Status", "Notes"];
  }
  if (kind === "compound_events") {
    return ["Date/Time", "Trailer", "Event", "Ownership", "Previous position", "New position", "Source", "Description"];
  }
  return ["Trailer", "Ownership", "Position", "Load status", "Customer", "Current status", "Notes"];
};

export const historicalCsvRow = (record: HistoricalListRecord): Array<string | null> => {
  if (record.kind === "arrivals") {
    return [
      formatHistoricalDateTime(record.occurredAt),
      record.trailerNumber,
      record.vesselName,
      record.sailingReference,
      record.customer,
      record.ownershipType,
      record.haulier,
      formatHistoricalDateTime(record.dischargedAt),
      formatHistoricalDateTime(record.receptionAt),
      record.position ?? null,
      record.status,
      record.notes,
    ];
  }
  if (record.kind === "departures") {
    return [
      formatHistoricalDateTime(record.occurredAt),
      record.trailerNumber,
      record.customer,
      record.bookingReference,
      record.ownershipType,
      record.haulier,
      record.loadStatus ?? null,
      record.notes,
    ];
  }
  if (record.kind === "deliveries") {
    return [
      formatHistoricalDateTime(record.occurredAt),
      record.trailerNumber,
      record.customer,
      record.bookingReference,
      record.haulier,
      record.ownershipType,
      record.ownershipType === "outsourcing" ? record.haulier : null,
      record.status,
      record.notes,
    ];
  }
  if (record.kind === "collections") {
    return [
      formatHistoricalDateTime(record.occurredAt),
      record.trailerNumber,
      record.customer,
      record.collectionSource === "export" ? "Export" : "Delivery",
      record.haulier,
      record.ownershipType,
      record.bookingReference,
      record.status,
      record.notes,
    ];
  }
  if (record.kind === "compound_events") {
    return [
      formatHistoricalDateTime(record.occurredAt),
      record.trailerNumber,
      record.eventType ?? null,
      record.ownershipType,
      record.previousPosition ?? null,
      record.newPosition ?? null,
      record.sourceModule,
      record.notes,
    ];
  }
  return [
    record.trailerNumber,
    record.ownershipType,
    record.position ?? null,
    record.loadStatus ?? null,
    record.customer,
    record.status,
    record.notes,
  ];
};

export const compoundEventTypeOptions = [...compoundActivityTypes];

export const snapshotOwnership = (row: {
  trailer_source?: string | null;
  external_company?: string | null;
  is_local?: boolean | null;
}) =>
  getTrailerOwnershipType({
    trailerSource: row.trailer_source,
    externalCompany: row.external_company,
    isLocal: row.is_local,
  });
