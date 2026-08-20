import {
  isExportAllocationActive,
  normalizeExportAllocationStatus,
} from "@/lib/export-allocation";

export const TRAILER_ACTIVE_EXPORT_ALLOCATION_CODE = "TRAILER_ACTIVE_EXPORT_ALLOCATION";

export const TRAILER_ACTIVE_EXPORT_ALLOCATION_MESSAGE =
  "This trailer already has an active export allocation and cannot be assigned to an incompatible job until that allocation is completed or cancelled.";

export const TRAILER_RESERVED_FOR_DELIVERY_CODE = "TRAILER_RESERVED_FOR_DELIVERY";

export const TRAILER_RESERVED_FOR_DELIVERY_MESSAGE =
  "This trailer already has an active delivery booking and cannot be assigned to an incompatible job until that booking is collected or cancelled.";

export const TRAILER_NOT_AVAILABLE_FOR_DEPARTURE_CODE = "TRAILER_NOT_AVAILABLE_FOR_DEPARTURE";

export const TRAILER_NOT_AVAILABLE_FOR_DEPARTURE_MESSAGE =
  "This trailer is reserved or is no longer physically available in the compound and cannot be confirmed as a departure.";

export class TrailerJobConflictError extends Error {
  status = 409;

  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "TrailerJobConflictError";
  }
}

export type TrailerJobCommitmentFields = {
  hasActiveDelivery?: boolean | null;
  activeExportStatus?: string | null;
};

export function hasActiveExportReservation(status?: string | null) {
  if (!(status ?? "").trim()) {
    return false;
  }

  return isExportAllocationActive(normalizeExportAllocationStatus(status));
}

export function getTrailerIdsReservedByActiveExportAllocations(
  allocations: Array<{ trailer_id?: string | null; status?: string | null }>,
) {
  const reservedTrailerIds = new Set<string>();

  for (const allocation of allocations) {
    if (!allocation.trailer_id || !hasActiveExportReservation(allocation.status)) {
      continue;
    }

    reservedTrailerIds.add(allocation.trailer_id);
  }

  return reservedTrailerIds;
}

export function getActiveExportStatusByTrailerId(
  allocations: Array<{ trailer_id?: string | null; status?: string | null }>,
) {
  const exportStatusByTrailerId = new Map<string, string>();

  for (const allocation of allocations) {
    if (!allocation.trailer_id || !hasActiveExportReservation(allocation.status)) {
      continue;
    }

    exportStatusByTrailerId.set(allocation.trailer_id, normalizeExportAllocationStatus(allocation.status));
  }

  return exportStatusByTrailerId;
}

export function withTrailerJobCommitments<T extends { id: string }>(
  trailers: T[],
  input: {
    reservedByDelivery: Iterable<string>;
    exportStatusByTrailerId: Map<string, string>;
  },
): Array<T & Required<TrailerJobCommitmentFields>> {
  const reservedByDelivery = new Set(input.reservedByDelivery);

  return trailers.map((trailer) => ({
    ...trailer,
    hasActiveDelivery: reservedByDelivery.has(trailer.id),
    activeExportStatus: input.exportStatusByTrailerId.get(trailer.id) ?? null,
  }));
}

export function isTrailerEligibleForNewDeliveryJob(commitment: TrailerJobCommitmentFields = {}) {
  return !commitment.hasActiveDelivery && !hasActiveExportReservation(commitment.activeExportStatus);
}

export function isTrailerEligibleForNewExportJob(commitment: TrailerJobCommitmentFields = {}) {
  return !commitment.hasActiveDelivery && !hasActiveExportReservation(commitment.activeExportStatus);
}

export function isTrailerEligibleForCompoundDeparture(commitment: TrailerJobCommitmentFields = {}) {
  if (commitment.hasActiveDelivery) {
    return false;
  }

  return !hasActiveExportReservation(commitment.activeExportStatus);
}
