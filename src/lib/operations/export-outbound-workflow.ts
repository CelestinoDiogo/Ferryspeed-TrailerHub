import type { Database } from "@/lib/database.types";
import type { OperationalStage } from "@/lib/operations/operational-stages";

type ExportAllocationRow = Database["public"]["Tables"]["export_allocations"]["Row"];
type TrailerEventRow = Database["public"]["Tables"]["trailer_events"]["Row"];
type TrailerRow = Database["public"]["Tables"]["trailers"]["Row"];
type VesselOperationTrailerRow = Database["public"]["Tables"]["vessel_operation_trailers"]["Row"];

export type ExportDerivedWorkflowStage =
  | "allocated"
  | "delivered_empty"
  | "waiting_loading"
  | "collected_loaded"
  | "ready_for_shipping"
  | "loaded_on_vessel"
  | "completed"
  | "cancelled";

export type ExportWorkflowAction =
  | "confirm_delivered_empty"
  | "mark_waiting_loading"
  | "confirm_collected_loaded"
  | "mark_ready_for_shipping"
  | "confirm_loaded_on_vessel"
  | "complete_export_cycle"
  | "cancel_allocation";

type EventMetadata = Record<string, unknown>;
type EventPayload = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return true;
};

const getEventMetadata = (row: TrailerEventRow | null | undefined): EventMetadata | undefined => {
  if (!row || !isPlainObject(row.new_value)) {
    return undefined;
  }

  const metadata = row.new_value.metadata;
  return isPlainObject(metadata) ? metadata : undefined;
};

const getSourceRecordId = (row: TrailerEventRow | null | undefined) => {
  if (!row || !isPlainObject(row.new_value)) {
    return undefined;
  }

  const sourceRecordId = row.new_value.source_record_id;
  return typeof sourceRecordId === "string" && sourceRecordId.trim() ? sourceRecordId : undefined;
};

const NON_EMPTY_STRING = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const getPayloadTimestamp = (payload: EventPayload | null | undefined, field: string) => {
  if (!payload) {
    return null;
  }

  const value = payload[field];
  return NON_EMPTY_STRING(value) ? value : null;
};

const EVENT_TIMESTAMP_FIELDS_BY_TYPE: Record<string, string[]> = {
  delivered_empty: ["delivered_empty_at", "delivered_at", "changed_at", "updated_at"],
  waiting_loading: ["waiting_loading_at", "loading_started_at", "changed_at", "updated_at"],
  collected_loaded: ["collected_loaded_at", "loaded_at", "changed_at", "updated_at"],
  ready_for_shipping: ["ready_for_shipping_at", "changed_at", "updated_at"],
  loaded_on_vessel: ["loaded_on_vessel_at", "shipped_at", "changed_at", "updated_at"],
  assigned_to_vessel: ["loaded_on_vessel_at", "shipped_at", "changed_at", "updated_at"],
  export_completed: ["completed_at", "departed_at", "returned_at", "shipped_at", "changed_at", "updated_at"],
  departed: ["departed_at", "completed_at", "changed_at", "updated_at"],
  allocation_cancelled: ["cancelled_at", "changed_at", "updated_at"],
  export_allocation_cancelled: ["cancelled_at", "changed_at", "updated_at"],
  export_allocation_status_changed: [
    "completed_at",
    "cancelled_at",
    "collected_loaded_at",
    "waiting_loading_at",
    "delivered_empty_at",
    "allocated_at",
    "changed_at",
    "updated_at",
  ],
};

const DEFAULT_EVENT_TIMESTAMP_FIELDS = [
  "occurred_at",
  "completed_at",
  "cancelled_at",
  "delivered_empty_at",
  "waiting_loading_at",
  "collected_loaded_at",
  "loaded_on_vessel_at",
  "ready_for_shipping_at",
  "departed_at",
  "delivered_at",
  "loaded_at",
  "returned_at",
  "shipped_at",
  "created_at",
  "updated_at",
];

