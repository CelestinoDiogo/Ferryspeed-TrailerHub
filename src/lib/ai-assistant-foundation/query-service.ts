import "server-only";

import { calculateCollectionAging } from "@/lib/collection-aging";
import type { Database } from "@/lib/database.types";
import { isExportAllocationOverdue, normalizeExportAllocationRecord, type ExportAllocationRecord } from "@/lib/export-allocation";
import { moduleKeys, type PermissionModuleKey } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/rbac/service";
import type { AssistantContext, AssistantIntent, AssistantQueryResult } from "@/lib/ai-assistant-foundation/types";
import { normalizeAssistantTrailerNumber } from "@/lib/ai-assistant-foundation/intent-detection";

type TrailerRow = Database["public"]["Tables"]["trailers"]["Row"];
type VesselTrailerRow = Database["public"]["Tables"]["vessel_operation_trailers"]["Row"];
type VesselOperationRow = Database["public"]["Tables"]["vessel_operations"]["Row"];
type ExportAllocationRow = Database["public"]["Tables"]["export_allocations"]["Row"];
type StockCheckRow = Database["public"]["Tables"]["compound_stock_checks"]["Row"];
type StockCheckItemRow = Database["public"]["Tables"]["compound_stock_check_items"]["Row"];
type AlertRow = Database["public"]["Tables"]["operational_alerts"]["Row"];
type DeliveryBookingRow = Database["public"]["Tables"]["delivery_bookings"]["Row"];
type ActivityRow = Database["public"]["Tables"]["trailer_activity_log"]["Row"];
type InspectionPhotoRow = Database["public"]["Tables"]["vessel_inspection_photos"]["Row"];

const LIST_LIMIT_DEFAULT = 20;
const LIST_LIMIT_MAX = 50;
const COMPOUND_CAPACITY = 50;

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const sanitizeLimit = (value?: number) => {
  if (!value || !Number.isFinite(value)) {
    return LIST_LIMIT_DEFAULT;
  }

  return Math.max(1, Math.min(LIST_LIMIT_MAX, Math.trunc(value)));
};

const toDateKey = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
};

const currentDateKey = (context?: AssistantContext["pageContext"]) => {
  if (context?.currentDate) {
    return context.currentDate;
  }

  return new Date().toISOString().slice(0, 10);
};

const titleCase = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
};

const asResult = (value: Omit<AssistantQueryResult, "sourceModules"> & { sourceModules?: string[] }): AssistantQueryResult => {
  return {
    ...value,
    sourceModules: value.sourceModules ?? [],
  };
};

const noResults = (
  intent: AssistantIntent["intent"],
  title: string,
  summary: string,
  sourceModules: string[],
  actions: AssistantQueryResult["actions"] = [],
): AssistantQueryResult => {
  return asResult({ intent, title, summary, count: 0, items: [], actions, sourceModules });
};

const permissionDeniedResult = (intent: AssistantIntent["intent"], moduleKey: PermissionModuleKey): AssistantQueryResult => {
  return asResult({
    intent,
    title: "Access denied",
    summary: `You do not have permission to access ${moduleKey.replace(/_/g, " ")} data.`,
    count: 0,
    items: [],
    actions: [],
    sourceModules: [moduleKey],
  });
};

class PermissionGate {
  private readonly cache = new Map<string, boolean>();

  constructor(private readonly context: AssistantContext) {}

  async can(moduleKey: PermissionModuleKey) {
    const cacheKey = `${moduleKey}:view`;
    const cached = this.cache.get(cacheKey);
    if (typeof cached === "boolean") {
      return cached;
    }

    const allowed = await requirePermission(this.context.supabase, this.context.userId, moduleKey, "view");
    this.cache.set(cacheKey, allowed);
    return allowed;
  }

  async firstDenied(...moduleKeysRequired: PermissionModuleKey[]) {
    for (const moduleKey of moduleKeysRequired) {
      if (!(await this.can(moduleKey))) {
        return moduleKey;
      }
    }

    return null;
  }
}

const findTrailerMatches = async (context: AssistantContext, trailerNumber: string, limit: number) => {
  const normalizedInput = normalizeAssistantTrailerNumber(trailerNumber);
  const parts = normalizedInput.match(/^([A-Z]{2,5})(\d{1,6})$/);

  const patterns = new Set<string>([normalizedInput]);
  if (parts) {
    patterns.add(`${parts[1]} ${parts[2]}`);
    patterns.add(`${parts[1]}-${parts[2]}`);
    patterns.add(`${parts[1]}%${parts[2]}`);
  }

  const queries = await Promise.all(
    Array.from(patterns).map((pattern) =>
      context.supabase
        .from("trailers")
        .select("id, trailer_number, customer, load_status, operational_status, compound_position, arrival_date, departure_date")
        .ilike("trailer_number", pattern)
        .order("arrival_date", { ascending: false })
        .limit(limit),
    ),
  );

  const rows: TrailerRow[] = [];
  for (const query of queries) {
    if (query.error) {
      throw query.error;
    }

    rows.push(...((query.data ?? []) as TrailerRow[]));
  }

  const dedupe = new Map<string, TrailerRow>();
  rows.forEach((row) => {
    if (!row.id || dedupe.has(row.id)) {
      return;
    }

    dedupe.set(row.id, row);
  });

  const exactMatches = Array.from(dedupe.values()).filter(
    (row) => normalizeAssistantTrailerNumber(row.trailer_number) === normalizedInput,
  );

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  return Array.from(dedupe.values()).filter((row) =>
    normalizeAssistantTrailerNumber(row.trailer_number).startsWith(normalizedInput),
  );
};

const buildTrailerItem = (trailer: TrailerRow) => ({
  trailerId: trailer.id,
  trailerNumber: trailer.trailer_number ?? "Unknown",
  status: trailer.operational_status ?? trailer.load_status ?? "Unknown",
  customer: trailer.customer ?? undefined,
  compoundPosition: trailer.compound_position ?? undefined,
  detail: [trailer.load_status ? `Load ${titleCase(trailer.load_status)}` : null, trailer.departure_date ? "Departed" : "Active"].filter(Boolean).join(" · "),
  route: `/dashboard/trailers/${trailer.id}`,
});

