import {
  getExportAllocationStatusLabel,
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
  activeExportCustomer?: string | null;
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

export function getActiveExportCustomerByTrailerId(
  allocations: Array<{ trailer_id?: string | null; status?: string | null; customer?: string | null }>,
) {
  const exportCustomerByTrailerId = new Map<string, string | null>();

  for (const allocation of allocations) {
    if (!allocation.trailer_id || !hasActiveExportReservation(allocation.status)) {
      continue;
    }

    exportCustomerByTrailerId.set(allocation.trailer_id, allocation.customer?.trim() || null);
  }

  return exportCustomerByTrailerId;
}

export type LinkedExportForDeparture = {
  badge: "EXPORT";
  customer: string | null;
  statusLabel: string;
  summary: string;
};

export function describeLinkedExportForDeparture(
  commitment: TrailerJobCommitmentFields = {},
): LinkedExportForDeparture | null {
  if (!hasActiveExportReservation(commitment.activeExportStatus)) {
    return null;
  }

  const statusLabel = getExportAllocationStatusLabel(
    normalizeExportAllocationStatus(commitment.activeExportStatus),
  );
  const customer = commitment.activeExportCustomer?.trim() || null;

  return {
    badge: "EXPORT",
    customer,
    statusLabel,
    summary: customer ? `Export: ${customer}` : "Export linked",
  };
}

export function withTrailerJobCommitments<T extends { id: string }>(
  trailers: T[],
  input: {
    reservedByDelivery: Iterable<string>;
    exportStatusByTrailerId: Map<string, string>;
    exportCustomerByTrailerId?: Map<string, string | null>;
  },
): Array<T & Required<TrailerJobCommitmentFields>> {
  const reservedByDelivery = new Set(input.reservedByDelivery);
  const exportCustomerByTrailerId = input.exportCustomerByTrailerId ?? new Map<string, string | null>();

  return trailers.map((trailer) => ({
    ...trailer,
    hasActiveDelivery: reservedByDelivery.has(trailer.id),
    activeExportStatus: input.exportStatusByTrailerId.get(trailer.id) ?? null,
    activeExportCustomer: exportCustomerByTrailerId.get(trailer.id) ?? null,
  }));
}

export function isTrailerEligibleForNewDeliveryJob(commitment: TrailerJobCommitmentFields = {}) {
  return !commitment.hasActiveDelivery && !hasActiveExportReservation(commitment.activeExportStatus);
}

export function isTrailerEligibleForNewExportJob(commitment: TrailerJobCommitmentFields = {}) {
  return !commitment.hasActiveDelivery && !hasActiveExportReservation(commitment.activeExportStatus);
}

export function isTrailerEligibleForCompoundDeparture(commitment: TrailerJobCommitmentFields = {}) {
  return commitment.hasActiveDelivery !== true;
}

export function getTrailerJobReservationLabel(commitment: TrailerJobCommitmentFields = {}) {
  const reservedForDelivery = commitment.hasActiveDelivery === true;
  const reservedForExport = hasActiveExportReservation(commitment.activeExportStatus);

  if (reservedForDelivery && reservedForExport) {
    return "Reserved - Delivery + Export";
  }

  if (reservedForDelivery) {
    return "Reserved - Delivery";
  }

  if (reservedForExport) {
    return "Reserved - Export";
  }

  return null;
}
