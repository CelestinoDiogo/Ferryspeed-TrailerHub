import { describe, expect, it } from "vitest";
import { isDashboardSafetyAlert, summarizeDashboardSafetyAlerts } from "@/lib/dashboard-safety-alerts";
import type { OperationalAlertRow } from "@/lib/operational-alerts";

const alert = (overrides: Partial<OperationalAlertRow>): OperationalAlertRow => ({
  id: "alert-1",
  alert_key: "vessel:Damage alert:vt-1",
  alert_type: "vessel_damage_alert",
  severity: "high",
  status: "active",
  title: "Damage alert",
  description: "Trailer FS100 has recorded damage.",
  trailer_id: "trailer-1",
  trailer_number: "FS100",
  source_module: "vessel",
  source_record_id: "vt-1",
  metadata: {},
  acknowledged_at: null,
  acknowledged_by: null,
  resolved_at: null,
  resolved_by: null,
  resolution_note: null,
  dismissed_at: null,
  dismissed_by: null,
  created_at: "2026-08-19T08:00:00.000Z",
  updated_at: "2026-08-19T08:00:00.000Z",
  ...overrides,
});

describe("dashboard safety alerts", () => {
  it("keeps damage and out-of-range temperature alerts visible", () => {
    const damage = alert({ id: "damage", title: "Damage alert", alert_type: "vessel_damage_alert" });
    const temperature = alert({ id: "temp", title: "Temperature alert", alert_type: "inspection_temperature_alert" });
    expect([damage, temperature].every(isDashboardSafetyAlert)).toBe(true);
    expect(summarizeDashboardSafetyAlerts([damage, temperature]).totalActiveAlerts).toBe(2);
  });

  it("hides unrelated operational alerts from the dashboard surface", () => {
    const sla = alert({ id: "sla", title: "Export waiting collection", alert_type: "export_export_waiting_collection" });
    const stock = alert({ id: "stock", title: "Stock check discrepancy", alert_type: "compound_stock_check_discrepancy" });
    const occupancy = alert({ id: "occ", title: "Compound occupancy warning", alert_type: "compound_compound_occupancy_warning" });
    expect([sla, stock, occupancy].some(isDashboardSafetyAlert)).toBe(false);
    expect(summarizeDashboardSafetyAlerts([sla, stock, occupancy]).totalActiveAlerts).toBe(0);
  });
});
