import type { Database } from "@/lib/database.types";

export type StockCheck = Database["public"]["Tables"]["compound_stock_checks"]["Row"];
export type StockCheckItem = Database["public"]["Tables"]["compound_stock_check_items"]["Row"];

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
