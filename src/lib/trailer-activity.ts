import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

export type TrailerActivityRow = Database["public"]["Tables"]["trailer_activity_log"]["Row"];

export type TrailerActivityEventType =
  | "trailer_created"
  | "arrived"
  | "departed"
  | "compound_entered"
  | "compound_position_changed"
  | "compound_removed"
  | "load_status_changed"
  | "operational_status_changed"
  | "export_allocated"
  | "export_status_changed"
  | "export_cancelled"
  | "vessel_expected"
  | "vessel_arrived"
  | "inspection_started"
  | "inspection_completed"
  | "temperature_recorded"
  | "damage_recorded"
  | "photo_uploaded"
  | "stock_check_confirmed"
  | "stock_check_adjusted"
  | "movement_undone"
  | "note_added"
  | (string & {});

export type TrailerActivitySourceModule =
  | "arrival"
  | "compound"
  | "delivery"
  | "export"
  | "inspection"
  | "operations"
  | "review_discrepancies"
  | "stock_check"
  | "system"
  | "vessel"
  | (string & {});

type TrailerActivitySupabaseClient = SupabaseClient<Database>;

type TrailerActivityMetadata = Record<string, Json>;

type CreateTrailerActivityInput = {
  supabaseClient?: TrailerActivitySupabaseClient;
  trailerId?: string | null;
  trailerNumber: string;
  eventType: TrailerActivityEventType;
  eventTitle: string;
  eventDescription?: string | null;
  sourceModule: TrailerActivitySourceModule;
  sourceRecordId?: string | null;
  previousStatus?: string | null;
  newStatus?: string | null;
  previousCompoundPosition?: string | null;
  newCompoundPosition?: string | null;
  metadata?: unknown;
  performedBy?: string | null;
  createdAt?: string | null;
};

type GetTrailerActivityInput = {
  supabaseClient?: TrailerActivitySupabaseClient;
  trailerId?: string | null;
  trailerNumber?: string | null;
  limit?: number;
};

const normalizeText = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const normalizeTrailerActivityNumber = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
};

const normalizeCompoundPosition = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
};

const sanitizeJsonValue = (value: unknown): Json | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeJsonValue(item))
      .filter((item): item is Json => item !== undefined);
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const sanitizedEntries = entries
      .map(([key, entryValue]) => [key, sanitizeJsonValue(entryValue)] as const)
      .filter((entry): entry is readonly [string, Json] => entry[1] !== undefined);

    return Object.fromEntries(sanitizedEntries);
  }

  return String(value);
};

const sanitizeMetadata = (metadata: unknown): TrailerActivityMetadata => {
  const sanitized = sanitizeJsonValue(metadata);

  if (!sanitized || Array.isArray(sanitized) || typeof sanitized !== "object") {
    return {};
  }

  return sanitized as TrailerActivityMetadata;
};

const resolveActivityOperatorName = async (supabaseClient: TrailerActivitySupabaseClient) => {
  const { data, error } = await supabaseClient.auth.getUser();
  if (error) {
    throw new Error(error.message || "Unable to resolve the current Supabase user.");
  }

  const user = data.user;
  if (!user) {
    return "TrailerHub User";
  }

  const metadataName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name.trim());

  return metadataName || user.email || user.id || "TrailerHub User";
};

const getClient = (supabaseClient?: TrailerActivitySupabaseClient) => supabaseClient ?? supabase;

const getRowSelect = () =>
  "id, trailer_id, trailer_number, normalized_trailer_number, event_type, event_title, event_description, source_module, source_record_id, previous_status, new_status, previous_compound_position, new_compound_position, metadata, performed_by, created_at";

export async function createTrailerActivity(input: CreateTrailerActivityInput) {
  const supabaseClient = getClient(input.supabaseClient);
  const trailerNumber = normalizeTrailerActivityNumber(input.trailerNumber);
  const eventType = normalizeText(input.eventType);
  const eventTitle = normalizeText(input.eventTitle);
  const sourceModule = normalizeText(input.sourceModule);

  if (!trailerNumber) {
    throw new Error("Trailer activity requires a trailer number.");
  }

  if (!eventType) {
    throw new Error("Trailer activity requires an event type.");
  }

  if (!eventTitle) {
    throw new Error("Trailer activity requires an event title.");
  }

  if (!sourceModule) {
    throw new Error("Trailer activity requires a source module.");
  }

  const performedBy = normalizeText(input.performedBy) ?? (await resolveActivityOperatorName(supabaseClient));
  const payload: Database["public"]["Tables"]["trailer_activity_log"]["Insert"] = {
    trailer_id: input.trailerId ?? null,
    trailer_number: trailerNumber,
    event_type: eventType,
    event_title: eventTitle,
    event_description: normalizeText(input.eventDescription),
    source_module: sourceModule,
    source_record_id: input.sourceRecordId ?? null,
    previous_status: normalizeText(input.previousStatus),
    new_status: normalizeText(input.newStatus),
    previous_compound_position: normalizeCompoundPosition(input.previousCompoundPosition),
    new_compound_position: normalizeCompoundPosition(input.newCompoundPosition),
    metadata: sanitizeMetadata(input.metadata),
    performed_by: performedBy,
    created_at: normalizeText(input.createdAt),
  };

  const { data, error } = await supabaseClient
    .from("trailer_activity_log")
    .insert(payload)
    .select(getRowSelect())
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Unable to create trailer activity record.");
  }

  return data as unknown as TrailerActivityRow;
}

export async function getTrailerActivity(input: GetTrailerActivityInput) {
  const supabaseClient = getClient(input.supabaseClient);
  const trailerId = normalizeText(input.trailerId);
  const trailerNumber = normalizeTrailerActivityNumber(input.trailerNumber);
  const limit = Math.max(1, Math.min(input.limit ?? 200, 1000));

  if (!trailerId && !trailerNumber) {
    throw new Error("Trailer activity lookup requires a trailer id or trailer number.");
  }

  const resultSets: TrailerActivityRow[][] = [];

  if (trailerId) {
    const { data, error } = await supabaseClient
      .from("trailer_activity_log")
      .select(getRowSelect())
      .eq("trailer_id", trailerId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(error.message || "Unable to load trailer activity by trailer id.");
    }

    resultSets.push((data ?? []) as unknown as TrailerActivityRow[]);
  }

  if (trailerNumber) {
    const { data, error } = await supabaseClient
      .from("trailer_activity_log")
      .select(getRowSelect())
      .eq("normalized_trailer_number", trailerNumber)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(error.message || "Unable to load trailer activity by trailer number.");
    }

    resultSets.push((data ?? []) as unknown as TrailerActivityRow[]);
  }

  const rowsById = new Map<string, TrailerActivityRow>();
  resultSets.flat().forEach((row) => {
    rowsById.set(row.id, row);
  });

  return Array.from(rowsById.values())
    .sort((left, right) => new Date(right.created_at ?? 0).getTime() - new Date(left.created_at ?? 0).getTime())
    .slice(0, limit);
}