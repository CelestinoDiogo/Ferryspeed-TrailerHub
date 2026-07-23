import "server-only";

import { calculateCollectionAging } from "@/lib/collection-aging";
import type { Database } from "@/lib/database.types";
import { buildActiveExportStatusByTrailerId, isTrailerEligibleForCompoundViews, isTrailerPresentInCompoundInventory, normalizeExportAllocationRecord, type ExportAllocationRecord } from "@/lib/export-allocation";
import { moduleKeys, type PermissionModuleKey } from "@/lib/auth/permissions";
import { loadTrailerOperationalProfile } from "@/lib/operations/trailer-operational-engine";
import { getLocalDateKey } from "@/lib/operational-readiness";
import { requirePermission } from "@/lib/rbac/service";
import { getTrailerCurrentLocationLabel } from "@/lib/trailer-location";
import type { AssistantContext, AssistantIntent, AssistantQueryResult } from "@/lib/ai-assistant-foundation/types";

type TrailerRow = Database["public"]["Tables"]["trailers"]["Row"];
type DeliveryBookingRow = Database["public"]["Tables"]["delivery_bookings"]["Row"];
type StockCheckRow = Database["public"]["Tables"]["compound_stock_checks"]["Row"];
type StockCheckItemRow = Database["public"]["Tables"]["compound_stock_check_items"]["Row"];
type VesselTrailerRow = Database["public"]["Tables"]["vessel_operation_trailers"]["Row"];

const LIST_LIMIT_DEFAULT = 12;
const LIST_LIMIT_MAX = 50;

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";
const normalizeTrailerNumber = (value?: string | null) => value?.trim().toUpperCase() ?? "";

