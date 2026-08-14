import { getTrailerOwnershipType, type TrailerOwnershipType } from "@/lib/trailer-ownership";
import { isDateWithinHistoryRange, type HistoryDateRangeValue } from "@/lib/history-date-range";

export type HistoricalOperationKind = "arrivals" | "departures";
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
};

export type HistoricalOperationFilters = {
  range: HistoryDateRangeValue;
  ownership: "all" | "company" | "outsourcing";
  search: string;
};

export const getHistoricalOperationDateKey = (value?: string | null) => value?.slice(0, 10) ?? null;

export const filterHistoricalOperations = (
  records: HistoricalOperationRecord[],
  filters: HistoricalOperationFilters,
) => {
  const search = filters.search.trim().toLowerCase();
  return records.filter((record) => {
    if (!isDateWithinHistoryRange(getHistoricalOperationDateKey(record.occurredAt), filters.range)) return false;
    if (filters.ownership !== "all" && record.ownershipType !== filters.ownership) return false;
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
