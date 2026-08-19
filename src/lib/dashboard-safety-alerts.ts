import type { OperationalAlertRow, OperationalAlertSummary } from "@/lib/operational-alerts";

const normalize = (value?: string | null) => value?.trim().toLowerCase() ?? "";

export const isDashboardSafetyAlert = (alert: Pick<OperationalAlertRow, "title" | "alert_type">) => {
  const title = normalize(alert.title);
  const alertType = normalize(alert.alert_type);
  return title === "damage alert"
    || title === "temperature alert"
    || alertType.includes("damage_alert")
    || alertType.includes("temperature_alert");
};

export const summarizeDashboardSafetyAlerts = (
  alerts: OperationalAlertRow[],
  raw: OperationalAlertSummary["raw"] = null,
): OperationalAlertSummary => {
  const safetyAlerts = alerts.filter(isDashboardSafetyAlert);
  const active = safetyAlerts.filter((alert) => {
    const status = normalize(alert.status);
    return status === "active" || status === "acknowledged" || status === "open";
  });

  return {
    totalActiveAlerts: active.length,
    criticalCount: active.filter((alert) => normalize(alert.severity) === "critical").length,
    highCount: active.filter((alert) => normalize(alert.severity) === "high").length,
    warningCount: active.filter((alert) => normalize(alert.severity) === "warning").length,
    infoCount: active.filter((alert) => normalize(alert.severity) === "info").length,
    latestAlertAt: active.reduce<string | null>((latest, alert) => {
      if (!alert.created_at) return latest;
      if (!latest || alert.created_at > latest) return alert.created_at;
      return latest;
    }, null),
    raw,
  };
};