const sanitizeLimit = (value?: number) => {
  if (!value || !Number.isFinite(value)) {
    return LIST_LIMIT_DEFAULT;
  }

  return Math.max(1, Math.min(LIST_LIMIT_MAX, Math.trunc(value)));
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const moduleLabels: Record<PermissionModuleKey, string> = {
  dashboard: "Dashboard",
  arrivals: "Arrivals",
  compound: "Compound",
  stock_check: "Stock Check",
  reconciliation: "Reconciliation",
  departures: "Departures",
  export_operations: "Export Operations",
  vessel_operations: "Vessel Operations",
  reports: "Reports",
  timeline: "Timeline",
  ai_assistant: "AI Assistant",
  settings: "Settings",
  user_management: "User Management",
};

const textResult = (intent: AssistantIntent["intent"], title: string, answer: string): AssistantQueryResult => ({
  intent,
  title,
  answer,
  resultType: "text",
  data: [],
  links: [],
  truncated: false,
});

const noResult = (intent: AssistantIntent["intent"], title: string, answer: string, links?: Array<{ label: string; href: string }>) => ({
  intent,
  title,
  answer,
  resultType: "text",
  data: [],
  links: links ?? [],
  truncated: false,
} satisfies AssistantQueryResult);

const permissionDeniedResult = (moduleKey: PermissionModuleKey): AssistantQueryResult => ({
  intent: "unknown",
  title: "Access denied",
  answer: `You do not have permission to access ${moduleLabels[moduleKey]} data.`,
  resultType: "text",
  data: [],
  links: [],
  truncated: false,
});

const isResolvedDiscrepancy = (value?: string | null) => {
  const normalized = normalizeText(value);
  return normalized === "resolved" || normalized === "closed";
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

const extractCustomerOrNull = (value?: string | null) => {
  const compact = value?.trim();
  return compact ? compact : null;
};

const resolveTrailerRecord = async (context: AssistantContext, trailerNumber: string) => {
  const normalized = normalizeTrailerNumber(trailerNumber);
  const { data, error } = await context.supabase
    .from("trailers")
    .select("id, trailer_number, load_status, customer, compound_position, is_local, arrival_date, departure_date, operational_status")
    .ilike("trailer_number", normalized)
    .order("arrival_date", { ascending: false })
    .limit(1);

  if (error) {
    throw error;
  }

  return ((data ?? [])[0] ?? null) as TrailerRow | null;
};

const queryTrailerLocation = async (context: AssistantContext, gate: PermissionGate, intent: AssistantIntent): Promise<AssistantQueryResult> => {
  const denied = await gate.firstDenied("arrivals");
  if (denied) {
    return permissionDeniedResult(denied);
  }

  if (!intent.trailerNumber) {
    return textResult("unknown", "Trailer lookup", "Please provide the complete trailer number.");
  }

  const trailer = await resolveTrailerRecord(context, intent.trailerNumber);
  if (!trailer) {
    return noResult("trailer_location", `Trailer ${intent.trailerNumber}`, `No active trailer was found with number ${intent.trailerNumber}.`);
  }

  const canSeeCompound = await gate.can("compound");
  const canSeeExport = await gate.can("export_operations");

  const location = getTrailerCurrentLocationLabel({
    departureDate: trailer.departure_date,
    isLocal: trailer.is_local,
    compoundPosition: canSeeCompound ? trailer.compound_position : null,
    waitingForCompound: false,
    exportLocation: canSeeExport ? "Export Operations" : null,
    fallbackLocation: null,
  });

  return {
    intent: "trailer_location",
    title: `Trailer ${trailer.trailer_number ?? intent.trailerNumber}`,
    answer: `${trailer.trailer_number ?? intent.trailerNumber} is currently at ${location}.`,
    resultType: "trailer",
    data: [
      {
        trailerNumber: trailer.trailer_number,
        currentLocation: location,
        compoundPosition: canSeeCompound ? trailer.compound_position : "Restricted",
        loadStatus: trailer.load_status,
        operationalStatus: trailer.operational_status,
        customer: extractCustomerOrNull(trailer.customer),
        link: `/dashboard/trailers/${trailer.id}`,
      },
    ],
    summary: [
      { label: "Trailer", value: trailer.trailer_number ?? intent.trailerNumber },
      { label: "Location", value: location },
    ],
    links: [{ label: "Open Trailer", href: `/dashboard/trailers/${trailer.id}` }],
    truncated: false,
  };
};

const queryTrailerFullStatus = async (context: AssistantContext, gate: PermissionGate, intent: AssistantIntent): Promise<AssistantQueryResult> => {
  const denied = await gate.firstDenied("arrivals");
  if (denied) {
    return permissionDeniedResult(denied);
  }

  if (!intent.trailerNumber) {
    return textResult("unknown", "Trailer status", "Please provide the complete trailer number.");
  }

  const profile = await loadTrailerOperationalProfile(context.supabase, intent.trailerNumber);
  const trailer = profile.trailer;

  if (!trailer) {
    return noResult("trailer_full_status", `Trailer ${intent.trailerNumber}`, `No active trailer was found with number ${intent.trailerNumber}.`);
  }

  const canCompound = await gate.can("compound");
  const canExport = await gate.can("export_operations");
  const canVessel = await gate.can("vessel_operations");
  const canReconciliation = await gate.can("reconciliation");
  const canTimeline = await gate.can("timeline");

  const vesselTrailer = profile.vesselOperationTrailers[0] ?? null;
  const latestVesselOperation = profile.vesselOperations[0] ?? null;
  const latestEvent = canTimeline ? profile.events[0] ?? null : null;

  const discrepancy = canReconciliation
    ? profile.events.find((event) => {
        const source = normalizeText(event.sourceModule);
        return source.includes("stock") || source.includes("compound");
      }) ?? null
    : null;

  const location = getTrailerCurrentLocationLabel({
    departureDate: trailer.departure_date,
    isLocal: trailer.is_local,
    compoundPosition: canCompound ? trailer.compound_position : null,
    waitingForCompound: false,
    exportLocation: canExport ? profile.position.currentLocation : null,
    fallbackLocation: profile.position.currentLocation,
  });

  const dataRow: Record<string, unknown> = {
    trailerNumber: trailer.trailer_number,
    currentLocation: location,
    compoundPosition: canCompound ? trailer.compound_position : "Restricted",
    loadStatus: trailer.load_status ?? "Unknown",
    operationalStatus: trailer.operational_status ?? profile.position.stageLabel,
    customer: trailer.customer ?? null,
    arrivalDateTime: formatDateTime(trailer.arrival_date),
    departureDateTime: formatDateTime(trailer.departure_date),
    activeAllocation: canExport ? profile.position.currentOperationReference ?? "None" : "Restricted",
    vesselOperation: canVessel ? latestVesselOperation?.vessel_name ?? "None" : "Restricted",
    inspectionStatus: canVessel
      ? vesselTrailer?.inspection_completed_at
        ? "Completed"
        : vesselTrailer?.inspection_started_at
          ? "In progress"
          : "Pending"
      : "Restricted",
    stockCheckDiscrepancy: canReconciliation ? (discrepancy?.description ?? "None") : "Restricted",
    latestTimelineEvent: canTimeline ? (latestEvent?.title ?? "None") : "Restricted",
    link: `/dashboard/trailers/${trailer.id}`,
  };

  return {
    intent: "trailer_full_status",
    title: `Trailer ${trailer.trailer_number ?? intent.trailerNumber}`,
    answer: `Full operational status compiled for ${trailer.trailer_number ?? intent.trailerNumber}.`,
    resultType: "trailer",
    data: [dataRow],
    summary: [
      { label: "Location", value: location },
      { label: "Load status", value: trailer.load_status ?? "Unknown" },
      { label: "Operational status", value: trailer.operational_status ?? profile.position.stageLabel },
    ],
    links: [
      { label: "Open Trailer", href: `/dashboard/trailers/${trailer.id}` },
      ...(canTimeline ? [{ label: "Open Timeline", href: "/dashboard/trailer-timeline" }] : []),
    ],
    truncated: false,
  };
};

const queryTrailerHistorySummary = async (context: AssistantContext, gate: PermissionGate, intent: AssistantIntent): Promise<AssistantQueryResult> => {
  const denied = await gate.firstDenied("timeline");
  if (denied) {
    return permissionDeniedResult(denied);
  }

  if (!intent.trailerNumber) {
    return textResult("unknown", "Trailer history", "Please provide the complete trailer number.");
  }

  const profile = await loadTrailerOperationalProfile(context.supabase, intent.trailerNumber);
  const trailer = profile.trailer;
  if (!trailer) {
    return noResult("trailer_history_summary", `Trailer ${intent.trailerNumber}`, `No active trailer was found with number ${intent.trailerNumber}.`);
  }

  const limit = sanitizeLimit(intent.limit);
  const rows = profile.events.slice(0, limit).map((event) => ({
    trailerNumber: trailer.trailer_number,
    eventType: event.eventType,
    title: event.title,
    sourceModule: event.sourceModule,
    occurredAt: formatDateTime(event.occurredAt),
    description: event.description ?? null,
  }));

  if (rows.length === 0) {
    return noResult("trailer_history_summary", `Trailer ${trailer.trailer_number}`, "No timeline events were found for this trailer.", [{ label: "Open Timeline", href: "/dashboard/trailer-timeline" }]);
  }

  return {
    intent: "trailer_history_summary",
    title: `History summary: ${trailer.trailer_number}`,
    answer: `Showing the latest ${rows.length} timeline events for ${trailer.trailer_number}.`,
    resultType: "trailer_list",
    data: rows,
    summary: [{ label: "Events", value: profile.events.length }],
    links: [
      { label: "Open Trailer", href: `/dashboard/trailers/${trailer.id}` },
      { label: "Open Timeline", href: "/dashboard/trailer-timeline" },
    ],
    truncated: profile.events.length > limit,
  };
};

const queryTrailersByCustomer = async (context: AssistantContext, gate: PermissionGate, intent: AssistantIntent): Promise<AssistantQueryResult> => {
  const denied = await gate.firstDenied("arrivals");
  if (denied) {
    return permissionDeniedResult(denied);
  }

  if (!intent.customer) {
    return textResult("unknown", "Customer trailers", "Please provide the customer name.");
  }

  const limit = sanitizeLimit(intent.limit);
  const { data, error } = await context.supabase
    .from("trailers")
    .select("id, trailer_number, customer, load_status, compound_position, departure_date, is_local, operational_status")
    .ilike("customer", `%${intent.customer}%`)
    .is("departure_date", null)
    .order("trailer_number", { ascending: true })
    .limit(limit + 1);

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as TrailerRow[]).slice(0, limit).map((trailer) => ({
    trailerNumber: trailer.trailer_number,
    customer: trailer.customer,
    loadStatus: trailer.load_status,
    operationalStatus: trailer.operational_status,
    compoundPosition: trailer.compound_position,
    link: `/dashboard/trailers/${trailer.id}`,
  }));

  if (rows.length === 0) {
    return noResult("trailers_by_customer", `Trailers for ${intent.customer}`, `No trailers were found for customer ${intent.customer}.`);
  }

  return {
    intent: "trailers_by_customer",
    title: `Trailers for ${intent.customer}`,
    answer: `${rows.length} trailer${rows.length === 1 ? "" : "s"} found for customer ${intent.customer}.`,
    resultType: "trailer_list",
    data: rows,
    summary: [{ label: "Matches", value: rows.length }],
    links: [{ label: "Open Trailer Search", href: "/dashboard/search" }],
    truncated: ((data ?? []) as TrailerRow[]).length > limit,
  };
};

const queryTrailerAtPosition = async (context: AssistantContext, gate: PermissionGate, intent: AssistantIntent): Promise<AssistantQueryResult> => {
  const denied = await gate.firstDenied("compound");
  if (denied) {
    return permissionDeniedResult(denied);
  }

  if (!intent.compoundPosition) {
    return textResult("unknown", "Compound position", "Please provide a valid compound position, for example P12.");
  }

  const { data, error } = await context.supabase
    .from("trailers")
    .select("id, trailer_number, customer, load_status, operational_status, compound_position, departure_date")
    .eq("compound_position", intent.compoundPosition)
    .is("departure_date", null)
    .limit(20);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as TrailerRow[];

  if (rows.length === 0) {
    return noResult("trailer_at_position", `Compound position ${intent.compoundPosition}`, `No active trailer is currently in position ${intent.compoundPosition}.`, [{ label: "Open Compound", href: "/dashboard/compound" }]);
  }

  return {
    intent: "trailer_at_position",
    title: `Position ${intent.compoundPosition}`,
    answer: `${rows.length} trailer${rows.length === 1 ? " is" : "s are"} currently in ${intent.compoundPosition}.`,
    resultType: "trailer_list",
    data: rows.map((trailer) => ({
      trailerNumber: trailer.trailer_number,
      customer: trailer.customer,
      loadStatus: trailer.load_status,
      operationalStatus: trailer.operational_status,
      compoundPosition: trailer.compound_position,
      link: `/dashboard/trailers/${trailer.id}`,
    })),
    summary: [{ label: "Trailers in position", value: rows.length }],
    links: [{ label: "Open Compound", href: "/dashboard/compound" }],
    truncated: false,
  };
};

const queryAllocatedStillInCompound = async (context: AssistantContext, gate: PermissionGate, intent: AssistantIntent): Promise<AssistantQueryResult> => {
  const denied = await gate.firstDenied("export_operations", "compound");
  if (denied) {
    return permissionDeniedResult(denied);
  }

  const limit = sanitizeLimit(intent.limit);
  const [
    { data: allocationData, error: allocationError },
    { data: trailerData, error: trailerError },
  ] = await Promise.all([
    context.supabase
      .from("export_allocations")
      .select("id, trailer_id, trailer_number, customer, booking_reference, status, updated_at")
      .in("status", ["allocated", "delivered_empty", "waiting_loading", "collected_loaded"])
      .order("updated_at", { ascending: false })
      .limit(300),
    context.supabase
      .from("trailers")
      .select("id, trailer_number, compound_position, departure_date, is_local, operational_status")
      .is("departure_date", null)
      .not("compound_position", "is", null)
      .limit(400),
  ]);

  if (allocationError) {
    throw allocationError;
  }

  if (trailerError) {
    throw trailerError;
  }

  const allocations = ((allocationData ?? []) as ExportAllocationRecord[]).map((row) => normalizeExportAllocationRecord(row));
  const activeStatusByTrailer = buildActiveExportStatusByTrailerId(allocations);

  const trailersById = new Map<string, TrailerRow>();
  for (const trailer of (trailerData ?? []) as TrailerRow[]) {
    trailersById.set(trailer.id, trailer);
  }

  const rows = allocations
    .filter((allocation) => Boolean(allocation.trailer_id))
    .map((allocation) => {
      const trailer = allocation.trailer_id ? trailersById.get(allocation.trailer_id) ?? null : null;
      return {
        allocation,
        trailer,
      };
    })
    .filter((pair) => {
      if (!pair.trailer || !pair.allocation.trailer_id) {
        return false;
      }

      return isTrailerEligibleForCompoundViews(pair.trailer, activeStatusByTrailer.get(pair.allocation.trailer_id)) && isTrailerPresentInCompoundInventory(pair.trailer, activeStatusByTrailer.get(pair.allocation.trailer_id));
    })
    .slice(0, limit)
    .map((pair) => ({
      trailerNumber: pair.trailer?.trailer_number ?? pair.allocation.trailer_number,
      customer: pair.allocation.customer,
      bookingReference: pair.allocation.booking_reference,
      allocationStatus: pair.allocation.status,
      compoundPosition: pair.trailer?.compound_position,
      trailerLink: pair.trailer ? `/dashboard/trailers/${pair.trailer.id}` : null,
      exportLink: `/dashboard/export-operations/${pair.allocation.id}`,
    }));

  if (rows.length === 0) {
    return noResult("allocated_still_in_compound", "Allocated trailers still in compound", "No active allocated trailers are currently still in compound.", [{ label: "Open Export Operations", href: "/dashboard/export-operations" }]);
  }

  return {
    intent: "allocated_still_in_compound",
    title: "Allocated trailers still in compound",
    answer: `${rows.length} active export allocations still have trailers in compound.`,
    resultType: "trailer_list",
    data: rows,
    summary: [{ label: "Allocations in compound", value: rows.length }],
    links: [{ label: "Open Export Operations", href: "/dashboard/export-operations" }],
    truncated: false,
  };
};

const queryWaitingCollectionOverdue = async (context: AssistantContext, gate: PermissionGate, intent: AssistantIntent): Promise<AssistantQueryResult> => {
  const denied = await gate.firstDenied("departures");
  if (denied) {
    return permissionDeniedResult(denied);
  }

  const limit = sanitizeLimit(intent.limit);
  const { data, error } = await context.supabase
    .from("delivery_bookings")
    .select("id, trailer_id, delivery_date, waiting_collection_since, collection_due_date, delivered_at, status")
    .eq("status", "waiting_collection")
    .order("waiting_collection_since", { ascending: true })
    .limit(300);

  if (error) {
    throw error;
  }

  const bookings = (data ?? []) as DeliveryBookingRow[];

  const trailerIds = Array.from(new Set(bookings.map((item) => item.trailer_id).filter((value): value is string => Boolean(value))));
  const trailerNumberById = new Map<string, string>();

  if (trailerIds.length > 0) {
    const { data: trailerData, error: trailerError } = await context.supabase
      .from("trailers")
      .select("id, trailer_number")
      .in("id", trailerIds);

    if (trailerError) {
      throw trailerError;
    }

    for (const trailer of trailerData ?? []) {
      trailerNumberById.set(trailer.id, trailer.trailer_number ?? "Unknown");
    }
  }

  const overdueRows = bookings
    .map((booking) => {
      const aging = calculateCollectionAging(booking);
      const hoursOverdue = booking.waiting_collection_since
        ? Math.floor((Date.now() - new Date(booking.waiting_collection_since).getTime()) / 3_600_000)
        : null;

      return {
        booking,
        aging,
        hoursOverdue,
      };
    })
    .filter((row) => (row.hoursOverdue ?? 0) >= 24 || row.aging.isOverdue)
    .slice(0, limit)
    .map((row) => ({
      trailerNumber: row.booking.trailer_id ? trailerNumberById.get(row.booking.trailer_id) ?? "Unknown" : "Unknown",
      waitingSince: formatDateTime(row.booking.waiting_collection_since),
      dueDate: row.booking.collection_due_date ?? "-",
      overdueHours: row.hoursOverdue,
      overdueDays: row.aging.overdueDays,
      link: row.booking.trailer_id ? `/dashboard/trailers/${row.booking.trailer_id}` : null,
    }));

  if (overdueRows.length === 0) {
    return noResult("waiting_collection_overdue", "Waiting collection overdue", "No waiting-collection trailers are currently overdue.", [{ label: "Open Deliveries", href: "/dashboard/deliveries?filter=waiting" }]);
  }

  return {
    intent: "waiting_collection_overdue",
    title: "Waiting collection overdue",
    answer: `${overdueRows.length} waiting-collection trailer${overdueRows.length === 1 ? " is" : "s are"} overdue.`,
    resultType: "trailer_list",
    data: overdueRows,
    summary: [{ label: "Overdue waiting collection", value: overdueRows.length }],
    links: [{ label: "Open Deliveries", href: "/dashboard/deliveries?filter=waiting" }],
    truncated: false,
  };
};

const queryArrivalsPendingInspection = async (context: AssistantContext, gate: PermissionGate, intent: AssistantIntent): Promise<AssistantQueryResult> => {
  const denied = await gate.firstDenied("vessel_operations");
  if (denied) {
    return permissionDeniedResult(denied);
  }

  const limit = sanitizeLimit(intent.limit);
  const { data, error } = await context.supabase
    .from("vessel_operation_trailers")
    .select("id, vessel_operation_id, trailer_id, trailer_number, customer, arrival_status, inspection_started_at, inspection_completed_at, assigned_position")
    .eq("arrival_status", "arrived")
    .is("inspection_completed_at", null)
    .order("arrived_at", { ascending: false })
    .limit(limit + 1);

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as VesselTrailerRow[]).slice(0, limit).map((row) => ({
    trailerNumber: row.trailer_number,
    customer: row.customer,
    inspectionStatus: row.inspection_started_at ? "In progress" : "Pending",
    assignedPosition: row.assigned_position,
    vesselLink: `/dashboard/vessel-operations/${row.vessel_operation_id}`,
    trailerLink: row.trailer_id ? `/dashboard/trailers/${row.trailer_id}` : null,
  }));

  if (rows.length === 0) {
    return noResult("arrivals_pending_inspection", "Arrivals pending inspection", "No arrived trailers are currently pending inspection.", [{ label: "Open Vessel Operation", href: "/dashboard/vessel-operations" }]);
  }

  return {
    intent: "arrivals_pending_inspection",
    title: "Arrivals pending inspection",
    answer: `${rows.length} arrived trailer${rows.length === 1 ? " is" : "s are"} still pending inspection.`,
    resultType: "trailer_list",
    data: rows,
    summary: [{ label: "Pending inspections", value: rows.length }],
    links: [{ label: "Open Vessel Operation", href: "/dashboard/vessel-operations" }],
    truncated: ((data ?? []) as VesselTrailerRow[]).length > limit,
  };
};

