import { addDays, formatDateShort } from "@/lib/calendar-utils";
import {
  createHistoryDateRange,
  isDateWithinHistoryRange,
  type HistoryDateRangeValue,
} from "@/lib/history-date-range";
import { getTrailerOwnershipType, type TrailerOwnershipType } from "@/lib/trailer-ownership";
import { getVesselTrailerReceptionAt, toLocalDateKey } from "@/lib/vessel-operations";

export const OPERATIONAL_SUMMARY_MOVEMENT_TYPES = [
  "arrival",
  "departure",
  "delivery",
  "collection",
] as const;

export type OperationalSummaryMovementType = (typeof OPERATIONAL_SUMMARY_MOVEMENT_TYPES)[number];

export type OperationalSummaryEvent = {
  id: string;
  movementType: OperationalSummaryMovementType;
  occurredAt: string;
  localDateKey: string;
  trailerNumber: string | null;
  customer: string | null;
  haulier: string | null;
  ownershipType: TrailerOwnershipType;
  sourceOrDestination: string | null;
  reference: string | null;
  loadStatus: string | null;
  notes: string | null;
  collectionSource?: "delivery" | "export";
};

export type OperationalSummaryFilters = {
  range: HistoryDateRangeValue;
  movementType: "all" | OperationalSummaryMovementType;
  ownership: "all" | TrailerOwnershipType;
  customer: string;
  haulier: string;
  search: string;
};

export type OperationalSummaryKpis = {
  arrivals: number;
  departures: number;
  deliveries: number;
  collections: number;
  outsourcings: number;
  totalMovements: number;
  outsourcingPercent: number | null;
};

export type OperationalSummaryDailyRow = {
  dateKey: string;
  label: string;
  arrivals: number;
  departures: number;
  deliveries: number;
  collections: number;
  outsourcings: number;
};

export type OperationalSummaryNamedCount = {
  name: string;
  count: number;
};

export type OperationalSummaryResult = {
  events: OperationalSummaryEvent[];
  kpis: OperationalSummaryKpis;
  dailyRows: OperationalSummaryDailyRow[];
  dailyTotal: OperationalSummaryDailyRow;
  ownershipBreakdown: {
    company: number;
    outsourcing: number;
    unknown: number;
  };
  customerBreakdown: OperationalSummaryNamedCount[];
  haulierBreakdown: OperationalSummaryNamedCount[];
};

export const OPERATIONAL_SUMMARY_TOTAL_MOVEMENTS_DEFINITION =
  "Total Movements is the count of completed operational events: Arrivals + Departures + Deliveries + Collections. Outsourcings is an ownership classification of those same events and is not added into the total.";

export const toOperationalLocalDateKey = (value?: string | null): string | null => {
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

  return toLocalDateKey(parsed);
};

export const listLocalDateKeysInclusive = (startDate: string, endDate: string): string[] => {
  if (!startDate || !endDate || startDate > endDate) {
    return [];
  }

  const keys: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    keys.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return keys;
};

export const getLast7DaysRange = (todayDateKey: string): HistoryDateRangeValue =>
  createHistoryDateRange("last_7_days", todayDateKey);

export const isCancelledOperationalStatus = (value?: string | null) => {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "cancelled" || normalized === "canceled" || normalized === "no_show";
};

const hasTimestamp = (value?: string | null) => Boolean((value ?? "").trim());

export const classifyOperationalOwnership = (input: {
  ownershipType?: string | null;
  ownership_type?: string | null;
  trailerSource?: string | null;
  trailer_source?: string | null;
  externalCompany?: string | null;
  external_company?: string | null;
  isLocal?: boolean | null;
  is_local?: boolean | null;
}): TrailerOwnershipType =>
  getTrailerOwnershipType({
    ownershipType: input.ownershipType ?? input.ownership_type,
    trailerSource: input.trailerSource ?? input.trailer_source,
    externalCompany: input.externalCompany ?? input.external_company,
    isLocal: input.isLocal ?? input.is_local,
  });

export const mapArrivalEvent = (row: {
  id: string;
  trailer_number?: string | null;
  customer?: string | null;
  booking_reference?: string | null;
  load_status?: string | null;
  planning_notes?: string | null;
  arrival_confirmed_at?: string | null;
  arrived_at?: string | null;
  arrival_status?: string | null;
  status?: string | null;
  cancelled_at?: string | null;
  no_show_at?: string | null;
  ownership_type?: string | null;
  trailer_source?: string | null;
  external_company?: string | null;
  vessel_name?: string | null;
  origin_port?: string | null;
}): OperationalSummaryEvent | null => {
  if (hasTimestamp(row.cancelled_at) || hasTimestamp(row.no_show_at)) {
    return null;
  }

  if (isCancelledOperationalStatus(row.status) || isCancelledOperationalStatus(row.arrival_status)) {
    return null;
  }

  const occurredAt = getVesselTrailerReceptionAt(row);
  const localDateKey = toOperationalLocalDateKey(occurredAt);
  if (!occurredAt || !localDateKey) {
    return null;
  }

  return {
    id: `arrival:${row.id}`,
    movementType: "arrival",
    occurredAt,
    localDateKey,
    trailerNumber: row.trailer_number ?? null,
    customer: row.customer ?? null,
    haulier: row.external_company ?? null,
    ownershipType: classifyOperationalOwnership(row),
    sourceOrDestination: [row.vessel_name, row.origin_port].filter(Boolean).join(" / ") || null,
    reference: row.booking_reference ?? null,
    loadStatus: row.load_status ?? null,
    notes: row.planning_notes ?? null,
  };
};

