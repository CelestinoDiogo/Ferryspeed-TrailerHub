import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { normalizeExportAllocationRecord, type ExportAllocationRecord, type ExportAllocationStatus } from "@/lib/export-allocation";
import { normalizeTrailerNumber } from "@/lib/compound-stock-check";

export type OperationalAlertRow = Database["public"]["Tables"]["operational_alerts"]["Row"];
export type OperationalAlertSettingsRow = Database["public"]["Tables"]["operational_alert_settings"]["Row"];
export type OperationalAlertSummaryRow = Database["public"]["Views"]["operational_alert_summary"]["Row"];

export type OperationalAlertSeverity = "critical" | "high" | "warning" | "info";
export type OperationalAlertStatus = "active" | "resolved" | "dismissed";

type ServiceOk<T> = { ok: true; data: T };
type ServiceErr = { ok: false; error: string; details?: string | null };
type ServiceResult<T> = ServiceOk<T> | ServiceErr;

type SupabaseErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

type InsertPayloadVariant = "modern" | "compat_no_alert_key";

type InsertSelectVariant = "modern_all" | "compat_core" | "compat_core_no_alert_key";

export type OperationalAlertSettings = {
  enabled: boolean;
  compoundDwellWarningDays: number;
  compoundDwellCriticalDays: number;
  compoundOccupancyWarningPercent: number;
  compoundOccupancyCriticalPercent: number;
  priorityInspectionPendingMinutes: number;
  temperatureAlertsEnabled: boolean;
  inspectionMissingPhotosEnabled: boolean;
  stockCheckDiscrepanciesEnabled: boolean;
  exportWaitingCollectionHours: number;
  raw: OperationalAlertSettingsRow | null;
  rawRows?: OperationalAlertSettingsRow[];
};

export type OperationalAlertSummary = {
  totalActiveAlerts: number;
  criticalCount: number;
  highCount: number;
  warningCount: number;
  infoCount: number;
  latestAlertAt: string | null;
  raw: OperationalAlertSummaryRow | null;
};

export type GetOperationalAlertsInput = {
  status?: OperationalAlertStatus[];
  severities?: OperationalAlertSeverity[];
  trailerId?: string | null;
  trailerNumber?: string | null;
  sourceModule?: string | null;
  limit?: number;
  includeResolved?: boolean;
};

export type OperationalAlertActionInput = {
  operationalAlertId: string;
  performedBy?: string | null;
  reason?: string | null;
};

export type CreateOperationalAlertInput = {
  alertKey?: string;
  severity: OperationalAlertSeverity;
  title: string;
  description?: string | null;
  sourceModule: string;
  sourceRecordId?: string | null;
  trailerId?: string | null;
  trailerNumber?: string | null;
  metadata?: unknown;
  performedBy?: string | null;
  status?: OperationalAlertStatus;
  existingAlert?: OperationalAlertRow | null;
};

export type OperationalAlertDetectionResult = {
  createdCount: number;
  updatedCount: number;
  resolvedCount: number;
  suppressedCount: number;
  errors: string[];
  summary: OperationalAlertSummary | null;
  alerts: OperationalAlertRow[];
};

type AlertCandidate = {
  severity: OperationalAlertSeverity;
  title: string;
  description: string;
  sourceModule: string;
  sourceRecordId?: string | null;
  trailerId?: string | null;
  trailerNumber?: string | null;
  metadata?: unknown;
  performedBy?: string | null;
};

type TrailerRow = {
  id: string;
  trailer_number: string | null;
  load_status: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  compound_position: string | null;
  operational_status: string | null;
  is_local: boolean | null;
  customer: string | null;
  load_description: string | null;
  created_at: string | null;
};

type VesselTrailerRow = {
  id: string;
  vessel_operation_id: string;
  trailer_id: string | null;
  trailer_number: string | null;
  priority_level: string | null;
  arrival_status: string | null;
  arrived_at: string | null;
  arrival_confirmed_at: string | null;
  inspection_started_at: string | null;
  inspection_completed_at: string | null;
  status: string | null;
  has_damage: boolean | null;
  has_temperature_alert: boolean | null;
  temperature_required: string | null;
  created_at: string | null;
};

type TemperatureRow = {
  id: string;
  vessel_trailer_id: string | null;
  trailer_id: string | null;
  trailer_number: string | null;
  is_out_of_range: boolean | null;
  recorded_at: string | null;
};

type PhotoRow = {
  id: string;
  vessel_trailer_id: string | null;
  vessel_operation_id: string | null;
  uploaded_at: string | null;
};

type StockCheckItemRow = {
  id: string;
  stock_check_id: string;
  trailer_id: string | null;
  trailer_number: string | null;
  discrepancy_type: string | null;
  resolution_status: string | null;
  system_load_status: string | null;
  system_operational_status: string | null;
  actual_position: string | null;
  expected_position: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ExportAllocationRow = {
  id: string;
  trailer_id: string | null;
  trailer_number: string | null;
  status: string;
  expected_return_at: string | null;
  allocated_at: string | null;
  delivered_empty_at: string | null;
  waiting_loading_at: string | null;
  collected_loaded_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type TrailerMovementActivityRow = {
  trailer_id: string | null;
  normalized_trailer_number: string | null;
  event_type: string | null;
  created_at: string | null;
};

const ACTIVE_ALERT_STATUSES: OperationalAlertStatus[] = ["active"];
const OPERATIONAL_ALERTS_ACTIVE_DEDUPE_INDEX = "operational_alerts_active_dedupe_idx";
const OPERATIONAL_ALERTS_STATUS_CONSTRAINT_NAMES = new Set([
  "operational_alerts_status_valid",
  "operational_alerts_status_check",
]);
const isDev = process.env.NODE_ENV === "development";
const MODERN_OPERATIONAL_ALERT_INSERT_SELECT = "*";
const COMPAT_OPERATIONAL_ALERT_INSERT_SELECT = "id,alert_key,alert_type,severity,status,title,description,trailer_id,trailer_number,source_module,source_record_id,metadata,created_at,updated_at";
const COMPAT_OPERATIONAL_ALERT_INSERT_SELECT_NO_ALERT_KEY = "id,alert_type,severity,status,title,description,trailer_id,trailer_number,source_module,source_record_id,metadata,created_at,updated_at";
const SETTINGS_CACHE_MS = 15_000;
const DETECTION_COOLDOWN_MS = 10_000;
const COMPOUND_AGE_WARNING_HOURS = 48;
const COMPOUND_NO_MOVEMENT_HIGH_HOURS = 96;
const DEFAULT_SETTINGS: OperationalAlertSettings = {
  enabled: true,
  compoundDwellWarningDays: 7,
  compoundDwellCriticalDays: 14,
  compoundOccupancyWarningPercent: 80,
  compoundOccupancyCriticalPercent: 90,
  priorityInspectionPendingMinutes: 60,
  temperatureAlertsEnabled: true,
  inspectionMissingPhotosEnabled: true,
  stockCheckDiscrepanciesEnabled: true,
  exportWaitingCollectionHours: 24,
  raw: null,
  rawRows: [],
};

let cachedOperationalAlertSettings: { fetchedAt: number; data: OperationalAlertSettings } | null = null;
let inFlightOperationalAlertSettingsPromise: Promise<ServiceResult<OperationalAlertSettings>> | null = null;
let cachedOperationalAlertDetectionResult: ServiceResult<OperationalAlertDetectionResult> | null = null;
let lastOperationalAlertDetectionAt = 0;
let inFlightOperationalAlertDetectionPromise: Promise<ServiceResult<OperationalAlertDetectionResult>> | null = null;

const severityOrder: OperationalAlertSeverity[] = ["critical", "high", "warning", "info"];

const getClient = (supabaseClient?: SupabaseClient<Database>) => supabaseClient ?? supabase;

const normalizeText = (value?: string | null) => (value ?? "").trim();

const normalizeKeyText = (value?: string | null) => normalizeText(value).toUpperCase();

const isUuidLike = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const isMissingColumnError = (message?: string | null) => {
  const normalized = normalizeText(message);
  return normalized.includes("does not exist") && normalized.includes("column");
};

const normalizeAlertStatus = (value?: string | null): OperationalAlertStatus => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "resolved" || normalized === "dismissed") {
    return normalized;
  }

  return "active";
};

