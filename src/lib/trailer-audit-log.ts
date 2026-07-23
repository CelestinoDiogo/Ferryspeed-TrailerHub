import type { Database, Json } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

export type TrailerAuditRow = Database["public"]["Tables"]["trailer_audit_log"]["Row"];

export type TrailerAuditSourceModule =
  | "arrival"
  | "departure"
  | "compound"
  | "stock_check"
  | "review_discrepancies"
  | "operations"
  | "system";

export type TrailerAuditTimeFilter = "today" | "last_7_days" | "last_30_days" | "all";

type LogTrailerEventInput = {
  trailerId?: string | null;
  trailerNumber?: string | null;
  eventType: string;
  description?: string | null;
  previousValue?: Json | null;
  newValue?: Json | null;
  sourceModule: TrailerAuditSourceModule;
  performedBy?: string | null;
  performedAt?: string | null;
};

type LoadTrailerAuditLogInput = {
  trailerId?: string | null;
  trailerNumber?: string | null;
  search?: string;
  timeFilter?: TrailerAuditTimeFilter;
  limit?: number;
};

const normalizeText = (value?: string | null) => value?.trim() ?? "";

const getDateFloorIso = (daysBack: number) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysBack);
  return date.toISOString();
};

const getTimeFilterLowerBoundIso = (timeFilter: TrailerAuditTimeFilter) => {
  if (timeFilter === "today") {
    return getDateFloorIso(0);
  }

  if (timeFilter === "last_7_days") {
    return getDateFloorIso(6);
  }

  if (timeFilter === "last_30_days") {
    return getDateFloorIso(29);
  }

  return null;
};

export const resolveAuditOperatorName = async () => {
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    return "TrailerHub User";
  }

  const metadataName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name.trim());

  return metadataName || user.email || user.id || "TrailerHub User";
};

export const logTrailerEvent = async (input: LogTrailerEventInput) => {
  const eventType = normalizeText(input.eventType);
  if (!eventType) {
    return { ok: false as const, error: "Event type is required." };
  }

  const performedBy = normalizeText(input.performedBy) || (await resolveAuditOperatorName());
  const performedAt = normalizeText(input.performedAt) || new Date().toISOString();

  const payload: Database["public"]["Tables"]["trailer_audit_log"]["Insert"] = {
    trailer_id: input.trailerId ?? null,
    trailer_number: normalizeText(input.trailerNumber) || null,
    event_type: eventType,
    description: input.description ?? null,
    previous_value: input.previousValue ?? null,
    new_value: input.newValue ?? null,
    source_module: input.sourceModule,
    performed_by: performedBy,
    performed_at: performedAt,
  };

  const { error } = await supabase.from("trailer_audit_log").insert(payload);
  if (error) {
    console.error("Failed to write trailer audit log:", error);
    return { ok: false as const, error: error.message || "Unable to write trailer audit log." };
  }

  return { ok: true as const };
};

export const loadTrailerAuditLog = async (input: LoadTrailerAuditLogInput) => {
  const searchTerm = normalizeText(input.search).toLowerCase();
  const limit = Math.max(1, Math.min(input.limit ?? 500, 2000));
  const timeFilter = input.timeFilter ?? "all";

  let query = supabase
    .from("trailer_audit_log")
    .select("id, trailer_id, trailer_number, event_type, description, previous_value, new_value, source_module, performed_by, performed_at, created_at")
    .order("performed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (input.trailerId) {
    query = query.eq("trailer_id", input.trailerId);
  }

  if (input.trailerNumber) {
    query = query.eq("trailer_number", input.trailerNumber);
  }

  const lowerBound = getTimeFilterLowerBoundIso(timeFilter);
  if (lowerBound) {
    query = query.gte("performed_at", lowerBound);
  }

  if (searchTerm) {
    query = query.ilike("trailer_number", `%${searchTerm}%`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || "Unable to load trailer audit log.");
  }

  return (data ?? []) as TrailerAuditRow[];
};