const queryTrailerWaitingReasons = async (context: AssistantContext, trailer: TrailerRow) => {
  const reasons: string[] = [];

  const [deliveryResult, exportResult, vesselResult] = await Promise.all([
    context.supabase
      .from("delivery_bookings")
      .select("id, status, waiting_collection_since, collection_due_date")
      .eq("trailer_id", trailer.id)
      .eq("status", "waiting_collection")
      .order("waiting_collection_since", { ascending: true })
      .limit(1)
      .maybeSingle(),
    context.supabase
      .from("export_allocations")
      .select("status, expected_return_at, collection_date")
      .eq("trailer_id", trailer.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    context.supabase
      .from("vessel_operation_trailers")
      .select("arrival_status, status, inspection_started_at, inspection_completed_at")
      .eq("trailer_id", trailer.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!deliveryResult.error && deliveryResult.data) {
    const waiting = deliveryResult.data as DeliveryBookingRow;
    const aging = calculateCollectionAging(waiting);
    reasons.push(`Waiting collection (${aging.overdueDays} day(s) overdue).`);
  }

  if (!exportResult.error && exportResult.data) {
    const exportRow = normalizeExportAllocationRecord(exportResult.data as unknown as ExportAllocationRecord);
    reasons.push(`Export status is ${titleCase(exportRow.status)}.`);
    if (isExportAllocationOverdue(exportRow)) {
      reasons.push("Export return window is overdue.");
    }
  }

  if (!vesselResult.error && vesselResult.data) {
    const vesselRow = vesselResult.data as VesselTrailerRow;
    if (normalizeText(vesselRow.arrival_status) === "arrived" && !vesselRow.inspection_completed_at) {
      reasons.push("Inspection is still pending after arrival.");
    }
  }

  if (!trailer.compound_position && !trailer.departure_date) {
    reasons.push("Compound position is not assigned.");
  }

  if (reasons.length === 0) {
    reasons.push("No blocking operational condition was detected from current records.");
  }

  return reasons;
};

const queryFindTrailer = async (context: AssistantContext, gate: PermissionGate, intent: Extract<AssistantIntent, { intent: "find_trailer" | "trailer_current_status" | "trailer_location" }>) => {
  const denied = await gate.firstDenied("arrivals");
  if (denied) {
    return permissionDeniedResult(intent.intent, denied);
  }

  const matches = await findTrailerMatches(context, intent.trailerNumber, sanitizeLimit(intent.limit) + 10);

  if (matches.length === 0) {
    return noResults(
      intent.intent,
      `Trailer ${intent.trailerNumber}`,
      `No trailer record was found for ${intent.trailerNumber}.`,
      ["trailers"],
      [{ label: "Open Trailer Search", route: "/dashboard/search" }],
    );
  }

  if (matches.length > 1 && intent.intent === "find_trailer") {
    const items = matches.slice(0, sanitizeLimit(intent.limit)).map(buildTrailerItem);
    return asResult({
      intent: "find_trailer",
      title: `Multiple trailers match ${intent.trailerNumber}`,
      summary: "More than one trailer matches this number pattern. Use the exact trailer number.",
      count: matches.length,
      items,
      actions: [{ label: "Open Trailer Search", route: "/dashboard/search" }],
      sourceModules: ["trailers"],
    });
  }

  const trailer = matches[0];
  const wantsExplanation = /\bwhy\b|\bexplain\b/.test(normalizeText(context.question));
  const waitingReasons = wantsExplanation ? await queryTrailerWaitingReasons(context, trailer) : [];

  if (intent.intent === "trailer_location") {
    const location = trailer.departure_date
      ? "Outside compound"
      : trailer.compound_position
        ? `Compound ${trailer.compound_position}`
        : "Location not assigned";

    return asResult({
      intent: "trailer_location",
      title: `Location: ${trailer.trailer_number ?? intent.trailerNumber}`,
      summary: `${trailer.trailer_number ?? intent.trailerNumber} is currently in ${location}.`,
      count: 1,
      items: [
        {
          ...buildTrailerItem(trailer),
          detail: [location, ...waitingReasons].join(" "),
        },
      ],
      actions: [
        { label: "Open trailer", route: `/dashboard/trailers/${trailer.id}` },
        { label: "View history", route: "/dashboard/trailer-timeline", filter: { trailer: trailer.trailer_number ?? "" } },
      ],
      sourceModules: ["trailers"],
    });
  }

  return asResult({
    intent: intent.intent === "find_trailer" ? "find_trailer" : "trailer_current_status",
    title: `Trailer ${trailer.trailer_number ?? intent.trailerNumber}`,
    summary: `${trailer.trailer_number ?? intent.trailerNumber} is ${titleCase(trailer.operational_status ?? trailer.load_status)}${
      trailer.compound_position ? ` at ${trailer.compound_position}` : ""
    }${waitingReasons.length > 0 ? ` ${waitingReasons.join(" ")}` : "."}`,
    count: 1,
    items: [buildTrailerItem(trailer)],
    actions: [
      { label: "Open trailer", route: `/dashboard/trailers/${trailer.id}` },
      { label: "View history", route: "/dashboard/trailer-timeline", filter: { trailer: trailer.trailer_number ?? "" } },
    ],
    sourceModules: ["trailers"],
  });
};

const queryWaitingCompound = async (context: AssistantContext, gate: PermissionGate, limit: number) => {
  const denied = await gate.firstDenied("compound");
  if (denied) {
    return permissionDeniedResult("list_waiting_compound", denied);
  }

  const { data, error } = await context.supabase
    .from("trailers")
    .select("id, trailer_number, customer, load_status, operational_status, compound_position, arrival_date, departure_date, is_local")
    .is("departure_date", null)
    .order("arrival_date", { ascending: true })
    .limit(700);

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as TrailerRow[]).filter((row) => {
    if (row.is_local === true) {
      return false;
    }

    const operational = normalizeText(row.operational_status);
    return !row.compound_position || operational.includes("waiting") || operational.includes("hold");
  });

  const items = rows.slice(0, limit).map((row) => ({
    trailerId: row.id,
    trailerNumber: row.trailer_number ?? "Unknown",
    status: titleCase(row.operational_status ?? row.load_status),
    customer: row.customer ?? undefined,
    compoundPosition: row.compound_position ?? undefined,
    detail: row.compound_position ? "Waiting operational progression." : "Waiting for compound position.",
    route: `/dashboard/trailers/${row.id}`,
  }));

  if (items.length === 0) {
    return noResults(
      "list_waiting_compound",
      "Waiting trailers",
      "No trailers are currently waiting for compound position or progression.",
      ["trailers"],
      [{ label: "Open Compound", route: "/dashboard/compound" }],
    );
  }

  return asResult({
    intent: "list_waiting_compound",
    title: "Waiting trailers",
    summary: `${rows.length} trailer${rows.length === 1 ? "" : "s"} currently waiting in the operational flow.`,
    count: rows.length,
    items,
    actions: [{ label: "Open Compound", route: "/dashboard/compound" }],
    sourceModules: ["trailers"],
  });
};

const queryArrivalsToday = async (context: AssistantContext, gate: PermissionGate, limit: number) => {
  const denied = await gate.firstDenied("arrivals");
  if (denied) {
    return permissionDeniedResult("arrivals_today", denied);
  }

  const today = currentDateKey(context.pageContext);
  const { data, error } = await context.supabase
    .from("trailers")
    .select("id, trailer_number, customer, operational_status, load_status, compound_position, arrival_date, departure_date")
    .is("departure_date", null)
    .order("arrival_date", { ascending: false })
    .limit(800);

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as TrailerRow[]).filter((row) => toDateKey(row.arrival_date) === today);
  const items = rows.slice(0, limit).map((row) => ({
    trailerId: row.id,
    trailerNumber: row.trailer_number ?? "Unknown",
    status: titleCase(row.operational_status ?? "arrived"),
    customer: row.customer ?? undefined,
    compoundPosition: row.compound_position ?? undefined,
    detail: row.arrival_date ? `Arrived ${new Date(row.arrival_date).toLocaleString("en-GB")}` : "Arrived today",
    route: `/dashboard/trailers/${row.id}`,
  }));

  if (items.length === 0) {
    return noResults("arrivals_today", "Arrivals today", "No arrivals were recorded today.", ["trailers"], [{ label: "Open Arrivals", route: "/dashboard/new-arrival" }]);
  }

  return asResult({
    intent: "arrivals_today",
    title: "Arrivals today",
    summary: `${rows.length} trailer${rows.length === 1 ? "" : "s"} arrived today.`,
    count: rows.length,
    items,
    actions: [{ label: "Open Arrivals", route: "/dashboard/new-arrival" }],
    sourceModules: ["trailers"],
  });
};

const queryTrailersByCustomer = async (context: AssistantContext, gate: PermissionGate, customer: string, limit: number) => {
  const denied = await gate.firstDenied("arrivals");
  if (denied) {
    return permissionDeniedResult("trailers_by_customer", denied);
  }

  const { data, error } = await context.supabase
    .from("trailers")
    .select("id, trailer_number, customer, load_status, operational_status, compound_position, arrival_date, departure_date")
    .ilike("customer", `%${customer}%`)
    .order("arrival_date", { ascending: false })
    .limit(limit + 10);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as TrailerRow[];
  const items = rows.slice(0, limit).map(buildTrailerItem);

  if (items.length === 0) {
    return noResults("trailers_by_customer", `Customer: ${customer}`, `No trailers were found for customer ${customer}.`, ["trailers"], [{ label: "Open Trailer Search", route: "/dashboard/search" }]);
  }

  return asResult({
    intent: "trailers_by_customer",
    title: `Customer: ${customer}`,
    summary: `${rows.length} trailer${rows.length === 1 ? "" : "s"} found for customer ${customer}.`,
    count: rows.length,
    items,
    actions: [{ label: "Open Trailer Search", route: "/dashboard/search" }],
    sourceModules: ["trailers"],
  });
};

const queryDamageAlerts = async (context: AssistantContext, gate: PermissionGate, limit: number) => {
  const denied = await gate.firstDenied("vessel_operations");
  if (denied) {
    return permissionDeniedResult("trailers_with_damage", denied);
  }

  const { data, error } = await context.supabase
    .from("vessel_operation_trailers")
    .select("id, vessel_operation_id, trailer_id, trailer_number, customer, status, arrival_status, has_damage, inspection_started_at, inspection_completed_at")
    .eq("has_damage", true)
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as VesselTrailerRow[];
  const items = rows.slice(0, limit).map((row) => ({
    trailerId: row.trailer_id ?? undefined,
    trailerNumber: row.trailer_number ?? "Unknown",
    status: "Damage alert",
    customer: row.customer ?? undefined,
    detail: [titleCase(row.arrival_status), row.inspection_completed_at ? "Inspection complete" : "Inspection pending"].filter(Boolean).join(" · "),
    route: `/dashboard/vessel-operations/${row.vessel_operation_id}`,
  }));

  if (items.length === 0) {
    return noResults("trailers_with_damage", "Damaged trailers", "No damaged trailers were found.", ["vessel_operation_trailers"], [{ label: "Open Vessel Operations", route: "/dashboard/vessel-operations" }]);
  }

  return asResult({
    intent: "trailers_with_damage",
    title: "Damaged trailers",
    summary: `${rows.length} trailer${rows.length === 1 ? "" : "s"} currently flagged with damage.`,
    count: rows.length,
    items,
    actions: [{ label: "Open Vessel Operations", route: "/dashboard/vessel-operations" }],
    sourceModules: ["vessel_operation_trailers"],
  });
};

const queryVesselOperationsToday = async (context: AssistantContext, gate: PermissionGate, limit: number) => {
  const denied = await gate.firstDenied("vessel_operations");
  if (denied) {
    return permissionDeniedResult("vessel_operations_today", denied);
  }

  const today = currentDateKey(context.pageContext);
  const { data, error } = await context.supabase
    .from("vessel_operations")
    .select("id, vessel_name, sailing_reference, status, expected_arrival_at, actual_arrival_at")
    .order("expected_arrival_at", { ascending: true, nullsFirst: false })
    .limit(200);

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as VesselOperationRow[]).filter((row) => {
    return toDateKey(row.expected_arrival_at) === today || toDateKey(row.actual_arrival_at) === today;
  });

  const items = rows.slice(0, limit).map((row) => ({
    trailerNumber: row.vessel_name ?? "Vessel",
    status: titleCase(row.status),
    detail: row.sailing_reference ? `Sailing ${row.sailing_reference}` : "No sailing reference",
    route: `/dashboard/vessel-operations/${row.id}`,
  }));

  if (items.length === 0) {
    return noResults("vessel_operations_today", "Vessel operations today", "No vessel operations were scheduled for today.", ["vessel_operations"], [{ label: "Open Vessel Operations", route: "/dashboard/vessel-operations" }]);
  }

  return asResult({
    intent: "vessel_operations_today",
    title: "Vessel operations today",
    summary: `${rows.length} vessel operation${rows.length === 1 ? "" : "s"} scheduled today.`,
    count: rows.length,
    items,
    actions: [{ label: "Open Vessel Operations", route: "/dashboard/vessel-operations" }],
    sourceModules: ["vessel_operations"],
  });
};