const slugifyAlertToken = (value: string, fallback: string) => {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }

  const slug = normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug || fallback;
};

const getAlertType = (sourceModule: string, title: string) => {
  const sourceToken = slugifyAlertToken(sourceModule, "unknown");
  const titleToken = slugifyAlertToken(title, "untitled");
  return `${sourceToken}_${titleToken}`;
};

const normalizeSeverity = (value?: string | null): OperationalAlertSeverity => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "critical" || normalized === "high" || normalized === "warning" || normalized === "info") {
    return normalized;
  }

  return "warning";
};

const toNumber = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
};

const toBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "t", "1", "yes", "y", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "f", "0", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }

  return fallback;
};

const buildAlertKey = (
  sourceModule: string,
  title: string,
  sourceRecordId?: string | null,
  trailerId?: string | null,
  overrideAlertKey?: string | null,
) => {
  const normalizedAlertKey = normalizeText(overrideAlertKey);
  if (normalizedAlertKey) {
    return normalizedAlertKey;
  }

  const normalizedSourceModule = normalizeText(sourceModule) || "unknown";
  const normalizedTitle = normalizeText(title) || "untitled";
  const recordRef = normalizeText(sourceRecordId) || normalizeText(trailerId) || "global";
  return `${normalizedSourceModule}:${normalizedTitle}:${recordRef}`;
};

const buildAlertIdentity = (
  alertKey: string,
  sourceRecordId?: string | null,
  trailerId?: string | null,
) => {
  return `${normalizeText(alertKey) || "unknown"}::${normalizeText(sourceRecordId) || "global"}::${normalizeText(trailerId) || "global"}`;
};

const getCandidateKey = (candidate: AlertCandidate) => {
  return buildAlertIdentity(
    buildAlertKey(candidate.sourceModule, candidate.title, candidate.sourceRecordId, candidate.trailerId),
    candidate.sourceRecordId,
    candidate.trailerId,
  );
};

const getAlertKey = (row: Pick<OperationalAlertRow, "alert_key" | "source_module" | "title" | "source_record_id" | "trailer_id">) => {
  return buildAlertIdentity(
    buildAlertKey(row.source_module, row.title, row.source_record_id, row.trailer_id, row.alert_key),
    row.source_record_id,
    row.trailer_id,
  );
};

const getAlertRank = (severity: string) => severityOrder.indexOf(normalizeSeverity(severity));

const parseJsonMetadata = (metadata: unknown): Json => {
  if (metadata === null || metadata === undefined) {
    return {};
  }

  if (typeof metadata === "string" || typeof metadata === "number" || typeof metadata === "boolean") {
    return metadata;
  }

  if (Array.isArray(metadata)) {
    return metadata.map((item) => parseJsonMetadata(item));
  }

  if (typeof metadata === "object") {
    return Object.fromEntries(
      Object.entries(metadata as Record<string, unknown>).map(([key, value]) => [key, parseJsonMetadata(value)]),
    );
  }

  return String(metadata);
};

const getNowIso = () => new Date().toISOString();

const parseIsoMillis = (timestamp?: string | null) => {
  if (!timestamp) {
    return null;
  }

  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const getHoursSinceTimestamp = (timestamp?: string | null) => {
  const millis = parseIsoMillis(timestamp);
  if (millis === null) {
    return null;
  }

  return Math.max(0, (Date.now() - millis) / 3_600_000);
};

const isCompoundMovementEventType = (eventType?: string | null) => {
  const normalized = normalizeText(eventType).toLowerCase();
  return (
    normalized === "compound_entered"
    || normalized === "compound_position_changed"
    || normalized === "arrived"
    || normalized === "vessel_arrived"
  );
};

const getActivityLookupKey = (row: { trailer_id?: string | null; normalized_trailer_number?: string | null }) => {
  if (row.trailer_id) {
    return `id:${row.trailer_id}`;
  }

  const trailerNumber = normalizeKeyText(row.normalized_trailer_number);
  return trailerNumber ? `number:${trailerNumber}` : null;
};

const buildMovementActivityMap = (rows: TrailerMovementActivityRow[]) => {
  const map = new Map<string, TrailerMovementActivityRow[]>();

  for (const row of rows) {
    if (!isCompoundMovementEventType(row.event_type)) {
      continue;
    }

    const key = getActivityLookupKey(row);
    if (!key) {
      continue;
    }

    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }

  return map;
};

const getTrailerActivityCandidates = (
  trailer: Pick<TrailerRow, "id" | "trailer_number">,
  movementMap: Map<string, TrailerMovementActivityRow[]>,
) => {
  const byId = movementMap.get(`id:${trailer.id}`) ?? [];
  const trailerNumberKey = normalizeKeyText(trailer.trailer_number);
  const byTrailerNumber = trailerNumberKey ? movementMap.get(`number:${trailerNumberKey}`) ?? [] : [];

  return [...byId, ...byTrailerNumber];
};

const resolveCompoundEntryTimestamp = (
  trailer: Pick<TrailerRow, "arrival_date" | "created_at">,
  activityRows: TrailerMovementActivityRow[],
) => {
  if (trailer.arrival_date) {
    return trailer.arrival_date;
  }

  if (activityRows.length > 0) {
    let earliest: string | null = null;
    let earliestMillis: number | null = null;

    for (const row of activityRows) {
      const millis = parseIsoMillis(row.created_at);
      if (millis === null) {
        continue;
      }

      if (earliestMillis === null || millis < earliestMillis) {
        earliestMillis = millis;
        earliest = row.created_at;
      }
    }

    if (earliest) {
      return earliest;
    }
  }

  return trailer.created_at;
};

const resolveLatestCompoundMovementTimestamp = (
  trailer: Pick<TrailerRow, "arrival_date" | "created_at">,
  activityRows: TrailerMovementActivityRow[],
) => {
  if (activityRows.length > 0) {
    let latest: string | null = null;
    let latestMillis: number | null = null;

    for (const row of activityRows) {
      const millis = parseIsoMillis(row.created_at);
      if (millis === null) {
        continue;
      }

      if (latestMillis === null || millis > latestMillis) {
        latestMillis = millis;
        latest = row.created_at;
      }
    }

    if (latest) {
      return latest;
    }
  }

  return resolveCompoundEntryTimestamp(trailer, activityRows);
};

const resolveActorName = async (supabaseClient: SupabaseClient<Database>, fallback = "TrailerHub User") => {
  const { data, error } = await supabaseClient.auth.getUser();
  if (error) {
    return fallback;
  }

  const user = data.user;
  if (!user) {
    return fallback;
  }

  const metadataName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name.trim());

  return metadataName || user.email || user.id || fallback;
};

