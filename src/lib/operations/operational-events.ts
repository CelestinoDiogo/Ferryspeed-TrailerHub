import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

export type OperationalSourceModule =
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

export type OperationalEvent = {
  id: string;
  trailerNumber: string;
  eventType: string;
  title: string;
  description?: string;
  occurredAt: string;
  userName?: string;
  sourceModule: OperationalSourceModule;
  sourceRecordId?: string;
  metadata?: Record<string, unknown>;
};

export type RecordOperationalEventInput = {
  trailerId?: string | null;
  trailerNumber: string;
  eventType: string;
  title?: string;
  description?: string;
  occurredAt?: string;
  userName?: string | null;
  sourceModule: OperationalSourceModule;
  sourceRecordId?: string | null;
  metadata?: Record<string, unknown>;
  oldValue?: Json | null;
  newValue?: Json | null;
  idempotencyKey?: string | null;
  requireSuccess?: boolean;
};

export type RecordOperationalEventResult = {
  ok: boolean;
  inserted: boolean;
  duplicate: boolean;
  eventId?: string;
  reason?: string;
};

type TrailerEventRow = Database["public"]["Tables"]["trailer_events"]["Row"];

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return true;
};

const humanizeEventType = (eventType: string) =>
  eventType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const buildEventEnvelope = (
  value: Json | null | undefined,
  extra: Record<string, unknown>,
): Json => {
  if (isPlainObject(value)) {
    return {
      ...value,
      ...extra,
    } as Json;
  }

  if (value === null || value === undefined) {
    return extra as Json;
  }

  return {
    value,
    ...extra,
  } as Json;
};

const getEventEnvelope = (value: unknown) => {
  if (!isPlainObject(value)) {
    return null;
  }

  return value;
};

export const inferOperationalSourceModule = (eventType?: string | null): OperationalSourceModule => {
  const normalized = eventType?.trim().toLowerCase() ?? "";

  if (normalized.startsWith("vessel_")) return "vessel";
  if (normalized === "arrival_registered") return "arrival";
  if (normalized.includes("inspection")) return "inspection";
  if (normalized.includes("compound")) return "compound";
  if (normalized.includes("delivery") || normalized === "on_delivery") return "delivery";
  if (normalized.includes("collection") || normalized === "trailer_collected") return "collection";
  if (normalized.startsWith("export_")) return "export";
  if (normalized.includes("departure")) return "departure";
  if (normalized.includes("maintenance")) return "maintenance";

  return "system";
};

export const getOperationalEventSourceRecordId = (row: Pick<TrailerEventRow, "old_value" | "new_value">) => {
  const newValue = getEventEnvelope(row.new_value);
  const oldValue = getEventEnvelope(row.old_value);

  const newSourceRecordId = newValue?.source_record_id;
  if (typeof newSourceRecordId === "string" && newSourceRecordId.trim()) {
    return newSourceRecordId;
  }

  const oldSourceRecordId = oldValue?.source_record_id;
  if (typeof oldSourceRecordId === "string" && oldSourceRecordId.trim()) {
    return oldSourceRecordId;
  }

  return undefined;
};

export const getOperationalEventMetadata = (row: Pick<TrailerEventRow, "old_value" | "new_value">) => {
  const newValue = getEventEnvelope(row.new_value);
  const metadata = newValue?.metadata;
  return isPlainObject(metadata) ? metadata : undefined;
};

export const getOperationalEventIdempotencyKey = (row: Pick<TrailerEventRow, "new_value">) => {
  const newValue = getEventEnvelope(row.new_value);
  const idempotencyKey = newValue?.idempotency_key;
  return typeof idempotencyKey === "string" && idempotencyKey.trim() ? idempotencyKey : undefined;
};

export const mapTrailerEventRowToOperationalEvent = (row: TrailerEventRow): OperationalEvent => {
  const newValue = getEventEnvelope(row.new_value);
  const oldValue = getEventEnvelope(row.old_value);
  const title = row.event_description?.trim() || humanizeEventType(row.event_type ?? "event");
  const sourceModuleValue = newValue?.source_module ?? oldValue?.source_module;
  const userNameValue = row.created_by ?? newValue?.user_name ?? oldValue?.user_name;
  const occurredAtValue = newValue?.occurred_at ?? oldValue?.occurred_at ?? row.created_at ?? new Date().toISOString();

  return {
    id: row.id,
    trailerNumber: row.trailer_number ?? "Unknown",
    eventType: row.event_type ?? "event",
    title,
    description: row.event_description ?? undefined,
    occurredAt: typeof occurredAtValue === "string" ? occurredAtValue : row.created_at ?? new Date().toISOString(),
    userName: typeof userNameValue === "string" && userNameValue.trim() ? userNameValue : undefined,
    sourceModule:
      typeof sourceModuleValue === "string"
        ? (sourceModuleValue as OperationalSourceModule)
        : inferOperationalSourceModule(row.event_type),
    sourceRecordId: getOperationalEventSourceRecordId(row),
    metadata: getOperationalEventMetadata(row),
  };
};

