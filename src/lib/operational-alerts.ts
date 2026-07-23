import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { isExportAllocationOverdue, normalizeExportAllocationRecord, type ExportAllocationRecord, type ExportAllocationStatus } from "@/lib/export-allocation";
import { normalizeTrailerNumber } from "@/lib/compound-stock-check";

export type OperationalAlertRow = Database["public"]["Tables"]["operational_alerts"]["Row"];
export type OperationalAlertSettingsRow = Database["public"]["Tables"]["operational_alert_settings"]["Row"];
export type OperationalAlertSummaryRow = Database["public"]["Views"]["operational_alert_summary"]["Row"];

export type OperationalAlertSeverity = "critical" | "high" | "warning" | "info";
export type OperationalAlertStatus = "active" | "acknowledged" | "resolved" | "dismissed";

type ServiceOk<T> = { ok: true; data: T };
type ServiceErr = { ok: false; error: string; details?: string | null };
type ServiceResult<T> = ServiceOk<T> | ServiceErr;

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
  alertKey: string;
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
  alertKey: string;
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

type ActiveAlertKey = {
  alertKey: string;
  sourceRecordId?: string | null;
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

const ACTIVE_ALERT_STATUSES: OperationalAlertStatus[] = ["active", "acknowledged"];
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
};

const severityOrder: OperationalAlertSeverity[] = ["critical", "high", "warning", "info"];

const getClient = (supabaseClient?: SupabaseClient<Database>) => supabaseClient ?? supabase;

const normalizeText = (value?: string | null) => (value ?? "").trim();

const normalizeAlertStatus = (value?: string | null): OperationalAlertStatus => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "acknowledged" || normalized === "resolved" || normalized === "dismissed") {
    return normalized;
  }

  return "active";
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

const getCandidateKey = (candidate: AlertCandidate) => `${candidate.alertKey}:${candidate.sourceRecordId ?? candidate.trailerId ?? "global"}`;

const getAlertKey = (row: Pick<OperationalAlertRow, "alert_key" | "source_record_id" | "trailer_id">) =>
  `${row.alert_key}:${row.source_record_id ?? row.trailer_id ?? "global"}`;

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

const normalizeSettingsRow = (row: OperationalAlertSettingsRow | null): OperationalAlertSettings => ({
  enabled: toBoolean(row?.enabled ?? null, DEFAULT_SETTINGS.enabled),
  compoundDwellWarningDays: toNumber(
    row?.compound_dwell_warning_days ?? (row as Record<string, unknown> | null)?.["dwell_warning_days"] ?? (row as Record<string, unknown> | null)?.["compound_warning_days"],
    DEFAULT_SETTINGS.compoundDwellWarningDays,
  ),
  compoundDwellCriticalDays: toNumber(
    row?.compound_dwell_critical_days ?? (row as Record<string, unknown> | null)?.["dwell_critical_days"] ?? (row as Record<string, unknown> | null)?.["compound_critical_days"],
    DEFAULT_SETTINGS.compoundDwellCriticalDays,
  ),
  compoundOccupancyWarningPercent: toNumber(
    row?.compound_occupancy_warning_percent ?? (row as Record<string, unknown> | null)?.["occupancy_warning_percent"] ?? (row as Record<string, unknown> | null)?.["occupancy_warning_threshold"],
    DEFAULT_SETTINGS.compoundOccupancyWarningPercent,
  ),
  compoundOccupancyCriticalPercent: toNumber(
    row?.compound_occupancy_critical_percent ?? (row as Record<string, unknown> | null)?.["occupancy_critical_percent"] ?? (row as Record<string, unknown> | null)?.["occupancy_critical_threshold"],
    DEFAULT_SETTINGS.compoundOccupancyCriticalPercent,
  ),
  priorityInspectionPendingMinutes: toNumber(
    row?.priority_inspection_pending_minutes ?? (row as Record<string, unknown> | null)?.["inspection_pending_minutes"] ?? (row as Record<string, unknown> | null)?.["priority_pending_minutes"],
    DEFAULT_SETTINGS.priorityInspectionPendingMinutes,
  ),
  temperatureAlertsEnabled: toBoolean(
    row?.temperature_alerts_enabled ?? (row as Record<string, unknown> | null)?.["temperature_alert_enabled"],
    DEFAULT_SETTINGS.temperatureAlertsEnabled,
  ),
  inspectionMissingPhotosEnabled: toBoolean(
    row?.inspection_missing_photos_enabled,
    DEFAULT_SETTINGS.inspectionMissingPhotosEnabled,
  ),
  stockCheckDiscrepanciesEnabled: toBoolean(
    row?.stock_check_discrepancies_enabled,
    DEFAULT_SETTINGS.stockCheckDiscrepanciesEnabled,
  ),
  exportWaitingCollectionHours: toNumber(
    row?.export_waiting_collection_hours ?? (row as Record<string, unknown> | null)?.["waiting_collection_hours"] ?? (row as Record<string, unknown> | null)?.["export_waiting_hours"],
    DEFAULT_SETTINGS.exportWaitingCollectionHours,
  ),
  raw: row,
});

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