const normalizeSettingsRow = (
  row: OperationalAlertSettingsRow | null,
  fallback: OperationalAlertSettings = DEFAULT_SETTINGS,
  rawRows: OperationalAlertSettingsRow[] = row ? [row] : [],
): OperationalAlertSettings => {
  const looseRow = row as Record<string, unknown> | null;

  return {
  enabled: toBoolean(row?.enabled ?? null, fallback.enabled),
  compoundDwellWarningDays: toNumber(
    row?.compound_dwell_warning_days ?? looseRow?.["dwell_warning_days"] ?? looseRow?.["compound_warning_days"],
    fallback.compoundDwellWarningDays,
  ),
  compoundDwellCriticalDays: toNumber(
    row?.compound_dwell_critical_days ?? looseRow?.["dwell_critical_days"] ?? looseRow?.["compound_critical_days"],
    fallback.compoundDwellCriticalDays,
  ),
  compoundOccupancyWarningPercent: toNumber(
    row?.compound_occupancy_warning_percent ?? looseRow?.["occupancy_warning_percent"] ?? looseRow?.["occupancy_warning_threshold"],
    fallback.compoundOccupancyWarningPercent,
  ),
  compoundOccupancyCriticalPercent: toNumber(
    row?.compound_occupancy_critical_percent ?? looseRow?.["occupancy_critical_percent"] ?? looseRow?.["occupancy_critical_threshold"],
    fallback.compoundOccupancyCriticalPercent,
  ),
  priorityInspectionPendingMinutes: toNumber(
    row?.priority_inspection_pending_minutes ?? looseRow?.["inspection_pending_minutes"] ?? looseRow?.["priority_pending_minutes"],
    fallback.priorityInspectionPendingMinutes,
  ),
  temperatureAlertsEnabled: toBoolean(
    row?.temperature_alerts_enabled ?? looseRow?.["temperature_alert_enabled"],
    fallback.temperatureAlertsEnabled,
  ),
  inspectionMissingPhotosEnabled: toBoolean(
    row?.inspection_missing_photos_enabled,
    fallback.inspectionMissingPhotosEnabled,
  ),
  stockCheckDiscrepanciesEnabled: toBoolean(
    row?.stock_check_discrepancies_enabled,
    fallback.stockCheckDiscrepanciesEnabled,
  ),
  exportWaitingCollectionHours: toNumber(
    row?.export_waiting_collection_hours ?? looseRow?.["waiting_collection_hours"] ?? looseRow?.["export_waiting_hours"],
    fallback.exportWaitingCollectionHours,
  ),
  raw: row,
  rawRows,
};
};

