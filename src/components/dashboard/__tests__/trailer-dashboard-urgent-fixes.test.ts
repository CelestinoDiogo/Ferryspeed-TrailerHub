import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(process.cwd(), "src/components/dashboard/trailer-dashboard.tsx"), "utf8");

describe("dashboard urgent-fix contracts", () => {
  it("counts vessel operations today with the shared expected-arrival helper", () => {
    expect(source).toContain("isVesselOperationScheduledOnLocalDate(operation, todayKey)");
    expect(source).toContain("getLocalDateInputValue()");
    expect(source).not.toContain("getDateKey(operation.actual_arrival_at)");
  });

  it("passes only damage and temperature alerts to the dashboard panel", () => {
    expect(source).toContain("isDashboardSafetyAlert");
    expect(source).toContain("activeAlerts={dashboardSafetyAlerts}");
  });

  it("counts delivered and waiting_collection deliveries in the Collections outstanding KPI", () => {
    expect(source).toContain('.in("status", ["waiting_collection", "delivered"])');
  });
});