const queryTemperatureAlerts = async (context: AssistantContext, gate: PermissionGate, intent: AssistantIntent): Promise<AssistantQueryResult> => {
  const denied = await gate.firstDenied("vessel_operations");
  if (denied) {
    return permissionDeniedResult(denied);
  }

  const limit = sanitizeLimit(intent.limit);
  const { data, error } = await context.supabase
    .from("vessel_operation_trailers")
    .select("id, vessel_operation_id, trailer_id, trailer_number, customer, has_temperature_alert, inspection_completed_at")
    .eq("has_temperature_alert", true)
    .order("updated_at", { ascending: false })
    .limit(limit + 1);

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as VesselTrailerRow[]).slice(0, limit).map((row) => ({
    trailerNumber: row.trailer_number,
    customer: row.customer,
    inspectionCompletedAt: formatDateTime(row.inspection_completed_at),
    vesselLink: `/dashboard/vessel-operations/${row.vessel_operation_id}`,
    trailerLink: row.trailer_id ? `/dashboard/trailers/${row.trailer_id}` : null,
  }));

  if (rows.length === 0) {
    return noResult("temperature_alerts", "Temperature alerts", "No active temperature alerts were found.", [{ label: "Open Vessel Operation", href: "/dashboard/vessel-operations" }]);
  }

  return {
    intent: "temperature_alerts",
    title: "Temperature alerts",
    answer: `${rows.length} trailer${rows.length === 1 ? " has" : "s have"} active temperature alerts.`,
    resultType: "trailer_list",
    data: rows,
    summary: [{ label: "Temperature alerts", value: rows.length }],
    links: [{ label: "Open Vessel Operation", href: "/dashboard/vessel-operations" }],
    truncated: ((data ?? []) as VesselTrailerRow[]).length > limit,
  };
};

