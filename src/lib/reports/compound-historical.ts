import { isDateWithinHistoryRange, type HistoryDateRangeValue } from "@/lib/history-date-range";
import { getTrailerOwnershipType, type TrailerOwnershipType } from "@/lib/trailer-ownership";
import { resolveHistoricalOwnership, type HistoricalOwnershipSnapshot } from "@/lib/reports/historical-trailer-ownership";

export type CompoundReportMode = "snapshot" | "activity";
export type CompoundSnapshotRecord = {
  id: string;
  trailerNumber: string | null;
  ownershipType: TrailerOwnershipType;
  position: string | null;
  loadStatus: string | null;
  customer: string | null;
  trailerType: string | null;
  localLabel: string;
  currentStatus: string | null;
  notes: string | null;
  eventType?: string;
  previousPosition?: string | null;
  newPosition?: string | null;
  sourceModule?: string | null;
  description?: string | null;
  occurredAt?: string | null;
};
export type CompoundActivityRecord = {
  id: string;
  occurredAt: string | null;
  trailerNumber: string | null;
  eventType: string;
  ownershipType: TrailerOwnershipType;
  previousPosition: string | null;
  newPosition: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  sourceModule: string | null;
  performedBy: string | null;
  description: string | null;
  currentStatus?: string | null;
  loadStatus?: string | null;
  localLabel?: string;
  position?: string | null;
  customer?: string | null;
};

export const compoundActivityTypes = ["arrived", "compound_entered", "compound_position_changed", "compound_removed", "departed", "load_status_changed", "operational_status_changed", "stock_check_confirmed", "stock_check_adjusted"] as const;

export const filterCompoundActivity = (rows: CompoundActivityRecord[], range: HistoryDateRangeValue, ownership: "all" | "company" | "outsourcing", search: string, eventType: string) => {
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (!isDateWithinHistoryRange(row.occurredAt?.slice(0, 10), range)) return false;
    if (ownership !== "all" && row.ownershipType !== ownership) return false;
    if (eventType !== "all" && row.eventType !== eventType) return false;
    if (needle && ![row.trailerNumber, row.eventType, row.description, row.previousPosition, row.newPosition].filter(Boolean).join(" ").toLowerCase().includes(needle)) return false;
    return true;
  }).sort((left, right) => (right.occurredAt ?? "").localeCompare(left.occurredAt ?? ""));
};

export const ownershipForCompoundTrailer = (row: { trailer_source?: string | null; external_company?: string | null; is_local?: boolean | null; trailer_number?: string | null }) => getTrailerOwnershipType({ trailerSource: row.trailer_source, externalCompany: row.external_company, isLocal: row.is_local, trailerNumber: row.trailer_number });

export const ownershipForCompoundActivity = (
  sourceSnapshot?: HistoricalOwnershipSnapshot | null,
  eventSnapshot?: HistoricalOwnershipSnapshot | null,
) => resolveHistoricalOwnership({ sourceSnapshot, eventSnapshot });

export const toCompoundSnapshotRecord = (row: {
  id: string;
  trailer_number: string | null;
  compound_position: string | null;
  load_status: string | null;
  customer: string | null;
  trailer_type?: string | null;
  is_local?: boolean | null;
  operational_status: string | null;
  notes?: string | null;
  trailer_source?: string | null;
  external_company?: string | null;
}): CompoundSnapshotRecord => ({
  id: row.id,
  trailerNumber: row.trailer_number,
  ownershipType: ownershipForCompoundTrailer(row),
  position: row.compound_position,
  loadStatus: row.load_status,
  customer: row.customer,
  trailerType: row.trailer_type ?? null,
  localLabel: row.is_local ? "Local" : "External",
  currentStatus: row.operational_status,
  notes: row.notes ?? null,
});