const queryActivityTimelineSnapshot = async (context: AssistantContext, limit: number) => {
  const { data, error } = await context.supabase
    .from("trailer_activity_log")
    .select("id, trailer_id, trailer_number, event_type, event_title, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return { count: 0, items: [] as ActivityRow[] };
  }

  return { count: (data ?? []).length, items: (data ?? []) as ActivityRow[] };
};

const queryVesselTrailerList = async (
  context: AssistantContext,
  gate: PermissionGate,
  intentName:
    | "list_expected_trailers"
    | "list_arrived_trailers"
    | "list_pending_inspections"
    | "list_inspections_in_progress"
    | "list_completed_inspections"
    | "list_priority_trailers"
    | "list_temperature_alerts"
    | "list_missing_photos",
  options?: { priorityOnly?: boolean; vesselOperationId?: string; limit?: number },
): Promise<AssistantQueryResult> => {
  const denied = await gate.firstDenied("vessel_operations");
  if (denied) {
    return permissionDeniedResult(intentName, denied);
  }

  const limit = sanitizeLimit(options?.limit);

  const baseQuery = context.supabase
    .from("vessel_operation_trailers")
    .select(
      "id, vessel_operation_id, trailer_id, trailer_number, customer, priority_level, arrival_status, status, inspection_started_at, inspection_completed_at, has_temperature_alert",
    )
    .order("created_at", { ascending: false })
    .limit(500);

  const scopedQuery = options?.vesselOperationId
    ? baseQuery.eq("vessel_operation_id", options.vesselOperationId)
    : baseQuery;

  const { data, error } = await scopedQuery;
  if (error) {
    throw error;
  }

  let rows = (data ?? []) as VesselTrailerRow[];

  if (options?.priorityOnly) {
    rows = rows.filter((row) => normalizeText(row.priority_level) === "priority");
  }

  if (intentName === "list_expected_trailers") {
    rows = rows.filter((row) => ["expected", "available_for_arrival"].includes(normalizeText(row.arrival_status)));
  }

  if (intentName === "list_arrived_trailers") {
    rows = rows.filter((row) => normalizeText(row.arrival_status) === "arrived");
  }

  if (intentName === "list_pending_inspections") {
    rows = rows.filter((row) => normalizeText(row.arrival_status) === "arrived" && !row.inspection_started_at && !row.inspection_completed_at);
  }

  if (intentName === "list_inspections_in_progress") {
    rows = rows.filter((row) => Boolean(row.inspection_started_at) && !row.inspection_completed_at);
  }

  if (intentName === "list_completed_inspections") {
    rows = rows.filter((row) => Boolean(row.inspection_completed_at) || normalizeText(row.status) === "inspected");
  }

  if (intentName === "list_priority_trailers") {
    rows = rows.filter((row) => normalizeText(row.priority_level) === "priority");
  }

  if (intentName === "list_temperature_alerts") {
    rows = rows.filter((row) => row.has_temperature_alert === true);
  }

  if (intentName === "list_missing_photos") {
    const inspectedRows = rows.filter((row) => Boolean(row.inspection_completed_at) || normalizeText(row.status) === "inspected");
    const vesselTrailerIds = inspectedRows.map((row) => row.id);

    if (vesselTrailerIds.length === 0) {
      return noResults(
        intentName,
        "Missing inspection photos",
        "No inspected trailers were found for photo verification.",
        ["vessel_operation_trailers", "vessel_inspection_photos"],
      );
    }

    const { data: photoData, error: photoError } = await context.supabase
      .from("vessel_inspection_photos")
      .select("vessel_trailer_id")
      .in("vessel_trailer_id", vesselTrailerIds)
      .limit(2000);

    if (photoError) {
      throw photoError;
    }

    const withPhotos = new Set(((photoData ?? []) as InspectionPhotoRow[]).map((row) => row.vessel_trailer_id).filter(Boolean));
    rows = inspectedRows.filter((row) => !withPhotos.has(row.id));
  }

  const items = rows.slice(0, limit).map((row) => ({
    trailerId: row.trailer_id ?? undefined,
    trailerNumber: row.trailer_number ?? "Unknown",
    status: titleCase(row.arrival_status || row.status),
    customer: row.customer ?? undefined,
    detail: [
      row.priority_level ? `Priority ${titleCase(row.priority_level)}` : null,
      row.inspection_completed_at ? "Inspection complete" : row.inspection_started_at ? "Inspection in progress" : "Inspection pending",
    ]
      .filter(Boolean)
      .join(" · "),
    route: `/dashboard/vessel-operations/${row.vessel_operation_id}`,
  }));

  if (items.length === 0) {
    return noResults(
      intentName,
      titleCase(intentName),
      "No matching vessel-operation trailers were found.",
      ["vessel_operation_trailers"],
      [{ label: "Open Vessel Operations", route: "/dashboard/vessel-operations" }],
    );
  }

  return asResult({
    intent: intentName,
    title: titleCase(intentName),
    summary: `${items.length} matching trailer${items.length === 1 ? "" : "s"} found.`,
    count: rows.length,
    items,
    actions: [{ label: "Open Vessel Operations", route: "/dashboard/vessel-operations" }],
    sourceModules: intentName === "list_missing_photos" ? ["vessel_operation_trailers", "vessel_inspection_photos"] : ["vessel_operation_trailers"],
  });
};