const queryDamageAlerts = async (context: AssistantContext, gate: PermissionGate, intent: AssistantIntent): Promise<AssistantQueryResult> => {
  const denied = await gate.firstDenied("vessel_operations");
  if (denied) {
    return permissionDeniedResult(denied);
  }

  const limit = sanitizeLimit(intent.limit);
  const { data, error } = await context.supabase
    .from("vessel_operation_trailers")
    .select("id, vessel_operation_id, trailer_id, trailer_number, customer, has_damage, inspection_completed_at")
    .eq("has_damage", true)
    .order("updated_at", { ascending: false })
    .limit(limit + 1);

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as VesselTrailerRow[]).slice(0, limit).map((row) => ({
    trailerNumber: row.trailer_number,
    customer: row.customer,
    inspectionCompletedAt: formatDateTime(row.inspection_completed_at),
    vesselLink: `/dashboard/vessel-operations/${row.vessel_operation_id}`,
    trailerLink: row.trailer_id ? `/dashboard/trailers/${row.trailer_id}` : null,
  }));

  if (rows.length === 0) {
    return noResult("damage_alerts", "Damage alerts", "No active damage alerts were found.", [{ label: "Open Vessel Operation", href: "/dashboard/vessel-operations" }]);
  }

  return {
    intent: "damage_alerts",
    title: "Damage alerts",
    answer: `${rows.length} trailer${rows.length === 1 ? " has" : "s have"} active damage alerts.`,
    resultType: "trailer_list",
    data: rows,
    summary: [{ label: "Damage alerts", value: rows.length }],
    links: [{ label: "Open Vessel Operation", href: "/dashboard/vessel-operations" }],
    truncated: ((data ?? []) as VesselTrailerRow[]).length > limit,
  };
};

