import { getTrailerOwnershipType, type TrailerOwnershipType } from "@/lib/trailer-ownership";

export type VesselOperationStatus =
  | "draft"
  | "confirmed"
  | "completed"
  | "planning"
  | "arriving"
  | "discharging"
  | "inspection"
  | "cancelled";

export type VesselTrailerStatus =
  | "expected"
  | "arrived"
  | "inspected"
  | "not_arrived"
  | "no_show"
  | "available_for_arrival"
  | "inspection_pending"
  | "inspection_in_progress"
  | "positioned"
  | "not_discharged"
  | "cancelled";

export type VesselPriorityLevel = "priority" | "normal";

export type VesselOperationRecord = {
  id: string;
  vessel_name?: string | null;
  sailing_reference?: string | null;
  origin_port?: string | null;
  berth?: string | null;
  expected_arrival_at?: string | null;
  actual_arrival_at?: string | null;
  status: VesselOperationStatus;
  list_status?: "draft" | "confirmed" | "reopened" | null;
  list_confirmed_at?: string | null;
  list_confirmed_by?: string | null;
  notes?: string | null;
  completed_at?: string | null;
  completed_by?: string | null;
  final_locked_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type VesselOperationTrailerRecord = {
  id: string;
  vessel_operation_id: string;
  trailer_id?: string | null;
  trailer_number?: string | null;
  customer?: string | null;
  booking_reference?: string | null;
  load_status?: string | null;
  load_description?: string | null;
  temperature_required?: string | null;
  expected_front_temperature?: number | null;
  expected_rear_temperature?: number | null;
  expected_temperature_unit?: string | null;
  priority_level: VesselPriorityLevel;
  priority_reason?: string | null;
  planned_destination?: string | null;
  planning_notes?: string | null;
  ownership_type?: TrailerOwnershipType | null;
  trailer_source?: string | null;
  external_company?: string | null;
  added_after_confirmation?: boolean | null;
  added_after_confirmation_at?: string | null;
  added_after_confirmation_by?: string | null;
  manifest_change_reason?: string | null;
  status: VesselTrailerStatus;
  arrived_at?: string | null;
  discharged_at?: string | null;
  arrival_status?: "expected" | "arrived" | "not_arrived" | "available_for_arrival" | "cancelled" | "not_discharged" | "no_show" | null;
  arrival_confirmed_at?: string | null;
  arrival_record_id?: string | null;
  arrival_confirmed_by?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancellation_reason?: string | null;
  no_show_at?: string | null;
  no_show_by?: string | null;
  no_show_reason?: string | null;
  inspection_started_at?: string | null;
  inspection_completed_at?: string | null;
  position_assigned_at?: string | null;
  assigned_position?: string | null;
  has_damage?: boolean | null;
  has_temperature_alert?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type VesselWorkflowStep =
  | "vessel"
  | "boat_list"
  | "planning"
  | "confirmed"
  | "discharge"
  | "checks"
  | "completed";

export type TrailerPlanningIssue = {
  field:
    | "trailer_number"
    | "ownership_type"
    | "customer_or_owner"
    | "priority_level"
    | "planned_destination"
    | "temperature_category"
    | "expected_front_temperature"
    | "expected_rear_temperature";
  message: string;
};

export type TrailerPlanningValidation = {
  trailerId: string;
  trailerNumber: string;
  issues: TrailerPlanningIssue[];
};

export type PlanningReadiness = {
  canConfirmList: boolean;
  incompleteTrailers: TrailerPlanningValidation[];
};

export type CompletionReadiness = {
  canComplete: boolean;
  blockers: Array<{ trailerId: string; trailerNumber: string; reason: string }>;
};

export type PlanningOwnershipSource = "company" | "outsourced" | "unknown" | "local";

export type PlanningOwnershipState = {
  ownershipType: TrailerOwnershipType;
  trailerSource: PlanningOwnershipSource;
  externalCompany: string;
};

export type SupabaseErrorLike = {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
  name?: string | null;
  status?: number | null;
};

export type VesselInspectionDamageRecord = {
  id: string;
  vessel_trailer_id?: string | null;
  damage_type?: string | null;
  damage_location?: string | null;
  severity?: string | null;
  description?: string | null;
  recorded_at?: string | null;
  recorded_by?: string | null;
};

export type VesselInspectionTemperatureRecord = {
  id: string;
  vessel_trailer_id?: string | null;
  trailer_id?: string | null;
  trailer_number?: string | null;
  temperature_value?: number | string | null;
  temperature_unit?: string | null;
  reading_point?: string | null;
  notes?: string | null;
  is_out_of_range?: boolean | null;
  recorded_at?: string | null;
  recorded_by?: string | null;
};

export type VesselTrailerTemperaturePair = {
  front: VesselInspectionTemperatureRecord | null;
  rear: VesselInspectionTemperatureRecord | null;
};

export type VesselInspectionPhotoRecord = {
  id: string;
  vessel_trailer_id?: string | null;
  trailer_id?: string | null;
  trailer_number?: string | null;
  vessel_operation_id?: string | null;
  category?: string | null;
  storage_path?: string | null;
  file_name?: string | null;
  description?: string | null;
  uploaded_at?: string | null;
  uploaded_by?: string | null;
};

export type VesselOperationSummary = {
  expected: number;
  arrived: number;
  notArrived: number;
  remaining: number;
  inspectionPending: number;
  inspected: number;
  damages: number;
  temperatureAlerts: number;
  availableForArrival: number;
  pending: number;
  priority: number;
  priorityRemaining: number;
  normal: number;
  cancelled: number;
  noShow: number;
  notDischarged: number;
  inProgress: number;
  positioned: number;
  pendingInspection: number;
  damagedTrailers: number;
};

export type VesselReceptionDestination = "compound" | "local" | "hold";
export type VesselReceptionLoadStatus = "" | "Empty" | "Loaded";

export const resolveVesselReceptionLoadStatus = (
  currentLoadStatus?: string | null,
  vesselLoadStatus?: string | null,
): VesselReceptionLoadStatus => {
  const incoming = vesselLoadStatus?.trim().toLowerCase();
  if (incoming === "loaded" || incoming === "empty") {
    return incoming === "loaded" ? "Loaded" : "Empty";
  }

  const current = currentLoadStatus?.trim().toLowerCase();
  if (current === "loaded" || current === "empty") {
    return current === "loaded" ? "Loaded" : "Empty";
  }

  return "";
};

export const resolveVesselReceptionOwnership = (input: {
  ownershipType?: string | null;
  vesselTrailerSource?: string | null;
  vesselExternalCompany?: string | null;
  currentTrailerSource?: string | null;
  currentExternalCompany?: string | null;
  trailerNumber?: string | null;
}) => {
  const historicalOwnership = getTrailerOwnershipType({
    ownershipType: input.ownershipType,
    trailerSource: input.vesselTrailerSource,
    externalCompany: input.vesselExternalCompany,
    trailerNumber: input.trailerNumber,
  });
  const currentOwnership = getTrailerOwnershipType({
    trailerSource: input.currentTrailerSource,
    externalCompany: input.currentExternalCompany,
    trailerNumber: input.trailerNumber,
  });
  const ownershipType = historicalOwnership === "unknown" ? currentOwnership : historicalOwnership;

  return {
    ownershipType,
    trailerSource: ownershipType === "outsourcing"
      ? "outsourced"
      : ownershipType === "company"
        ? "company"
        : input.currentTrailerSource?.trim() || input.vesselTrailerSource?.trim() || null,
    externalCompany: ownershipType === "outsourcing"
      ? input.vesselExternalCompany?.trim() || input.currentExternalCompany?.trim() || null
      : null,
  };
};

export type VesselArrivalWorkflowState = "expected" | "arrived" | "inspection_pending" | "inspected" | "received" | "cancelled";

export type VesselInspectionProgressState = "not_started" | "in_progress" | "completed" | "issues_found";

export const VESSEL_OPERATION_STATUS_LABELS: Record<VesselOperationStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  completed: "Completed",
  planning: "Draft",
  arriving: "Confirmed",
  discharging: "Confirmed",
  inspection: "Confirmed",
  cancelled: "Cancelled",
};

export const VESSEL_TRAILER_STATUS_LABELS: Record<VesselTrailerStatus, string> = {
  expected: "Expected",
  arrived: "Arrived",
  inspected: "Inspected",
  not_arrived: "Not Arrived",
  no_show: "No Show",
  available_for_arrival: "Expected",
  inspection_pending: "Arrived",
  inspection_in_progress: "Arrived",
  positioned: "Inspected",
  not_discharged: "Not Arrived",
  cancelled: "Not Arrived",
};

export const VESSEL_PRIORITY_LABELS: Record<VesselPriorityLevel, string> = {
  priority: "Priority",
  normal: "Normal",
};

export const PLANNED_DESTINATION_SUGGESTIONS = [
  "Priority Area",
  "Compound",
  "Workshop",
  "Direct Delivery",
  "Temperature Check Area",
  "Customs Area",
  "Other",
];

export const COMPOUND_POSITIONS = Array.from({ length: 50 }, (_, index) => `P${String(index + 1).padStart(2, "0")}`);

export const VESSEL_OPERATION_FILTERS = ["today", "tomorrow", "upcoming", "completed", "all"] as const;

const normalizeTrimmed = (value?: string | null) => value?.trim() ?? "";

export const toLocalDateKey = (date: Date = new Date()) => {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().split("T")[0];
};

export const getLocalDateInputValue = () => toLocalDateKey(new Date());

export const getVesselOperationExpectedDateKey = (expectedArrivalAt?: string | null) =>
  expectedArrivalAt?.slice(0, 10) ?? "";

export const isVesselOperationScheduledOnLocalDate = (
  operation: {
    expected_arrival_at?: string | null;
    actual_arrival_at?: string | null;
    created_at?: string | null;
    status?: string | null;
  },
  dateKey: string,
) => getVesselOperationExpectedDateKey(operation.expected_arrival_at) === dateKey && operation.status !== "cancelled";

export const getLocalDateTimeInputValue = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const localDate = new Date(now.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
};

export const formatVesselDate = (value?: string | null) => {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
};

export const formatVesselDateTime = (value?: string | null) => {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

export const normalizeTemperatureReadingPoint = (value?: string | null) => (value ?? "").trim().toLowerCase();

export const normalizeExpectedTemperatureUnit = (value?: string | null) => {
  const normalized = (value ?? "").trim().toUpperCase();
  if (!normalized) {
    return "C";
  }

  return normalized;
};

const parseLegacyFrontExpectedTemperature = (value?: string | null) => {
  const text = (value ?? "").trim();
  if (!text) {
    return null;
  }

  const direct = Number(text);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

export const resolveExpectedFrontTemperature = (trailer: Pick<VesselOperationTrailerRecord, "expected_front_temperature" | "temperature_required">) => {
  if (typeof trailer.expected_front_temperature === "number" && Number.isFinite(trailer.expected_front_temperature)) {
    return trailer.expected_front_temperature;
  }

  return parseLegacyFrontExpectedTemperature(trailer.temperature_required);
};

export const resolveExpectedRearTemperature = (trailer: Pick<VesselOperationTrailerRecord, "expected_rear_temperature">) => {
  if (typeof trailer.expected_rear_temperature === "number" && Number.isFinite(trailer.expected_rear_temperature)) {
    return trailer.expected_rear_temperature;
  }

  return null;
};

export const getTrailerTemperaturePair = (rows: VesselInspectionTemperatureRecord[]): VesselTrailerTemperaturePair => {
  const front = rows.find((row) => normalizeTemperatureReadingPoint(row.reading_point) === "front") ?? null;
  const rear = rows.find((row) => normalizeTemperatureReadingPoint(row.reading_point) === "rear") ?? null;

  return { front, rear };
};

export const formatTemperatureReading = (row?: VesselInspectionTemperatureRecord | null) => {
  if (!row || row.temperature_value === null || row.temperature_value === undefined || row.temperature_value === "") {
    return "-";
  }

  return `${row.temperature_value} ${row.temperature_unit ?? "C"}`;
};

export const formatVesselTime = (value?: string | null) => {
  if (!value) return "—";
  return value.slice(0, 5) || "—";
};

export const normalizeTrailerNumber = (value?: string | null) =>
  normalizeTrimmed(value).replace(/\s+/g, " ").toUpperCase();

export const compareTrailerNumber = (left?: string | null, right?: string | null) => {
  const leftValue = normalizeTrailerNumber(left);
  const rightValue = normalizeTrailerNumber(right);

  if (!leftValue && !rightValue) {
    return 0;
  }
  if (!leftValue) {
    return 1;
  }
  if (!rightValue) {
    return -1;
  }

  return leftValue.localeCompare(rightValue, undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

export const isPendingVesselArrivalStatus = (arrivalStatus?: string | null) => {
  const normalized = normalizeTrimmed(arrivalStatus).toLowerCase();
  return normalized === "expected" || normalized === "available_for_arrival";
};

export const isArrivedVesselArrivalStatus = (arrivalStatus?: string | null) =>
  normalizeTrimmed(arrivalStatus).toLowerCase() === "arrived";

export const getVesselTrailerDischargedAt = (
  trailer: Pick<VesselOperationTrailerRecord, "discharged_at"> | { discharged_at?: string | null },
) => trailer.discharged_at ?? null;

export const getVesselTrailerReceptionAt = (
  trailer: Pick<VesselOperationTrailerRecord, "arrival_confirmed_at" | "arrived_at"> | {
    arrival_confirmed_at?: string | null;
    arrived_at?: string | null;
  },
) => trailer.arrival_confirmed_at ?? trailer.arrived_at ?? null;

export const normalizeCompoundPosition = (value?: string | null) => {
  const trimmed = value?.trim().toUpperCase();
  if (!trimmed) {
    return null;
  }

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

export const getAvailableCompoundPositions = (occupiedPositions: Set<string>) =>
  COMPOUND_POSITIONS.filter((position) => !occupiedPositions.has(position));

export const getFirstAvailableCompoundPosition = (occupiedPositions: Set<string>) =>
  COMPOUND_POSITIONS.find((position) => !occupiedPositions.has(position)) ?? null;

export const hasCompletedBoatCheck = (trailer: Pick<VesselOperationTrailerRecord, "status" | "inspection_completed_at">) =>
  trailer.status === "inspected" || Boolean(trailer.inspection_completed_at);

type VesselCancellationEligibilityRow = Pick<
  VesselOperationTrailerRecord,
  "arrival_status" | "arrival_record_id" | "inspection_started_at" | "inspection_completed_at" | "status"
>;

const hasVesselArrivalHistory = (trailer: VesselCancellationEligibilityRow) =>
  Boolean(trailer.arrival_record_id) ||
  Boolean(trailer.inspection_started_at) ||
  Boolean(trailer.inspection_completed_at) ||
  trailer.status === "arrived" ||
  trailer.status === "inspected";

export const canCancelVesselTrailer = (trailer: VesselCancellationEligibilityRow) =>
  (trailer.arrival_status === "expected" || trailer.arrival_status === "available_for_arrival") &&
  !hasVesselArrivalHistory(trailer);

export const canUndoVesselTrailerCancellation = (trailer: VesselCancellationEligibilityRow) =>
  trailer.arrival_status === "cancelled" && !hasVesselArrivalHistory(trailer);

export const getVesselInspectionProgressState = (
  trailer: Pick<VesselOperationTrailerRecord, "inspection_started_at" | "inspection_completed_at" | "has_damage" | "has_temperature_alert" | "status">,
): VesselInspectionProgressState => {
  const completed = trailer.status === "inspected" || Boolean(trailer.inspection_completed_at);
  const started = Boolean(trailer.inspection_started_at);
  const hasIssues = Boolean(trailer.has_damage) || Boolean(trailer.has_temperature_alert);

  if (completed && hasIssues) {
    return "issues_found";
  }

  if (completed) {
    return "completed";
  }

  if (started) {
    return "in_progress";
  }

  return "not_started";
};

export const getVesselInspectionProgressLabel = (state: VesselInspectionProgressState) => {
  switch (state) {
    case "not_started":
      return "Not Started";
    case "in_progress":
      return "In Progress";
    case "completed":
      return "Completed";
    case "issues_found":
      return "Issues Found";
    default:
      return "Not Started";
  }
};

export const getVesselArrivalWorkflowState = (
  trailer: Pick<
    VesselOperationTrailerRecord,
    "arrival_status" | "arrival_record_id" | "status" | "inspection_started_at" | "inspection_completed_at" | "has_damage" | "has_temperature_alert"
  >,
): VesselArrivalWorkflowState => {
  if (
    trailer.arrival_status === "cancelled" ||
    trailer.status === "cancelled" ||
    trailer.arrival_status === "no_show" ||
    trailer.status === "no_show" ||
    trailer.arrival_status === "not_discharged" ||
    trailer.status === "not_discharged"
  ) {
    return "cancelled";
  }

  if (trailer.arrival_record_id) {
    return "received";
  }

  if (trailer.arrival_status !== "arrived") {
    return "expected";
  }

  return hasCompletedBoatCheck(trailer) ? "inspected" : "inspection_pending";
};

export const getVesselArrivalWorkflowLabel = (state: VesselArrivalWorkflowState) => {
  switch (state) {
    case "expected":
      return "Expected";
    case "arrived":
      return "Arrived";
    case "inspection_pending":
      return "Inspection Pending";
    case "inspected":
      return "Inspected";
    case "received":
      return "Received";
    case "cancelled":
      return "Cancelled";
    default:
      return "Expected";
  }
};

export const canConfirmVesselTrailerReception = (
  trailer: Pick<VesselOperationTrailerRecord, "arrival_status" | "arrival_record_id" | "status" | "inspection_completed_at">,
  operation?: Pick<VesselOperationRecord, "status"> | null,
) => {
  if (!trailer || trailer.arrival_status !== "arrived") {
    return false;
  }

  if (trailer.arrival_record_id) {
    return false;
  }

  if (trailer.status === "not_arrived") {
    return false;
  }

  return operation?.status !== "cancelled";
};

export const getVesselReceptionDate = (value?: string | null) => {
  const sourceValue = value ?? new Date().toISOString();
  return sourceValue.split("T")[0] ?? new Date().toISOString().split("T")[0];
};

export const normalizeVesselText = (value?: string | null) => normalizeTrimmed(value).toLowerCase();

export const getVesselOperationStatusLabel = (status: VesselOperationStatus) => VESSEL_OPERATION_STATUS_LABELS[status] ?? status;

export const getVesselTrailerStatusLabel = (status: VesselTrailerStatus) => VESSEL_TRAILER_STATUS_LABELS[status] ?? status;

export const getVesselPriorityLabel = (priority: VesselPriorityLevel) => VESSEL_PRIORITY_LABELS[priority] ?? priority;

export const getVesselOperationStatusClass = (status: VesselOperationStatus) => {
  switch (status) {
    case "draft":
    case "planning":
      return "border-slate-500/30 bg-slate-500/10 text-slate-200";
    case "confirmed":
    case "arriving":
    case "discharging":
    case "inspection":
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
    case "completed":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    case "cancelled":
      return "border-slate-500/30 bg-slate-500/10 text-slate-300";
    default:
      return "border-slate-500/30 bg-slate-500/10 text-slate-200";
  }
};

export const getVesselTrailerStatusClass = (status: VesselTrailerStatus) => {
  switch (status) {
    case "expected":
    case "available_for_arrival":
      return "border-slate-500/30 bg-slate-500/10 text-slate-200";
    case "arrived":
    case "inspection_pending":
    case "inspection_in_progress":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    case "inspected":
    case "positioned":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    case "not_arrived":
    case "no_show":
    case "not_discharged":
    case "cancelled":
      return "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200";
    default:
      return "border-slate-500/30 bg-slate-500/10 text-slate-200";
  }
};

export const getVesselPriorityClass = (priority: VesselPriorityLevel) => {
  switch (priority) {
    case "priority":
      return "border-rose-500/35 bg-rose-500/15 text-rose-100";
    case "normal":
      return "border-slate-500/30 bg-slate-500/10 text-slate-200";
    default:
      return "border-slate-500/30 bg-slate-500/10 text-slate-200";
  }
};

export const getVesselTrailerSortRank = (status: VesselTrailerStatus) => {
  switch (status) {
    case "expected":
    case "available_for_arrival":
      return 0;
    case "arrived":
    case "inspection_pending":
    case "inspection_in_progress":
      return 1;
    case "inspected":
    case "positioned":
      return 2;
    case "not_arrived":
    case "no_show":
    case "not_discharged":
    case "cancelled":
      return 3;
    default:
      return 4;
  }
};

export const sortVesselOperationTrailersForArrivals = <T extends { trailer_number?: string | null }>(items: T[]) =>
  [...items].sort((left, right) => compareTrailerNumber(left.trailer_number, right.trailer_number));

export const computeVesselOperationSummary = (
  trailers: Array<Pick<VesselOperationTrailerRecord, "priority_level" | "status" | "has_damage" | "has_temperature_alert" | "arrival_status">>,
): VesselOperationSummary => {
  const isCancelledOrNoShow = (item: Pick<VesselOperationTrailerRecord, "status" | "arrival_status">) =>
    item.status === "cancelled" ||
    item.arrival_status === "cancelled" ||
    item.status === "no_show" ||
    item.arrival_status === "no_show";

  const isNotArrived = (item: Pick<VesselOperationTrailerRecord, "status" | "arrival_status">) =>
    !isCancelledOrNoShow(item) &&
    item.status !== "not_discharged" &&
    item.arrival_status !== "not_discharged" &&
    (item.status === "not_arrived" || item.arrival_status === "not_arrived");

  const isArrived = (item: Pick<VesselOperationTrailerRecord, "status" | "arrival_status">) =>
    item.arrival_status === "arrived" || item.status === "arrived" || item.status === "inspected" || item.status === "positioned" || item.status === "inspection_pending" || item.status === "inspection_in_progress";

  const isInspected = (item: Pick<VesselOperationTrailerRecord, "status">) =>
    item.status === "inspected" || item.status === "positioned";

  const activeTrailers = trailers.filter((item) => !isCancelledOrNoShow(item));
  const expected = activeTrailers.length;
  const arrived = activeTrailers.filter((item) => isArrived(item)).length;
  const inspected = activeTrailers.filter((item) => isInspected(item)).length;
  const notArrived = activeTrailers.filter((item) => isNotArrived(item)).length;
  const notDischarged = activeTrailers.filter((item) => item.status === "not_discharged" || item.arrival_status === "not_discharged").length;
  const remaining = Math.max(expected - arrived - notArrived - notDischarged, 0);
  const inspectionPending = Math.max(arrived - inspected, 0);
  const availableForArrival = remaining;
  const pending = remaining;
  const priority = trailers.filter((item) => item.priority_level === "priority").length;
  const priorityRemaining = trailers.filter((item) => item.priority_level === "priority" && !isArrived(item) && !isNotArrived(item)).length;
  const normal = trailers.filter((item) => item.priority_level !== "priority").length;
  const cancelled = trailers.filter((item) => item.status === "cancelled" || item.arrival_status === "cancelled").length;
  const noShow = trailers.filter((item) => item.status === "no_show" || item.arrival_status === "no_show").length;
  const inProgress = trailers.filter((item) => item.status === "inspection_in_progress").length;
  const positioned = trailers.filter((item) => item.status === "positioned").length;
  const damagedTrailers = trailers.filter((item) => item.has_damage).length;
  const temperatureAlerts = trailers.filter((item) => item.has_temperature_alert).length;

  return {
    expected,
    arrived,
    notArrived,
    remaining,
    inspectionPending,
    inspected,
    damages: damagedTrailers,
    temperatureAlerts,
    availableForArrival,
    pending,
    priority,
    priorityRemaining,
    normal,
    cancelled,
    noShow,
    notDischarged,
    inProgress,
    positioned,
    pendingInspection: inspectionPending,
    damagedTrailers,
  };
};

export const getVesselOperationFilterLabel = (filter: (typeof VESSEL_OPERATION_FILTERS)[number]) => {
  switch (filter) {
    case "today":
      return "Today";
    case "tomorrow":
      return "Tomorrow";
    case "upcoming":
      return "Upcoming";
    case "completed":
      return "Completed";
    case "all":
      return "All";
    default:
      return filter;
  }
};

export const logVesselSupabaseError = (label: string, error?: SupabaseErrorLike | null) => {
  if (!error) {
    return;
  }

  console.error(label, {
    error,
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code,
    name: error.name,
    status: error.status,
  });
};

export const buildVesselSupabaseErrorMessage = (error?: SupabaseErrorLike | null, fallback = "Unable to complete vessel operation request.") => {
  if (!error) {
    return fallback;
  }

  return fallback;
};

const normalizeOwnership = (value?: string | null): TrailerOwnershipType => {
  if (value === "company" || value === "outsourcing" || value === "unknown") {
    return value;
  }

  return "unknown";
};

export const applyPlanningOwnershipSelection = (
  requestedOwnership: TrailerOwnershipType,
  currentSource?: string | null,
  currentExternalCompany?: string | null,
): PlanningOwnershipState => {
  const normalizedSource = normalizeVesselText(currentSource);
  const isLocal = normalizedSource === "local";
  const externalCompany = (currentExternalCompany ?? "").trim();

  if (isLocal) {
    return {
      ownershipType: "unknown",
      trailerSource: "local",
      externalCompany: "",
    };
  }

  if (requestedOwnership === "outsourcing") {
    return {
      ownershipType: "outsourcing",
      trailerSource: "outsourced",
      externalCompany,
    };
  }

  if (requestedOwnership === "company") {
    return {
      ownershipType: "company",
      trailerSource: "company",
      externalCompany: "",
    };
  }

  return {
    ownershipType: "unknown",
    trailerSource: "unknown",
    externalCompany: "",
  };
};

const looksTemperatureControlled = (trailer: Pick<VesselOperationTrailerRecord, "temperature_required" | "expected_front_temperature" | "expected_rear_temperature">) => {
  if (typeof trailer.expected_front_temperature === "number" || typeof trailer.expected_rear_temperature === "number") {
    return true;
  }

  const requiredText = normalizeVesselText(trailer.temperature_required);
  if (requiredText) {
    return true;
  }

  return false;
};

export const validateTrailerPlanning = (
  trailer: Pick<
    VesselOperationTrailerRecord,
    | "id"
    | "trailer_number"
    | "customer"
    | "priority_level"
    | "planned_destination"
    | "temperature_required"
    | "expected_front_temperature"
    | "expected_rear_temperature"
    | "ownership_type"
    | "external_company"
    | "status"
    | "arrival_status"
  >,
): TrailerPlanningValidation => {
  const trailerNumber = normalizeTrailerNumber(trailer.trailer_number);
  const issues: TrailerPlanningIssue[] = [];
  const ownershipType = normalizeOwnership(trailer.ownership_type);
  const temperatureControlled = looksTemperatureControlled(trailer);

  if (!trailerNumber) {
    issues.push({
      field: "trailer_number",
      message: "Trailer number is required.",
    });
  }

  if (!trailer.ownership_type) {
    issues.push({
      field: "ownership_type",
      message: "Ownership is required.",
    });
  }

  if (ownershipType === "unknown") {
    issues.push({
      field: "ownership_type",
      message: "Select trailer ownership.",
    });
  }

  if (ownershipType === "outsourcing") {
    const hasOwner = normalizeVesselText(trailer.external_company).length > 0;
    if (!hasOwner) {
      issues.push({
        field: "customer_or_owner",
        message: "Enter external company for outsourcing trailer.",
      });
    }
  }

  if (!(trailer.priority_level === "priority" || trailer.priority_level === "normal")) {
    issues.push({
      field: "priority_level",
      message: "Priority is required.",
    });
  }

  if (!normalizeVesselText(trailer.planned_destination)) {
    issues.push({
      field: "planned_destination",
      message: "Planned destination is required.",
    });
  }

  if (temperatureControlled && trailer.expected_front_temperature === null) {
    issues.push({
      field: "expected_front_temperature",
      message: "Expected front temperature is required for temperature-controlled trailers.",
    });
  }

  if (temperatureControlled && trailer.expected_rear_temperature === null) {
    issues.push({
      field: "expected_rear_temperature",
      message: "Expected rear temperature is required for temperature-controlled trailers.",
    });
  }

  return {
    trailerId: trailer.id,
    trailerNumber: trailerNumber || "(missing trailer number)",
    issues,
  };
};

export const getPlanningReadiness = (
  trailers: Array<
    Pick<
      VesselOperationTrailerRecord,
      | "id"
      | "trailer_number"
      | "customer"
      | "priority_level"
      | "planned_destination"
      | "temperature_required"
      | "expected_front_temperature"
      | "expected_rear_temperature"
      | "ownership_type"
      | "external_company"
      | "status"
      | "arrival_status"
    >
  >,
): PlanningReadiness => {
  const incompleteTrailers = trailers
    .filter((item) => item.status !== "cancelled" && item.arrival_status !== "cancelled" && item.status !== "no_show" && item.arrival_status !== "no_show")
    .map((item) => validateTrailerPlanning(item))
    .filter((item) => item.issues.length > 0);

  return {
    canConfirmList: trailers.length > 0 && incompleteTrailers.length === 0,
    incompleteTrailers,
  };
};

export const getCompletionReadiness = (
  trailers: Array<
    Pick<
      VesselOperationTrailerRecord,
      | "id"
      | "trailer_number"
      | "status"
      | "arrival_status"
      | "inspection_completed_at"
      | "temperature_required"
      | "expected_front_temperature"
      | "expected_rear_temperature"
      | "added_after_confirmation"
      | "customer"
      | "priority_level"
      | "planned_destination"
      | "ownership_type"
      | "external_company"
    >
  >,
): CompletionReadiness => {
  const blockers: Array<{ trailerId: string; trailerNumber: string; reason: string }> = [];

  for (const trailer of trailers) {
    const trailerNumber = normalizeTrailerNumber(trailer.trailer_number) || "(missing trailer number)";
    const isTerminalExcluded =
      trailer.status === "cancelled" ||
      trailer.arrival_status === "cancelled" ||
      trailer.status === "no_show" ||
      trailer.arrival_status === "no_show";
    if (isTerminalExcluded) {
      continue;
    }

    const arrivalStatus = trailer.arrival_status ?? "expected";
    const isArrived = arrivalStatus === "arrived";
    const isNotDischarged = arrivalStatus === "not_discharged" || trailer.status === "not_arrived" || trailer.status === "not_discharged";
    const isExpected = arrivalStatus === "expected" || arrivalStatus === "available_for_arrival";

    if (!isArrived && !isNotDischarged && isExpected) {
      blockers.push({
        trailerId: trailer.id,
        trailerNumber,
        reason: "Trailer must be arrived or explicitly marked not discharged/cancelled.",
      });
      continue;
    }

    if (trailer.added_after_confirmation) {
      const planning = validateTrailerPlanning(trailer);
      if (planning.issues.length > 0) {
        blockers.push({
          trailerId: trailer.id,
          trailerNumber,
          reason: "Added-after-confirmation trailer has incomplete planning data.",
        });
      }
    }

    if (isArrived && !trailer.inspection_completed_at && trailer.status !== "inspected") {
      blockers.push({
        trailerId: trailer.id,
        trailerNumber,
        reason: "Arrived trailer still has pending checks.",
      });
    }
  }

  return {
    canComplete: trailers.length > 0 && blockers.length === 0,
    blockers,
  };
};

export const deriveVesselWorkflowStep = (
  operation: Pick<VesselOperationRecord, "status" | "list_status" | "completed_at" | "final_locked_at"> | null | undefined,
  trailers: Array<Pick<VesselOperationTrailerRecord, "arrival_status" | "status" | "inspection_completed_at">>,
): VesselWorkflowStep => {
  if (!operation) {
    return "vessel";
  }

  if (operation.status === "completed" || operation.final_locked_at || operation.completed_at) {
    return "completed";
  }

  if (trailers.length === 0) {
    return "boat_list";
  }

  if ((operation.list_status ?? "draft") !== "confirmed") {
    return "planning";
  }

  const hasArrivals = trailers.some((trailer) => trailer.arrival_status === "arrived" || trailer.status === "arrived" || trailer.status === "inspected");
  if (!hasArrivals) {
    return "confirmed";
  }

  const pendingChecks = trailers.some(
    (trailer) => trailer.arrival_status === "arrived" && trailer.status !== "inspected" && !trailer.inspection_completed_at,
  );

  if (pendingChecks) {
    return "checks";
  }

  return "discharge";
};