const queryCompoundList = async (
  context: AssistantContext,
  gate: PermissionGate,
  intentName:
    | "compound_empty_trailers"
    | "compound_loaded_trailers"
    | "compound_available_trailers"
    | "compound_long_dwell"
    | "compound_free_positions"
    | "compound_summary",
  options?: { minHours?: number; limit?: number },
): Promise<AssistantQueryResult> => {
  const denied = await gate.firstDenied("compound");
  if (denied) {
    return permissionDeniedResult(intentName, denied);
  }

  const limit = sanitizeLimit(options?.limit);
  const { data, error } = await context.supabase
    .from("trailers")
    .select("id, trailer_number, customer, load_status, operational_status, compound_position, arrival_date, departure_date, is_local")
    .is("departure_date", null)
    .order("arrival_date", { ascending: true })
    .limit(600);

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as TrailerRow[]).filter((row) => row.is_local !== true && Boolean(row.compound_position));

  if (intentName === "compound_summary") {
    const occupied = rows.length;
    const free = Math.max(COMPOUND_CAPACITY - occupied, 0);
    const occupancy = Math.round((occupied / COMPOUND_CAPACITY) * 100);

    return asResult({
      intent: "compound_summary",
      title: "Compound occupancy summary",
      summary: `Compound occupancy is ${occupied}/${COMPOUND_CAPACITY} (${occupancy}%). ${free} positions are currently free.`,
      count: occupied,
      items: [
        { trailerNumber: "COMPOUND", status: `${occupancy}% occupied`, detail: `${occupied} occupied · ${free} free` },
      ],
      actions: [{ label: "Open Compound", route: "/dashboard/compound" }],
      sourceModules: ["trailers"],
    });
  }

  if (intentName === "compound_free_positions") {
    const occupied = new Set(rows.map((row) => normalizeText(row.compound_position)));
    const freePositions: string[] = [];
    for (let i = 1; i <= COMPOUND_CAPACITY; i += 1) {
      const candidate = `p${i.toString().padStart(2, "0")}`;
      if (!occupied.has(candidate)) {
        freePositions.push(candidate.toUpperCase());
      }
    }

    return asResult({
      intent: "compound_free_positions",
      title: "Compound free positions",
      summary: `${freePositions.length} positions are currently free.`,
      count: freePositions.length,
      items: freePositions.slice(0, limit).map((position) => ({ trailerNumber: position, status: "Free" })),
      actions: [{ label: "Open Compound", route: "/dashboard/compound" }],
      sourceModules: ["trailers"],
    });
  }

  let filtered = rows;

  if (intentName === "compound_empty_trailers") {
    filtered = rows.filter((row) => normalizeText(row.load_status).includes("empty"));
  }

  if (intentName === "compound_loaded_trailers") {
    filtered = rows.filter((row) => normalizeText(row.load_status).includes("loaded"));
  }

  if (intentName === "compound_available_trailers") {
    filtered = rows.filter((row) => normalizeText(row.load_status).includes("available"));
  }

  if (intentName === "compound_long_dwell") {
    const minHours = Math.max(1, options?.minHours ?? 48);
    filtered = rows.filter((row) => {
      if (!row.arrival_date) {
        return false;
      }

      const arrivedAt = new Date(row.arrival_date).getTime();
      if (!Number.isFinite(arrivedAt)) {
        return false;
      }

      const ageHours = (Date.now() - arrivedAt) / 3_600_000;
      return ageHours >= minHours;
    });
  }

  const items = filtered.slice(0, limit).map((row) => ({
    trailerId: row.id,
    trailerNumber: row.trailer_number ?? "Unknown",
    status: titleCase(row.load_status),
    customer: row.customer ?? undefined,
    compoundPosition: row.compound_position ?? undefined,
    detail: row.arrival_date ? `Arrived ${new Date(row.arrival_date).toLocaleString("en-GB")}` : undefined,
    route: `/dashboard/trailers/${row.id}`,
  }));

  if (items.length === 0) {
    return noResults(
      intentName,
      titleCase(intentName),
      "No matching compound trailers were found.",
      ["trailers"],
      [{ label: "Open Compound", route: "/dashboard/compound" }],
    );
  }

  return asResult({
    intent: intentName,
    title: titleCase(intentName),
    summary: `${filtered.length} matching trailer${filtered.length === 1 ? "" : "s"} found in compound.`,
    count: filtered.length,
    items,
    actions: [{ label: "Open Compound", route: "/dashboard/compound" }],
    sourceModules: ["trailers"],
  });
};