const queryOpenDiscrepancies = async (context: AssistantContext, gate: PermissionGate, intent: AssistantIntent): Promise<AssistantQueryResult> => {
  const denied = await gate.firstDenied("reconciliation", "stock_check");
  if (denied) {
    return permissionDeniedResult(denied);
  }

  const limit = sanitizeLimit(intent.limit);
  const { data: latestStockCheckData, error: latestStockCheckError } = await context.supabase
    .from("compound_stock_checks")
    .select("id, started_at, status")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestStockCheckError) {
    throw latestStockCheckError;
  }

  const latestStockCheck = (latestStockCheckData ?? null) as StockCheckRow | null;

  if (!latestStockCheck?.id) {
    return noResult("open_discrepancies", "Open discrepancies", "No stock check records are available yet.", [{ label: "Review Discrepancies", href: "/dashboard/compound/review-discrepancies" }]);
  }

  const { data, error } = await context.supabase
    .from("compound_stock_check_items")
    .select("id, trailer_id, trailer_number, discrepancy_type, resolution_status, expected_position, actual_position")
    .eq("stock_check_id", latestStockCheck.id)
    .order("checked_at", { ascending: false })
    .limit(300);

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as StockCheckItemRow[])
    .filter((row) => Boolean(row.discrepancy_type))
    .filter((row) => !isResolvedDiscrepancy(row.resolution_status))
    .slice(0, limit)
    .map((row) => ({
      trailerNumber: row.trailer_number,
      discrepancyType: row.discrepancy_type,
      resolutionStatus: row.resolution_status ?? "open",
      expectedPosition: row.expected_position,
      actualPosition: row.actual_position,
      trailerLink: row.trailer_id ? `/dashboard/trailers/${row.trailer_id}` : null,
    }));

  if (rows.length === 0) {
    return noResult("open_discrepancies", "Open discrepancies", "No open discrepancies were found in the latest stock check.", [{ label: "Review Discrepancies", href: "/dashboard/compound/review-discrepancies" }]);
  }

  return {
    intent: "open_discrepancies",
    title: "Open discrepancies",
    answer: `${rows.length} open discrepancy item${rows.length === 1 ? "" : "s"} found in the latest stock check.`,
    resultType: "trailer_list",
    data: rows,
    summary: [
      { label: "Open discrepancies", value: rows.length },
      { label: "Stock check", value: formatDateTime(latestStockCheck.started_at) },
    ],
    links: [{ label: "Review Discrepancies", href: "/dashboard/compound/review-discrepancies" }],
    truncated: ((data ?? []) as StockCheckItemRow[]).length > limit,
  };
};