export const getEventTimestamp = (row: TrailerEventRow | null | undefined): string | null => {
  if (!row) {
    return null;
  }

  const newValuePayload = isPlainObject(row.new_value) ? row.new_value : null;
  if (newValuePayload) {
    const occurredAt = getPayloadTimestamp(newValuePayload, "occurred_at");
    if (occurredAt) {
      return occurredAt;
    }

    const eventType = NON_EMPTY_STRING(row.event_type) ? row.event_type.trim().toLowerCase() : "";
    const candidateFields = EVENT_TIMESTAMP_FIELDS_BY_TYPE[eventType] ?? DEFAULT_EVENT_TIMESTAMP_FIELDS;
    for (const field of candidateFields) {
      const timestamp = getPayloadTimestamp(newValuePayload, field);
      if (timestamp) {
        return timestamp;
      }
    }
  }

  const oldValuePayload = isPlainObject(row.old_value) ? row.old_value : null;
  if (oldValuePayload) {
    const eventType = NON_EMPTY_STRING(row.event_type) ? row.event_type.trim().toLowerCase() : "";
    const candidateFields = EVENT_TIMESTAMP_FIELDS_BY_TYPE[eventType] ?? DEFAULT_EVENT_TIMESTAMP_FIELDS;
    for (const field of candidateFields) {
      const timestamp = getPayloadTimestamp(oldValuePayload, field);
      if (timestamp) {
        return timestamp;
      }
    }
  }

  if ("occurred_at" in row && NON_EMPTY_STRING((row as unknown as Record<string, unknown>).occurred_at)) {
    return (row as unknown as Record<string, string>).occurred_at;
  }

  if (NON_EMPTY_STRING(row.created_at)) {
    return row.created_at;
  }

  return null;
};

const getLatestMatchingEvent = (events: Array<TrailerEventRow | null | undefined>, predicate: (row: TrailerEventRow) => boolean) => {
  return [...events]
    .filter((row): row is TrailerEventRow => Boolean(row && row.id))
    .filter(predicate)
    .sort((left, right) => new Date(right.created_at ?? 0).getTime() - new Date(left.created_at ?? 0).getTime())[0] ?? null;
};

export const mapDerivedExportStageToOperationalStage = (stage: ExportDerivedWorkflowStage): OperationalStage => {
  switch (stage) {
    case "allocated":
      return "allocated";
    case "delivered_empty":
      return "delivered_empty";
    case "waiting_loading":
      return "waiting_loading";
    case "collected_loaded":
      return "collected_loaded";
    case "ready_for_shipping":
      return "ready_for_shipping";
    case "loaded_on_vessel":
      return "loaded_on_vessel";
    case "completed":
      return "departed";
    case "cancelled":
      return "cancelled";
  }
};

export const getExportWorkflowEventRows = (events: Array<TrailerEventRow | null | undefined>, exportAllocationId: string) =>
  events.filter((row): row is TrailerEventRow => {
    if (!row) {
      return false;
    }

    const sourceRecordId = getSourceRecordId(row);
    if (sourceRecordId === exportAllocationId) {
      return true;
    }

    const metadata = getEventMetadata(row);
    return metadata?.export_allocation_id === exportAllocationId;
  });

export const getExportDerivedWorkflowStage = (input: {
  allocation: Pick<
    ExportAllocationRow,
    | "id"
    | "status"
    | "completed_at"
    | "cancelled_at"
    | "delivered_empty_at"
    | "waiting_loading_at"
    | "collected_loaded_at"
  >;
  events: Array<TrailerEventRow | null | undefined>;
  vesselTrailer?: Pick<VesselOperationTrailerRow, "arrival_record_id" | "trailer_id"> | null;
  trailer?: Pick<TrailerRow, "departure_date"> | null;
}): ExportDerivedWorkflowStage => {
  const allocationEvents = getExportWorkflowEventRows(input.events, input.allocation.id);
  const readyForShippingEvent = getLatestMatchingEvent(allocationEvents, (row) => row.event_type === "ready_for_shipping");
  const loadedOnVesselEvent = getLatestMatchingEvent(allocationEvents, (row) => row.event_type === "loaded_on_vessel" || row.event_type === "assigned_to_vessel");
  const completedEvent = getLatestMatchingEvent(allocationEvents, (row) => row.event_type === "export_completed" || row.event_type === "departed");

  if ((input.allocation.status ?? "").trim().toLowerCase() === "cancelled" || input.allocation.cancelled_at) {
    return "cancelled";
  }

  if (input.allocation.completed_at || completedEvent || input.trailer?.departure_date) {
    return "completed";
  }

  if (loadedOnVesselEvent) {
    return "loaded_on_vessel";
  }

  if (readyForShippingEvent) {
    return "ready_for_shipping";
  }

  switch ((input.allocation.status ?? "").trim().toLowerCase()) {
    case "allocated":
      return "allocated";
    case "delivered_empty":
      return input.allocation.waiting_loading_at ? "waiting_loading" : "delivered_empty";
    case "waiting_loading":
    case "loading":
      return "waiting_loading";
    case "collected_loaded":
    case "loaded":
      return "collected_loaded";
    case "completed":
    case "returned":
    case "shipped":
      return "completed";
    default:
      return "allocated";
  }
}