const queryExportList = async (
  context: AssistantContext,
  gate: PermissionGate,
  intentName: "export_allocated" | "export_waiting_loading" | "export_waiting_collection" | "export_overdue",
  options?: { limit?: number },
): Promise<AssistantQueryResult> => {
  const denied = await gate.firstDenied("export_operations");
  if (denied) {
    return permissionDeniedResult(intentName, denied);
  }

  const limit = sanitizeLimit(options?.limit);
  const { data, error } = await context.supabase
    .from("export_allocations")
    .select("id, trailer_id, trailer_number, customer, status, collection_date, expected_return_at, delivered_empty_at, waiting_loading_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error) {
    throw error;
  }

  let rows = ((data ?? []) as ExportAllocationRow[]).map((row) => normalizeExportAllocationRecord(row as unknown as ExportAllocationRecord));

  if (intentName === "export_allocated") {
    rows = rows.filter((row) => row.status === "allocated");
  }

  if (intentName === "export_waiting_loading") {
    rows = rows.filter((row) => row.status === "waiting_loading");
  }

  if (intentName === "export_waiting_collection") {
    rows = rows.filter((row) => row.status === "delivered_empty");
  }

  if (intentName === "export_overdue") {
    rows = rows.filter((row) => {
      if (!row.expected_return_at) {
        return false;
      }

      const expected = new Date(row.expected_return_at).getTime();
      return Number.isFinite(expected) && expected < Date.now() && row.status !== "completed" && row.status !== "cancelled";
    });
  }

  const items = rows.slice(0, limit).map((row) => ({
    trailerId: row.trailer_id ?? undefined,
    trailerNumber: row.trailer_number ?? "Unknown",
    status: titleCase(row.status),
    customer: row.customer ?? undefined,
    detail: row.collection_date ? `Collection ${row.collection_date}` : row.expected_return_at ? `Expected return ${row.expected_return_at}` : undefined,
    route: `/dashboard/export-operations/${row.id}`,
  }));

  if (items.length === 0) {
    return noResults(
      intentName,
      titleCase(intentName),
      "No matching export operations were found.",
      ["export_allocations"],
      [{ label: "Open Export Operations", route: "/dashboard/export-operations" }],
    );
  }

  return asResult({
    intent: intentName,
    title: titleCase(intentName),
    summary: `${rows.length} matching export operation${rows.length === 1 ? "" : "s"} found.`,
    count: rows.length,
    items,
    actions: [{ label: "Open Export Operations", route: "/dashboard/export-operations" }],
    sourceModules: ["export_allocations"],
  });
};

const queryDeparturesToday = async (context: AssistantContext, gate: PermissionGate, limit: number) => {
  const denied = await gate.firstDenied("departures");
  if (denied) {
    return permissionDeniedResult("departures_today", denied);
  }

  const today = currentDateKey(context.pageContext);
  const { data, error } = await context.supabase
    .from("trailers")
    .select("id, trailer_number, customer, load_status, operational_status, departure_date")
    .eq("departure_date", today)
    .order("trailer_number", { ascending: true })
    .limit(limit + 5);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as TrailerRow[];
  const items = rows.slice(0, limit).map((row) => ({
    trailerId: row.id,
    trailerNumber: row.trailer_number ?? "Unknown",
    status: titleCase(row.operational_status ?? "departed"),
    customer: row.customer ?? undefined,
    detail: row.departure_date ? `Departed ${row.departure_date}` : undefined,
    route: `/dashboard/trailers/${row.id}`,
  }));

  if (items.length === 0) {
    return noResults(
      "departures_today",
      "Departures today",
      "No trailers departed today.",
      ["trailers"],
      [{ label: "Open Departures", route: "/dashboard/departure" }],
    );
  }

  return asResult({
    intent: "departures_today",
    title: "Departures today",
    summary: `${rows.length} trailer${rows.length === 1 ? "" : "s"} departed today.`,
    count: rows.length,
    items,
    actions: [{ label: "Open Departures", route: "/dashboard/departure" }],
    sourceModules: ["trailers"],
  });
};