export const mapDepartureEvent = (row: {
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
}): OperationalSummaryEvent | null => {
  if (isCancelledOperationalStatus(row.operational_status)) {
    return null;
  }

  const departureDate = (row.departure_date ?? "").trim().slice(0, 10);
  if (!departureDate) {
    return null;
  }

  const departureTime = (row.departure_time ?? "00:00:00").trim() || "00:00:00";
  const occurredAt = `${departureDate}T${departureTime.length === 5 ? `${departureTime}:00` : departureTime}`;

  return {
    id: `departure:${row.id}`,
    movementType: "departure",
    occurredAt,
    localDateKey: departureDate,
    trailerNumber: row.trailer_number ?? null,
    customer: row.customer ?? null,
    haulier: row.external_company ?? null,
    ownershipType: classifyOperationalOwnership(row),
    sourceOrDestination: null,
    reference: null,
    loadStatus: row.load_status ?? null,
    notes: row.notes ?? null,
  };
};

export const mapDeliveryEvent = (row: {
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
}): OperationalSummaryEvent | null => {
  if (isCancelledOperationalStatus(row.status)) {
    return null;
  }

  const occurredAt = (row.delivered_at ?? "").trim();
  const localDateKey = toOperationalLocalDateKey(occurredAt);
  if (!occurredAt || !localDateKey) {
    return null;
  }

  return {
    id: `delivery:${row.id}`,
    movementType: "delivery",
    occurredAt,
    localDateKey,
    trailerNumber: row.trailer_number ?? null,
    customer: row.customer ?? null,
    haulier: row.driver_name ?? row.external_company ?? null,
    ownershipType: classifyOperationalOwnership(row),
    sourceOrDestination: row.delivery_location ?? null,
    reference: row.booking_reference ?? null,
    loadStatus: null,
    notes: row.notes ?? null,
  };
};

export const mapDeliveryCollectionEvent = (row: {
  id: string;
  trailer_number?: string | null;
  customer?: string | null;
  booking_reference?: string | null;
  status?: string | null;
  collected_at?: string | null;
  notes?: string | null;
  driver_name?: string | null;
  ownership_type?: string | null;
  trailer_source?: string | null;
  external_company?: string | null;
  is_local?: boolean | null;
}): OperationalSummaryEvent | null => {
  if (isCancelledOperationalStatus(row.status)) {
    return null;
  }

  const occurredAt = (row.collected_at ?? "").trim();
  const localDateKey = toOperationalLocalDateKey(occurredAt);
  if (!occurredAt || !localDateKey) {
    return null;
  }

  return {
    id: `collection:delivery:${row.id}`,
    movementType: "collection",
    occurredAt,
    localDateKey,
    trailerNumber: row.trailer_number ?? null,
    customer: row.customer ?? null,
    haulier: row.driver_name ?? row.external_company ?? null,
    ownershipType: classifyOperationalOwnership(row),
    sourceOrDestination: null,
    reference: row.booking_reference ?? null,
    loadStatus: null,
    notes: row.notes ?? null,
    collectionSource: "delivery",
  };
};

export const mapExportCollectionEvent = (row: {
  id: string;
  trailer_number?: string | null;
  customer?: string | null;
  booking_reference?: string | null;
  haulier?: string | null;
  status?: string | null;
  collected_loaded_at?: string | null;
  cancelled_at?: string | null;
  notes?: string | null;
  ownership_type?: string | null;
  trailer_source?: string | null;
  external_company?: string | null;
  is_local?: boolean | null;
}): OperationalSummaryEvent | null => {
  if (hasTimestamp(row.cancelled_at) || isCancelledOperationalStatus(row.status)) {
    return null;
  }

  const occurredAt = (row.collected_loaded_at ?? "").trim();
  const localDateKey = toOperationalLocalDateKey(occurredAt);
  if (!occurredAt || !localDateKey) {
    return null;
  }

  return {
    id: `collection:export:${row.id}`,
    movementType: "collection",
    occurredAt,
    localDateKey,
    trailerNumber: row.trailer_number ?? null,
    customer: row.customer ?? null,
    haulier: row.haulier ?? row.external_company ?? null,
    ownershipType: classifyOperationalOwnership(row),
    sourceOrDestination: null,
    reference: row.booking_reference ?? null,
    loadStatus: null,
    notes: row.notes ?? null,
    collectionSource: "export",
  };
};

