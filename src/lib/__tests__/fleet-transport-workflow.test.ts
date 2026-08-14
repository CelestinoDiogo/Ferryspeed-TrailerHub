import { describe, expect, it } from "vitest";
import { canPerformAction } from "@/lib/auth/permissions";
import { jobStatusLabel, nextJobStatus, normalizeFleetSearch, unitTypeLabel } from "@/lib/fleet-transport";

describe("Fleet / Transport workflow", () => {
  it("keeps Fleet read-only for Operators and denied for Drivers", () => {
    expect(canPerformAction("administrator", "fleet_transport", "create")).toBe(true);
    expect(canPerformAction("supervisor", "fleet_transport", "edit")).toBe(true);
    expect(canPerformAction("operator", "fleet_transport", "view")).toBe(true);
    expect(canPerformAction("operator", "fleet_transport", "edit")).toBe(false);
    expect(canPerformAction("driver", "fleet_transport", "view")).toBe(false);
  });

  it("uses the Migration 046 status values and safe forward transitions", () => {
    expect(jobStatusLabel("assigned")).toBe("Ready");
    expect(nextJobStatus("planned")).toBe("in_progress");
    expect(nextJobStatus("assigned")).toBe("in_progress");
    expect(nextJobStatus("in_progress")).toBe("completed");
    expect(nextJobStatus("completed")).toBeNull();
    expect(nextJobStatus("cancelled")).toBeNull();
  });

  it("keeps schema transport labels and normalized search behavior centralized", () => {
    expect(unitTypeLabel("tractor_only")).toBe("Tractor Only");
    expect(normalizeFleetSearch("  FS 123 ")).toBe("fs 123");
  });
});