const queryOperationalStatusIssues = async (context: AssistantContext, gate: PermissionGate, intent: AssistantIntent): Promise<AssistantQueryResult> => {
  const denied = await gate.firstDenied("arrivals");
  if (denied) {
    return permissionDeniedResult(denied);
  }

  const limit = sanitizeLimit(intent.limit);
  const problematicStatuses = ["maintenance", "hold", "cancelled", "not_discharged", "inspection_pending"];

  const { data, error } = await context.supabase
    .from("trailers")
    .select("id, trailer_number, customer, load_status, operational_status, compound_position, departure_date")
    .is("departure_date", null)
    .order("arrival_date", { ascending: false })
    .limit(400);

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as TrailerRow[])
    .filter((row) => problematicStatuses.includes(normalizeText(row.operational_status)))
    .slice(0, limit)
    .map((row) => ({
      trailerNumber: row.trailer_number,
      customer: row.customer,
      operationalStatus: row.operational_status,
      loadStatus: row.load_status,
      compoundPosition: row.compound_position,
      trailerLink: `/dashboard/trailers/${row.id}`,
    }));

  if (rows.length === 0) {
    return noResult("operational_status_issues", "Operational status issues", "No active trailers with operational status issues were found.");
  }

  return {
    intent: "operational_status_issues",
    title: "Operational status issues",
    answer: `${rows.length} active trailer${rows.length === 1 ? " has" : "s have"} operational status issues.`,
    resultType: "trailer_list",
    data: rows,
    summary: [{ label: "Issue count", value: rows.length }],
    links: [{ label: "Open Trailer Search", href: "/dashboard/search" }],
    truncated: false,
  };
};

