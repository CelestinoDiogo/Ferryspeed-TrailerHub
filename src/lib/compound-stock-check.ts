import type { Database } from "@/lib/database.types";

export type StockCheck = Database["public"]["Tables"]["compound_stock_checks"]["Row"];
export type StockCheckItem = Database["public"]["Tables"]["compound_stock_check_items"]["Row"];

export const STOCK_CHECK_STATUSES = ["in_progress", "completed", "cancelled"] as const;
export type StockCheckStatus = (typeof STOCK_CHECK_STATUSES)[number];

export type CheckStatus = "unchecked" | "present" | "missing";

export const toCheckStatus = (value: boolean | null): CheckStatus => {
  if (value === true) {
    return "present";
  }

  if (value === false) {
    return "missing";
  }

  return "unchecked";
};

export type StockCheckObservationClassification = {
  checked: boolean;
  present: boolean;
  missing: boolean;
  unexpected: boolean;
  positionMismatch: boolean;
  statusMismatch: boolean;
  unresolvedStatusMismatch: boolean;
  resolved: boolean;
  checkStatus: CheckStatus;
};

export type StockCheckPhysicalLoad = "empty" | "loaded";

export type StockCheckFindingNotes = {
  physicalLoad: StockCheckPhysicalLoad | null;
  positionConflictOccupant: string | null;
  unknownTrailer: boolean;
  operatorNote: string | null;
};

const FINDING_NOTES_PREFIX = "SCFIND|";

const STOCK_CHECK_OPERATIONAL_TIME_ZONE = "Europe/Guernsey";

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const normalizePosition = (value?: string | null) => value?.trim().toUpperCase() || null;

export const isOpenStockCheckStatus = (status?: string | null) => normalizeText(status) === "in_progress";

export const isCancelledStockCheckStatus = (status?: string | null) => normalizeText(status) === "cancelled";

export const isCompletedStockCheckStatus = (status?: string | null) => normalizeText(status) === "completed";

export const isHistoricalStockCheckStatus = (status?: string | null) =>
  isCompletedStockCheckStatus(status) || isCancelledStockCheckStatus(status);

export const isLiveStockCheckDiscrepancySession = (status?: string | null) => isOpenStockCheckStatus(status);

export const stockCheckEndedAt = (stockCheck: Pick<StockCheck, "completed_at" | "cancelled_at">) =>
  stockCheck.completed_at ?? stockCheck.cancelled_at ?? null;

export const toGuernseyDateKey = (value?: string | Date | null) => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STOCK_CHECK_OPERATIONAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

export const isStockCheckFromPriorOperationalDay = (
  startedAt?: string | null,
  referenceAt: Date | string = new Date(),
) => {
  const startedKey = toGuernseyDateKey(startedAt);
  const referenceKey = toGuernseyDateKey(referenceAt);
  return Boolean(startedKey && referenceKey && startedKey < referenceKey);
};

export const shouldPromptResumeOrCloseOpenSession = ({
  openStockCheck,
  isWorkingOpenSession,
}: {
  openStockCheck: Pick<StockCheck, "status"> | null;
  isWorkingOpenSession: boolean;
}) => Boolean(openStockCheck && isOpenStockCheckStatus(openStockCheck.status) && !isWorkingOpenSession);

export const classifyStockCheckObservation = (
  item: Pick<
    StockCheckItem,
    | "expected_in_compound"
    | "physically_present"
    | "expected_position"
    | "actual_position"
    | "discrepancy_type"
    | "resolution_status"
    | "checked_at"
  >,
): StockCheckObservationClassification => {
  const physicallyPresent = item.physically_present;
  const discrepancy = normalizeText(item.discrepancy_type);
  const resolution = normalizeText(item.resolution_status);
  const checked = physicallyPresent !== null || Boolean(item.checked_at);
  const present = physicallyPresent === true;
  const missing = item.expected_in_compound === true && physicallyPresent === false;
  const unexpected = item.expected_in_compound === false && physicallyPresent === true;
  const expectedPosition = normalizePosition(item.expected_position);
  const actualPosition = normalizePosition(item.actual_position);
  const positionMismatch =
    checked &&
    physicallyPresent !== null &&
    Boolean(expectedPosition) &&
    Boolean(actualPosition) &&
    expectedPosition !== actualPosition;
  const statusMismatch =
    physicallyPresent !== null && (discrepancy === "wrong_status" || discrepancy === "wrong_load_status");
  const resolved = resolution === "resolved";

  return {
    checked,
    present,
    missing,
    unexpected,
    positionMismatch,
    statusMismatch,
    unresolvedStatusMismatch: statusMismatch && !resolved,
    resolved,
    checkStatus: toCheckStatus(physicallyPresent),
  };
};

export const isUnexpectedStockCheckFinding = (
  item: Pick<StockCheckItem, "expected_in_compound" | "physically_present">,
) => item.expected_in_compound === false && item.physically_present === true;

