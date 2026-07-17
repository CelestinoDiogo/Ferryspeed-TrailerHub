import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  getExportDerivedWorkflowStage,
  getExportWorkflowTimestamp,
  mapDerivedExportStageToOperationalStage,
} from "@/lib/operations/export-outbound-workflow";
import {
  ALLOWED_OPERATIONAL_TRANSITIONS,
  getAvailableNextStages,
  getOperationalStageLabel,
  type OperationalStage,
} from "@/lib/operations/operational-stages";
import {
  inferOperationalSourceModule,
  mapTrailerEventRowToOperationalEvent,
  type OperationalEvent,
} from "@/lib/operations/operational-events";

type TrailerRow = Database["public"]["Tables"]["trailers"]["Row"];
type CompanyTrailerRow = Database["public"]["Tables"]["company_trailers"]["Row"];
type TrailerEventRow = Database["public"]["Tables"]["trailer_events"]["Row"];
type DeliveryBookingRow = Database["public"]["Tables"]["delivery_bookings"]["Row"];
type ExportAllocationRow = Database["public"]["Tables"]["export_allocations"]["Row"];
type VesselOperationRow = Database["public"]["Tables"]["vessel_operations"]["Row"];
type VesselOperationTrailerRow = Database["public"]["Tables"]["vessel_operation_trailers"]["Row"];
type DamageRow = Database["public"]["Tables"]["vessel_inspection_damages"]["Row"];
type TemperatureRow = Database["public"]["Tables"]["vessel_inspection_temperatures"]["Row"];

export type TrailerNextAction = {
  label: string;
  href: string | null;
  sourceModule:
    | "vessel"
    | "arrival"
    | "inspection"
    | "compound"
    | "delivery"
    | "collection"
    | "export"
    | "departure"
    | "maintenance"
    | "system";
};

export type TrailerIssueIndicator = {
  hasIssues: boolean;
  reasons: string[];
};

export type TrailerRelatedRecord = {
  id: string;
  label: string;
  href: string | null;
  module:
    | "vessel"
    | "inspection"
    | "delivery"
    | "collection"
    | "export"
    | "departure"
    | "system";
  recordedAt?: string | null;
};

export type TrailerDwellMetrics = {
  durationInStageMs: number | null;
  durationInStageLabel: string;
  totalYardDwellMs: number | null;
  totalYardDwellLabel: string;
  compoundDwellMs: number | null;
  compoundDwellLabel: string;
  customerSiteDwellMs: number | null;
  customerSiteDwellLabel: string;
  vesselProcessingMs: number | null;
  vesselProcessingLabel: string;
  receptionProcessingMs: number | null;
  receptionProcessingLabel: string;
};

export type TrailerOperationalPosition = {
  trailerId: string | null;
  trailerNumber: string;
  operationalStage: OperationalStage | null;
  stageLabel: string;
  currentLocation: string | null;
  customer: string | null;
  vessel: string | null;
  voyage: string | null;
  compoundPosition: string | null;
  currentOperationReference: string | null;
  stageStartedAt: string | null;
  priority: string | null;
  issueIndicator: TrailerIssueIndicator;
  nextRecommendedAction: TrailerNextAction | null;
  availableNextStages: OperationalStage[];
  precedenceReason: string;
  dwell: TrailerDwellMetrics;
};

export type TrailerOperationalProfile = {
  identifier: string;
  trailer: TrailerRow | null;
  companyTrailer: CompanyTrailerRow | null;
  trailerEventRows: TrailerEventRow[];
  vesselOperationTrailers: VesselOperationTrailerRow[];
  vesselOperations: VesselOperationRow[];
  deliveryBookings: DeliveryBookingRow[];
  exportAllocations: ExportAllocationRow[];
  events: OperationalEvent[];
  relatedRecords: TrailerRelatedRecord[];
  position: TrailerOperationalPosition;
  fleetStatus: string;
  trailerType: string | null;
};

export type TrailerOperationalContext = {
  trailerNumber: string;
  trailer: TrailerRow | null;
  companyTrailer: CompanyTrailerRow | null;
  trailerEvents: TrailerEventRow[];
  vesselOperationTrailers: VesselOperationTrailerRow[];
  vesselOperations: VesselOperationRow[];
  deliveryBookings: DeliveryBookingRow[];
  exportAllocations: ExportAllocationRow[];
  damages?: DamageRow[];
  temperatures?: TemperatureRow[];
};

export const TRAILER_OPERATIONAL_PRECEDENCE_RULES = [
  "Maintenance operational status overrides all normal availability.",
  "Departure date or departed operational status overrides all active yard states.",
  "Active export allocation stages override general compound or local availability.",
  "Active delivery or collection stages override general compound or local availability.",
  "Explicit hold or awaiting-position reception states override general yard placement.",
  "Active trailer yard states (compound or local) override passive received states.",
  "Vessel exception states such as not discharged override expected planning states.",
  "Active vessel arrival and inspection states are used when no stronger active trailer state exists.",
  "Confirmed vessel expectation is the final fallback before unknown / no active stage.",
] as const;

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  try {
    return new Date(value).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
};

const normalizeTrailerNumber = (value?: string | null) => (value ?? "").trim().toUpperCase();

const normalizeOperationalStatus = (value?: string | null) => (value ?? "").trim().toLowerCase();

const isActiveDeparture = (value?: string | null) => Boolean(value && value.trim());

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return true;
};

const parseJsonMetadata = (value: unknown) => {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const metadata = value.metadata;
  return isPlainObject(metadata) ? metadata : undefined;
};

