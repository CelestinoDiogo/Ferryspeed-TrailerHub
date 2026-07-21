export type ExportAllocationStatus =
  | "allocated"
  | "delivered_empty"
  | "waiting_loading"
  | "collected_loaded"
  | "completed"
  | "cancelled";

export type LegacyExportAllocationStatus =
  | "collected_by_haulier"
  | "waiting_loading"
  | "loading"
  | "loaded"
  | "returned"
  | "shipped";

export type ExportAllocationPriority = "low" | "normal" | "high" | "urgent";

export type ExportAllocationRecord = {
  id: string;
  trailer_id?: string | null;
  trailer_number?: string | null;
  customer?: string | null;
  collection_address?: string | null;
  haulier?: string | null;
  booking_reference?: string | null;
  load_type?: string | null;
  collection_date?: string | null;
  expected_return_at?: string | null;
  priority: ExportAllocationPriority;
  status: ExportAllocationStatus;
  notes?: string | null;
  allocated_at?: string | null;
  delivered_empty_at?: string | null;
  collected_loaded_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  collected_by_haulier_at?: string | null;
  waiting_loading_at?: string | null;
  loading_started_at?: string | null;
  loaded_at?: string | null;
  returned_at?: string | null;
  shipped_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ExportAllocationFilter =
  | "today"
  | "upcoming"
  | "allocated"
  | "delivered_empty"
  | "waiting_loading"
  | "collected_loaded"
  | "completed"
  | "cancelled"
  | "at_customer"
  | "overdue"
  | "all";

export const EXPORT_ACTIVE_STATUSES: ReadonlySet<ExportAllocationStatus> =
  new Set([
    "allocated",
    "delivered_empty",
    "waiting_loading",
    "collected_loaded",
  ]);

export const EXPORT_OFF_COMPOUND_STATUSES: ReadonlySet<ExportAllocationStatus> =
  new Set([
    "delivered_empty",
    "waiting_loading",
    "collected_loaded",
    "completed",
  ]);

export const EXPORT_ACTIVE_STATUS_QUERY_VALUES = [
  "allocated",
  "delivered_empty",
  "collected_loaded",
  "collected_by_haulier",
  "waiting_loading",
  "loading",
  "loaded",
] as const;

const LEGACY_STATUS_MAP: Record<
  LegacyExportAllocationStatus,
  ExportAllocationStatus
> = {
  collected_by_haulier: "delivered_empty",
  waiting_loading: "waiting_loading",
  loading: "waiting_loading",
  loaded: "collected_loaded",
  returned: "completed",
  shipped: "completed",
};

const STATUS_SEQUENCE: ExportAllocationStatus[] = [
  "allocated",
  "delivered_empty",
  "waiting_loading",
  "collected_loaded",
  "completed",
];

export function getPreviousExportAllocationStatus(
  status: ExportAllocationStatus,
): ExportAllocationStatus | null {
  if (status === "allocated" || status === "cancelled") {
    return null;
  }

  const index = STATUS_SEQUENCE.indexOf(status);
  if (index <= 0) {
    return null;
  }

  return STATUS_SEQUENCE[index - 1] ?? null;
}

export function normalizeExportAllocationStatus(
  status?: string | null,
): ExportAllocationStatus {
  const normalized = (status ?? "").trim().toLowerCase();

  switch (normalized) {
    case "allocated":
    case "delivered_empty":
    case "waiting_loading":
    case "collected_loaded":
    case "completed":
    case "cancelled":
      return normalized;

    case "collected_by_haulier":
    case "waiting_loading":
    case "loading":
    case "loaded":
    case "returned":
    case "shipped":
      return LEGACY_STATUS_MAP[normalized];

    default:
      return "allocated";
  }
}

export function normalizeExportAllocationRecord<
  T extends { status?: string | null },
>(record: T): T & { status: ExportAllocationStatus } {
  return {
    ...record,
    status: normalizeExportAllocationStatus(record.status),
  };
}

export function getExportAllocationStatusLabel(
  status: ExportAllocationStatus,
): string {
  switch (status) {
    case "allocated":
      return "Allocated";
    case "delivered_empty":
      return "Delivered Empty";
    case "waiting_loading":
      return "Waiting Loading";
    case "collected_loaded":
      return "Collected Loaded";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function getNextExportAllocationStatus(
  status: ExportAllocationStatus,
): ExportAllocationStatus | null {
  if (status === "cancelled" || status === "completed") {
    return null;
  }

  const index = STATUS_SEQUENCE.indexOf(status);

  if (index < 0 || index + 1 >= STATUS_SEQUENCE.length) {
    return null;
  }

  return STATUS_SEQUENCE[index + 1];
}

export function getAdvanceStatusActionLabel(
  status: ExportAllocationStatus,
): string | null {
  const next = getNextExportAllocationStatus(status);

  if (!next) {
    return null;
  }

  switch (next) {
    case "delivered_empty":
      return "Confirm Delivered Empty";
    case "waiting_loading":
      return "Mark Waiting Loading";
    case "collected_loaded":
      return "Confirm Collected Loaded";
    case "completed":
      return "Complete Export Cycle";
    default:
      return null;
  }
}

export function getExportAllocationStatusClasses(
  status: ExportAllocationStatus,
): string {
  switch (status) {
    case "allocated":
      return "border-cyan-400/30 bg-cyan-500/10 text-cyan-200";
    case "delivered_empty":
      return "border-indigo-400/30 bg-indigo-500/10 text-indigo-200";
    case "waiting_loading":
      return "border-amber-400/30 bg-amber-500/10 text-amber-200";
    case "collected_loaded":
      return "border-orange-400/30 bg-orange-500/10 text-orange-200";
    case "completed":
      return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
    case "cancelled":
      return "border-rose-400/30 bg-rose-500/10 text-rose-200";
    default:
      return "border-slate-500/30 bg-slate-500/10 text-slate-200";
  }
}

export function getExportAllocationPriorityLabel(
  priority: ExportAllocationPriority,
): string {
  switch (priority) {
    case "low":
      return "Low";
    case "normal":
      return "Normal";
    case "high":
      return "High";
    case "urgent":
      return "Urgent";
    default:
      return priority;
  }
}

export function getExportAllocationPriorityClasses(
  priority: ExportAllocationPriority,
): string {
  switch (priority) {
    case "low":
      return "border-slate-500/30 bg-slate-500/10 text-slate-200";
    case "normal":
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
    case "high":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    case "urgent":
      return "border-rose-500/30 bg-rose-500/10 text-rose-200";
    default:
      return "border-slate-500/30 bg-slate-500/10 text-slate-200";
  }
}

export function getExportAllocationTimestampField(
  status: ExportAllocationStatus,
):
  | "allocated_at"
  | "delivered_empty_at"
  | "waiting_loading_at"
  | "collected_loaded_at"
  | "completed_at"
  | "cancelled_at"
  | null {
  switch (status) {
    case "allocated":
      return "allocated_at";
    case "delivered_empty":
      return "delivered_empty_at";
    case "waiting_loading":
      return "waiting_loading_at";
    case "collected_loaded":
      return "collected_loaded_at";
    case "completed":
      return "completed_at";
    case "cancelled":
      return "cancelled_at";
    default:
      return null;
  }
}

export function getExportAllocationFilterFromQuery(
  value?: string | null,
): ExportAllocationFilter {
  switch (value) {
    case "today":
    case "upcoming":
    case "allocated":
    case "delivered_empty":
    case "waiting_loading":
    case "collected_loaded":
    case "completed":
    case "cancelled":
    case "at_customer":
    case "overdue":
    case "all":
      return value;
    default:
      return "today";
  }
}

export type TrailerAvailabilityInput = {
  id?: string | null;
  departure_date?: string | null;
  load_status?: string | null;
  operational_status?: string | null;
  is_local?: boolean | null;
  compound_position?: string | null;
};

const normalizeText = (value?: string | null) =>
  (value ?? "").trim().toLowerCase();

export function isTrailerAvailableForExportAllocation(
  trailer: TrailerAvailabilityInput,
  hasActiveAllocation: boolean,
): boolean {
  const isActive =
    !trailer.departure_date || trailer.departure_date.trim() === "";

  if (!isActive || hasActiveAllocation) {
    return false;
  }

  if (normalizeText(trailer.load_status) !== "empty") {
    return false;
  }

  if (normalizeText(trailer.operational_status) === "departed") {
    return false;
  }

  if (normalizeText(trailer.operational_status) === "maintenance") {
    return false;
  }

  if (normalizeText(trailer.operational_status) === "cancelled") {
    return false;
  }

  return true;
}

export function isExportAllocationOffCompoundStatus(
  status?: ExportAllocationStatus | string | null,
): boolean {
  return EXPORT_OFF_COMPOUND_STATUSES.has(normalizeExportAllocationStatus(status));
}

const normalizeCompoundPosition = (value?: string | null) => {
  const trimmed = (value ?? "").trim().toUpperCase();
  const match = trimmed.match(/^(P|A)?0*(\d{1,2})$/);
  if (!match) {
    return null;
  }

  const numericValue = Number(match[2]);
  if (numericValue < 1 || numericValue > 50) {
    return null;
  }

  return `P${numericValue.toString().padStart(2, "0")}`;
};

export function isTrailerPresentInCompoundInventory(
  trailer: TrailerAvailabilityInput,
  activeExportStatus?: ExportAllocationStatus | string | null,
): boolean {
  const hasCompoundPosition = Boolean(normalizeCompoundPosition(trailer.compound_position));

  if (!isTrailerEligibleForCompoundViews(trailer, activeExportStatus) || !hasCompoundPosition) {
    return false;
  }

  return true;
}

export function isTrailerEligibleForCompoundViews(
  trailer: TrailerAvailabilityInput,
  activeExportStatus?: ExportAllocationStatus | string | null,
): boolean {
  const isActive = !trailer.departure_date || trailer.departure_date.trim() === "";
  const inCompoundLane = trailer.is_local !== true;

  if (!isActive || !inCompoundLane) {
    return false;
  }

  if (isExportAllocationOffCompoundStatus(activeExportStatus)) {
    return false;
  }

  return true;
}

export function buildActiveExportStatusByTrailerId(
  allocations: Array<{ trailer_id?: string | null; status?: string | null }>,
) {
  const statusByTrailerId = new Map<string, ExportAllocationStatus>();

  for (const allocation of allocations) {
    if (!allocation.trailer_id) {
      continue;
    }

    const normalizedStatus = normalizeExportAllocationStatus(allocation.status);
    if (!EXPORT_ACTIVE_STATUSES.has(normalizedStatus)) {
      continue;
    }

    statusByTrailerId.set(allocation.trailer_id, normalizedStatus);
  }

  return statusByTrailerId;
}

export function isExportAllocationActive(
  status: ExportAllocationStatus,
): boolean {
  return EXPORT_ACTIVE_STATUSES.has(status);
}

export function isExportAllocationOverdue(
  allocation: {
    expected_return_at?: string | null;
    status: ExportAllocationStatus;
  },
  nowIso?: string,
): boolean {
  if (
    !allocation.expected_return_at ||
    allocation.status === "completed" ||
    allocation.status === "cancelled"
  ) {
    return false;
  }

  const now = nowIso ? new Date(nowIso) : new Date();
  const expected = new Date(allocation.expected_return_at);

  if (Number.isNaN(expected.getTime())) {
    return false;
  }

  return expected.getTime() < now.getTime();
}

export const COMPOUND_REFRESH_STORAGE_KEY = "ferryspeed:compound-updated";

type CompoundRefreshRpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

export type AutomaticWaitingAssignmentResult =
  | {
      assigned: true;
      trailerNumber: string | null;
      assignedPosition: string | null;
    }
  | {
      assigned: false;
      reason: "no_waiting" | "no_position";
    };

const extractFirstRpcRow = (value: unknown): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    const first = value[0];
    if (!first || typeof first !== "object") {
      return null;
    }

    return first as Record<string, unknown>;
  }

  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return null;
};

export async function assignNextWaitingTrailerAfterDeliveredEmpty(
  rpcClient: CompoundRefreshRpcClient,
): Promise<AutomaticWaitingAssignmentResult> {
  const { data, error } = await rpcClient.rpc("assign_next_waiting_trailer");

  if (error) {
    const normalizedMessage = (error.message ?? "").trim().toLowerCase();

    if (
      normalizedMessage.includes("compound is full") ||
      normalizedMessage.includes("no position is available")
    ) {
      return { assigned: false, reason: "no_position" };
    }

    if (normalizedMessage.includes("there are no trailers waiting for compound")) {
      return { assigned: false, reason: "no_waiting" };
    }

    throw new Error(error.message || "Unable to automatically assign waiting trailer.");
  }

  const row = extractFirstRpcRow(data);

  return {
    assigned: true,
    trailerNumber: (row?.trailer_number as string | null) ?? null,
    assignedPosition: (row?.assigned_position as string | null) ?? null,
  };
}