export const buildOperationalEventIdempotencyKey = (input: {
  trailerId?: string | null;
  trailerNumber: string;
  eventType: string;
  sourceModule: OperationalSourceModule;
  sourceRecordId?: string | null;
  occurredAt?: string | null;
}) => {
  return [
    input.trailerId ?? input.trailerNumber.trim().toUpperCase(),
    input.eventType,
    input.sourceModule,
    input.sourceRecordId ?? "none",
    input.occurredAt ?? "none",
  ].join(":");
};

export async function recordOperationalEvent(
  supabase: SupabaseClient<Database>,
  input: RecordOperationalEventInput,
): Promise<RecordOperationalEventResult> {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const idempotencyKey =
    input.idempotencyKey ??
    buildOperationalEventIdempotencyKey({
      trailerId: input.trailerId,
      trailerNumber: input.trailerNumber,
      eventType: input.eventType,
      sourceModule: input.sourceModule,
      sourceRecordId: input.sourceRecordId,
      occurredAt,
    });

  const { data: existingRows, error: existingError } = await supabase
    .from("trailer_events")
    .select("id, trailer_id, trailer_number, event_type, event_description, old_value, new_value, created_at, created_by")
    .eq("event_type", input.eventType)
    .eq(input.trailerId ? "trailer_id" : "trailer_number", input.trailerId ?? input.trailerNumber)
    .order("created_at", { ascending: false })
    .limit(20);

  if (existingError) {
    if (input.requireSuccess) {
      throw new Error(existingError.message || "Unable to validate operational event idempotency.");
    }

    return {
      ok: false,
      inserted: false,
      duplicate: false,
      reason: existingError.message || "Unable to validate operational event idempotency.",
    };
  }

  const duplicateEvent = ((existingRows ?? []) as TrailerEventRow[]).find((row) => {
    const existingKey = getOperationalEventIdempotencyKey(row);
    if (existingKey && existingKey === idempotencyKey) {
      return true;
    }

    const existingSourceRecordId = getOperationalEventSourceRecordId(row);
    return existingSourceRecordId && input.sourceRecordId && existingSourceRecordId === input.sourceRecordId;
  });

  if (duplicateEvent) {
    return {
      ok: true,
      inserted: false,
      duplicate: true,
      eventId: duplicateEvent.id,
    };
  }

  const metadata = {
    ...(input.metadata ?? {}),
  };

  const oldValue = buildEventEnvelope(input.oldValue, {
    source_module: input.sourceModule,
    source_record_id: input.sourceRecordId ?? null,
    occurred_at: occurredAt,
    user_name: input.userName ?? null,
    idempotency_key: idempotencyKey,
    metadata,
  });

  const newValue = buildEventEnvelope(input.newValue, {
    source_module: input.sourceModule,
    source_record_id: input.sourceRecordId ?? null,
    occurred_at: occurredAt,
    user_name: input.userName ?? null,
    idempotency_key: idempotencyKey,
    metadata,
  });

  const { data: insertedRow, error: insertError } = await supabase
    .from("trailer_events")
    .insert({
      trailer_id: input.trailerId ?? null,
      trailer_number: input.trailerNumber,
      event_type: input.eventType,
      event_description: input.description ?? input.title ?? humanizeEventType(input.eventType),
      old_value: oldValue,
      new_value: newValue,
      created_at: occurredAt,
      created_by: input.userName ?? null,
    })
    .select("id")
    .single();

  if (insertError || !insertedRow) {
    if (input.requireSuccess) {
      throw new Error(insertError?.message || "Unable to record operational event.");
    }

    return {
      ok: false,
      inserted: false,
      duplicate: false,
      reason: insertError?.message || "Unable to record operational event.",
    };
  }

  return {
    ok: true,
    inserted: true,
    duplicate: false,
    eventId: insertedRow.id,
  };
}