export const getExportWorkflowTimestamp = (input: {
  allocation: ExportAllocationRow;
  events: Array<TrailerEventRow | null | undefined>;
  stage: ExportDerivedWorkflowStage;
}): string | null => {
  const allocationEvents = getExportWorkflowEventRows(input.events, input.allocation.id);
  const latestByType = (eventType: string) => getLatestMatchingEvent(allocationEvents, (row) => row.event_type === eventType);

  switch (input.stage) {
    case "allocated":
      return input.allocation.allocated_at ?? input.allocation.created_at ?? null;
    case "delivered_empty":
      return input.allocation.delivered_empty_at ?? getEventTimestamp(latestByType("delivered_empty") ?? latestByType("export_allocation_status_changed"));
    case "waiting_loading":
      return input.allocation.waiting_loading_at ?? getEventTimestamp(latestByType("waiting_loading") ?? latestByType("export_allocation_status_changed"));
    case "collected_loaded":
      return input.allocation.collected_loaded_at ?? getEventTimestamp(latestByType("collected_loaded") ?? latestByType("export_allocation_status_changed"));
    case "ready_for_shipping":
      return getEventTimestamp(latestByType("ready_for_shipping") ?? latestByType("export_allocation_status_changed"));
    case "loaded_on_vessel":
      return getEventTimestamp(latestByType("loaded_on_vessel") ?? latestByType("assigned_to_vessel") ?? latestByType("export_allocation_status_changed"));
    case "completed":
      return input.allocation.completed_at ?? getEventTimestamp(latestByType("export_completed") ?? latestByType("departed") ?? latestByType("export_allocation_status_changed"));
    case "cancelled":
      return input.allocation.cancelled_at ?? getEventTimestamp(latestByType("allocation_cancelled") ?? latestByType("export_allocation_cancelled") ?? latestByType("export_allocation_status_changed"));
    default:
      return null;
  }
};

export const getNextExportWorkflowAction = (stage: ExportDerivedWorkflowStage): ExportWorkflowAction | null => {
  switch (stage) {
    case "allocated":
      return "confirm_delivered_empty";
    case "delivered_empty":
      return "mark_waiting_loading";
    case "waiting_loading":
      return "confirm_collected_loaded";
    case "collected_loaded":
      return "mark_ready_for_shipping";
    case "ready_for_shipping":
      return "confirm_loaded_on_vessel";
    case "loaded_on_vessel":
      return "complete_export_cycle";
    default:
      return null;
  }
};

export const getExportWorkflowActionLabel = (action: ExportWorkflowAction | null) => {
  switch (action) {
    case "confirm_delivered_empty":
      return "Confirm Delivered Empty";
    case "mark_waiting_loading":
      return "Mark Waiting Loading";
    case "confirm_collected_loaded":
      return "Confirm Collected Loaded";
    case "mark_ready_for_shipping":
      return "Mark Ready for Shipping";
    case "confirm_loaded_on_vessel":
      return "Confirm Loaded on Vessel";
    case "complete_export_cycle":
      return "Complete Export Cycle";
    case "cancel_allocation":
      return "Cancel Allocation";
    default:
      return null;
  }
};

export const canCancelExportWorkflow = (stage: ExportDerivedWorkflowStage) => stage !== "completed" && stage !== "cancelled";

export const getInvalidExportWorkflowActionReason = (input: {
  action: ExportWorkflowAction;
  stage: ExportDerivedWorkflowStage;
  trailer?: Pick<TrailerRow, "load_status" | "operational_status" | "compound_position" | "departure_date"> | null;
  vesselOperationTrailer?: Pick<VesselOperationTrailerRow, "arrival_record_id"> | null;
}) => {
  switch (input.action) {
    case "confirm_delivered_empty":
      return input.stage !== "allocated" ? "Delivered Empty can only be confirmed from Allocated." : null;
    case "mark_waiting_loading":
      return input.stage !== "delivered_empty" ? "Waiting Loading can only be marked after Delivered Empty." : null;
    case "confirm_collected_loaded":
      return input.stage !== "waiting_loading" && input.stage !== "delivered_empty"
        ? "Collected Loaded can only be confirmed from Delivered Empty or Waiting Loading."
        : null;
    case "mark_ready_for_shipping":
      if (input.stage !== "collected_loaded") {
        return "Ready for Shipping can only be marked from Collected Loaded.";
      }
      if ((input.trailer?.load_status ?? "").trim().toLowerCase() !== "loaded") {
        return "Trailer must be loaded before it can be marked Ready for Shipping.";
      }
      return null;
    case "confirm_loaded_on_vessel":
      if (input.stage !== "ready_for_shipping") {
        return "Loaded on Vessel can only be confirmed from Ready for Shipping.";
      }
      return null;
    case "complete_export_cycle":
      return input.stage !== "loaded_on_vessel" ? "Export cycle can only be completed after Loaded on Vessel." : null;
    case "cancel_allocation":
      return canCancelExportWorkflow(input.stage) ? null : "Terminal export stages cannot be cancelled.";
    default:
      return null;
  }
};