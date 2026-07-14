export type VesselOperationStatus =
  | "planning"
  | "arriving"
  | "discharging"
  | "inspection"
  | "completed"
  | "cancelled";

export type VesselTrailerStatus =
  | "expected"
  | "available_for_arrival"
  | "arrived"
  | "inspection_pending"
  | "inspection_in_progress"
  | "inspected"
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
  priority_level: VesselPriorityLevel;
  priority_reason?: string | null;
  planned_destination?: string | null;
  planning_notes?: string | null;
  status: VesselTrailerStatus;
  arrived_at?: string | null;
  arrival_status?: "expected" | "available_for_arrival" | "arrived" | "cancelled" | "not_discharged" | null;
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
};

export type VesselInspectionDamageRecord = {
  id: string;
  vessel_operation_id: string;
  vessel_operation_trailer_id: string;
  damage_type?: string | null;
  damage_location?: string | null;
  severity?: string | null;
  description?: string | null;
  recorded_at?: string | null;
  recorded_by?: string | null;
};

export type VesselInspectionTemperatureRecord = {
  id: string;
  vessel_operation_id: string;
  vessel_operation_trailer_id: string;
  temperature_value?: number | string | null;
  unit?: string | null;
  reading_point?: string | null;
  notes?: string | null;
  out_of_range?: boolean | null;
  recorded_at?: string | null;
  recorded_by?: string | null;
};

export type VesselInspectionPhotoRecord = {
  id: string;
  vessel_operation_id: string;
  vessel_operation_trailer_id: string;
  category?: string | null;
  storage_path?: string | null;
  file_name?: string | null;
  description?: string | null;
  uploaded_at?: string | null;
  uploaded_by?: string | null;
};

export type VesselOperationSummary = {
  expected: number;
  availableForArrival: number;
  arrived: number;
  remaining: number;
  pending: number;
  priority: number;
  priorityRemaining: number;
  normal: number;
  cancelled: number;
  notDischarged: number;
  pendingInspection: number;
  inProgress: number;
  inspected: number;
  positioned: number;
  damagedTrailers: number;
  temperatureAlerts: number;
};

export const VESSEL_OPERATION_STATUS_LABELS: Record<VesselOperationStatus, string> = {
  planning: "Planning",
  arriving: "Arriving",
  discharging: "Discharging",
  inspection: "Inspection",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const VESSEL_TRAILER_STATUS_LABELS: Record<VesselTrailerStatus, string> = {
  expected: "Expected",
  available_for_arrival: "Available for Arrival",
  arrived: "Arrived",
  inspection_pending: "Inspection Pending",
  inspection_in_progress: "Inspection In Progress",
  inspected: "Inspected",
  positioned: "Positioned",
  not_discharged: "Not Discharged",
  cancelled: "Cancelled",
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

export const formatVesselTime = (value?: string | null) => {
  if (!value) return "—";
  return value.slice(0, 5) || "—";
};

export const normalizeTrailerNumber = (value?: string | null) =>
  normalizeTrimmed(value).replace(/\s+/g, " ").toUpperCase();

export const normalizeVesselText = (value?: string | null) => normalizeTrimmed(value).toLowerCase();

export const getVesselOperationStatusLabel = (status: VesselOperationStatus) => VESSEL_OPERATION_STATUS_LABELS[status] ?? status;

export const getVesselTrailerStatusLabel = (status: VesselTrailerStatus) => VESSEL_TRAILER_STATUS_LABELS[status] ?? status;

export const getVesselPriorityLabel = (priority: VesselPriorityLevel) => VESSEL_PRIORITY_LABELS[priority] ?? priority;

export const getVesselOperationStatusClass = (status: VesselOperationStatus) => {
  switch (status) {
    case "planning":
      return "border-slate-500/30 bg-slate-500/10 text-slate-200";
    case "arriving":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    case "discharging":
      return "border-orange-500/30 bg-orange-500/10 text-orange-200";
    case "inspection":
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
    case "completed":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    case "cancelled":
      return "border-rose-500/30 bg-rose-500/10 text-rose-200";
    default:
      return "border-slate-500/30 bg-slate-500/10 text-slate-200";
  }
};

export const getVesselTrailerStatusClass = (status: VesselTrailerStatus) => {
  switch (status) {
    case "expected":
      return "border-slate-500/30 bg-slate-500/10 text-slate-200";
    case "available_for_arrival":
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
    case "arrived":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    case "inspection_pending":
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
    case "inspection_in_progress":
      return "border-orange-500/30 bg-orange-500/10 text-orange-200";
    case "inspected":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    case "positioned":
      return "border-violet-500/30 bg-violet-500/10 text-violet-200";
    case "not_discharged":
      return "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200";
    case "cancelled":
      return "border-rose-500/30 bg-rose-500/10 text-rose-200";
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
      return 0;
    case "available_for_arrival":
      return 1;
    case "inspection_pending":
      return 2;
    case "inspection_in_progress":
      return 3;
    case "arrived":
      return 4;
    case "inspected":
      return 5;
    case "positioned":
      return 6;
    case "not_discharged":
      return 7;
    case "cancelled":
      return 8;
    default:
      return 9;
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
  const expected = trailers.filter((item) => item.arrival_status !== "cancelled").length;
  const availableForArrival = trailers.filter((item) => item.arrival_status === "available_for_arrival").length;
  const arrived = trailers.filter((item) => item.arrival_status === "arrived").length;
  const remaining = trailers.filter((item) => item.arrival_status === "expected").length;
  const pending = trailers.filter((item) => item.arrival_status === "expected" || item.arrival_status === "available_for_arrival").length;
  const priority = trailers.filter((item) => item.priority_level === "priority" && item.arrival_status !== "cancelled").length;
  const priorityRemaining = trailers.filter((item) => item.priority_level === "priority" && (item.arrival_status === "expected" || item.arrival_status === "available_for_arrival")).length;
  const normal = trailers.filter((item) => item.priority_level === "normal" && item.arrival_status !== "cancelled").length;
  const cancelled = trailers.filter((item) => item.arrival_status === "cancelled").length;
  const notDischarged = trailers.filter((item) => item.arrival_status === "not_discharged").length;
  const pendingInspection = trailers.filter((item) => item.status === "inspection_pending").length;
  const inProgress = trailers.filter((item) => item.status === "inspection_in_progress").length;
  const inspected = trailers.filter((item) => item.status === "inspected" || item.status === "positioned").length;
  const positioned = trailers.filter((item) => item.status === "positioned").length;
  const damagedTrailers = trailers.filter((item) => item.has_damage).length;
  const temperatureAlerts = trailers.filter((item) => item.has_temperature_alert).length;

  return {
    expected,
    availableForArrival,
    arrived,
    remaining,
    pending,
    priority,
    priorityRemaining,
    normal,
    cancelled,
    notDischarged,
    pendingInspection,
    inProgress,
    inspected,
    positioned,
    damagedTrailers,
    temperatureAlerts,
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

  console.error(label, error);
};

export const buildVesselSupabaseErrorMessage = (error?: SupabaseErrorLike | null, fallback = "Unable to complete vessel operation request.") => {
  if (!error) {
    return fallback;
  }

  return [error.message, error.details, error.hint].filter(Boolean).join(" — ") || fallback;
};