const mergeSettingsRows = (rows: OperationalAlertSettingsRow[]): OperationalAlertSettings => {
  if (rows.length === 0) {
    return { ...DEFAULT_SETTINGS, raw: null, rawRows: [] };
  }

  const sortedRows = [...rows].sort((left, right) => {
    const leftTime = new Date(left.updated_at ?? left.created_at ?? 0).getTime();
    const rightTime = new Date(right.updated_at ?? right.created_at ?? 0).getTime();

    const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
    const safeRight = Number.isFinite(rightTime) ? rightTime : 0;

    return safeLeft - safeRight;
  });

  let merged: OperationalAlertSettings = { ...DEFAULT_SETTINGS, raw: null, rawRows: [] };

  for (const row of sortedRows) {
    try {
      merged = normalizeSettingsRow(row, merged, [...(merged.rawRows ?? []), row]);
    } catch (error) {
      if (isDev) {
        console.error("[alerts] malformed settings row skipped", {
          resource: "public.operational_alert_settings",
          rowId: row.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return merged;
};

const loadOperationalAlertSettings = async (client: SupabaseClient<Database>): Promise<ServiceResult<OperationalAlertSettings>> => {
  try {
    const { data, error } = await client
      .from("operational_alert_settings")
      .select("*")
      .order("updated_at", { ascending: false, nullsFirst: false });

    if (error) {
      return { ok: false, error: error.message || "Unable to load operational alert settings." };
    }

    const rows = (data ?? []) as OperationalAlertSettingsRow[];
    const mergedSettings = mergeSettingsRows(rows);

    if (isDev) {
      console.info("[alerts] settings loaded", {
        resource: "public.operational_alert_settings",
        rowCount: rows.length,
        effectiveSettingsRowId: mergedSettings.raw?.id ?? null,
      });
    }

    return { ok: true, data: mergedSettings };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load operational alert settings.";
    return { ok: false, error: message };
  }
};

const normalizeSummaryRow = (row: OperationalAlertSummaryRow | null): OperationalAlertSummary => ({
  totalActiveAlerts: toNumber(row?.total_active_alerts, 0),
  criticalCount: toNumber(row?.critical_count, 0),
  highCount: toNumber(row?.high_count, 0),
  warningCount: toNumber(row?.warning_count, 0),
  infoCount: toNumber(row?.info_count, 0),
  latestAlertAt: row?.latest_alert_at ?? null,
  raw: row,
});

const normalizeAlertRow = (row: OperationalAlertRow): OperationalAlertRow => ({
  ...row,
  severity: normalizeSeverity(row.severity),
  status: normalizeAlertStatus(row.status),
  trailer_number: row.trailer_number ? normalizeTrailerNumber(row.trailer_number) : null,
});

const findLatestAlert = async (
  supabaseClient: SupabaseClient<Database>,
  alertKey: string,
  sourceRecordId?: string | null,
  trailerId?: string | null,
) => {
  let query = supabaseClient
    .from("operational_alerts")
    .select("*")
    .eq("alert_key", alertKey)
    .order("created_at", { ascending: false })
    .limit(1);

  if (sourceRecordId) {
    query = query.eq("source_record_id", sourceRecordId);
  } else {
    query = query.is("source_record_id", null);
  }

  if (trailerId) {
    query = query.eq("trailer_id", trailerId);
  } else {
    query = query.is("trailer_id", null);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || "Unable to load existing operational alert.");
  }

  const row = (data ?? [])[0] ?? null;
  return row ? normalizeAlertRow(row as OperationalAlertRow) : null;
};

const findActiveAlertByIdentity = async (
  supabaseClient: SupabaseClient<Database>,
  alertKey: string,
  sourceRecordId?: string | null,
  trailerId?: string | null,
) => {
  let query = supabaseClient
    .from("operational_alerts")
    .select("*")
    .eq("alert_key", alertKey)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1);

  if (sourceRecordId) {
    query = query.eq("source_record_id", sourceRecordId);
  } else {
    query = query.is("source_record_id", null);
  }

  if (trailerId) {
    query = query.eq("trailer_id", trailerId);
  } else {
    query = query.is("trailer_id", null);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || "Unable to load existing active operational alert.");
  }

  const row = (data ?? [])[0] ?? null;
  return row ? normalizeAlertRow(row as OperationalAlertRow) : null;
};

const isActiveAlertDedupeConstraintError = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as SupabaseErrorLike;
  const code = normalizeText(maybeError.code);
  const message = normalizeText(maybeError.message).toLowerCase();

  return code === "23505" && message.includes(OPERATIONAL_ALERTS_ACTIVE_DEDUPE_INDEX);
};

const normalizeSupabaseErrorLike = (error: unknown): SupabaseErrorLike => {
  if (!error || typeof error !== "object") {
    return {};
  }

  const candidate = error as SupabaseErrorLike;
  return {
    code: candidate.code ?? null,
    message: candidate.message ?? null,
    details: candidate.details ?? null,
    hint: candidate.hint ?? null,
  };
};

const isSchemaCacheCompatibilityError = (error: SupabaseErrorLike) => {
  const code = normalizeText(error.code);
  const message = normalizeText(error.message).toLowerCase();
  const details = normalizeText(error.details).toLowerCase();
  return code === "PGRST204" || details.includes("schema cache") || message.includes("schema cache");
};

const extractSchemaCacheFieldName = (error: SupabaseErrorLike) => {
  const combined = `${normalizeText(error.message)} ${normalizeText(error.details)}`;
  const quotedMatch = combined.match(/'([a-zA-Z0-9_]+)'/);
  if (quotedMatch && quotedMatch[1]) {
    return quotedMatch[1];
  }

  const quotedDoubleMatch = combined.match(/"([a-zA-Z0-9_]+)"/);
  if (quotedDoubleMatch && quotedDoubleMatch[1]) {
    return quotedDoubleMatch[1];
  }

  return null;
};

const extractNotNullFieldName = (error: SupabaseErrorLike) => {
  const details = normalizeText(error.details);
  const quotedMatch = details.match(/column\s+"([a-zA-Z0-9_]+)"/i);
  if (quotedMatch && quotedMatch[1]) {
    return quotedMatch[1];
  }

  return null;
};

const extractConstraintName = (error: SupabaseErrorLike) => {
  const combined = `${normalizeText(error.message)} ${normalizeText(error.details)} ${normalizeText(error.hint)}`;
  const doubleQuotedMatch = combined.match(/constraint\s+"([a-zA-Z0-9_]+)"/i);
  if (doubleQuotedMatch && doubleQuotedMatch[1]) {
    return doubleQuotedMatch[1].toLowerCase();
  }

  const singleQuotedMatch = combined.match(/constraint\s+'([a-zA-Z0-9_]+)'/i);
  if (singleQuotedMatch && singleQuotedMatch[1]) {
    return singleQuotedMatch[1].toLowerCase();
  }

  return null;
};

const isLegacyRequiredFieldError = (error: SupabaseErrorLike) => normalizeText(error.code) === "23502";

const isRecognizedStatusConstraintError = (error: SupabaseErrorLike) => {
  if (normalizeText(error.code) !== "23514") {
    return false;
  }

  const constraintName = extractConstraintName(error);
  if (constraintName && OPERATIONAL_ALERTS_STATUS_CONSTRAINT_NAMES.has(constraintName)) {
    return true;
  }

  const message = normalizeText(error.message).toLowerCase();
  const details = normalizeText(error.details).toLowerCase();
  const hint = normalizeText(error.hint).toLowerCase();
  const combined = `${message} ${details} ${hint}`;
  return combined.includes("operational_alerts")
    && combined.includes("check constraint")
    && /\bstatus\b/.test(combined);
};

const isRecognizedInsertCompatibilityFailure = (error: SupabaseErrorLike) => {
  return (
    isSchemaCacheCompatibilityError(error)
    || isLegacyRequiredFieldError(error)
    || isRecognizedStatusConstraintError(error)
  );
};

const getInsertStatusCandidates = (statusValue: unknown): string[] => {
  const normalized = normalizeText(typeof statusValue === "string" ? statusValue : "").toLowerCase();
  if (!normalized || normalized === "active" || normalized === "open") {
    return ["open", "active"];
  }

  return [normalized];
};

const buildInsertPayloadVariant = (
  basePayload: Database["public"]["Tables"]["operational_alerts"]["Insert"],
  statusCandidate: string,
  payloadVariant: InsertPayloadVariant,
) => {
  const candidatePayload: Database["public"]["Tables"]["operational_alerts"]["Insert"] = {
    ...basePayload,
    status: statusCandidate,
    // Keep alert_type explicit for legacy NOT NULL schemas.
    alert_type: normalizeText(basePayload.alert_type) || "general",
  };

  if (payloadVariant === "compat_no_alert_key") {
    delete candidatePayload.alert_key;
  }

  return candidatePayload;
};

const getInsertSelectClause = (selectVariant: InsertSelectVariant) => {
  if (selectVariant === "compat_core") {
    return COMPAT_OPERATIONAL_ALERT_INSERT_SELECT;
  }

  if (selectVariant === "compat_core_no_alert_key") {
    return COMPAT_OPERATIONAL_ALERT_INSERT_SELECT_NO_ALERT_KEY;
  }

  return MODERN_OPERATIONAL_ALERT_INSERT_SELECT;
};

const updateAlertRow = async (
  supabaseClient: SupabaseClient<Database>,
  alertId: string,
  payload: Partial<Database["public"]["Tables"]["operational_alerts"]["Update"]>,
) => {
  const { data, error } = await supabaseClient
    .from("operational_alerts")
    .update(payload)
    .eq("id", alertId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Unable to update operational alert.");
  }

  return normalizeAlertRow(data as OperationalAlertRow);
};

const insertAlertRow = async (
  supabaseClient: SupabaseClient<Database>,
  payload: Database["public"]["Tables"]["operational_alerts"]["Insert"],
) => {
  const statusCandidates = getInsertStatusCandidates(payload.status);
  let attempt = 0;
  let statusIndex = 0;
  let payloadVariant: InsertPayloadVariant = "modern";
  let selectVariant: InsertSelectVariant = "modern_all";
  const triedStates = new Set<string>();

  while (statusIndex < statusCandidates.length) {
    const statusCandidate = statusCandidates[statusIndex] ?? "open";
    const attemptPayload = buildInsertPayloadVariant(payload, statusCandidate, payloadVariant);
    const attemptSelect = getInsertSelectClause(selectVariant);
    const stateKey = `${statusCandidate}|${payloadVariant}|${selectVariant}`;

    if (triedStates.has(stateKey)) {
      break;
    }

    triedStates.add(stateKey);
    attempt += 1;

    const { data, error } = await supabaseClient
      .from("operational_alerts")
      .insert(attemptPayload)
      .select(attemptSelect)
      .single();

    if (!error && data) {
      if (isDev) {
        console.info("[alerts] operational_alerts insert attempt", {
          attempt,
          payloadVariant,
          statusCandidate,
          selectVariant,
          errorCode: null,
          willRetry: false,
        });
      }

      return normalizeAlertRow(data as unknown as OperationalAlertRow);
    }

    const normalizedError = normalizeSupabaseErrorLike(error);
    const recognizedCompatibilityFailure = isRecognizedInsertCompatibilityFailure(normalizedError);
    let willRetry = false;

    if (recognizedCompatibilityFailure) {
      if (isRecognizedStatusConstraintError(normalizedError) && statusIndex < statusCandidates.length - 1) {
        statusIndex += 1;
        willRetry = true;
      } else if (isSchemaCacheCompatibilityError(normalizedError)) {
        const schemaField = extractSchemaCacheFieldName(normalizedError);
        if (schemaField === "alert_key" && payloadVariant !== "compat_no_alert_key") {
          payloadVariant = "compat_no_alert_key";
          selectVariant = "compat_core_no_alert_key";
          willRetry = true;
        } else if (selectVariant === "modern_all") {
          selectVariant = payloadVariant === "compat_no_alert_key" ? "compat_core_no_alert_key" : "compat_core";
          willRetry = true;
        }
      } else if (isLegacyRequiredFieldError(normalizedError)) {
        const missingField = extractNotNullFieldName(normalizedError);
        const hasAlertType = normalizeText(attemptPayload.alert_type) !== "";
        if (missingField === "alert_type" && !hasAlertType) {
          willRetry = true;
        }
      }
    }

    if (isDev) {
      const schemaField = extractSchemaCacheFieldName(normalizedError);
      const missingRequiredField = extractNotNullFieldName(normalizedError);
      console.warn("[alerts] operational_alerts insert attempt failed", {
        attempt,
        payloadVariant,
        statusCandidate,
        selectVariant,
        errorCode: normalizedError.code ?? null,
        schemaField,
        missingRequiredField,
        recognizedCompatibilityFailure,
        willRetry,
      });
    }

    if (!error) {
      break;
    }

    if (!willRetry) {
      const insertError = new Error(error.message || "Unable to create operational alert.") as Error & SupabaseErrorLike;
      insertError.code = error.code ?? null;
      insertError.details = error.details ?? null;
      insertError.hint = error.hint ?? null;
      throw insertError;
    }
  }

  throw new Error("Unable to create operational alert.");
};

export async function getOperationalAlertSettings(
  supabaseClient?: SupabaseClient<Database>,
): Promise<ServiceResult<OperationalAlertSettings>> {
  const client = getClient(supabaseClient);
  const now = Date.now();

  if (cachedOperationalAlertSettings && now - cachedOperationalAlertSettings.fetchedAt < SETTINGS_CACHE_MS) {
    return { ok: true, data: cachedOperationalAlertSettings.data };
  }

  if (!inFlightOperationalAlertSettingsPromise) {
    inFlightOperationalAlertSettingsPromise = loadOperationalAlertSettings(client).finally(() => {
      inFlightOperationalAlertSettingsPromise = null;
    });
  }

  const result = await inFlightOperationalAlertSettingsPromise;
  if (result.ok) {
    cachedOperationalAlertSettings = {
      fetchedAt: now,
      data: result.data,
    };
  }

  return result;
}

export async function getOperationalAlertSummary(
  supabaseClient?: SupabaseClient<Database>,
): Promise<ServiceResult<OperationalAlertSummary>> {
  const client = getClient(supabaseClient);
  const isDev = process.env.NODE_ENV !== "production";

  try {
    const { data, error } = await client.from("operational_alert_summary").select("*");
    if (error) {
      return { ok: false, error: error.message || "Unable to load operational alert summary." };
    }

    const rows = (data ?? []) as OperationalAlertSummaryRow[];

    if (rows.length > 1) {
      if (isDev) {
        console.error("[alerts] summary returned multiple rows", {
          resource: "public.operational_alert_summary",
          rowCount: rows.length,
        });
      }

      return {
        ok: false,
        error: `Dashboard summary data issue: operational_alert_summary returned ${rows.length} rows; expected 1.`,
      };
    }

    return { ok: true, data: normalizeSummaryRow(rows[0] ?? null) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load operational alert summary.";
    return { ok: false, error: message };
  }
}

export async function getOperationalAlerts(
  input: GetOperationalAlertsInput = {},
  supabaseClient?: SupabaseClient<Database>,
): Promise<ServiceResult<OperationalAlertRow[]>> {
  const client = getClient(supabaseClient);

  try {
    let query = client.from("operational_alerts").select("*").order("created_at", { ascending: true });

    if (!input.includeResolved) {
      query = query.in("status", ACTIVE_ALERT_STATUSES);
    } else if (input.status && input.status.length > 0) {
      query = query.in("status", input.status);
    }

    if (input.severities && input.severities.length > 0) {
      query = query.in("severity", input.severities);
    }

    if (input.trailerId) {
      query = query.eq("trailer_id", input.trailerId);
    }

    if (input.trailerNumber) {
      query = query.eq("trailer_number", normalizeTrailerNumber(input.trailerNumber));
    }

    if (input.sourceModule) {
      query = query.eq("source_module", input.sourceModule);
    }

    const limit = Math.max(1, Math.min(input.limit ?? 100, 1000));
    query = query.limit(limit);

    const { data, error } = await query;
    if (error) {
      return { ok: false, error: error.message || "Unable to load operational alerts." };
    }

    return { ok: true, data: ((data ?? []) as OperationalAlertRow[]).map(normalizeAlertRow) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load operational alerts.";
    return { ok: false, error: message };
  }
}

export async function acknowledgeOperationalAlert(
  input: OperationalAlertActionInput,
  supabaseClient?: SupabaseClient<Database>,
): Promise<ServiceResult<OperationalAlertRow>> {
  const client = getClient(supabaseClient);

  try {
    const performedBy = normalizeText(input.performedBy) || (await resolveActorName(client));
    const { data, error } = await client.rpc("acknowledge_operational_alert", {
      p_operational_alert_id: input.operationalAlertId,
      p_acknowledged_by: performedBy,
    } as never);

    if (error) {
      return { ok: false, error: error.message || "Unable to acknowledge operational alert." };
    }

    const row = (Array.isArray(data) ? data[0] : data) as OperationalAlertRow | null;
    if (!row) {
      return { ok: false, error: "No alert row was returned after acknowledge." };
    }

    return { ok: true, data: normalizeAlertRow(row) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to acknowledge operational alert.";
    return { ok: false, error: message };
  }
}

export async function resolveOperationalAlert(
  input: OperationalAlertActionInput,
  supabaseClient?: SupabaseClient<Database>,
): Promise<ServiceResult<OperationalAlertRow>> {
  const client = getClient(supabaseClient);

  try {
    const performedBy = normalizeText(input.performedBy) || (await resolveActorName(client));
    const { data, error } = await client.rpc("resolve_operational_alert", {
      p_operational_alert_id: input.operationalAlertId,
      p_resolved_by: performedBy,
      p_resolution_note: normalizeText(input.reason) || null,
    } as never);

    if (error) {
      return { ok: false, error: error.message || "Unable to resolve operational alert." };
    }

    const row = (Array.isArray(data) ? data[0] : data) as OperationalAlertRow | null;
    if (!row) {
      return { ok: false, error: "No alert row was returned after resolve." };
    }

    return { ok: true, data: normalizeAlertRow(row) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resolve operational alert.";
    return { ok: false, error: message };
  }
}

export async function dismissOperationalAlert(
  input: OperationalAlertActionInput,
  supabaseClient?: SupabaseClient<Database>,
): Promise<ServiceResult<OperationalAlertRow>> {
  const client = getClient(supabaseClient);

  try {
    const performedBy = normalizeText(input.performedBy) || (await resolveActorName(client));
    const { data, error } = await client.rpc("dismiss_operational_alert", {
      p_operational_alert_id: input.operationalAlertId,
      p_dismissed_by: performedBy,
      p_dismissal_reason: normalizeText(input.reason) || null,
    } as never);

    if (error) {
      return { ok: false, error: error.message || "Unable to dismiss operational alert." };
    }

    const row = (Array.isArray(data) ? data[0] : data) as OperationalAlertRow | null;
    if (!row) {
      return { ok: false, error: "No alert row was returned after dismiss." };
    }

    return { ok: true, data: normalizeAlertRow(row) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to dismiss operational alert.";
    return { ok: false, error: message };
  }
}

export async function createOperationalAlert(
  input: CreateOperationalAlertInput,
  supabaseClient?: SupabaseClient<Database>,
): Promise<ServiceResult<OperationalAlertRow>> {
  const client = getClient(supabaseClient);
  const sourceModule = normalizeText(input.sourceModule);
  const title = normalizeText(input.title);
  const description = normalizeText(input.description);
  const trailerNumber = input.trailerNumber ? normalizeTrailerNumber(input.trailerNumber) : null;
  const normalizedSourceRecordIdText = normalizeText(input.sourceRecordId);
  const sourceRecordId = normalizedSourceRecordIdText && isUuidLike(normalizedSourceRecordIdText)
    ? normalizedSourceRecordIdText
    : null;
  const normalizedTrailerIdText = normalizeText(input.trailerId);
  const trailerId = normalizedTrailerIdText && isUuidLike(normalizedTrailerIdText)
    ? normalizedTrailerIdText
    : null;
  const alertKey = buildAlertKey(sourceModule, title, sourceRecordId, trailerId, input.alertKey);
  const alertType = getAlertType(sourceModule, title);
  const status = normalizeAlertStatus(input.status ?? "active");
  const severity = normalizeSeverity(input.severity);

  if (!sourceModule) {
    return { ok: false, error: "Source module is required." };
  }

  if (!title) {
    return { ok: false, error: "Alert title is required." };
  }

  try {
    const existing = input.existingAlert ?? await findLatestAlert(client, alertKey, sourceRecordId, trailerId);

    if (existing?.status === "dismissed") {
      return { ok: true, data: existing };
    }

    if (existing && ACTIVE_ALERT_STATUSES.includes(existing.status as OperationalAlertStatus)) {
      const updated = await updateAlertRow(client, existing.id, {
        alert_key: alertKey,
        alert_type: alertType,
        severity,
        title,
        description,
        trailer_id: trailerId ?? existing.trailer_id,
        trailer_number: trailerNumber ?? existing.trailer_number,
        source_module: sourceModule,
        source_record_id: sourceRecordId ?? existing.source_record_id,
        metadata: parseJsonMetadata(input.metadata),
        status: existing.status,
      });

      return { ok: true, data: updated };
    }

    const basePayload: Database["public"]["Tables"]["operational_alerts"]["Insert"] = {
      alert_type: alertType,
      alert_key: alertKey,
      severity,
      status,
      title,
      description,
      trailer_id: trailerId,
      trailer_number: trailerNumber,
      source_module: sourceModule,
      source_record_id: sourceRecordId,
      metadata: parseJsonMetadata(input.metadata),
      created_at: getNowIso(),
    };

    const performedBy = normalizeText(input.performedBy) || (await resolveActorName(client));
    let inserted: OperationalAlertRow;

    try {
      inserted = await insertAlertRow(client, basePayload);
    } catch (error) {
      if (!isActiveAlertDedupeConstraintError(error)) {
        throw error;
      }

      const recoveredActive = await findActiveAlertByIdentity(client, alertKey, sourceRecordId, trailerId);
      if (!recoveredActive) {
        throw error;
      }

      const recoveryPayload: Partial<Database["public"]["Tables"]["operational_alerts"]["Update"]> = {
        alert_key: alertKey,
        alert_type: alertType,
        severity,
        title,
        description,
        trailer_id: trailerId ?? recoveredActive.trailer_id,
        trailer_number: trailerNumber ?? recoveredActive.trailer_number,
        source_module: sourceModule,
        source_record_id: sourceRecordId ?? recoveredActive.source_record_id,
        metadata: parseJsonMetadata(input.metadata),
        status: recoveredActive.status,
      };

      try {
        const updatedRecovered = await updateAlertRow(client, recoveredActive.id, recoveryPayload);
        return { ok: true, data: updatedRecovered };
      } catch {
        return { ok: true, data: recoveredActive };
      }
    }

    if (performedBy && inserted.status === "active") {
      return { ok: true, data: inserted };
    }

    return { ok: true, data: inserted };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create operational alert.";
    return { ok: false, error: message };
  }
}

const activeKeyMap = (rows: OperationalAlertRow[]) => {
  const map = new Map<string, OperationalAlertRow>();
  rows.forEach((row) => {
    const key = getAlertKey(row);
    if (!map.has(key)) {
      map.set(key, row);
    }
  });
  return map;
};

const sortActiveAlerts = (rows: OperationalAlertRow[]) =>
  [...rows].sort((left, right) => {
    const severityDelta = getAlertRank(left.severity) - getAlertRank(right.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }

    return new Date(left.created_at ?? 0).getTime() - new Date(right.created_at ?? 0).getTime();
  });

const buildAlertMetadata = (data: Record<string, unknown>) => data as unknown;

const isTimestampOlderThanMinutes = (timestamp?: string | null, minutes = 0) => {
  if (!timestamp) {
    return false;
  }

  const timestampMs = new Date(timestamp).getTime();
  if (Number.isNaN(timestampMs)) {
    return false;
  }

  return Date.now() - timestampMs >= minutes * 60_000;
};

const isTimestampOlderThanHours = (timestamp?: string | null, hours = 0) => {
  if (!timestamp) {
    return false;
  }

  const timestampMs = new Date(timestamp).getTime();
  if (Number.isNaN(timestampMs)) {
    return false;
  }

  return Date.now() - timestampMs >= hours * 3_600_000;
};

const buildTargetAlerts = (
  settings: OperationalAlertSettings,
  data: {
    trailers: TrailerRow[];
    trailerMovementActivity: TrailerMovementActivityRow[];
    vesselTrailers: VesselTrailerRow[];
    temperatures: TemperatureRow[];
    photos: PhotoRow[];
    stockCheckItems: StockCheckItemRow[];
    exportAllocations: ExportAllocationRow[];
  },
): AlertCandidate[] => {
  const candidates: AlertCandidate[] = [];
  const movementMap = buildMovementActivityMap(data.trailerMovementActivity);

  const compoundTrailers = data.trailers.filter((trailer) => {
    const active = !trailer.departure_date || trailer.departure_date.trim() === "";
    return active && trailer.is_local !== true && Boolean(trailer.compound_position?.trim());
  });

  for (const trailer of compoundTrailers) {
    const activityRows = getTrailerActivityCandidates(trailer, movementMap);
    const entryTimestamp = resolveCompoundEntryTimestamp(trailer, activityRows);
    const lastMovementTimestamp = resolveLatestCompoundMovementTimestamp(trailer, activityRows);
    const entryAgeHours = getHoursSinceTimestamp(entryTimestamp);
    const noMovementHours = getHoursSinceTimestamp(lastMovementTimestamp);

    const noMovementHigh = typeof noMovementHours === "number" && noMovementHours >= COMPOUND_NO_MOVEMENT_HIGH_HOURS;
    const ageWarning = typeof entryAgeHours === "number" && entryAgeHours >= COMPOUND_AGE_WARNING_HOURS;

    if (noMovementHigh) {
      candidates.push({
        severity: "high",
        title: "Compound age requires movement",
        description: `Trailer ${normalizeTrailerNumber(trailer.trailer_number ?? "") || "unknown"} has had no compound movement for more than 96 hours.`,
        sourceModule: "compound",
        sourceRecordId: trailer.id,
        trailerId: trailer.id,
        trailerNumber: trailer.trailer_number ?? null,
        metadata: buildAlertMetadata({
          trailer_id: trailer.id,
          trailer_number: trailer.trailer_number,
          compound_position: trailer.compound_position,
          arrival_date: trailer.arrival_date,
          entry_timestamp: entryTimestamp,
          last_movement_timestamp: lastMovementTimestamp,
          age_hours: entryAgeHours,
          no_movement_hours: noMovementHours,
          age_threshold_hours: COMPOUND_AGE_WARNING_HOURS,
          no_movement_threshold_hours: COMPOUND_NO_MOVEMENT_HIGH_HOURS,
        }),
      });
    } else if (ageWarning) {
      candidates.push({
        severity: "warning",
        title: "Compound age requires movement",
        description: `Trailer ${normalizeTrailerNumber(trailer.trailer_number ?? "") || "unknown"} has remained in compound for more than 48 hours.`,
        sourceModule: "compound",
        sourceRecordId: trailer.id,
        trailerId: trailer.id,
        trailerNumber: trailer.trailer_number ?? null,
        metadata: buildAlertMetadata({
          trailer_id: trailer.id,
          trailer_number: trailer.trailer_number,
          compound_position: trailer.compound_position,
          arrival_date: trailer.arrival_date,
          entry_timestamp: entryTimestamp,
          last_movement_timestamp: lastMovementTimestamp,
          age_hours: entryAgeHours,
          no_movement_hours: noMovementHours,
          age_threshold_hours: COMPOUND_AGE_WARNING_HOURS,
          no_movement_threshold_hours: COMPOUND_NO_MOVEMENT_HIGH_HOURS,
        }),
      });
    }
  }

  const occupancy = Math.min(100, Math.round((compoundTrailers.length / 50) * 100));
  if (occupancy >= settings.compoundOccupancyCriticalPercent) {
    candidates.push({
      severity: "critical",
      title: "Compound occupancy critical",
      description: `Compound occupancy is at ${occupancy}%.`,
      sourceModule: "compound",
      metadata: buildAlertMetadata({
        occupancy,
        threshold: settings.compoundOccupancyCriticalPercent,
      }),
    });
  } else if (occupancy >= settings.compoundOccupancyWarningPercent) {
    candidates.push({
      severity: "warning",
      title: "Compound occupancy warning",
      description: `Compound occupancy is at ${occupancy}%.`,
      sourceModule: "compound",
      metadata: buildAlertMetadata({
        occupancy,
        threshold: settings.compoundOccupancyWarningPercent,
      }),
    });
  }

  for (const vesselTrailer of data.vesselTrailers) {
    const arrivalTimestamp = vesselTrailer.arrival_confirmed_at ?? vesselTrailer.arrived_at;
    const isPriority = normalizeText(vesselTrailer.priority_level).toLowerCase() === "priority";
    const isArrived = normalizeText(vesselTrailer.arrival_status).toLowerCase() === "arrived" || normalizeText(vesselTrailer.status).toLowerCase() === "arrived";
    const inspectionPending = !vesselTrailer.inspection_completed_at;

    if (isPriority && isArrived && inspectionPending && isTimestampOlderThanMinutes(arrivalTimestamp, settings.priorityInspectionPendingMinutes)) {
      candidates.push({
        severity: "high",
        title: "Priority inspection pending",
        description: `Priority vessel trailer ${vesselTrailer.trailer_number ?? "unknown"} has not completed inspection.`,
        sourceModule: "vessel",
        sourceRecordId: vesselTrailer.id,
        trailerId: vesselTrailer.trailer_id ?? null,
        trailerNumber: vesselTrailer.trailer_number ?? null,
        metadata: buildAlertMetadata({
          vessel_trailer_id: vesselTrailer.id,
          vessel_operation_id: vesselTrailer.vessel_operation_id,
          arrival_timestamp: arrivalTimestamp,
          priority_level: vesselTrailer.priority_level,
          threshold_minutes: settings.priorityInspectionPendingMinutes,
        }),
      });
    }

    if (settings.inspectionMissingPhotosEnabled && vesselTrailer.inspection_completed_at) {
      const hasPhotos = data.photos.some((photo) => photo.vessel_trailer_id === vesselTrailer.id);
      if (!hasPhotos) {
        candidates.push({
          severity: "warning",
          title: "Inspection missing photos",
          description: `Completed inspection for trailer ${vesselTrailer.trailer_number ?? "unknown"} has no linked photos.`,
          sourceModule: "inspection",
          sourceRecordId: vesselTrailer.id,
          trailerId: vesselTrailer.trailer_id ?? null,
          trailerNumber: vesselTrailer.trailer_number ?? null,
          metadata: buildAlertMetadata({
            vessel_trailer_id: vesselTrailer.id,
            vessel_operation_id: vesselTrailer.vessel_operation_id,
          }),
        });
      }
    }
  }

  if (settings.temperatureAlertsEnabled) {
    for (const temperature of data.temperatures.filter((row) => row.is_out_of_range === true)) {
      candidates.push({
        severity: "high",
        title: "Temperature alert",
        description: `Trailer ${temperature.trailer_number ?? "unknown"} has an out-of-range temperature record.`,
        sourceModule: "inspection",
        sourceRecordId: temperature.id,
        trailerId: temperature.trailer_id ?? null,
        trailerNumber: temperature.trailer_number ?? null,
        metadata: buildAlertMetadata({
          temperature_record_id: temperature.id,
          vessel_trailer_id: temperature.vessel_trailer_id,
          recorded_at: temperature.recorded_at,
        }),
      });
    }
  }

  if (settings.stockCheckDiscrepanciesEnabled) {
    for (const item of data.stockCheckItems.filter((row) => {
      const resolution = normalizeText(row.resolution_status).toLowerCase();
      const discrepancyType = normalizeText(row.discrepancy_type).toLowerCase();
      return Boolean(discrepancyType) && resolution !== "resolved";
    })) {
      candidates.push({
        severity: "high",
        title: "Stock check discrepancy",
        description: `Unresolved stock check discrepancy for trailer ${item.trailer_number ?? "unknown"}.`,
        sourceModule: "stock_check",
        sourceRecordId: item.id,
        trailerId: item.trailer_id ?? null,
        trailerNumber: item.trailer_number ?? null,
        metadata: buildAlertMetadata({
          stock_check_item_id: item.id,
          stock_check_id: item.stock_check_id,
          discrepancy_type: item.discrepancy_type,
          resolution_status: item.resolution_status,
          actual_position: item.actual_position,
          expected_position: item.expected_position,
          system_load_status: item.system_load_status,
          system_operational_status: item.system_operational_status,
        }),
      });
    }
  }

  for (const allocation of data.exportAllocations.map((item) => normalizeExportAllocationRecord(item as ExportAllocationRecord))) {
    const status = allocation.status as ExportAllocationStatus;
    const waitingCollection = status === "delivered_empty" || status === "waiting_loading";
    if (!waitingCollection) {
      continue;
    }

    const timestamp = allocation.waiting_loading_at ?? allocation.delivered_empty_at ?? allocation.allocated_at ?? allocation.created_at ?? null;
    if (!isTimestampOlderThanHours(timestamp, settings.exportWaitingCollectionHours)) {
      continue;
    }

    candidates.push({
      severity: "warning",
      title: "Export waiting collection",
      description: `Export allocation for trailer ${allocation.trailer_number ?? "unknown"} has been waiting beyond the configured threshold.`,
      sourceModule: "export",
      sourceRecordId: allocation.id,
      trailerId: allocation.trailer_id ?? null,
      trailerNumber: allocation.trailer_number ?? null,
      metadata: buildAlertMetadata({
        export_allocation_id: allocation.id,
        status: allocation.status,
        timestamp,
        threshold_hours: settings.exportWaitingCollectionHours,
      }),
    });
  }

  return candidates;
};

const loadOperationalAlertSourceData = async (client: SupabaseClient<Database>) => {
  const [
    trailersResult,
    movementActivityResult,
    vesselTrailersResult,
    temperaturesResult,
    photosResult,
    stockCheckItemsResult,
    exportAllocationsResult,
  ] = await Promise.all([
    client
      .from("trailers")
      .select("id, trailer_number, load_status, arrival_date, departure_date, compound_position, operational_status, is_local, customer, load_description, created_at")
      .is("departure_date", null),
    client
      .from("trailer_activity_log")
      .select("trailer_id, normalized_trailer_number, event_type, created_at")
      .in("event_type", ["compound_entered", "compound_position_changed", "arrived", "vessel_arrived"])
      .order("created_at", { ascending: false })
      .limit(5000),
    client
      .from("vessel_operation_trailers")
      .select("id, vessel_operation_id, trailer_id, trailer_number, priority_level, arrival_status, arrived_at, arrival_confirmed_at, inspection_started_at, inspection_completed_at, status, has_damage, has_temperature_alert, temperature_required, created_at")
      .order("created_at", { ascending: false }),
    client
      .from("vessel_inspection_temperatures")
      .select("id, vessel_trailer_id, trailer_id, trailer_number, is_out_of_range, recorded_at")
      .order("recorded_at", { ascending: false }),
    client
      .from("vessel_inspection_photos")
      .select("id, vessel_trailer_id, vessel_operation_id, uploaded_at")
      .order("uploaded_at", { ascending: false }),
    client
      .from("compound_stock_check_items")
      .select("id, stock_check_id, trailer_id, trailer_number, discrepancy_type, resolution_status, system_load_status, system_operational_status, actual_position, expected_position, created_at, updated_at")
      .order("created_at", { ascending: false }),
    client
      .from("export_allocations")
      .select("id, trailer_id, trailer_number, status, expected_return_at, allocated_at, delivered_empty_at, waiting_loading_at, collected_loaded_at, created_at, updated_at")
      .order("created_at", { ascending: false }),
  ]);

  const firstError =
    trailersResult.error
    ?? movementActivityResult.error
    ?? vesselTrailersResult.error
    ?? temperaturesResult.error
    ?? photosResult.error
    ?? stockCheckItemsResult.error
    ?? exportAllocationsResult.error;
  if (firstError) {
    throw new Error(firstError.message || "Unable to load operational alert source data.");
  }

  return {
    trailers: (trailersResult.data ?? []) as TrailerRow[],
    trailerMovementActivity: (movementActivityResult.data ?? []) as TrailerMovementActivityRow[],
    vesselTrailers: (vesselTrailersResult.data ?? []) as VesselTrailerRow[],
    temperatures: (temperaturesResult.data ?? []) as TemperatureRow[],
    photos: (photosResult.data ?? []) as PhotoRow[],
    stockCheckItems: (stockCheckItemsResult.data ?? []) as StockCheckItemRow[],
    exportAllocations: (exportAllocationsResult.data ?? []) as ExportAllocationRow[],
  };
};

export async function runOperationalAlertDetection(
  supabaseClient?: SupabaseClient<Database>,
): Promise<ServiceResult<OperationalAlertDetectionResult>> {
  const client = getClient(supabaseClient);

  const executeDetection = async (): Promise<ServiceResult<OperationalAlertDetectionResult>> => {
    try {
    const settingsResult = await getOperationalAlertSettings(client);
    if (!settingsResult.ok) {
      return { ok: false, error: settingsResult.error };
    }

    const settings = settingsResult.data;
    if (!settings.enabled) {
      const summaryResult = await getOperationalAlertSummary(client);
      return {
        ok: true,
        data: {
          createdCount: 0,
          updatedCount: 0,
          resolvedCount: 0,
          suppressedCount: 0,
          errors: [],
          summary: summaryResult.ok ? summaryResult.data : null,
          alerts: [],
        },
      };
    }

    const sourceData = await loadOperationalAlertSourceData(client);
    const targetCandidates = buildTargetAlerts(settings, sourceData);
    const activeAlertsResult = await getOperationalAlerts({ includeResolved: false, limit: 1000 }, client);
    if (!activeAlertsResult.ok) {
      return { ok: false, error: activeAlertsResult.error };
    }

    const activeAlerts = activeAlertsResult.data;
    const activeMap = activeKeyMap(activeAlerts);
    const targetKeys = new Set(targetCandidates.map(getCandidateKey));
    const summaryResult = await getOperationalAlertSummary(client);

    const errors: string[] = [];
    let createdCount = 0;
    let updatedCount = 0;
    let resolvedCount = 0;
    let suppressedCount = 0;

    for (const activeAlert of activeAlerts) {
      const key = getAlertKey(activeAlert);
      if (targetKeys.has(key)) {
        continue;
      }

      try {
        await resolveOperationalAlert({ operationalAlertId: activeAlert.id, reason: "Condition no longer true." }, client);
        resolvedCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : `Unable to resolve alert ${activeAlert.id}.`;
        console.error("Operational alert resolution failed:", message, error);
        errors.push(message);
      }
    }

    for (const candidate of targetCandidates) {
      try {
        const key = getCandidateKey(candidate);
        const activeRow = activeMap.get(key);
        const result = await createOperationalAlert({
          ...candidate,
          existingAlert: activeRow ?? null,
        }, client);
        if (!result.ok) {
          if (isMissingColumnError(result.error)) {
            return { ok: false, error: result.error };
          }
          errors.push(result.error);
          continue;
        }

        if (result.data.status === "active") {
          activeMap.set(key, result.data);
        }

        if (activeRow) {
          updatedCount += 1;
        } else if (result.data.status === "dismissed") {
          suppressedCount += 1;
        } else {
          createdCount += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : `Unable to create alert ${candidate.title}.`;
        if (isMissingColumnError(message)) {
          return { ok: false, error: message };
        }
        console.error("Operational alert creation failed:", message, error);
        errors.push(message);
      }
    }

    const refreshedAlertsResult = await getOperationalAlerts({ includeResolved: false, limit: 250 }, client);
    if (!refreshedAlertsResult.ok) {
      return { ok: false, error: refreshedAlertsResult.error };
    }

    return {
      ok: true,
      data: {
        createdCount,
        updatedCount,
        resolvedCount,
        suppressedCount,
        errors,
        summary: summaryResult.ok ? summaryResult.data : null,
        alerts: sortActiveAlerts(refreshedAlertsResult.data),
      },
    };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to run operational alert detection.";
      return { ok: false, error: message };
    }
  };

  const shouldCache = !supabaseClient || supabaseClient === supabase;

  if (!shouldCache) {
    return executeDetection();
  }

  if (inFlightOperationalAlertDetectionPromise) {
    return inFlightOperationalAlertDetectionPromise;
  }

  if (
    cachedOperationalAlertDetectionResult &&
    Date.now() - lastOperationalAlertDetectionAt < DETECTION_COOLDOWN_MS
  ) {
    return cachedOperationalAlertDetectionResult;
  }

  inFlightOperationalAlertDetectionPromise = executeDetection()
    .then((result) => {
      cachedOperationalAlertDetectionResult = result;
      lastOperationalAlertDetectionAt = Date.now();
      return result;
    })
    .finally(() => {
      inFlightOperationalAlertDetectionPromise = null;
    });

  return inFlightOperationalAlertDetectionPromise;
}

export const operationalAlertTestUtils = {
  resolveCompoundEntryTimestamp,
  resolveLatestCompoundMovementTimestamp,
  isCompoundMovementEventType,
};
