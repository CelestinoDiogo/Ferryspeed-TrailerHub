import { z } from "zod";

export const mobileActionTypes = [
  "ADD_VESSEL_TRAILER",
  "MARK_ARRIVED",
  "MARK_CANCELLED",
  "MARK_NO_SHOW",
  "UNDO_CANCELLED",
  "UNDO_NO_SHOW",
  "MOVE_COMPOUND_POSITION",
  "CHANGE_LOAD_STATUS",
  "CONFIRM_DEPARTURE",
  "START_INSPECTION",
  "SAVE_INSPECTION_PROGRESS",
  "COMPLETE_INSPECTION",
] as const;

export type MobileActionType = (typeof mobileActionTypes)[number];

const isoDateTimeSchema = z.string().datetime().optional();

const loadStatusSchema = z.enum(["Loaded", "Empty"]);
const ownershipTypeSchema = z.enum(["company", "outsourcing", "unknown"]);
const trailerSourceSchema = z.enum(["company", "outsourced", "unknown"]);

const inspectionDamageSchema = z.object({
  hasDamage: z.boolean(),
  damageType: z.string().trim().max(120).optional().nullable(),
  damageLocation: z.string().trim().max(120).optional().nullable(),
  damageDescription: z.string().trim().max(2000).optional().nullable(),
});

const inspectionPayloadBaseSchema = z.object({
  vesselTrailerId: z.string().uuid(),
  trailerNumber: z.string().trim().max(80).optional(),
  frontTemperature: z.number().finite().optional().nullable(),
  rearTemperature: z.number().finite().optional().nullable(),
  unit: z.string().trim().max(8).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  damage: inspectionDamageSchema.optional().nullable(),
});

export const markArrivedPayloadSchema = z.object({
  vesselTrailerId: z.string().uuid().optional(),
  trailerNumber: z.string().trim().min(1).max(80).optional(),
  operationId: z.string().uuid().optional(),
  receivedAt: isoDateTimeSchema,
});

