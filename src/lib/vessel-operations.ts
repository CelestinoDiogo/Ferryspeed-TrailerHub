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
  status: VesselTrailerStatus;
  arrived_at?: string | null;
  arrival_status?: "expected" | "arrived" | "not_arrived" | "available_for_arrival" | "cancelled" | "not_discharged" | null;
  arrival_confirmed_at?: string | null;
  arrival_record_id?: string | null;
  arrival_confirmed_by?: string | null;
  inspection_started_at?: string | null;
  inspection_completed_at?: string | null;
  position_assigned_at?: string | null;
  assigned_position?: string | null;
  has_damage?: boolean | null;
  has_temperature_alert?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
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
  notDischarged: number;
  inProgress: number;
  positioned: number;
  pendingInspection: number;
  damagedTrailers: number;
};

export type VesselReceptionDestination = "compound" | "local" | "hold";
export type VesselReceptionLoadStatus = "Empty" | "Loaded";

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
  cancelled: "Completed",
};

export const VESSEL_TRAILER_STATUS_LABELS: Record<VesselTrailerStatus, string> = {
  expected: "Expected",
  arrived: "Arrived",
  inspected: "Inspected",
  not_arrived: "Not Arrived",
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

export const getLocalDateInputValue = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const localDate = new Date(now.getTime() - offset * 60_000);
  return localDate.toISOString().split("T")[0];
};

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
  if (trailer.arrival_status === "cancelled" || trailer.status === "cancelled" || trailer.arrival_status === "not_discharged" || trailer.status === "not_discharged") {
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
    case "cancelled":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
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
    case "not_discharged":
    case "cancelled":
      return 3;
    default:
      return 4;
  }
};

export const sortVesselOperationTrailersForArrivals = <T extends { priority_level?: VesselPriorityLevel | null; status?: VesselTrailerStatus | null; trailer_number?: string | null }>(items: T[]) =>
  [...items].sort((left, right) => {
    const leftPriority = left.priority_level === "priority" ? 0 : 1;
    const rightPriority = right.priority_level === "priority" ? 0 : 1;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;

    const leftStatus = getVesselTrailerSortRank((left.status ?? "expected") as VesselTrailerStatus);
    const rightStatus = getVesselTrailerSortRank((right.status ?? "expected") as VesselTrailerStatus);
    if (leftStatus !== rightStatus) return leftStatus - rightStatus;

    return normalizeVesselText(left.trailer_number).localeCompare(normalizeVesselText(right.trailer_number));
  });

export const computeVesselOperationSummary = (
  trailers: Array<Pick<VesselOperationTrailerRecord, "priority_level" | "status" | "has_damage" | "has_temperature_alert" | "arrival_status">>,
): VesselOperationSummary => {
  const isNotArrived = (item: Pick<VesselOperationTrailerRecord, "status" | "arrival_status">) =>
    item.status === "not_arrived" || item.arrival_status === "not_arrived" || item.status === "cancelled" || item.arrival_status === "cancelled" || item.status === "not_discharged" || item.arrival_status === "not_discharged";

  const isArrived = (item: Pick<VesselOperationTrailerRecord, "status" | "arrival_status">) =>
    item.arrival_status === "arrived" || item.status === "arrived" || item.status === "inspected" || item.status === "positioned" || item.status === "inspection_pending" || item.status === "inspection_in_progress";

  const isInspected = (item: Pick<VesselOperationTrailerRecord, "status">) =>
    item.status === "inspected" || item.status === "positioned";

  const expected = trailers.length;
  const arrived = trailers.filter((item) => isArrived(item)).length;
  const inspected = trailers.filter((item) => isInspected(item)).length;
  const notArrived = trailers.filter((item) => isNotArrived(item)).length;
  const remaining = Math.max(expected - arrived - notArrived, 0);
  const inspectionPending = Math.max(arrived - inspected, 0);
  const availableForArrival = remaining;
  const pending = remaining;
  const priority = trailers.filter((item) => item.priority_level === "priority").length;
  const priorityRemaining = trailers.filter((item) => item.priority_level === "priority" && !isArrived(item) && !isNotArrived(item)).length;
  const normal = trailers.filter((item) => item.priority_level !== "priority").length;
  const cancelled = trailers.filter((item) => item.status === "cancelled" || item.arrival_status === "cancelled").length;
  const notDischarged = trailers.filter((item) => item.status === "not_discharged" || item.arrival_status === "not_discharged").length;
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
