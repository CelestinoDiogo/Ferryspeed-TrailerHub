export const FLEET_UNIT_TYPES = [
  ["tractor_only", "Tractor Only"],
  ["curtain_sider", "Curtain Sider"],
  ["reefer", "Reefer"],
  ["flatbed", "Flatbed"],
  ["rigid", "Rigid"],
  ["other", "Other"],
] as const;

export const TRANSPORT_JOB_STATUSES = ["planned", "assigned", "in_progress", "completed", "cancelled"] as const;

export type TransportJobStatus = (typeof TRANSPORT_JOB_STATUSES)[number];

export const ACTIVE_TRANSPORT_JOB_STATUSES: TransportJobStatus[] = ["planned", "assigned", "in_progress"];

export const unitTypeLabel = (value: string) => FLEET_UNIT_TYPES.find(([key]) => key === value)?.[1] ?? value;

export const jobStatusLabel = (value: string) => {
  const labels: Record<TransportJobStatus, string> = {
    planned: "Planned",
    assigned: "Ready",
    in_progress: "In Progress",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  return labels[value as TransportJobStatus] ?? value;
};

export const nextJobStatus = (status: string): TransportJobStatus | null => {
  if (status === "planned" || status === "assigned") {
    return "in_progress";
  }

  if (status === "in_progress") {
    return "completed";
  }

  return null;
};

export const normalizeFleetSearch = (value: string | null | undefined) => value?.trim().toLowerCase() ?? "";

export const formatFleetDateTime = (value: string | null | undefined) => {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};