export const isResolvedStockCheckItem = (item: Pick<StockCheckItem, "resolution_status">) =>
  normalizeText(item.resolution_status) === "resolved";

export const isStockCheckDiscrepancyItem = (
  item: Parameters<typeof classifyStockCheckObservation>[0],
) => {
  const classification = classifyStockCheckObservation(item);
  return classification.unexpected || classification.missing || classification.positionMismatch || classification.statusMismatch;
};

export const recountStockCheckResolutionTotals = (
  items: Array<Parameters<typeof classifyStockCheckObservation>[0]>,
) => {
  let resolved = 0;
  let unresolved = 0;

  for (const item of items) {
    if (!isStockCheckDiscrepancyItem(item)) {
      continue;
    }
    if (isResolvedStockCheckItem(item)) {
      resolved += 1;
    } else {
      unresolved += 1;
    }
  }

  return { resolved_total: resolved, unresolved_total: unresolved };
};

export const normalizeStockCheckPhysicalLoad = (value?: string | null): StockCheckPhysicalLoad | null => {
  const normalized = normalizeText(value);
  if (normalized === "empty" || normalized === "empty_trailer") {
    return "empty";
  }
  if (normalized === "loaded" || normalized === "full" || normalized === "load") {
    return "loaded";
  }
  return null;
};

export const parseStockCheckFindingNotes = (notes?: string | null): StockCheckFindingNotes => {
  const raw = notes?.trim() ?? "";
  if (!raw.startsWith(FINDING_NOTES_PREFIX)) {
    return {
      physicalLoad: null,
      positionConflictOccupant: null,
      unknownTrailer: false,
      operatorNote: raw || null,
    };
  }

  const parts = raw.slice(FINDING_NOTES_PREFIX.length).split("|");
  const map = new Map<string, string>();
  for (const part of parts) {
    const index = part.indexOf("=");
    if (index <= 0) {
      continue;
    }
    map.set(part.slice(0, index), decodeURIComponent(part.slice(index + 1)));
  }

  return {
    physicalLoad: normalizeStockCheckPhysicalLoad(map.get("load") ?? null),
    positionConflictOccupant: map.get("conflict")?.trim().toUpperCase() || null,
    unknownTrailer: map.get("unknown") === "1",
    operatorNote: map.get("note")?.trim() || null,
  };
};

export const encodeStockCheckFindingNotes = (input: StockCheckFindingNotes) => {
  const parts = [
    `load=${encodeURIComponent(input.physicalLoad ?? "")}`,
    `conflict=${encodeURIComponent(input.positionConflictOccupant ?? "")}`,
    `unknown=${input.unknownTrailer ? "1" : "0"}`,
    `note=${encodeURIComponent(input.operatorNote ?? "")}`,
  ];
  return `${FINDING_NOTES_PREFIX}${parts.join("|")}`;
};

export const formatStockCheckPhysicalLoadLabel = (value?: string | null) => {
  const normalized = normalizeStockCheckPhysicalLoad(value);
  if (normalized === "empty") {
    return "Empty";
  }
  if (normalized === "loaded") {
    return "Loaded";
  }
  return "-";
};

export const describeStockCheckDiscrepancy = (
  item: Parameters<typeof classifyStockCheckObservation>[0],
) => {
  const classification = classifyStockCheckObservation(item);
  if (classification.unexpected) {
    const finding = parseStockCheckFindingNotes("notes" in item ? (item as StockCheckItem).notes : null);
    return finding.unknownTrailer ? "Unknown / Unexpected" : "Unexpected";
  }
  if (classification.missing) {
    return "Missing";
  }
  if (classification.positionMismatch) {
    return "Position Mismatch";
  }
  if (classification.statusMismatch) {
    return "Status / Load Mismatch";
  }
  return "Matched";
};

export const recountStockCheckObservationTotals = (
  items: Array<Parameters<typeof classifyStockCheckObservation>[0]>,
) => {
  const totals = {
    checked_total: 0,
    present_total: 0,
    missing_total: 0,
    unexpected_total: 0,
    wrong_position_total: 0,
    wrong_status_total: 0,
  };

  for (const item of items) {
    const classification = classifyStockCheckObservation(item);
    if (classification.checked) {
      totals.checked_total += 1;
    }
    if (classification.present) {
      totals.present_total += 1;
    }
    if (classification.missing) {
      totals.missing_total += 1;
    }
    if (classification.unexpected) {
      totals.unexpected_total += 1;
    }
    if (classification.positionMismatch) {
      totals.wrong_position_total += 1;
    }
    if (classification.statusMismatch) {
      totals.wrong_status_total += 1;
    }
  }

  return totals;
};

export const formatStatusLabel = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

export const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const normalizeTrailerNumber = (value: string) => value.trim().toUpperCase();
