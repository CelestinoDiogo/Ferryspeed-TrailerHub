import { getTrailerOwnershipType, type TrailerOwnershipType } from "@/lib/trailer-ownership";
import { isDateWithinHistoryRange, type HistoryDateRangeValue } from "@/lib/history-date-range";
import { calculateCollectionAging, type AgingLevel } from "@/lib/collection-aging";

export type HistoricalOperationKind = "arrivals" | "departures" | "deliveries" | "collections";
export type HistoricalOperationRecord = {
  id: string;
  trailerNumber: string | null;
  occurredAt: string | null;
  ownershipType: TrailerOwnershipType;
  customer: string | null;
  sourceOrDestination: string | null;
  reference: string | null;
  loadStatus: string | null;
  notes: string | null;
  driver?: string | null;
  collectionState?: "pending" | "collected";
  agingLevel?: AgingLevel;
  agingLabel?: string;
  waitingSince?: string | null;
  collectedAt?: string | null;
};

export type HistoricalOperationFilters = {
  range: HistoryDateRangeValue;
  ownership: "all" | "company" | "outsourcing";
  search: string;
  collectionState?: "all" | "pending" | "collected";
  aging?: "all" | AgingLevel;
  currentPending?: boolean;
};

export const getHistoricalOperationDateKey = (value?: string | null) => value?.slice(0, 10) ?? null;

export const filterHistoricalOperations = (
  records: HistoricalOperationRecord[],
  filters: HistoricalOperationFilters,
) => {
  const search = filters.search.trim().toLowerCase();
  return records.filter((record) => {
    if (!(filters.currentPending && record.collectionState === "pending") && !isDateWithinHistoryRange(getHistoricalOperationDateKey(record.occurredAt), filters.range)) return false;
    if (filters.ownership !== "all" && record.ownershipType !== filters.ownership) return false;
    if (filters.collectionState && filters.collectionState !== "all" && record.collectionState !== filters.collectionState) return false;
    if (filters.aging && filters.aging !== "all" && record.agingLevel !== filters.aging) return false;
    if (search) {
      const haystack = [record.trailerNumber, record.customer, record.sourceOrDestination, record.reference, record.loadStatus]
        .filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  }).sort((left, right) => {
    const time = (right.occurredAt ?? "").localeCompare(left.occurredAt ?? "");
    return time || (left.trailerNumber ?? "").localeCompare(right.trailerNumber ?? "", undefined, { numeric: true });
  });
};

export const ownershipForTrailer = (row: { trailer_source?: string | null; external_company?: string | null; is_local?: boolean | null; trailer_number?: string | null }) =>
  getTrailerOwnershipType({ trailerSource: row.trailer_source, externalCompany: row.external_company, isLocal: row.is_local, trailerNumber: row.trailer_number });

type ArrivalOwnershipRow = {
  ownership_type?: string | null;
  trailer_source?: string | null;
  external_company?: string | null;
  is_local?: boolean | null;
  trailer_number?: string | null;
};

export const ownershipForArrival = (
  historicalRow: ArrivalOwnershipRow,
  currentTrailer?: ArrivalOwnershipRow | null,
) => {
  const historicalOwnership = getTrailerOwnershipType({
    ownershipType: historicalRow.ownership_type,
    trailerSource: historicalRow.trailer_source,
    externalCompany: historicalRow.external_company,
    isLocal: historicalRow.is_local,
    trailerNumber: historicalRow.trailer_number,
  });

  return historicalOwnership === "unknown"
    ? ownershipForTrailer(currentTrailer ?? historicalRow)
    : historicalOwnership;
};

export const collectionRecord = (row: { id: string; trailer_number?: string | null; customer?: string | null; booking_reference?: string | null; delivery_date: string; delivered_at?: string | null; waiting_collection_since?: string | null; collection_due_date?: string | null; collected_at?: string | null; notes?: string | null; driver?: string | null; trailer_source?: string | null; external_company?: string | null; is_local?: boolean | null }) => {
  const collectionState = row.collected_at ? "collected" as const : "pending" as const;
  const aging = calculateCollectionAging({ delivery_date: row.delivery_date, delivered_at: row.delivered_at, waiting_collection_since: row.waiting_collection_since, collection_due_date: row.collection_due_date, collected_at: row.collected_at });
  return { id: row.id, trailerNumber: row.trailer_number ?? null, occurredAt: row.collected_at ?? row.waiting_collection_since ?? row.delivered_at ?? row.delivery_date, ownershipType: ownershipForTrailer(row), customer: row.customer ?? null, sourceOrDestination: null, reference: row.booking_reference ?? null, loadStatus: null, notes: row.notes ?? null, driver: row.driver ?? null, collectionState, agingLevel: aging.agingLevel, agingLabel: aging.agingLabel, waitingSince: aging.waitingSince, collectedAt: row.collected_at ?? null } satisfies HistoricalOperationRecord;
};
