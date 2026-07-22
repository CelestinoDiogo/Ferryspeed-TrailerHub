export type HistoryDateRangePreset =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "custom";

export type HistoryDateRangeValue = {
  preset: HistoryDateRangePreset;
  startDate: string;
  endDate: string;
};

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftDays = (date: Date, amount: number) => {
  const value = new Date(date);
  value.setDate(value.getDate() + amount);
  return value;
};

export const getTodayDateKey = () => toDateKey(new Date());

export const createHistoryDateRange = (
  preset: HistoryDateRangePreset,
  todayDateKey: string = getTodayDateKey(),
): HistoryDateRangeValue => {
  const today = new Date(`${todayDateKey}T00:00:00`);

  if (preset === "today") {
    return { preset, startDate: todayDateKey, endDate: todayDateKey };
  }

  if (preset === "yesterday") {
    const yesterday = toDateKey(shiftDays(today, -1));
    return { preset, startDate: yesterday, endDate: yesterday };
  }

  if (preset === "last_7_days") {
    const start = toDateKey(shiftDays(today, -6));
    return { preset, startDate: start, endDate: todayDateKey };
  }

  if (preset === "last_30_days") {
    const start = toDateKey(shiftDays(today, -29));
    return { preset, startDate: start, endDate: todayDateKey };
  }

  return { preset, startDate: todayDateKey, endDate: todayDateKey };
};

export const getHistoryDateRangeLabel = (value: HistoryDateRangeValue) => {
  if (value.preset === "today") {
    return "Today";
  }

  if (value.preset === "yesterday") {
    return "Yesterday";
  }

  if (value.preset === "last_7_days") {
    return "Last 7 Days";
  }

  if (value.preset === "last_30_days") {
    return "Last 30 Days";
  }

  if (value.startDate && value.endDate) {
    return `${value.startDate} to ${value.endDate}`;
  }

  return "Custom";
};

export const isDateWithinHistoryRange = (
  dateKey: string | null | undefined,
  range: HistoryDateRangeValue,
) => {
  const normalizedDate = (dateKey ?? "").trim();
  const normalizedStart = range.startDate.trim();
  const normalizedEnd = range.endDate.trim();

  if (!normalizedDate || !normalizedStart || !normalizedEnd) {
    return false;
  }

  return normalizedDate >= normalizedStart && normalizedDate <= normalizedEnd;
};

export const normalizeHistoryPreset = (
  value?: string | null,
): HistoryDateRangePreset => {
  switch ((value ?? "").trim().toLowerCase()) {
    case "today":
    case "yesterday":
    case "last_7_days":
    case "last_30_days":
    case "custom":
      return value as HistoryDateRangePreset;
    default:
      return "today";
  }
};
