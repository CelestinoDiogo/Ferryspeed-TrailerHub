import { normalizeExportAllocationStatus } from "@/lib/export-allocation";

export type MandatoryCollectionSource = "delivery" | "export";
export type MandatoryCollectionAgeLevel = "green" | "orange" | "red" | "future";

export type MandatoryCollection = {
  key: string;
  source: MandatoryCollectionSource;
  sourceId: string;
  trailerId: string | null;
  trailerNumber: string | null;
  customer: string | null;
  location: string | null;
  reference: string | null;
  status: string;
  originalDueAt: string;
  ageStartedAt: string;
  pendingSince: string;
  collectedAt: string | null;
  physicalResult: "Empty" | "Loaded" | null;
  ageHours: number;
  ageLevel: MandatoryCollectionAgeLevel;
  ageLabel: string;
  isOutstanding: boolean;
};

export type DeliveryCollectionSourceRow = {
  id: string;
  trailer_id: string | null;
  trailer_number?: string | null;
  customer?: string | null;
  delivery_location?: string | null;
  booking_reference?: string | null;
  delivery_date: string;
  delivered_at?: string | null;
  waiting_collection_since?: string | null;
  collection_due_date?: string | null;
  collected_at?: string | null;
  status: string;
  resulting_load_status?: string | null;
};

export type ExportCollectionSourceRow = {
  id: string;
  trailer_id: string | null;
  trailer_number?: string | null;
  customer?: string | null;
  collection_address?: string | null;
  booking_reference?: string | null;
  collection_date?: string | null;
  expected_return_at?: string | null;
  delivered_empty_at?: string | null;
  waiting_loading_at?: string | null;
  collected_loaded_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  status: string;
};

const HOUR_MS = 3_600_000;
const normalizeStatus = (value?: string | null) => value?.trim().toLowerCase() ?? "";

// Date-only collection commitments become due at 00:00 UTC on the recorded business date.
export const COLLECTION_DATE_OPERATIONAL_BOUNDARY = "00:00 UTC";
const toTimestamp = (value: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value).getTime();
const toIsoAtOperationalBoundary = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  ? `${value}T00:00:00.000Z`
  : value;

export const getMandatoryCollectionAge = (originalDueAt: string, referenceAt: string | Date = new Date()) => {
  const dueTime = toTimestamp(originalDueAt);
  const referenceTime = referenceAt instanceof Date ? referenceAt.getTime() : new Date(referenceAt).getTime();
  const elapsedHours = Number.isFinite(dueTime) && Number.isFinite(referenceTime) ? (referenceTime - dueTime) / HOUR_MS : 0;

  if (elapsedHours < 0) {
    const hoursUntilDue = Math.ceil(Math.abs(elapsedHours));
    return {
      ageHours: 0,
      ageLevel: "future" as const,
      ageLabel: hoursUntilDue < 24 ? `Due in ${hoursUntilDue}h` : `Due in ${Math.ceil(hoursUntilDue / 24)}d`,
    };
  }

  const ageHours = Math.max(0, elapsedHours);
  const ageLevel: MandatoryCollectionAgeLevel = ageHours <= 24 ? "green" : ageHours <= 48 ? "orange" : "red";
  const wholeHours = Math.floor(ageHours);
  const days = Math.floor(wholeHours / 24);
  const remainingHours = wholeHours % 24;
  const ageLabel = wholeHours === 0
    ? "Due now"
    : days === 0
      ? `Pending ${wholeHours}h`
      : remainingHours === 0
        ? `Pending ${days}d`
        : `Pending ${days}d ${remainingHours}h`;

  return { ageHours, ageLevel, ageLabel };
};

export const isDeliveryPendingMandatoryCollection = (row: Pick<DeliveryCollectionSourceRow, "status" | "collected_at">) => {
  const status = normalizeStatus(row.status);
  return !row.collected_at && (status === "waiting_collection" || status === "delivered");
};

