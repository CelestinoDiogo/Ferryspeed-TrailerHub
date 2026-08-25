export type EscortFilter = "all" | "needed" | "delivered" | "none";

export const DEFAULT_ESCORT_NEEDED = false;
export const DEFAULT_DELIVERED_WITH_ESCORT = false;

export const ESCORT_FILTER_OPTIONS: Array<{ value: EscortFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "needed", label: "Escort Needed" },
  { value: "delivered", label: "Delivered with Escort" },
  { value: "none", label: "No Escort" },
];

export function normalizeEscortFlag(value?: boolean | null) {
  return value === true;
}

export function parseEscortFilter(value?: string | null): EscortFilter {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "needed" || normalized === "delivered" || normalized === "none") {
    return normalized;
  }
  return "all";
}

export function getEscortFilterLabel(filter: EscortFilter) {
  return ESCORT_FILTER_OPTIONS.find((option) => option.value === filter)?.label ?? "All";
}

export function matchesEscortFilter(
  record: {
    escortNeeded?: boolean | null;
    deliveredWithEscort?: boolean | null;
  },
  filter: EscortFilter,
) {
  const escortNeeded = normalizeEscortFlag(record.escortNeeded);
  const deliveredWithEscort = normalizeEscortFlag(record.deliveredWithEscort);

  switch (filter) {
    case "needed":
      return escortNeeded;
    case "delivered":
      return deliveredWithEscort;
    case "none":
      return !escortNeeded && !deliveredWithEscort;
    default:
      return true;
  }
}

export function shouldShowEscortBadge(record: {
  escortNeeded?: boolean | null;
  deliveredWithEscort?: boolean | null;
}) {
  return normalizeEscortFlag(record.escortNeeded) || normalizeEscortFlag(record.deliveredWithEscort);
}

export function resolveDeliveredWithEscortOnCompletion(input: {
  escortNeeded?: boolean | null;
  deliveredWithEscort?: boolean | null;
}) {
  if (normalizeEscortFlag(input.deliveredWithEscort)) {
    return true;
  }

  return normalizeEscortFlag(input.escortNeeded);
}