export const filterOperationalSummaryEvents = (
  events: OperationalSummaryEvent[],
  filters: OperationalSummaryFilters,
): OperationalSummaryEvent[] => {
  const customer = filters.customer.trim().toLowerCase();
  const haulier = filters.haulier.trim().toLowerCase();
  const search = filters.search.trim().toLowerCase();

  return events
    .filter((event) => {
      if (!isDateWithinHistoryRange(event.localDateKey, filters.range)) {
        return false;
      }
      if (filters.movementType !== "all" && event.movementType !== filters.movementType) {
        return false;
      }
      if (filters.ownership !== "all" && event.ownershipType !== filters.ownership) {
        return false;
      }
      if (customer && (event.customer ?? "").toLowerCase() !== customer) {
        return false;
      }
      if (haulier && (event.haulier ?? "").toLowerCase() !== haulier) {
        return false;
      }
      if (search) {
        const haystack = [
          event.trailerNumber,
          event.customer,
          event.haulier,
          event.reference,
          event.sourceOrDestination,
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
      const time = right.occurredAt.localeCompare(left.occurredAt);
      if (time !== 0) {
        return time;
      }
      return (left.trailerNumber ?? "").localeCompare(right.trailerNumber ?? "", undefined, { numeric: true });
    });
};

const countByType = (events: OperationalSummaryEvent[], movementType: OperationalSummaryMovementType) =>
  events.filter((event) => event.movementType === movementType).length;

const topNamedCounts = (values: Array<string | null>, limit = 8): OperationalSummaryNamedCount[] => {
  const counts = new Map<string, number>();
  for (const value of values) {
    const name = (value ?? "").trim();
    if (!name) {
      continue;
    }
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, limit);
};

export const buildOperationalSummary = (
  events: OperationalSummaryEvent[],
  filters: OperationalSummaryFilters,
): OperationalSummaryResult => {
  const filtered = filterOperationalSummaryEvents(events, filters);
  const arrivals = countByType(filtered, "arrival");
  const departures = countByType(filtered, "departure");
  const deliveries = countByType(filtered, "delivery");
  const collections = countByType(filtered, "collection");
  const totalMovements = arrivals + departures + deliveries + collections;
  const outsourcings = filtered.filter((event) => event.ownershipType === "outsourcing").length;

  const dateKeys = listLocalDateKeysInclusive(filters.range.startDate, filters.range.endDate);
  const dailyRows: OperationalSummaryDailyRow[] = dateKeys.map((dateKey) => {
    const dayEvents = filtered.filter((event) => event.localDateKey === dateKey);
    return {
      dateKey,
      label: formatDateShort(dateKey),
      arrivals: countByType(dayEvents, "arrival"),
      departures: countByType(dayEvents, "departure"),
      deliveries: countByType(dayEvents, "delivery"),
      collections: countByType(dayEvents, "collection"),
      outsourcings: dayEvents.filter((event) => event.ownershipType === "outsourcing").length,
    };
  });

  const dailyTotal: OperationalSummaryDailyRow = {
    dateKey: "total",
    label: "TOTAL",
    arrivals: dailyRows.reduce((sum, row) => sum + row.arrivals, 0),
    departures: dailyRows.reduce((sum, row) => sum + row.departures, 0),
    deliveries: dailyRows.reduce((sum, row) => sum + row.deliveries, 0),
    collections: dailyRows.reduce((sum, row) => sum + row.collections, 0),
    outsourcings: dailyRows.reduce((sum, row) => sum + row.outsourcings, 0),
  };

  return {
    events: filtered,
    kpis: {
      arrivals,
      departures,
      deliveries,
      collections,
      outsourcings,
      totalMovements,
      outsourcingPercent: totalMovements === 0 ? null : Math.round((outsourcings / totalMovements) * 100),
    },
    dailyRows,
    dailyTotal,
    ownershipBreakdown: {
      company: filtered.filter((event) => event.ownershipType === "company").length,
      outsourcing: outsourcings,
      unknown: filtered.filter((event) => event.ownershipType === "unknown").length,
    },
    customerBreakdown: topNamedCounts(filtered.map((event) => event.customer)),
    haulierBreakdown: topNamedCounts(filtered.map((event) => event.haulier)),
  };
};

export const eventsForKpi = (
  events: OperationalSummaryEvent[],
  kpi: "arrivals" | "departures" | "deliveries" | "collections" | "outsourcings",
) => {
  if (kpi === "outsourcings") {
    return events.filter((event) => event.ownershipType === "outsourcing");
  }

  const movementType: OperationalSummaryMovementType =
    kpi === "arrivals" ? "arrival" : kpi === "departures" ? "departure" : kpi === "deliveries" ? "delivery" : "collection";
  return events.filter((event) => event.movementType === movementType);
};

export const uniqueSortedNames = (events: OperationalSummaryEvent[], field: "customer" | "haulier") =>
  [...new Set(events.map((event) => (event[field] ?? "").trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