const queryDeparturesByCustomer = async (context: AssistantContext, gate: PermissionGate, customer: string, limit: number) => {
  const denied = await gate.firstDenied("departures");
  if (denied) {
    return permissionDeniedResult("departures_by_customer", denied);
  }

  const today = currentDateKey(context.pageContext);
  const { data, error } = await context.supabase
    .from("trailers")
    .select("id, trailer_number, customer, operational_status, departure_date")
    .eq("departure_date", today)
    .ilike("customer", `%${customer}%`)
    .order("trailer_number", { ascending: true })
    .limit(limit + 5);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as TrailerRow[];
  const items = rows.slice(0, limit).map((row) => ({
    trailerId: row.id,
    trailerNumber: row.trailer_number ?? "Unknown",
    status: titleCase(row.operational_status ?? "departed"),
    customer: row.customer ?? undefined,
    detail: `Departed ${row.departure_date ?? today}`,
    route: `/dashboard/trailers/${row.id}`,
  }));

  if (items.length === 0) {
    return noResults(
      "departures_by_customer",
      `Departures: ${customer}`,
      `No departures were found today for customer ${customer}.`,
      ["trailers"],
      [{ label: "Open Departures", route: "/dashboard/departure" }],
    );
  }

  return asResult({
    intent: "departures_by_customer",
    title: `Departures: ${customer}`,
    summary: `${rows.length} departure${rows.length === 1 ? "" : "s"} found for customer ${customer} today.`,
    count: rows.length,
    items,
    actions: [{ label: "Open Departures", route: "/dashboard/departure" }],
    sourceModules: ["trailers"],
  });
};

const queryUnresolvedAlerts = async (context: AssistantContext, gate: PermissionGate, limit: number) => {
  const denied = await gate.firstDenied("dashboard");
  if (denied) {
    return permissionDeniedResult("unresolved_operational_alerts", denied);
  }

  const { data, error } = await context.supabase
    .from("operational_alerts")
    .select("id, trailer_id, trailer_number, severity, status, title, source_module")
    .in("status", ["active"])
    .order("created_at", { ascending: false })
    .limit(limit + 10);

  if (error) {
    console.error("[operational_alerts]", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    });
    throw error;
  }

  const rows = (data ?? []) as AlertRow[];
  const items = rows.slice(0, limit).map((row) => ({
    trailerId: row.trailer_id ?? undefined,
    trailerNumber: row.trailer_number ?? "Unlinked",
    status: `${titleCase(row.severity)} · ${titleCase(row.status)}`,
    detail: `${row.title}${row.source_module ? ` (${titleCase(row.source_module)})` : ""}`,
    route: row.trailer_id ? `/dashboard/trailers/${row.trailer_id}` : "/dashboard/operations-command-centre",
  }));

  if (items.length === 0) {
    return noResults(
      "unresolved_operational_alerts",
      "Unresolved operational alerts",
      "No unresolved operational alerts were found.",
      ["operational_alerts"],
      [{ label: "Open Exceptions", route: "/dashboard/operations-command-centre" }],
    );
  }

  return asResult({
    intent: "unresolved_operational_alerts",
    title: "Unresolved operational alerts",
    summary: `${rows.length} unresolved operational alert${rows.length === 1 ? "" : "s"} found.`,
    count: rows.length,
    items,
    actions: [{ label: "Open Exceptions", route: "/dashboard/operations-command-centre" }],
    sourceModules: ["operational_alerts"],
  });
};