export const projectDeliveryCollection = (row: DeliveryCollectionSourceRow, referenceAt?: string | Date): MandatoryCollection | null => {
  const status = normalizeStatus(row.status);
  const isCancelled = status === "cancelled";
  const isCompleted = status === "collected" && Boolean(row.collected_at);
  const isOutstanding = isDeliveryPendingMandatoryCollection(row);
  if (isCancelled || (!isOutstanding && !isCompleted)) return null;

  const pendingSince = row.waiting_collection_since ?? row.delivered_at ?? toIsoAtOperationalBoundary(row.delivery_date);
  const originalDueAt = row.collection_due_date ? toIsoAtOperationalBoundary(row.collection_due_date) : pendingSince;
  const ageStartedAt = pendingSince;
  const normalizedResult = row.resulting_load_status?.trim().toLowerCase();

  return {
    key: `delivery:${row.id}`,
    source: "delivery",
    sourceId: row.id,
    trailerId: row.trailer_id,
    trailerNumber: row.trailer_number ?? null,
    customer: row.customer ?? null,
    location: row.delivery_location ?? null,
    reference: row.booking_reference ?? null,
    status: row.status,
    originalDueAt,
    ageStartedAt,
    pendingSince,
    collectedAt: row.collected_at ?? null,
    physicalResult: normalizedResult === "empty" ? "Empty" : normalizedResult === "loaded" ? "Loaded" : null,
    ...getMandatoryCollectionAge(ageStartedAt, isCompleted && row.collected_at ? row.collected_at : referenceAt),
    isOutstanding,
  };
};

export const projectExportCollection = (row: ExportCollectionSourceRow, referenceAt?: string | Date): MandatoryCollection | null => {
  const status = normalizeExportAllocationStatus(row.status);
  const isOutstanding = status === "delivered_empty" || status === "waiting_loading";
  const isCompleted = status === "collected_loaded" || status === "completed";
  const isCancelled = status === "cancelled" || Boolean(row.cancelled_at);
  if (isCancelled || (!isOutstanding && !isCompleted)) return null;

  const pendingSince = row.delivered_empty_at ?? row.waiting_loading_at ?? row.expected_return_at
    ?? (row.collection_date ? toIsoAtOperationalBoundary(row.collection_date) : new Date(0).toISOString());
  const originalDueAt = row.expected_return_at ?? pendingSince;
  const ageStartedAt = originalDueAt;

  const collectedAt = row.collected_loaded_at ?? row.completed_at ?? null;

  return {
    key: `export:${row.id}`,
    source: "export",
    sourceId: row.id,
    trailerId: row.trailer_id,
    trailerNumber: row.trailer_number ?? null,
    customer: row.customer ?? null,
    location: row.collection_address ?? null,
    reference: row.booking_reference ?? null,
    status: row.status,
    originalDueAt,
    ageStartedAt,
    pendingSince,
    collectedAt,
    physicalResult: isCompleted ? "Loaded" : null,
    ...getMandatoryCollectionAge(ageStartedAt, isCompleted && collectedAt ? collectedAt : referenceAt),
    isOutstanding,
  };
};

const severityRank: Record<MandatoryCollectionAgeLevel, number> = { red: 0, orange: 1, green: 2, future: 3 };

export const sortMandatoryCollections = (items: MandatoryCollection[]) => [...items].sort((left, right) => {
  const severity = severityRank[left.ageLevel] - severityRank[right.ageLevel];
  if (severity !== 0) return severity;
  if (left.ageLevel === "future") return left.originalDueAt.localeCompare(right.originalDueAt);
  return right.ageHours - left.ageHours || left.key.localeCompare(right.key);
});

export const deriveMandatoryCollections = (input: {
  deliveries: DeliveryCollectionSourceRow[];
  exports: ExportCollectionSourceRow[];
  referenceAt?: string | Date;
  includeCompleted?: boolean;
}) => {
  const projected = [
    ...input.deliveries.map((row) => projectDeliveryCollection(row, input.referenceAt)),
    ...input.exports.map((row) => projectExportCollection(row, input.referenceAt)),
  ].filter((item): item is MandatoryCollection => Boolean(item));
  const unique = new Map(projected.map((item) => [item.key, item]));
  return sortMandatoryCollections(Array.from(unique.values()).filter((item) => input.includeCompleted || item.isOutstanding));
};