const selectActiveAlerts = async (supabaseClient: SupabaseClient<Database>) => {
  const { data, error } = await supabaseClient
    .from("operational_alerts")
    .select("*")
    .in("status", ACTIVE_ALERT_STATUSES)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message || "Unable to load operational alerts.");
  }

  return ((data ?? []) as OperationalAlertRow[]).map(normalizeAlertRow);
};

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
  } else if (trailerId) {
    query = query.eq("trailer_id", trailerId);
  } else {
    query = query.is("source_record_id", null).is("trailer_id", null);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || "Unable to load existing operational alert.");
  }

  const row = (data ?? [])[0] ?? null;
  return row ? normalizeAlertRow(row as OperationalAlertRow) : null;
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
  const { data, error } = await supabaseClient
    .from("operational_alerts")
    .insert(payload)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Unable to create operational alert.");
  }

  return normalizeAlertRow(data as OperationalAlertRow);
};

export async function getOperationalAlertSettings(
  supabaseClient?: SupabaseClient<Database>,
): Promise<ServiceResult<OperationalAlertSettings>> {
  const client = getClient(supabaseClient);

  try {
    const { data, error } = await client.from("operational_alert_settings").select("*").maybeSingle();
    if (error) {
      return { ok: false, error: error.message || "Unable to load operational alert settings." };
    }

    return { ok: true, data: normalizeSettingsRow((data ?? null) as OperationalAlertSettingsRow | null) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load operational alert settings.";
    return { ok: false, error: message };
  }
}

export async function getOperationalAlertSummary(
  supabaseClient?: SupabaseClient<Database>,
): Promise<ServiceResult<OperationalAlertSummary>> {
  const client = getClient(supabaseClient);

  try {
    const { data, error } = await client.from("operational_alert_summary").select("*").maybeSingle();
    if (error) {
      return { ok: false, error: error.message || "Unable to load operational alert summary." };
    }

    return { ok: true, data: normalizeSummaryRow((data ?? null) as OperationalAlertSummaryRow | null) };
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
  const alertKey = normalizeText(input.alertKey);
  const sourceModule = normalizeText(input.sourceModule);
  const title = normalizeText(input.title);
  const description = normalizeText(input.description);
  const trailerNumber = input.trailerNumber ? normalizeTrailerNumber(input.trailerNumber) : null;
  const status = normalizeAlertStatus(input.status ?? "active");
  const severity = normalizeSeverity(input.severity);

  if (!alertKey) {
    return { ok: false, error: "Alert key is required." };
  }

  if (!sourceModule) {
    return { ok: false, error: "Source module is required." };
  }

  if (!title) {
    return { ok: false, error: "Alert title is required." };
  }

  try {
    const existing = await findLatestAlert(client, alertKey, input.sourceRecordId ?? null, input.trailerId ?? null);

    if (existing?.status === "dismissed") {
      return { ok: true, data: existing };
    }

    if (existing && ACTIVE_ALERT_STATUSES.includes(existing.status as OperationalAlertStatus)) {
      const updated = await updateAlertRow(client, existing.id, {
        severity,
        title,
        description,
        trailer_id: input.trailerId ?? existing.trailer_id,
        trailer_number: trailerNumber ?? existing.trailer_number,
        source_module: sourceModule,
        source_record_id: input.sourceRecordId ?? existing.source_record_id,
        metadata: parseJsonMetadata(input.metadata),
        status: existing.status,
      });

      return { ok: true, data: updated };
    }

    const performedBy = normalizeText(input.performedBy) || (await resolveActorName(client));
    const inserted = await insertAlertRow(client, {
      alert_key: alertKey,
      severity,
      status,
      title,
      description,
      trailer_id: input.trailerId ?? null,
      trailer_number: trailerNumber,
      source_module: sourceModule,
      source_record_id: input.sourceRecordId ?? null,
      metadata: parseJsonMetadata(input.metadata),
      acknowledged_at: null,
      acknowledged_by: null,
      resolved_at: null,
      resolved_by: null,
      dismissed_at: null,
      dismissed_by: null,
      created_at: getNowIso(),
      updated_at: getNowIso(),
    });

    if (performedBy && inserted.status === "active") {
      return { ok: true, data: inserted };
    }

    return { ok: true, data: inserted };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create operational alert.";
    return { ok: false, error: message };
  }
}

const resolveAlertTarget = (candidate: AlertCandidate): ActiveAlertKey => ({
  alertKey: candidate.alertKey,
  sourceRecordId: candidate.sourceRecordId ?? candidate.trailerId ?? null,
});

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

const isTimestampOlderThanDays = (timestamp?: string | null, days = 0) => {
  if (!timestamp) {
    return false;
  }

  const timestampMs = new Date(timestamp).getTime();
  if (Number.isNaN(timestampMs)) {
    return false;
  }

  return Date.now() - timestampMs >= days * 86_400_000;
};

const buildTargetAlerts = (
  settings: OperationalAlertSettings,
  data: {
    trailers: TrailerRow[];
    vesselTrailers: VesselTrailerRow[];
    temperatures: TemperatureRow[];
    photos: PhotoRow[];
    stockCheckItems: StockCheckItemRow[];
    exportAllocations: ExportAllocationRow[];
  },
): AlertCandidate[] => {
  const candidates: AlertCandidate[] = [];

  const compoundTrailers = data.trailers.filter((trailer) => {
    const active = !trailer.departure_date || trailer.departure_date.trim() === "";
    return active && trailer.is_local !== true && Boolean(trailer.compound_position?.trim());
  });

  for (const trailer of compoundTrailers) {
    const dwellTimestamp = trailer.arrival_date ?? trailer.created_at;
    const warningActive = isTimestampOlderThanDays(dwellTimestamp, settings.compoundDwellWarningDays);
    const criticalActive = isTimestampOlderThanDays(dwellTimestamp, settings.compoundDwellCriticalDays);

    if (criticalActive) {
      candidates.push({
        alertKey: `compound_dwell_critical:${trailer.id}`,
        severity: "critical",
        title: "Compound dwell critical",
        description: `Trailer ${normalizeTrailerNumber(trailer.trailer_number ?? "") || "unknown"} has been in compound longer than the critical dwell threshold.`,
        sourceModule: "compound",
        sourceRecordId: trailer.id,
        trailerId: trailer.id,
        trailerNumber: trailer.trailer_number ?? null,
        metadata: buildAlertMetadata({
          trailer_id: trailer.id,
          trailer_number: trailer.trailer_number,
          compound_position: trailer.compound_position,
          arrival_date: trailer.arrival_date,
          dwell_days: settings.compoundDwellCriticalDays,
        }),
      });
    } else if (warningActive) {
      candidates.push({
        alertKey: `compound_dwell_warning:${trailer.id}`,
        severity: "warning",
        title: "Compound dwell warning",
        description: `Trailer ${normalizeTrailerNumber(trailer.trailer_number ?? "") || "unknown"} is approaching the dwell threshold in compound.`,
        sourceModule: "compound",
        sourceRecordId: trailer.id,
        trailerId: trailer.id,
        trailerNumber: trailer.trailer_number ?? null,
        metadata: buildAlertMetadata({
          trailer_id: trailer.id,
          trailer_number: trailer.trailer_number,
          compound_position: trailer.compound_position,
          arrival_date: trailer.arrival_date,
          dwell_days: settings.compoundDwellWarningDays,
        }),
      });
    }
  }

  const occupancy = Math.min(100, Math.round((compoundTrailers.length / 50) * 100));
  if (occupancy >= settings.compoundOccupancyCriticalPercent) {
    candidates.push({
      alertKey: "compound_occupancy_critical",
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
      alertKey: "compound_occupancy_warning",
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
        alertKey: `priority_inspection_pending:${vesselTrailer.id}`,
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
          alertKey: `inspection_missing_photos:${vesselTrailer.id}`,
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
        alertKey: `temperature_alert:${temperature.id}`,
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
        alertKey: `stock_check_discrepancy:${item.id}`,
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
      alertKey: `export_waiting_collection:${allocation.id}`,
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
  const [trailersResult, vesselTrailersResult, temperaturesResult, photosResult, stockCheckItemsResult, exportAllocationsResult] = await Promise.all([
    client
      .from("trailers")
      .select("id, trailer_number, load_status, arrival_date, departure_date, compound_position, operational_status, is_local, customer, load_description, created_at")
      .is("departure_date", null),
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

  const firstError = trailersResult.error ?? vesselTrailersResult.error ?? temperaturesResult.error ?? photosResult.error ?? stockCheckItemsResult.error ?? exportAllocationsResult.error;
  if (firstError) {
    throw new Error(firstError.message || "Unable to load operational alert source data.");
  }

  return {
    trailers: (trailersResult.data ?? []) as TrailerRow[],
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
        const result = await createOperationalAlert(candidate, client);
        if (!result.ok) {
          errors.push(result.error);
          continue;
        }

        const key = getCandidateKey(candidate);
        const activeRow = activeMap.get(key);
        if (activeRow) {
          updatedCount += 1;
        } else if (result.data.status === "dismissed") {
          suppressedCount += 1;
        } else {
          createdCount += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : `Unable to create alert ${candidate.alertKey}.`;
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
}