export const addVesselTrailerPayloadSchema = z.object({
  operationId: z.string().uuid(),
  trailerNumber: z.string().trim().min(1).max(80),
  ownershipType: ownershipTypeSchema,
  trailerSource: trailerSourceSchema.optional().nullable(),
  externalCompany: z.string().trim().max(200).optional().nullable(),
  plannedDestination: z.string().trim().min(1).max(200),
  priorityReason: z.string().trim().max(500).optional().nullable(),
  manifestChangeReason: z.string().trim().max(500).optional().nullable(),
  customer: z.string().trim().max(200).optional().nullable(),
  bookingReference: z.string().trim().max(120).optional().nullable(),
  loadStatus: z.string().trim().max(60).optional().nullable(),
  expectedFrontTemperature: z.number().finite().optional().nullable(),
  expectedRearTemperature: z.number().finite().optional().nullable(),
  expectedTemperatureUnit: z.string().trim().max(8).optional().nullable(),
  priorityLevel: z.enum(["priority", "normal"]).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

export const markCancelledPayloadSchema = z.object({
  vesselTrailerId: z.string().uuid(),
  trailerNumber: z.string().trim().max(80).optional(),
  reason: z.string().trim().max(1000).optional().nullable(),
});

export const markNoShowPayloadSchema = z.object({
  vesselTrailerId: z.string().uuid(),
  trailerNumber: z.string().trim().max(80).optional(),
  reason: z.string().trim().max(1000).optional().nullable(),
});

export const undoCancelledPayloadSchema = z.object({
  vesselTrailerId: z.string().uuid(),
  trailerNumber: z.string().trim().max(80).optional(),
});

export const undoNoShowPayloadSchema = z.object({
  vesselTrailerId: z.string().uuid(),
  trailerNumber: z.string().trim().max(80).optional(),
});

export const moveCompoundPositionPayloadSchema = z.object({
  trailerId: z.string().uuid(),
  trailerNumber: z.string().trim().max(80).optional(),
  targetPosition: z.string().trim().min(1).max(8),
  expectedCurrentPosition: z.string().trim().max(8).optional().nullable(),
  reason: z.string().trim().max(240).optional().nullable(),
});

export const changeLoadStatusPayloadSchema = z.object({
  trailerId: z.string().uuid(),
  trailerNumber: z.string().trim().max(80).optional(),
  nextLoadStatus: loadStatusSchema,
  expectedCurrentLoadStatus: z.string().trim().max(40).optional().nullable(),
  customer: z.string().trim().max(200).optional().nullable(),
  consignee: z.string().trim().max(200).optional().nullable(),
  containerNumber: z.string().trim().max(120).optional().nullable(),
  loadDescription: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

export const confirmDeparturePayloadSchema = z.object({
  trailerId: z.string().uuid(),
  trailerNumber: z.string().trim().max(80).optional(),
});

export const startInspectionPayloadSchema = z.object({
  vesselTrailerId: z.string().uuid(),
  trailerNumber: z.string().trim().max(80).optional(),
});

export const saveInspectionProgressPayloadSchema = inspectionPayloadBaseSchema;

export const completeInspectionPayloadSchema = inspectionPayloadBaseSchema;

export const mobileActionRequestSchema = z.discriminatedUnion("actionType", [
  z.object({ actionType: z.literal("ADD_VESSEL_TRAILER"), payload: addVesselTrailerPayloadSchema }),
  z.object({ actionType: z.literal("MARK_ARRIVED"), payload: markArrivedPayloadSchema }),
  z.object({ actionType: z.literal("MARK_CANCELLED"), payload: markCancelledPayloadSchema }),
  z.object({ actionType: z.literal("MARK_NO_SHOW"), payload: markNoShowPayloadSchema }),
  z.object({ actionType: z.literal("UNDO_CANCELLED"), payload: undoCancelledPayloadSchema }),
  z.object({ actionType: z.literal("UNDO_NO_SHOW"), payload: undoNoShowPayloadSchema }),
  z.object({ actionType: z.literal("MOVE_COMPOUND_POSITION"), payload: moveCompoundPositionPayloadSchema }),
  z.object({ actionType: z.literal("CHANGE_LOAD_STATUS"), payload: changeLoadStatusPayloadSchema }),
  z.object({ actionType: z.literal("CONFIRM_DEPARTURE"), payload: confirmDeparturePayloadSchema }),
  z.object({ actionType: z.literal("START_INSPECTION"), payload: startInspectionPayloadSchema }),
  z.object({ actionType: z.literal("SAVE_INSPECTION_PROGRESS"), payload: saveInspectionProgressPayloadSchema }),
  z.object({ actionType: z.literal("COMPLETE_INSPECTION"), payload: completeInspectionPayloadSchema }),
]);

export type MobileActionRequest = z.infer<typeof mobileActionRequestSchema>;

export type MobileActionQueueState =
  | "pending"
  | "syncing"
  | "completed"
  | "failed"
  | "conflict"
  | "cancelled";

export type MobileActionConflict = {
  code: string;
  message: string;
  serverState?: Record<string, unknown> | null;
};

export type MobileActionQueueItem = {
  id: string;
  actionType: MobileActionType;
  payload: MobileActionRequest["payload"];
  dedupeKey: string;
  trailerNumber?: string | null;
  createdAt: string;
  operator: string;
  retryCount: number;
  state: MobileActionQueueState;
  lastError?: string | null;
  conflict?: MobileActionConflict | null;
  lastAttemptAt?: string | null;
  nextRetryAt?: string | null;
};

export type LegacyMobileActionQueueItem = {
  id?: unknown;
  source?: unknown;
  label?: unknown;
  commandText?: unknown;
  trailerNumber?: unknown;
  createdAt?: unknown;
  status?: unknown;
  attempts?: unknown;
  error?: unknown;
};

export const isMobileActionType = (value: unknown): value is MobileActionType => {
  return typeof value === "string" && (mobileActionTypes as readonly string[]).includes(value);
};

const toIsoString = (value: unknown, fallback: string) => {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed.toISOString();
};

const toQueueState = (value: unknown): MobileActionQueueState => {
  if (value === "pending" || value === "syncing" || value === "completed" || value === "failed" || value === "conflict" || value === "cancelled") {
    return value;
  }

  return "pending";
};

const toRetryCount = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.floor(value);
};

const toStringOrNull = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const coerceQueueItem = (value: unknown): MobileActionQueueItem | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  const nowIso = new Date().toISOString();

  if (isMobileActionType(row.actionType)) {
    const payloadResult = mobileActionRequestSchema.safeParse({
      actionType: row.actionType,
      payload: row.payload,
    });

    if (!payloadResult.success) {
      return null;
    }

    const id = toStringOrNull(row.id) ?? `mobile-action-${nowIso}-${Math.random().toString(16).slice(2)}`;

    return {
      id,
      actionType: payloadResult.data.actionType,
      payload: payloadResult.data.payload,
      dedupeKey:
        toStringOrNull(row.dedupeKey) ??
        getMobileActionDedupeKey({
          actionType: payloadResult.data.actionType,
          payload: payloadResult.data.payload,
          trailerNumber: toStringOrNull(row.trailerNumber),
        }),
      trailerNumber: toStringOrNull(row.trailerNumber),
      createdAt: toIsoString(row.createdAt, nowIso),
      operator: toStringOrNull(row.operator) ?? "Unknown Operator",
      retryCount: toRetryCount(row.retryCount),
      state: toQueueState(row.state),
      lastError: toStringOrNull(row.lastError),
      conflict:
        row.conflict && typeof row.conflict === "object"
          ? {
              code: toStringOrNull((row.conflict as Record<string, unknown>).code) ?? "conflict",
              message: toStringOrNull((row.conflict as Record<string, unknown>).message) ?? "Conflict detected.",
              serverState:
                (row.conflict as Record<string, unknown>).serverState && typeof (row.conflict as Record<string, unknown>).serverState === "object"
                  ? ((row.conflict as Record<string, unknown>).serverState as Record<string, unknown>)
                  : null,
            }
          : null,
      lastAttemptAt: toStringOrNull(row.lastAttemptAt),
      nextRetryAt: toStringOrNull(row.nextRetryAt),
    };
  }

  const legacy = row as LegacyMobileActionQueueItem;
  const legacyCommandText = toStringOrNull(legacy.commandText);
  if (!legacyCommandText) {
    return null;
  }

  const legacyTrailerNumber = toStringOrNull(legacy.trailerNumber);
  const legacyStateRaw = toStringOrNull(legacy.status);
  const state = legacyStateRaw === "syncing" ? "syncing" : legacyStateRaw === "failed" ? "failed" : legacyStateRaw === "conflict" ? "conflict" : "pending";

  const normalizedTrailerNumber = legacyTrailerNumber ?? "";

  // Legacy queue migration: treat freeform commands as mark-arrived only when intent is explicit,
  // otherwise leave them as pending and they can be reviewed/cancelled.
  const markArrivedRegex = /\b(mark\s+arrived|confirm\s+arrival)\b/i;
  const isMarkArrived = markArrivedRegex.test(legacyCommandText);

  if (!isMarkArrived) {
    return null;
  }

  const item: MobileActionQueueItem = {
    id: toStringOrNull(legacy.id) ?? `mobile-action-${nowIso}-${Math.random().toString(16).slice(2)}`,
    actionType: "MARK_ARRIVED",
    payload: {
      trailerNumber: normalizedTrailerNumber || undefined,
    },
    dedupeKey: getMobileActionDedupeKey({
      actionType: "MARK_ARRIVED",
      payload: {
        trailerNumber: normalizedTrailerNumber || undefined,
      },
      trailerNumber: normalizedTrailerNumber || null,
    }),
    trailerNumber: normalizedTrailerNumber || null,
    createdAt: toIsoString(legacy.createdAt, nowIso),
    operator: "Unknown Operator",
    retryCount: toRetryCount(legacy.attempts),
    state,
    lastError: toStringOrNull(legacy.error),
    conflict: null,
  };

  return item;
};

export const getMobileActionLabel = (item: Pick<MobileActionQueueItem, "actionType" | "trailerNumber" | "payload">) => {
  const trailerNumber = item.trailerNumber ?? ("trailerNumber" in item.payload ? (item.payload as { trailerNumber?: string }).trailerNumber : null);

  switch (item.actionType) {
    case "ADD_VESSEL_TRAILER":
      return `Add trailer ${(item.payload as { trailerNumber?: string }).trailerNumber ?? trailerNumber ?? "trailer"}`;
    case "MARK_ARRIVED":
      return `Mark arrived ${trailerNumber ?? "trailer"}`;
    case "MARK_CANCELLED":
      return `Mark cancelled ${trailerNumber ?? "trailer"}`;
    case "MARK_NO_SHOW":
      return `Mark no show ${trailerNumber ?? "trailer"}`;
    case "UNDO_CANCELLED":
      return `Undo cancelled ${trailerNumber ?? "trailer"}`;
    case "UNDO_NO_SHOW":
      return `Undo no show ${trailerNumber ?? "trailer"}`;
    case "MOVE_COMPOUND_POSITION":
      return `Move ${trailerNumber ?? "trailer"} to ${(item.payload as { targetPosition?: string }).targetPosition ?? "position"}`;
    case "CHANGE_LOAD_STATUS":
      return `Set ${trailerNumber ?? "trailer"} ${(item.payload as { nextLoadStatus?: string }).nextLoadStatus ?? "status"}`;
    case "CONFIRM_DEPARTURE":
      return `Confirm departure ${trailerNumber ?? "trailer"}`;
    case "START_INSPECTION":
      return `Start inspection ${trailerNumber ?? "trailer"}`;
    case "SAVE_INSPECTION_PROGRESS":
      return `Save inspection ${trailerNumber ?? "trailer"}`;
    case "COMPLETE_INSPECTION":
      return `Complete inspection ${trailerNumber ?? "trailer"}`;
    default:
      return "Mobile action";
  }
};

const normalizeDedupeValue = (value: unknown) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toUpperCase();
};

export const getMobileActionDedupeKey = (input: {
  actionType: MobileActionType;
  payload: MobileActionRequest["payload"];
  trailerNumber?: string | null;
}) => {
  switch (input.actionType) {
    case "ADD_VESSEL_TRAILER": {
      const payload = input.payload as Extract<MobileActionRequest, { actionType: "ADD_VESSEL_TRAILER" }>["payload"];
      return [
        input.actionType,
        normalizeDedupeValue(payload.operationId),
        normalizeDedupeValue(payload.trailerNumber ?? input.trailerNumber),
      ].join("::");
    }
    case "MARK_ARRIVED": {
      const payload = input.payload as Extract<MobileActionRequest, { actionType: "MARK_ARRIVED" }>["payload"];
      return [
        input.actionType,
        normalizeDedupeValue(payload.vesselTrailerId),
        normalizeDedupeValue(payload.operationId),
        normalizeDedupeValue(payload.trailerNumber ?? input.trailerNumber),
      ].join("::");
    }
    case "MARK_CANCELLED": {
      const payload = input.payload as Extract<MobileActionRequest, { actionType: "MARK_CANCELLED" }> ["payload"];
      return [input.actionType, normalizeDedupeValue(payload.vesselTrailerId)].join("::");
    }
    case "MARK_NO_SHOW": {
      const payload = input.payload as Extract<MobileActionRequest, { actionType: "MARK_NO_SHOW" }> ["payload"];
      return [input.actionType, normalizeDedupeValue(payload.vesselTrailerId)].join("::");
    }
    case "UNDO_CANCELLED": {
      const payload = input.payload as Extract<MobileActionRequest, { actionType: "UNDO_CANCELLED" }> ["payload"];
      return [input.actionType, normalizeDedupeValue(payload.vesselTrailerId)].join("::");
    }
    case "UNDO_NO_SHOW": {
      const payload = input.payload as Extract<MobileActionRequest, { actionType: "UNDO_NO_SHOW" }> ["payload"];
      return [input.actionType, normalizeDedupeValue(payload.vesselTrailerId)].join("::");
    }
    case "MOVE_COMPOUND_POSITION": {
      const payload = input.payload as Extract<MobileActionRequest, { actionType: "MOVE_COMPOUND_POSITION" }>["payload"];
      return [input.actionType, normalizeDedupeValue(payload.trailerId), normalizeDedupeValue(payload.targetPosition)].join("::");
    }
    case "CHANGE_LOAD_STATUS": {
      const payload = input.payload as Extract<MobileActionRequest, { actionType: "CHANGE_LOAD_STATUS" }>["payload"];
      return [input.actionType, normalizeDedupeValue(payload.trailerId), normalizeDedupeValue(payload.nextLoadStatus)].join("::");
    }
    case "CONFIRM_DEPARTURE": {
      const payload = input.payload as Extract<MobileActionRequest, { actionType: "CONFIRM_DEPARTURE" }>["payload"];
      return [input.actionType, normalizeDedupeValue(payload.trailerId)].join("::");
    }
    case "START_INSPECTION": {
      const payload = input.payload as Extract<MobileActionRequest, { actionType: "START_INSPECTION" }>["payload"];
      return [input.actionType, normalizeDedupeValue(payload.vesselTrailerId)].join("::");
    }
    case "SAVE_INSPECTION_PROGRESS": {
      const payload = input.payload as Extract<MobileActionRequest, { actionType: "SAVE_INSPECTION_PROGRESS" }>["payload"];
      return [input.actionType, normalizeDedupeValue(payload.vesselTrailerId)].join("::");
    }
    case "COMPLETE_INSPECTION": {
      const payload = input.payload as Extract<MobileActionRequest, { actionType: "COMPLETE_INSPECTION" }>["payload"];
      return [input.actionType, normalizeDedupeValue(payload.vesselTrailerId)].join("::");
    }
    default:
      return [input.actionType, normalizeDedupeValue(input.trailerNumber)].join("::");
  }
};

export const createMobileActionQueueItem = (input: {
  actionType: MobileActionType;
  payload: MobileActionRequest["payload"];
  trailerNumber?: string | null;
  operator: string;
}): MobileActionQueueItem => {
  const nowIso = new Date().toISOString();

  return {
    id: globalThis.crypto?.randomUUID?.() ?? `mobile-action-${nowIso}-${Math.random().toString(16).slice(2)}`,
    actionType: input.actionType,
    payload: input.payload,
    dedupeKey: getMobileActionDedupeKey(input),
    trailerNumber: input.trailerNumber ?? null,
    createdAt: nowIso,
    operator: input.operator,
    retryCount: 0,
    state: "pending",
    lastError: null,
    conflict: null,
    lastAttemptAt: null,
    nextRetryAt: null,
  };
};