const formatDuration = (milliseconds: number | null) => {
  if (milliseconds === null || milliseconds < 0) {
    return "-";
  }

  const totalMinutes = Math.floor(milliseconds / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days} day${days === 1 ? "" : "s"} ${hours} h` : `${days} day${days === 1 ? "" : "s"}`;
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  }

  return `${minutes} min`;
};

const toMs = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const durationBetween = (start?: string | null, end?: string | null) => {
  const startMs = toMs(start);
  const endMs = toMs(end ?? new Date().toISOString());
  if (startMs === null || endMs === null) {
    return null;
  }

  return Math.max(endMs - startMs, 0);
};

const getMostRecent = <T extends Record<string, unknown>>(
  rows: T[],
  field: keyof T,
) => {
  return [...rows].sort((left, right) => {
    const leftField = left[field];
    const rightField = right[field];
    const leftValue = toMs(typeof leftField === "string" ? leftField : null);
    const rightValue = toMs(typeof rightField === "string" ? rightField : null);
    return (rightValue ?? 0) - (leftValue ?? 0);
  })[0] ?? null;
};

const getCurrentVesselOperationTrailer = (
  trailer: TrailerRow | null,
  trailerNumber: string,
  rows: VesselOperationTrailerRow[],
  operationsById: Map<string, VesselOperationRow>,
) => {
  const activeRows = rows.filter((row) => {
    const operation = operationsById.get(row.vessel_operation_id);
    return operation?.status !== "completed";
  });

  const preferredRows = activeRows.length > 0 ? activeRows : rows;

  return (
    preferredRows.find((row) => trailer?.source_vessel_operation_trailer_id && row.id === trailer.source_vessel_operation_trailer_id) ??
    preferredRows.find((row) => trailer?.id && (row.arrival_record_id === trailer.id || row.trailer_id === trailer.id)) ??
    preferredRows.find((row) => normalizeTrailerNumber(row.trailer_number) === trailerNumber)
  );
};

const mapExportAllocationStage = (input: {
  allocation: ExportAllocationRow | null;
  trailerEvents: TrailerEventRow[];
  trailer: TrailerRow | null;
  vesselTrailer: VesselOperationTrailerRow | null;
}): OperationalStage | null => {
  if (!input.allocation) {
    return null;
  }

  return mapDerivedExportStageToOperationalStage(
    getExportDerivedWorkflowStage({
      allocation: input.allocation,
      events: input.trailerEvents,
      vesselTrailer: input.vesselTrailer,
      trailer: input.trailer,
    }),
  );
};

const mapDeliveryStage = (booking: DeliveryBookingRow | null): OperationalStage | null => {
  if (!booking) {
    return null;
  }

  switch ((booking.status ?? "").trim().toLowerCase()) {
    case "on_delivery":
      return "on_delivery";
    case "delivered":
      return "delivered";
    case "waiting_collection":
      return "waiting_collection";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
};

const getExportStageStartedAt = (input: {
  allocation: ExportAllocationRow | null;
  trailerEvents: TrailerEventRow[];
  trailer: TrailerRow | null;
  vesselTrailer: VesselOperationTrailerRow | null;
}) => {
  if (!input.allocation) {
    return null;
  }

  const derivedStage = getExportDerivedWorkflowStage({
    allocation: input.allocation,
    events: input.trailerEvents,
    vesselTrailer: input.vesselTrailer,
    trailer: input.trailer,
  });

  return getExportWorkflowTimestamp({
    allocation: input.allocation,
    events: input.trailerEvents,
    stage: derivedStage,
  });
};

const getDeliveryStageStartedAt = (booking: DeliveryBookingRow | null) => {
  if (!booking) {
    return null;
  }

  const stage = mapDeliveryStage(booking);
  switch (stage) {
    case "on_delivery":
      return booking.updated_at ?? booking.created_at ?? null;
    case "delivered":
      return booking.delivered_at ?? booking.updated_at ?? null;
    case "waiting_collection":
      return booking.waiting_collection_since ?? booking.updated_at ?? null;
    case "cancelled":
      return booking.updated_at ?? null;
    default:
      return null;
  }
};

const buildNextAction = (input: {
  stage: OperationalStage | null;
  trailerNumber: string;
  trailer: TrailerRow | null;
  activeDelivery: DeliveryBookingRow | null;
  activeExport: ExportAllocationRow | null;
  currentVesselOperation: VesselOperationRow | null;
  currentVesselTrailer: VesselOperationTrailerRow | null;
}): TrailerNextAction | null => {
  const encodedTrailerNumber = encodeURIComponent(input.trailerNumber);

  switch (input.stage) {
    case "expected":
      return input.currentVesselOperation
        ? {
            label: "Open Expected Arrivals",
            href: `/dashboard/vessel-operations/${input.currentVesselOperation.id}/arrivals`,
            sourceModule: "arrival",
          }
        : null;
    case "arrived":
    case "inspection":
      return input.currentVesselOperation && input.currentVesselTrailer
        ? {
            label: "Open Boat Check",
            href: `/dashboard/vessel-operations/${input.currentVesselOperation.id}/boat-check/${input.currentVesselTrailer.id}`,
            sourceModule: "inspection",
          }
        : null;
    case "received":
    case "hold":
    case "not_discharged":
      return input.currentVesselOperation
        ? {
            label: "Open Vessel Operation",
            href: `/dashboard/vessel-operations/${input.currentVesselOperation.id}`,
            sourceModule: "vessel",
          }
        : null;
    case "allocated":
    case "delivered_empty":
    case "waiting_loading":
    case "collected_loaded":
    case "ready_for_shipping":
    case "loaded_on_vessel":
      return input.activeExport
        ? {
            label: "Open Export Allocation",
            href: `/dashboard/export-operations/${input.activeExport.id}`,
            sourceModule: "export",
          }
        : null;
    case "on_delivery":
    case "delivered":
    case "waiting_collection":
      return input.activeDelivery
        ? {
            label: "Open Delivery Booking",
            href: `/dashboard/deliveries/${input.activeDelivery.id}`,
            sourceModule: input.stage === "waiting_collection" ? "collection" : "delivery",
          }
        : null;
    case "maintenance":
      return {
        label: "Open Maintenance",
        href: "/dashboard/maintenance",
        sourceModule: "maintenance",
      };
    case "compound":
    case "local":
      return {
        label: "Open Trailer Profile",
        href: `/dashboard/trailers/${encodedTrailerNumber}`,
        sourceModule: "system",
      };
    default:
      return null;
  }
};

const dedupeEvents = (events: OperationalEvent[]) => {
  const seen = new Set<string>();
  return events
    .sort((left, right) => (toMs(right.occurredAt) ?? 0) - (toMs(left.occurredAt) ?? 0))
    .filter((event) => {
      const key = [event.eventType, event.sourceModule, event.sourceRecordId ?? "none", event.occurredAt].join(":");
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
};

const buildDerivedEvents = (input: {
  trailer: TrailerRow | null;
  trailerNumber: string;
  vesselOperationTrailers: VesselOperationTrailerRow[];
  operationsById: Map<string, VesselOperationRow>;
  damages: DamageRow[];
  temperatures: TemperatureRow[];
  deliveryBookings: DeliveryBookingRow[];
  exportAllocations: ExportAllocationRow[];
}) => {
  const events: OperationalEvent[] = [];

  input.vesselOperationTrailers.forEach((row) => {
    const operation = input.operationsById.get(row.vessel_operation_id);
    const voyage = operation?.sailing_reference ?? operation?.vessel_name ?? row.vessel_operation_id;

    if (row.created_at) {
      events.push({
        id: `derived-vessel-list-added-${row.id}`,
        trailerNumber: input.trailerNumber,
        eventType: "vessel_list_added",
        title: "Added to vessel list",
        description: `Trailer added to vessel operation ${voyage}.`,
        occurredAt: row.created_at,
        sourceModule: "vessel",
        sourceRecordId: row.id,
      });
    }

    if (operation?.list_confirmed_at) {
      events.push({
        id: `derived-vessel-list-confirmed-${row.id}`,
        trailerNumber: input.trailerNumber,
        eventType: "vessel_list_confirmed",
        title: "Expected list confirmed",
        description: `Vessel list confirmed for ${voyage}.`,
        occurredAt: operation.list_confirmed_at,
        userName: operation.list_confirmed_by ?? undefined,
        sourceModule: "vessel",
        sourceRecordId: operation.id,
      });
    }

    if (row.arrival_confirmed_at ?? row.arrived_at) {
      events.push({
        id: `derived-trailer-arrived-${row.id}`,
        trailerNumber: input.trailerNumber,
        eventType: "trailer_arrived",
        title: "Trailer arrived",
        description: `Arrival recorded against ${voyage}.`,
        occurredAt: row.arrival_confirmed_at ?? row.arrived_at ?? row.created_at ?? new Date().toISOString(),
        sourceModule: "arrival",
        sourceRecordId: row.id,
      });
    }

    if (row.inspection_started_at) {
      events.push({
        id: `derived-inspection-started-${row.id}`,
        trailerNumber: input.trailerNumber,
        eventType: "inspection_started",
        title: "Inspection started",
        description: `Boat Check started for ${input.trailerNumber}.`,
        occurredAt: row.inspection_started_at,
        sourceModule: "inspection",
        sourceRecordId: row.id,
      });
    }

    if (row.inspection_completed_at) {
      events.push({
        id: `derived-inspection-completed-${row.id}`,
        trailerNumber: input.trailerNumber,
        eventType: "inspection_completed",
        title: "Inspection completed",
        description: `Boat Check completed for ${input.trailerNumber}.`,
        occurredAt: row.inspection_completed_at,
        sourceModule: "inspection",
        sourceRecordId: row.id,
      });
    }

    if (row.position_assigned_at) {
      events.push({
        id: `derived-compound-position-${row.id}`,
        trailerNumber: input.trailerNumber,
        eventType: "compound_position_assigned",
        title: "Compound position assigned",
        description: row.assigned_position
          ? `Assigned to compound position ${row.assigned_position}.`
          : "Reception position assignment recorded.",
        occurredAt: row.position_assigned_at,
        sourceModule: "compound",
        sourceRecordId: row.id,
      });
    }
  });

  input.damages.forEach((row) => {
    if (!row.recorded_at) {
      return;
    }

    events.push({
      id: `derived-inspection-issue-${row.id}`,
      trailerNumber: input.trailerNumber,
      eventType: "inspection_issue_found",
      title: "Inspection issue found",
      description: row.description ?? row.damage_type ?? "Damage recorded during inspection.",
      occurredAt: row.recorded_at,
      userName: row.recorded_by ?? undefined,
      sourceModule: "inspection",
      sourceRecordId: row.id,
    });
  });

  input.temperatures.forEach((row) => {
    if (!row.recorded_at || row.is_out_of_range !== true) {
      return;
    }

    events.push({
      id: `derived-temperature-issue-${row.id}`,
      trailerNumber: input.trailerNumber,
      eventType: "inspection_issue_found",
      title: "Temperature alert",
      description: `Temperature alert recorded at ${row.reading_point ?? "unknown point"}.`,
      occurredAt: row.recorded_at,
      userName: row.recorded_by ?? undefined,
      sourceModule: "inspection",
      sourceRecordId: row.id,
    });
  });

  input.deliveryBookings.forEach((row) => {
    if (row.delivered_at) {
      events.push({
        id: `derived-delivered-${row.id}`,
        trailerNumber: input.trailerNumber,
        eventType: "delivered",
        title: "Delivered",
        description: `Delivery completed for booking ${row.booking_reference ?? row.id}.`,
        occurredAt: row.delivered_at,
        sourceModule: "delivery",
        sourceRecordId: row.id,
      });
    }

    if (row.waiting_collection_since) {
      events.push({
        id: `derived-waiting-collection-${row.id}`,
        trailerNumber: input.trailerNumber,
        eventType: "waiting_collection",
        title: "Waiting collection",
        description: `Trailer waiting for collection from ${row.delivery_location ?? row.customer ?? "customer site"}.`,
        occurredAt: row.waiting_collection_since,
        sourceModule: "collection",
        sourceRecordId: row.id,
      });
    }

    if (row.collected_at) {
      events.push({
        id: `derived-collected-${row.id}`,
        trailerNumber: input.trailerNumber,
        eventType: "collected",
        title: "Collected",
        description: `Trailer collected from delivery workflow ${row.booking_reference ?? row.id}.`,
        occurredAt: row.collected_at,
        sourceModule: "collection",
        sourceRecordId: row.id,
      });
    }
  });

  input.exportAllocations.forEach((row) => {
    const normalizedStatus = (row.status ?? "").trim().toLowerCase();

    if (row.allocated_at) {
      events.push({
        id: `derived-export-allocated-${row.id}`,
        trailerNumber: input.trailerNumber,
        eventType: "export_allocated",
        title: "Export allocated",
        description: `Allocated to export booking ${row.booking_reference ?? row.id}.`,
        occurredAt: row.allocated_at,
        sourceModule: "export",
        sourceRecordId: row.id,
      });
    }

    if (row.delivered_empty_at) {
      events.push({
        id: `derived-export-delivered-empty-${row.id}`,
        trailerNumber: input.trailerNumber,
        eventType: "delivered_empty",
        title: "Delivered empty",
        description: `Empty trailer delivered to ${row.customer ?? "customer"}.`,
        occurredAt: row.delivered_empty_at,
        sourceModule: "export",
        sourceRecordId: row.id,
      });
    }

    if (row.waiting_loading_at || normalizedStatus === "waiting_loading") {
      events.push({
        id: `derived-export-waiting-loading-${row.id}`,
        trailerNumber: input.trailerNumber,
        eventType: "waiting_loading",
        title: "Waiting loading",
        description: `Trailer waiting loading at ${row.customer ?? "customer site"}.`,
        occurredAt: row.waiting_loading_at ?? row.updated_at ?? row.created_at ?? new Date().toISOString(),
        sourceModule: "export",
        sourceRecordId: row.id,
      });
    }

    if (row.collected_loaded_at || row.loaded_at || normalizedStatus === "collected_loaded" || normalizedStatus === "loaded") {
      events.push({
        id: `derived-export-collected-loaded-${row.id}`,
        trailerNumber: input.trailerNumber,
        eventType: "collected_loaded",
        title: "Collected loaded",
        description: `Loaded trailer collected from ${row.customer ?? "customer"}.`,
        occurredAt: row.collected_loaded_at ?? row.loaded_at ?? row.updated_at ?? row.created_at ?? new Date().toISOString(),
        sourceModule: "export",
        sourceRecordId: row.id,
      });
    }

    if (row.shipped_at) {
      events.push({
        id: `derived-export-departed-${row.id}`,
        trailerNumber: input.trailerNumber,
        eventType: "departed",
        title: "Departed",
        description: `Trailer departed via export workflow ${row.booking_reference ?? row.id}.`,
        occurredAt: row.shipped_at,
        sourceModule: "export",
        sourceRecordId: row.id,
      });
    }
  });

  if (input.trailer?.departure_date) {
    events.push({
      id: `derived-departure-${input.trailer.id}`,
      trailerNumber: input.trailerNumber,
      eventType: "departed",
      title: "Departed",
      description: "Trailer departure registered.",
      occurredAt: input.trailer.departure_date,
      sourceModule: "departure",
      sourceRecordId: input.trailer.id,
    });
  }

  return events;
};

const buildRelatedRecords = (input: {
  trailerNumber: string;
  trailer: TrailerRow | null;
  vesselOperationTrailers: VesselOperationTrailerRow[];
  operationsById: Map<string, VesselOperationRow>;
  deliveryBookings: DeliveryBookingRow[];
  exportAllocations: ExportAllocationRow[];
}) => {
  const records: TrailerRelatedRecord[] = [];

  input.vesselOperationTrailers.forEach((row) => {
    const operation = input.operationsById.get(row.vessel_operation_id);
    records.push({
      id: row.id,
      label: operation?.vessel_name
        ? `${operation.vessel_name}${operation.sailing_reference ? ` - ${operation.sailing_reference}` : ""}`
        : `Vessel Operation ${row.vessel_operation_id}`,
      href: `/dashboard/vessel-operations/${row.vessel_operation_id}`,
      module: "vessel",
      recordedAt: row.created_at,
    });

    records.push({
      id: `${row.id}-inspection`,
      label: `Boat Check ${input.trailerNumber}`,
      href: `/dashboard/vessel-operations/${row.vessel_operation_id}/boat-check/${row.id}`,
      module: "inspection",
      recordedAt: row.inspection_completed_at ?? row.inspection_started_at,
    });
  });

  input.deliveryBookings.forEach((row) => {
    records.push({
      id: row.id,
      label: `Delivery ${row.booking_reference ?? row.id}`,
      href: `/dashboard/deliveries/${row.id}`,
      module: row.status === "waiting_collection" || row.status === "collected" ? "collection" : "delivery",
      recordedAt: row.updated_at ?? row.created_at,
    });
  });

  input.exportAllocations.forEach((row) => {
    records.push({
      id: row.id,
      label: `Export ${row.booking_reference ?? row.id}`,
      href: `/dashboard/export-operations/${row.id}`,
      module: "export",
      recordedAt: row.updated_at ?? row.created_at,
    });
  });

  if (input.trailer?.departure_date) {
    records.push({
      id: `${input.trailer.id}-departure`,
      label: `Departure ${input.trailer.trailer_number ?? input.trailer.id}`,
      href: "/dashboard/departure",
      module: "departure",
      recordedAt: input.trailer.departure_date,
    });
  }

  return records.filter((record, index, rows) => rows.findIndex((candidate) => candidate.id === record.id) === index);
};

const buildDwellMetrics = (input: {
  trailer: TrailerRow | null;
  currentStage: OperationalStage | null;
  currentStageStartedAt: string | null;
  activeDelivery: DeliveryBookingRow | null;
  activeExport: ExportAllocationRow | null;
  currentVesselTrailer: VesselOperationTrailerRow | null;
}) => {
  const compoundStartedAt =
    input.currentStage === "compound"
      ? input.currentStageStartedAt
      : input.currentVesselTrailer?.position_assigned_at ?? input.trailer?.arrival_date ?? null;
  const customerSiteStartedAt =
    input.currentStage === "delivered_empty"
      ? input.activeExport?.delivered_empty_at ?? input.activeExport?.waiting_loading_at ?? null
      : input.currentStage === "waiting_loading"
        ? input.activeExport?.waiting_loading_at ?? input.activeExport?.delivered_empty_at ?? null
        : input.currentStage === "on_delivery"
          ? input.activeDelivery?.updated_at ?? null
          : input.currentStage === "delivered"
            ? input.activeDelivery?.delivered_at ?? null
            : input.currentStage === "waiting_collection"
              ? input.activeDelivery?.waiting_collection_since ?? null
              : null;

  const vesselProcessingStartedAt = input.currentVesselTrailer?.arrival_confirmed_at ?? input.currentVesselTrailer?.arrived_at ?? null;
  const receptionProcessingStartedAt = input.currentVesselTrailer?.inspection_completed_at ?? input.currentVesselTrailer?.inspection_started_at ?? null;
  const totalYardDwellStartedAt = input.trailer?.arrival_date ?? input.currentVesselTrailer?.arrival_confirmed_at ?? input.currentVesselTrailer?.arrived_at ?? null;
  const totalYardDwellEndedAt = input.trailer?.departure_date ?? null;

  const durationInStageMs = durationBetween(input.currentStageStartedAt, null);
  const totalYardDwellMs = durationBetween(totalYardDwellStartedAt, totalYardDwellEndedAt);
  const compoundDwellMs = durationBetween(compoundStartedAt, input.trailer?.departure_date ?? null);
  const customerSiteDwellMs = durationBetween(customerSiteStartedAt, null);
  const vesselProcessingMs = durationBetween(vesselProcessingStartedAt, input.trailer?.arrival_date ?? input.currentVesselTrailer?.position_assigned_at ?? null);
  const receptionProcessingMs = durationBetween(receptionProcessingStartedAt, input.currentVesselTrailer?.position_assigned_at ?? input.trailer?.arrival_date ?? null);

  return {
    durationInStageMs,
    durationInStageLabel: formatDuration(durationInStageMs),
    totalYardDwellMs,
    totalYardDwellLabel: formatDuration(totalYardDwellMs),
    compoundDwellMs,
    compoundDwellLabel: formatDuration(compoundDwellMs),
    customerSiteDwellMs,
    customerSiteDwellLabel: formatDuration(customerSiteDwellMs),
    vesselProcessingMs,
    vesselProcessingLabel: formatDuration(vesselProcessingMs),
    receptionProcessingMs,
    receptionProcessingLabel: formatDuration(receptionProcessingMs),
  };
};

const deriveOperationalPosition = (input: {
  trailerNumber: string;
  trailer: TrailerRow | null;
  companyTrailer: CompanyTrailerRow | null;
  currentVesselTrailer: VesselOperationTrailerRow | null;
  currentVesselOperation: VesselOperationRow | null;
  activeDelivery: DeliveryBookingRow | null;
  activeExport: ExportAllocationRow | null;
  trailerEvents: TrailerEventRow[];
  damages: DamageRow[];
  temperatures: TemperatureRow[];
}): TrailerOperationalPosition => {
  const stageIssues: string[] = [];
  const trailerOperationalStatus = normalizeOperationalStatus(input.trailer?.operational_status);
  const exportStage = mapExportAllocationStage({
    allocation: input.activeExport,
    trailerEvents: input.trailerEvents,
    trailer: input.trailer,
    vesselTrailer: input.currentVesselTrailer,
  });
  const deliveryStage = mapDeliveryStage(input.activeDelivery);
  const vesselArrivalStatus = (input.currentVesselTrailer?.arrival_status ?? "").trim().toLowerCase();
  const vesselStatus = (input.currentVesselTrailer?.status ?? "").trim().toLowerCase();
  const hasInspectionIssues =
    input.damages.length > 0 ||
    input.temperatures.some((row) => row.is_out_of_range === true) ||
    input.currentVesselTrailer?.has_damage === true ||
    input.currentVesselTrailer?.has_temperature_alert === true;

  if (hasInspectionIssues) {
    stageIssues.push("Inspection issues recorded.");
  }

  if (input.activeDelivery?.status === "waiting_collection") {
    stageIssues.push("Trailer is waiting for collection.");
  }

  if (trailerOperationalStatus.includes("maintenance")) {
    stageIssues.push("Trailer is blocked for maintenance.");
  }

  let operationalStage: OperationalStage | null = null;
  let stageStartedAt: string | null = null;
  let precedenceReason = "No active operational stage could be derived.";

  if (trailerOperationalStatus.includes("maintenance")) {
    operationalStage = "maintenance";
    stageStartedAt = input.trailer?.arrival_date ?? input.trailer?.created_at ?? null;
    precedenceReason = TRAILER_OPERATIONAL_PRECEDENCE_RULES[0];
  } else if (input.trailer && (isActiveDeparture(input.trailer.departure_date) || trailerOperationalStatus === "departed")) {
    operationalStage = "departed";
    stageStartedAt = input.trailer.departure_date ?? null;
    precedenceReason = TRAILER_OPERATIONAL_PRECEDENCE_RULES[1];
  } else if (exportStage) {
    operationalStage = exportStage;
    stageStartedAt = getExportStageStartedAt({
      allocation: input.activeExport,
      trailerEvents: input.trailerEvents,
      trailer: input.trailer,
      vesselTrailer: input.currentVesselTrailer,
    });
    precedenceReason = TRAILER_OPERATIONAL_PRECEDENCE_RULES[2];
  } else if (deliveryStage) {
    operationalStage = deliveryStage;
    stageStartedAt = getDeliveryStageStartedAt(input.activeDelivery);
    precedenceReason = TRAILER_OPERATIONAL_PRECEDENCE_RULES[3];
  } else if (trailerOperationalStatus === "awaiting position") {
    operationalStage = "hold";
    stageStartedAt = input.currentVesselTrailer?.position_assigned_at ?? input.trailer?.arrival_date ?? input.trailer?.created_at ?? null;
    precedenceReason = TRAILER_OPERATIONAL_PRECEDENCE_RULES[4];
  } else if (input.trailer?.is_local === true || trailerOperationalStatus === "local trailer") {
    operationalStage = "local";
    stageStartedAt = input.trailer?.arrival_date ?? input.trailer?.created_at ?? null;
    precedenceReason = TRAILER_OPERATIONAL_PRECEDENCE_RULES[5];
  } else if (input.trailer && (input.trailer.compound_position || trailerOperationalStatus === "in compound" || trailerOperationalStatus === "returned empty" || trailerOperationalStatus === "ready for departure")) {
    operationalStage = "compound";
    stageStartedAt = input.currentVesselTrailer?.position_assigned_at ?? input.trailer.arrival_date ?? input.trailer.created_at ?? null;
    precedenceReason = TRAILER_OPERATIONAL_PRECEDENCE_RULES[5];
  } else if (vesselArrivalStatus === "not_discharged" || vesselStatus === "not_discharged") {
    operationalStage = "not_discharged";
    stageStartedAt = input.currentVesselTrailer?.updated_at ?? input.currentVesselTrailer?.arrival_confirmed_at ?? input.currentVesselTrailer?.created_at ?? null;
    precedenceReason = TRAILER_OPERATIONAL_PRECEDENCE_RULES[6];
    stageIssues.push("Trailer was marked not discharged.");
  } else if (input.currentVesselTrailer?.arrival_record_id || input.currentVesselTrailer?.trailer_id || input.trailer) {
    if (vesselArrivalStatus === "arrived" && (input.currentVesselTrailer?.inspection_started_at || input.currentVesselTrailer?.inspection_completed_at || hasInspectionIssues)) {
      operationalStage = "inspection";
      stageStartedAt = input.currentVesselTrailer?.inspection_started_at ?? input.currentVesselTrailer?.arrival_confirmed_at ?? input.currentVesselTrailer?.arrived_at ?? null;
      precedenceReason = TRAILER_OPERATIONAL_PRECEDENCE_RULES[7];
    } else if (vesselArrivalStatus === "arrived") {
      operationalStage = "arrived";
      stageStartedAt = input.currentVesselTrailer?.arrival_confirmed_at ?? input.currentVesselTrailer?.arrived_at ?? null;
      precedenceReason = TRAILER_OPERATIONAL_PRECEDENCE_RULES[7];
    } else if (input.currentVesselTrailer?.arrival_record_id || input.currentVesselTrailer?.trailer_id || input.trailer) {
      operationalStage = "received";
      stageStartedAt = input.trailer?.arrival_date ?? input.currentVesselTrailer?.position_assigned_at ?? input.currentVesselTrailer?.inspection_completed_at ?? null;
      precedenceReason = TRAILER_OPERATIONAL_PRECEDENCE_RULES[5];
    }
  } else if (vesselArrivalStatus === "expected" || vesselArrivalStatus === "available_for_arrival") {
    operationalStage = "expected";
    stageStartedAt = input.currentVesselOperation?.list_confirmed_at ?? input.currentVesselTrailer?.created_at ?? null;
    precedenceReason = TRAILER_OPERATIONAL_PRECEDENCE_RULES[8];
  }

  const currentLocation = (() => {
    switch (operationalStage) {
      case "compound":
        return input.trailer?.compound_position ?? "Compound";
      case "local":
        return "Local Trailer";
      case "hold":
        return "Awaiting Position";
      case "on_delivery":
      case "delivered":
      case "waiting_collection":
        return input.activeDelivery?.delivery_location ?? input.activeDelivery?.customer ?? "Customer Site";
      case "allocated":
      case "delivered_empty":
      case "waiting_loading":
      case "collected_loaded":
      case "ready_for_shipping":
        return input.activeExport?.collection_address ?? input.activeExport?.customer ?? "Export Operation";
      case "loaded_on_vessel":
        return input.currentVesselOperation?.vessel_name ?? input.activeExport?.customer ?? "Loaded on Vessel";
      case "expected":
      case "arrived":
      case "inspection":
      case "received":
      case "not_discharged":
        return input.currentVesselOperation?.vessel_name ?? "Vessel Operation";
      case "maintenance":
        return "Maintenance";
      case "departed":
        return "Departed";
      case "cancelled":
        return "Cancelled";
      default:
        return input.trailer?.compound_position ?? null;
    }
  })();

  const customer =
    input.activeDelivery?.customer ??
    input.activeExport?.customer ??
    input.trailer?.customer ??
    input.currentVesselTrailer?.customer ??
    null;

  const nextRecommendedAction = buildNextAction({
    stage: operationalStage,
    trailerNumber: input.trailerNumber,
    trailer: input.trailer,
    activeDelivery: input.activeDelivery,
    activeExport: input.activeExport,
    currentVesselOperation: input.currentVesselOperation,
    currentVesselTrailer: input.currentVesselTrailer,
  });

  const dwell = buildDwellMetrics({
    trailer: input.trailer,
    currentStage: operationalStage,
    currentStageStartedAt: stageStartedAt,
    activeDelivery: input.activeDelivery,
    activeExport: input.activeExport,
    currentVesselTrailer: input.currentVesselTrailer,
  });

  return {
    trailerId: input.trailer?.id ?? null,
    trailerNumber: input.trailerNumber,
    operationalStage,
    stageLabel: operationalStage ? getOperationalStageLabel(operationalStage) : "Unknown",
    currentLocation,
    customer,
    vessel: input.currentVesselOperation?.vessel_name ?? null,
    voyage: input.currentVesselOperation?.sailing_reference ?? null,
    compoundPosition: input.trailer?.compound_position ?? input.currentVesselTrailer?.assigned_position ?? null,
    currentOperationReference:
      input.activeExport?.booking_reference ??
      input.activeDelivery?.booking_reference ??
      input.currentVesselOperation?.sailing_reference ??
      null,
    stageStartedAt,
    priority: input.currentVesselTrailer?.priority_level ?? input.activeExport?.priority ?? null,
    issueIndicator: {
      hasIssues: stageIssues.length > 0,
      reasons: stageIssues,
    },
    nextRecommendedAction,
    availableNextStages: operationalStage ? getAvailableNextStages(operationalStage) : [],
    precedenceReason,
    dwell,
  };
};

export async function loadTrailerOperationalProfile(
  supabase: SupabaseClient<Database>,
  identifier: string,
): Promise<TrailerOperationalProfile> {
  const trimmedIdentifier = identifier.trim();
  const normalizedTrailerNumber = normalizeTrailerNumber(trimmedIdentifier);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmedIdentifier);

  let trailer: TrailerRow | null = null;

  if (isUuid) {
    const { data } = await supabase
      .from("trailers")
      .select("id, trailer_number, trailer_type, load_status, load_description, customer, consignee, container_number, compound_position, arrival_date, departure_date, departure_time, notes, created_at, trailer_source, external_company, external_reference, is_local, operational_status, source_vessel_operation_trailer_id")
      .eq("id", trimmedIdentifier)
      .maybeSingle();
    trailer = (data as TrailerRow | null) ?? null;
  }

  if (!trailer) {
    const { data } = await supabase
      .from("trailers")
      .select("id, trailer_number, trailer_type, load_status, load_description, customer, consignee, container_number, compound_position, arrival_date, departure_date, departure_time, notes, created_at, trailer_source, external_company, external_reference, is_local, operational_status, source_vessel_operation_trailer_id")
      .ilike("trailer_number", normalizedTrailerNumber)
      .order("departure_date", { ascending: true, nullsFirst: true })
      .order("arrival_date", { ascending: false })
      .limit(1);
    trailer = ((data ?? []) as TrailerRow[])[0] ?? null;
  }

  const resolvedTrailerNumber = normalizeTrailerNumber(trailer?.trailer_number) || normalizedTrailerNumber;

  const [companyTrailerResult, deliveryBookingsResult, exportAllocationsResult, eventByIdResult, eventByNumberResult, vesselTrailerResult] = await Promise.all([
    supabase
      .from("company_trailers")
      .select("id, trailer_number, prefix, numeric_part, trailer_type, notes, original_value, active, created_at")
      .ilike("trailer_number", resolvedTrailerNumber)
      .limit(1)
      .maybeSingle(),
    trailer?.id
      ? supabase
          .from("delivery_bookings")
          .select("id, trailer_id, delivery_date, delivery_time, customer, consignee, delivery_location, booking_reference, escort_required, status, notes, created_at, updated_at, delivered_at, waiting_collection_since, collection_due_date, collected_at, demurrage_free_days, demurrage_daily_rate, demurrage_currency, demurrage_notes")
          .eq("trailer_id", trailer.id)
          .order("delivery_date", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    trailer?.id
      ? supabase
          .from("export_allocations")
          .select("id, trailer_id, trailer_number, customer, collection_address, haulier, booking_reference, load_type, collection_date, collection_time, expected_return_at, priority, status, notes, allocated_at, delivered_empty_at, waiting_loading_at, collected_loaded_at, completed_at, cancelled_at, collected_by_haulier_at, loading_started_at, loaded_at, returned_at, shipped_at, created_at, updated_at")
          .eq("trailer_id", trailer.id)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    trailer?.id
      ? supabase
          .from("trailer_events")
          .select("id, trailer_id, trailer_number, event_type, event_description, old_value, new_value, created_at, created_by")
          .eq("trailer_id", trailer.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("trailer_events")
      .select("id, trailer_id, trailer_number, event_type, event_description, old_value, new_value, created_at, created_by")
      .ilike("trailer_number", resolvedTrailerNumber)
      .order("created_at", { ascending: false }),
    supabase
      .from("vessel_operation_trailers")
      .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, load_description, temperature_required, priority_level, priority_reason, planned_destination, planning_notes, status, arrived_at, arrival_status, arrival_confirmed_at, arrival_record_id, arrival_confirmed_by, inspection_started_at, inspection_completed_at, position_assigned_at, assigned_position, has_damage, has_temperature_alert, created_at, updated_at")
      .ilike("trailer_number", resolvedTrailerNumber)
      .order("created_at", { ascending: false }),
  ]);

  const deliveryBookings = (deliveryBookingsResult.data ?? []) as DeliveryBookingRow[];
  const exportAllocations = (exportAllocationsResult.data ?? []) as ExportAllocationRow[];
  const trailerEvents = [
    ...((eventByIdResult.data ?? []) as TrailerEventRow[]),
    ...((eventByNumberResult.data ?? []) as TrailerEventRow[]),
  ].filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index);
  const vesselOperationTrailers = (vesselTrailerResult.data ?? []) as VesselOperationTrailerRow[];
  const vesselOperationIds = Array.from(new Set(vesselOperationTrailers.map((row) => row.vessel_operation_id)));
  const companyTrailer = (companyTrailerResult.data as CompanyTrailerRow | null) ?? null;

  const [vesselOperationsResult, damagesResult, temperaturesResult] = await Promise.all([
    vesselOperationIds.length > 0
      ? supabase
          .from("vessel_operations")
          .select("id, vessel_name, sailing_reference, origin_port, berth, expected_arrival_at, actual_arrival_at, status, list_status, list_confirmed_at, list_confirmed_by, notes, created_at, updated_at")
          .in("id", vesselOperationIds)
      : Promise.resolve({ data: [], error: null }),
    vesselOperationTrailers.length > 0
      ? supabase
          .from("vessel_inspection_damages")
          .select("id, vessel_trailer_id, trailer_id, trailer_number, vessel_operation_id, vessel_operation_trailer_id, damage_type, damage_location, severity, description, recorded_at, recorded_by")
          .in("vessel_trailer_id", vesselOperationTrailers.map((row) => row.id))
      : Promise.resolve({ data: [], error: null }),
    vesselOperationTrailers.length > 0
      ? supabase
          .from("vessel_inspection_temperatures")
          .select("id, vessel_trailer_id, trailer_id, trailer_number, temperature_value, temperature_unit, reading_point, notes, is_out_of_range, recorded_at, recorded_by")
          .in("vessel_trailer_id", vesselOperationTrailers.map((row) => row.id))
      : Promise.resolve({ data: [], error: null }),
  ]);

  const vesselOperations = (vesselOperationsResult.data ?? []) as VesselOperationRow[];
  const operationsById = new Map(vesselOperations.map((row) => [row.id, row]));
  const damages = (damagesResult.data ?? []) as DamageRow[];
  const temperatures = (temperaturesResult.data ?? []) as TemperatureRow[];
  const currentVesselTrailer = getCurrentVesselOperationTrailer(trailer, resolvedTrailerNumber, vesselOperationTrailers, operationsById) ?? null;
  const currentVesselOperation = currentVesselTrailer ? operationsById.get(currentVesselTrailer.vessel_operation_id) ?? null : null;
  const activeDelivery =
    getMostRecent(
      deliveryBookings.filter((row) => !["collected", "cancelled"].includes((row.status ?? "").trim().toLowerCase())),
      "updated_at",
    ) ?? null;
  const activeExport =
    getMostRecent(
      exportAllocations.filter((row) => !["completed", "cancelled", "returned", "shipped"].includes((row.status ?? "").trim().toLowerCase())),
      "updated_at",
    ) ?? null;

  const explicitEvents = trailerEvents.map((row) => mapTrailerEventRowToOperationalEvent(row));
  const derivedEvents = buildDerivedEvents({
    trailer,
    trailerNumber: resolvedTrailerNumber,
    vesselOperationTrailers,
    operationsById,
    damages,
    temperatures,
    deliveryBookings,
    exportAllocations,
  });

  const events = dedupeEvents([...explicitEvents, ...derivedEvents]);
  const position = deriveOperationalPosition({
    trailerNumber: resolvedTrailerNumber,
    trailer,
    companyTrailer,
    currentVesselTrailer,
    currentVesselOperation,
    activeDelivery,
    activeExport,
    trailerEvents,
    damages,
    temperatures,
  });

  const relatedRecords = buildRelatedRecords({
    trailerNumber: resolvedTrailerNumber,
    trailer,
    vesselOperationTrailers,
    operationsById,
    deliveryBookings,
    exportAllocations,
  });

  const fleetStatus = trailer?.trailer_source === "outsourced"
    ? "Outsourced"
    : trailer?.is_local === true
      ? "Local Trailer"
      : companyTrailer?.active === true
        ? "Ferryspeed Fleet"
        : trailer
          ? "Active Trailer Record"
          : "No Active Trailer Record";

  return {
    identifier: resolvedTrailerNumber,
    trailer,
    companyTrailer,
    trailerEventRows: trailerEvents,
    vesselOperationTrailers,
    vesselOperations,
    deliveryBookings,
    exportAllocations,
    events,
    relatedRecords,
    position,
    fleetStatus,
    trailerType: trailer?.trailer_type ?? companyTrailer?.trailer_type ?? null,
  };
}

export const getTrailerFleetStatus = (input: {
  trailer: TrailerRow | null;
  companyTrailer: CompanyTrailerRow | null;
}) => {
  if (input.trailer?.trailer_source === "outsourced") {
    return "Outsourced";
  }

  if (input.trailer?.is_local === true) {
    return "Local Trailer";
  }

  if (input.companyTrailer?.active === true) {
    return "Ferryspeed Fleet";
  }

  if (input.trailer) {
    return "Active Trailer Record";
  }

  return "No Active Trailer Record";
};

export const buildTrailerOperationalPositionFromContext = (context: TrailerOperationalContext) => {
  const operationsById = new Map(context.vesselOperations.map((row) => [row.id, row]));
  const currentVesselTrailer = getCurrentVesselOperationTrailer(context.trailer, context.trailerNumber, context.vesselOperationTrailers, operationsById) ?? null;
  const currentVesselOperation = currentVesselTrailer ? operationsById.get(currentVesselTrailer.vessel_operation_id) ?? null : null;
  const activeDelivery =
    getMostRecent(
      context.deliveryBookings.filter((row) => !["collected", "cancelled"].includes((row.status ?? "").trim().toLowerCase())),
      "updated_at",
    ) ?? null;
  const activeExport =
    getMostRecent(
      context.exportAllocations.filter((row) => !["completed", "cancelled", "returned", "shipped"].includes((row.status ?? "").trim().toLowerCase())),
      "updated_at",
    ) ?? null;

  return deriveOperationalPosition({
    trailerNumber: context.trailerNumber,
    trailer: context.trailer,
    companyTrailer: context.companyTrailer,
    currentVesselTrailer,
    currentVesselOperation,
    activeDelivery,
    activeExport,
    trailerEvents: context.trailerEvents,
    damages: context.damages ?? [],
    temperatures: context.temperatures ?? [],
  });
};

export async function getTrailerOperationalPosition(
  supabase: SupabaseClient<Database>,
  trailerNumber: string,
): Promise<TrailerOperationalPosition> {
  const profile = await loadTrailerOperationalProfile(supabase, trailerNumber);
  return profile.position;
}

export const getCanonicalStageTransitionMap = () => ALLOWED_OPERATIONAL_TRANSITIONS;

export const getOperationalStageSummary = (profile: TrailerOperationalProfile) => ({
  identifier: profile.identifier,
  stage: profile.position.operationalStage,
  stageLabel: profile.position.stageLabel,
  nextStages: profile.position.operationalStage ? getAvailableNextStages(profile.position.operationalStage) : [],
  recordedAt: formatDateTime(profile.position.stageStartedAt),
});