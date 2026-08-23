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
  checkStatus: CheckStatus;
};

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
    physicallyPresent !== null &&
    (discrepancy === "wrong_status" || discrepancy === "wrong_load_status") &&
    resolution !== "resolved";

  return {
    checked,
    present,
    missing,
    unexpected,
    positionMismatch,
    statusMismatch,
    checkStatus: toCheckStatus(physicallyPresent),
  };
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