const queryDailyOperationsSummary = async (context: AssistantContext, gate: PermissionGate): Promise<AssistantQueryResult> => {
  const today = getLocalDateKey();

  const allowedModules = new Set<PermissionModuleKey>();
  for (const moduleKey of moduleKeys) {
    if (await gate.can(moduleKey)) {
      allowedModules.add(moduleKey);
    }
  }

  const metrics: Array<{ label: string; value: string | number }> = [];
  const links: Array<{ label: string; href: string }> = [];

  if (allowedModules.has("compound")) {
    const { data, error } = await context.supabase
      .from("trailers")
      .select("id, compound_position, is_local, departure_date")
      .is("departure_date", null)
      .not("compound_position", "is", null)
      .limit(600);

    if (error) {
      throw error;
    }

    const rows = (data ?? []) as Array<Pick<TrailerRow, "id" | "compound_position" | "is_local" | "departure_date">>;
    metrics.push({ label: "Trailers currently in compound", value: rows.filter((row) => row.is_local !== true).length });
    links.push({ label: "Open Compound", href: "/dashboard/compound" });
  }

  if (allowedModules.has("arrivals")) {
    const { count, error } = await context.supabase
      .from("trailers")
      .select("id", { count: "exact", head: true })
      .eq("arrival_date", today);

    if (error) {
      throw error;
    }

    metrics.push({ label: "Arrivals today", value: count ?? 0 });
  }

  if (allowedModules.has("departures")) {
    const { count, error } = await context.supabase
      .from("trailers")
      .select("id", { count: "exact", head: true })
      .eq("departure_date", today);

    if (error) {
      throw error;
    }

    metrics.push({ label: "Departures today", value: count ?? 0 });

    const { count: waitingCollectionCount, error: waitingCollectionError } = await context.supabase
      .from("delivery_bookings")
      .select("id", { count: "exact", head: true })
      .eq("status", "waiting_collection");

    if (waitingCollectionError) {
      throw waitingCollectionError;
    }

    metrics.push({ label: "Waiting collection", value: waitingCollectionCount ?? 0 });
  }

  if (allowedModules.has("export_operations")) {
    const { count, error } = await context.supabase
      .from("export_allocations")
      .select("id", { count: "exact", head: true })
      .in("status", ["allocated", "delivered_empty", "waiting_loading", "collected_loaded"]);

    if (error) {
      throw error;
    }

    metrics.push({ label: "Active export allocations", value: count ?? 0 });
    links.push({ label: "Open Export Operations", href: "/dashboard/export-operations" });
  }

  if (allowedModules.has("vessel_operations")) {
    const { data, error } = await context.supabase
      .from("vessel_operation_trailers")
      .select("id, arrival_status, inspection_completed_at, has_temperature_alert, has_damage")
      .limit(800);

    if (error) {
      throw error;
    }

    const rows = (data ?? []) as Array<Pick<VesselTrailerRow, "id" | "arrival_status" | "inspection_completed_at" | "has_temperature_alert" | "has_damage">>;
    metrics.push({ label: "Arrivals pending inspection", value: rows.filter((row) => normalizeText(row.arrival_status) === "arrived" && !row.inspection_completed_at).length });
    metrics.push({ label: "Temperature alerts", value: rows.filter((row) => row.has_temperature_alert === true).length });
    metrics.push({ label: "Damage alerts", value: rows.filter((row) => row.has_damage === true).length });
    links.push({ label: "Open Vessel Operation", href: "/dashboard/vessel-operations" });
  }

  if (allowedModules.has("reconciliation") || allowedModules.has("stock_check")) {
    const { data: latestCheckData, error: latestCheckError } = await context.supabase
      .from("compound_stock_checks")
      .select("id, started_at")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestCheckError) {
      throw latestCheckError;
    }

    const latest = latestCheckData as Pick<StockCheckRow, "id"> | null;
    if (latest?.id) {
      const { data: itemData, error: itemError } = await context.supabase
        .from("compound_stock_check_items")
        .select("id, discrepancy_type, resolution_status")
        .eq("stock_check_id", latest.id)
        .limit(1000);

      if (itemError) {
        throw itemError;
      }

      const items = (itemData ?? []) as Array<Pick<StockCheckItemRow, "id" | "discrepancy_type" | "resolution_status">>;
      metrics.push({ label: "Missing trailers", value: items.filter((row) => normalizeText(row.discrepancy_type).includes("missing")).length });
      metrics.push({ label: "Unexpected trailers", value: items.filter((row) => normalizeText(row.discrepancy_type).includes("unexpected")).length });
      metrics.push({ label: "Open discrepancies", value: items.filter((row) => row.discrepancy_type && !isResolvedDiscrepancy(row.resolution_status)).length });
      links.push({ label: "Review Discrepancies", href: "/dashboard/compound/review-discrepancies" });
    }
  }

  if (metrics.length === 0) {
    return {
      intent: "daily_operations_summary",
      title: "Daily operations summary",
      answer: "No authorized operational modules are available for this summary.",
      resultType: "text",
      data: [],
      summary: [{ label: "Access", value: "No authorized modules" }],
      links: [],
      truncated: false,
    };
  }

  return {
    intent: "daily_operations_summary",
    title: "Daily operations summary",
    answer: "Here is today's operational summary based on your current access permissions.",
    resultType: "summary",
    data: [],
    summary: metrics,
    links,
    truncated: false,
  };
};