const queryStockCheckDiscrepancies = async (context: AssistantContext, gate: PermissionGate, limit: number) => {
  const denied = await gate.firstDenied("stock_check", "reconciliation");
  if (denied) {
    return permissionDeniedResult("stock_check_discrepancies", denied);
  }

  const { data: stockCheckData, error: stockCheckError } = await context.supabase
    .from("compound_stock_checks")
    .select("id, started_at")
    .in("status", ["in_progress", "completed"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (stockCheckError) {
    throw stockCheckError;
  }

  const latest = stockCheckData as StockCheckRow | null;
  if (!latest?.id) {
    return noResults(
      "stock_check_discrepancies",
      "Stock check discrepancies",
      "No stock check session is available yet.",
      ["compound_stock_checks", "compound_stock_check_items"],
      [{ label: "Open Stock Check", route: "/dashboard/compound/stock-check" }],
    );
  }

  const { data, error } = await context.supabase
    .from("compound_stock_check_items")
    .select("id, trailer_id, trailer_number, discrepancy_type, resolution_status, expected_position, actual_position")
    .eq("stock_check_id", latest.id)
    .order("checked_at", { ascending: false })
    .limit(800);

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as StockCheckItemRow[])
    .filter((row) => Boolean(row.discrepancy_type) && !["resolved", "closed"].includes(normalizeText(row.resolution_status)))
    .slice(0, limit);

  const items = rows.map((row) => ({
    trailerId: row.trailer_id ?? undefined,
    trailerNumber: row.trailer_number ?? "Unknown",
    status: titleCase(row.discrepancy_type),
    compoundPosition: row.actual_position ?? row.expected_position ?? undefined,
    detail: `Resolution: ${titleCase(row.resolution_status ?? "open")}`,
    route: row.trailer_id ? `/dashboard/trailers/${row.trailer_id}` : "/dashboard/compound/review-discrepancies",
  }));

  if (items.length === 0) {
    return noResults(
      "stock_check_discrepancies",
      "Stock check discrepancies",
      "No unresolved stock-check discrepancies were found in the latest session.",
      ["compound_stock_check_items"],
      [{ label: "Open Review Discrepancies", route: "/dashboard/compound/review-discrepancies" }],
    );
  }

  return asResult({
    intent: "stock_check_discrepancies",
    title: "Stock check discrepancies",
    summary: `${items.length} unresolved discrepancy item${items.length === 1 ? "" : "s"} found in the latest stock check.`,
    count: items.length,
    items,
    actions: [{ label: "Open Review Discrepancies", route: "/dashboard/compound/review-discrepancies" }],
    sourceModules: ["compound_stock_check_items", "compound_stock_checks"],
  });
};

const queryCurrentOperationalSummary = async (context: AssistantContext, gate: PermissionGate) => {
  const allowedModules = new Set<PermissionModuleKey>();
  for (const moduleKey of moduleKeys) {
    if (await gate.can(moduleKey)) {
      allowedModules.add(moduleKey);
    }
  }

  const summaryItems: AssistantQueryResult["items"] = [];
  const actions: AssistantQueryResult["actions"] = [];
  const primaryMetrics: NonNullable<AssistantQueryResult["primaryMetrics"]> = [];
  const sections: NonNullable<AssistantQueryResult["sections"]> = [];
  const alerts: NonNullable<AssistantQueryResult["alerts"]> = [];

  if (allowedModules.has("compound")) {
    const compound = await queryCompoundList(context, gate, "compound_summary", { limit: 1 });
    if (compound.items?.[0]) {
      summaryItems?.push({ trailerNumber: "Compound", status: compound.items[0].status, detail: compound.summary });
      actions.push({ label: "Open Compound", route: "/dashboard/compound" });
      primaryMetrics.push({ label: "Compound", value: compound.items[0].status ?? "-" });
    }
  }

  if (allowedModules.has("departures")) {
    const departures = await queryDeparturesToday(context, gate, 1);
    summaryItems?.push({ trailerNumber: "Departures", status: String(departures.count ?? 0), detail: "Today" });
    actions.push({ label: "Open Departures", route: "/dashboard/departure" });
    primaryMetrics.push({ label: "Departures Today", value: departures.count ?? 0 });
  }

  if (allowedModules.has("export_operations")) {
    const exportsWaiting = await queryExportList(context, gate, "export_waiting_collection", { limit: 1 });
    summaryItems?.push({ trailerNumber: "Exports waiting collection", status: String(exportsWaiting.count ?? 0) });
    actions.push({ label: "Open Export Operations", route: "/dashboard/export-operations" });
    primaryMetrics.push({ label: "Waiting Collection", value: exportsWaiting.count ?? 0 });
  }

  if (allowedModules.has("vessel_operations")) {
    const pendingInspection = await queryVesselTrailerList(context, gate, "list_pending_inspections", { limit: 1 });
    summaryItems?.push({ trailerNumber: "Pending inspections", status: String(pendingInspection.count ?? 0) });
    actions.push({ label: "Open Vessel Operations", route: "/dashboard/vessel-operations" });
    primaryMetrics.push({ label: "Inspection Queue", value: pendingInspection.count ?? 0 });

    const temperatureAlerts = await queryVesselTrailerList(context, gate, "list_temperature_alerts", { limit: 1 });
    primaryMetrics.push({ label: "Temperature Alerts", value: temperatureAlerts.count ?? 0 });

    const damageAlerts = await queryDamageAlerts(context, gate, 1);
    primaryMetrics.push({ label: "Damage Alerts", value: damageAlerts.count ?? 0 });

    sections.push({
      key: "vessel",
      title: "Current Vessel Operations",
      items: [
        { label: "Pending Inspection", value: pendingInspection.count ?? 0 },
        { label: "Temperature Alerts", value: temperatureAlerts.count ?? 0 },
        { label: "Damage Alerts", value: damageAlerts.count ?? 0 },
      ],
    });
  }

  if (allowedModules.has("dashboard")) {
    const unresolved = await queryUnresolvedAlerts(context, gate, 1);
    summaryItems?.push({ trailerNumber: "Unresolved alerts", status: String(unresolved.count ?? 0) });
    actions.push({ label: "Open Exceptions", route: "/dashboard/operations-command-centre" });
    primaryMetrics.push({ label: "Operational Alerts", value: unresolved.count ?? 0 });
    if ((unresolved.count ?? 0) > 0) {
      alerts.push({ severity: "warning", message: `${unresolved.count} unresolved operational alert(s) need attention.` });
    }
  }

  const waitingTrailers = allowedModules.has("compound")
    ? await queryWaitingCompound(context, gate, 1)
    : null;
  if (waitingTrailers) {
    primaryMetrics.push({ label: "Waiting Position", value: waitingTrailers.count ?? 0 });
    sections.push({
      key: "yard",
      title: "Compound",
      items: [
        { label: "Waiting Position", value: waitingTrailers.count ?? 0 },
      ],
    });
  }

  const timeline = await queryActivityTimelineSnapshot(context, 5);
  primaryMetrics.push({ label: "Timeline Events", value: timeline.count });
  sections.push({
    key: "timeline",
    title: "Timeline",
    items: timeline.items.slice(0, 5).map((row) => ({
      label: row.trailer_number ?? row.event_title ?? "Activity",
      value: row.event_type ?? "event",
    })),
  });

  sections.push({
    key: "user",
    title: "Current User",
    items: [{ label: "Operator", value: context.userId }],
  });

  const queueRisk = Number(primaryMetrics.find((metric) => metric.label === "Waiting Collection")?.value ?? 0)
    + Number(primaryMetrics.find((metric) => metric.label === "Inspection Queue")?.value ?? 0);
  if (queueRisk > 0) {
    alerts.push({ severity: "critical", message: `${queueRisk} trailer(s) are waiting across collection and inspection queues.` });
  }

  if (summaryItems.length === 0) {
    return asResult({
      intent: "current_operational_summary",
      title: "Current operational summary",
      summary: "No authorized operational modules are available for summary.",
      count: 0,
      items: [],
      actions: [],
      sourceModules: [],
    });
  }

  return asResult({
    intent: "current_operational_summary",
    title: "Current operational summary",
    summary: "Live operational snapshot generated from dashboard, vessel, compound, export, alerts and timeline data.",
    count: summaryItems.length,
    items: summaryItems,
    actions,
    primaryMetrics,
    sections,
    alerts,
    sourceModules: ["trailers", "vessel_operation_trailers", "export_allocations", "operational_alerts", "trailer_activity_log"],
  });
};

const queryExportWaitingCollectionViaDeliveries = async (context: AssistantContext, gate: PermissionGate, limit: number) => {
  const denied = await gate.firstDenied("departures");
  if (denied) {
    return permissionDeniedResult("export_waiting_collection", denied);
  }

  const { data, error } = await context.supabase
    .from("delivery_bookings")
    .select("id, trailer_id, waiting_collection_since, collection_due_date, status")
    .eq("status", "waiting_collection")
    .order("waiting_collection_since", { ascending: true })
    .limit(600);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as DeliveryBookingRow[];
  const trailerIds = Array.from(new Set(rows.map((row) => row.trailer_id).filter(Boolean)));

  const trailerMap = new Map<string, TrailerRow>();
  if (trailerIds.length > 0) {
    const trailerResult = await context.supabase
      .from("trailers")
      .select("id, trailer_number, customer, load_status, operational_status, compound_position")
      .in("id", trailerIds);

    if (trailerResult.error) {
      throw trailerResult.error;
    }

    ((trailerResult.data ?? []) as TrailerRow[]).forEach((row) => trailerMap.set(row.id, row));
  }

  const items = rows.slice(0, limit).map((row) => {
    const trailer = trailerMap.get(row.trailer_id);
    const aging = calculateCollectionAging(row);
    return {
      trailerId: trailer?.id,
      trailerNumber: trailer?.trailer_number ?? "Unknown",
      status: titleCase(row.status),
      customer: trailer?.customer ?? undefined,
      compoundPosition: trailer?.compound_position ?? undefined,
      detail: `Overdue ${aging.overdueDays} day(s)`,
      route: trailer?.id ? `/dashboard/trailers/${trailer.id}` : "/dashboard/deliveries?filter=waiting",
    };
  });

  if (items.length === 0) {
    return noResults(
      "export_waiting_collection",
      "Exports waiting collection",
      "No trailers are currently waiting for collection.",
      ["delivery_bookings", "trailers"],
      [{ label: "Open Deliveries", route: "/dashboard/deliveries?filter=waiting" }],
    );
  }

  return asResult({
    intent: "export_waiting_collection",
    title: "Exports waiting collection",
    summary: `${rows.length} trailer${rows.length === 1 ? "" : "s"} are waiting for collection.`,
    count: rows.length,
    items,
    actions: [{ label: "Open Deliveries", route: "/dashboard/deliveries?filter=waiting" }],
    sourceModules: ["delivery_bookings", "trailers"],
  });
};

export const runIntentQuery = async (context: AssistantContext, intent: AssistantIntent): Promise<AssistantQueryResult> => {
  const gate = new PermissionGate(context);

  const assistantDenied = await gate.firstDenied("ai_assistant");
  if (assistantDenied) {
    return permissionDeniedResult(intent.intent, assistantDenied);
  }

  switch (intent.intent) {
    case "find_trailer":
    case "trailer_current_status":
    case "trailer_location":
      return queryFindTrailer(context, gate, intent);
    case "list_expected_trailers":
    case "list_arrived_trailers":
    case "list_pending_inspections":
    case "list_inspections_in_progress":
    case "list_completed_inspections":
    case "list_priority_trailers":
      return queryVesselTrailerList(context, gate, intent.intent, {
        priorityOnly: intent.priorityOnly,
        vesselOperationId: "vesselOperationId" in intent ? intent.vesselOperationId : context.pageContext?.activeVesselOperationId,
        limit: intent.limit,
      });
    case "list_temperature_alerts":
      return queryVesselTrailerList(context, gate, "list_temperature_alerts", { limit: intent.limit });
    case "list_missing_photos":
      return queryVesselTrailerList(context, gate, "list_missing_photos", {
        vesselOperationId: "vesselOperationId" in intent ? intent.vesselOperationId : context.pageContext?.activeVesselOperationId,
        limit: intent.limit,
      });
    case "compound_summary":
    case "compound_empty_trailers":
    case "compound_loaded_trailers":
    case "compound_available_trailers":
    case "compound_free_positions":
      return queryCompoundList(context, gate, intent.intent, { limit: intent.limit });
    case "compound_long_dwell":
      return queryCompoundList(context, gate, "compound_long_dwell", { minHours: intent.minHours, limit: intent.limit });
    case "export_allocated":
      return queryExportList(context, gate, "export_allocated", { limit: intent.limit });
    case "export_waiting_loading":
      return queryExportList(context, gate, "export_waiting_loading", { limit: intent.limit });
    case "export_waiting_collection": {
      const fromDeliveries = await queryExportWaitingCollectionViaDeliveries(context, gate, sanitizeLimit(intent.limit));
      if ((fromDeliveries.count ?? 0) > 0) {
        return fromDeliveries;
      }

      return queryExportList(context, gate, "export_waiting_collection", { limit: intent.limit });
    }
    case "export_overdue":
      return queryExportList(context, gate, "export_overdue", { limit: intent.limit });
    case "list_waiting_compound":
      return queryWaitingCompound(context, gate, sanitizeLimit(intent.limit));
    case "arrivals_today":
      return queryArrivalsToday(context, gate, sanitizeLimit(intent.limit));
    case "departures_today":
      return queryDeparturesToday(context, gate, sanitizeLimit(intent.limit));
    case "departures_by_customer":
      return queryDeparturesByCustomer(context, gate, intent.customer, sanitizeLimit(intent.limit));
    case "vessel_operations_today":
      return queryVesselOperationsToday(context, gate, sanitizeLimit(intent.limit));
    case "operations_summary_today":
      return queryCurrentOperationalSummary(context, gate);
    case "export_by_status": {
      if (intent.status === "allocated") {
        return queryExportList(context, gate, "export_allocated", { limit: intent.limit });
      }
      if (intent.status === "waiting_loading") {
        return queryExportList(context, gate, "export_waiting_loading", { limit: intent.limit });
      }
      if (intent.status === "delivered_empty") {
        return queryExportList(context, gate, "export_waiting_collection", { limit: intent.limit });
      }
      return queryExportList(context, gate, "export_overdue", { limit: intent.limit });
    }
    case "trailers_by_customer":
      return queryTrailersByCustomer(context, gate, intent.customer, sanitizeLimit(intent.limit));
    case "trailers_with_damage":
      return queryDamageAlerts(context, gate, sanitizeLimit(intent.limit));
    case "trailers_with_temperature_alert":
      return queryVesselTrailerList(context, gate, "list_temperature_alerts", { limit: intent.limit });
    case "unresolved_operational_alerts":
      return queryUnresolvedAlerts(context, gate, sanitizeLimit(intent.limit));
    case "stock_check_discrepancies":
      return queryStockCheckDiscrepancies(context, gate, sanitizeLimit(intent.limit));
    case "current_operational_summary":
      return queryCurrentOperationalSummary(context, gate);
    case "unknown":
    default:
      return asResult({
        intent: "unknown",
        title: "Unsupported question",
        summary:
          "I can answer operational read-only questions about waiting trailers, trailer search/location, arrivals, departures, inspections, compound occupancy, exports, alerts, timeline and daily summaries.",
        count: 0,
        items: [],
        actions: [
          { label: "Open Operations Command Centre", route: "/dashboard/operations-command-centre" },
          { label: "Open Trailer Search", route: "/dashboard/search" },
        ],
        sourceModules: [],
      });
  }
};