const queryAmbiguousTrailer = (intent: AssistantIntent): AssistantQueryResult => {
  const prefix = intent.trailerPrefix ?? "that trailer";
  return {
    intent: "ambiguous_trailer",
    title: "Clarification required",
    answer: `Several trailers may match \"${prefix}\". Please enter the complete trailer number.`,
    resultType: "text",
    data: [],
    links: [],
    truncated: false,
  };
};

const queryUnknown = (): AssistantQueryResult => ({
  intent: "unknown",
  title: "Clarification required",
  answer: "I need more detail to answer that. Try a full trailer number, customer name, or a specific request like \"allocated trailers still in compound\".",
  resultType: "text",
  data: [],
  links: [],
  truncated: false,
});

export const runIntentQuery = async (context: AssistantContext, intent: AssistantIntent): Promise<AssistantQueryResult> => {
  const gate = new PermissionGate(context);

  const assistantDenied = await gate.firstDenied("ai_assistant");
  if (assistantDenied) {
    return permissionDeniedResult(assistantDenied);
  }

  switch (intent.intent) {
    case "trailer_location":
      return queryTrailerLocation(context, gate, intent);
    case "trailer_full_status":
      return queryTrailerFullStatus(context, gate, intent);
    case "trailer_history_summary":
      return queryTrailerHistorySummary(context, gate, intent);
    case "trailers_by_customer":
      return queryTrailersByCustomer(context, gate, intent);
    case "trailer_at_position":
      return queryTrailerAtPosition(context, gate, intent);
    case "allocated_still_in_compound":
      return queryAllocatedStillInCompound(context, gate, intent);
    case "waiting_collection_overdue":
      return queryWaitingCollectionOverdue(context, gate, intent);
    case "arrivals_pending_inspection":
      return queryArrivalsPendingInspection(context, gate, intent);
    case "temperature_alerts":
      return queryTemperatureAlerts(context, gate, intent);
    case "damage_alerts":
      return queryDamageAlerts(context, gate, intent);
    case "open_discrepancies":
      return queryOpenDiscrepancies(context, gate, intent);
    case "operational_status_issues":
      return queryOperationalStatusIssues(context, gate, intent);
    case "daily_operations_summary":
      return queryDailyOperationsSummary(context, gate);
    case "ambiguous_trailer":
      return queryAmbiguousTrailer(intent);
    default:
      return queryUnknown();
  }
};
