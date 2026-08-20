import { describe, expect, it } from "vitest";
import { getVesselOperationStatusLabel, isVesselOperationScheduledOnLocalDate } from "@/lib/vessel-operations";

describe("vessel operations today KPI", () => {
  it("counts today's expected arrival and ignores yesterday even if actual arrival is today", () => {
    expect(isVesselOperationScheduledOnLocalDate({
      expected_arrival_at: "2026-08-19T07:00:00.000Z",
      status: "arriving",
    }, "2026-08-19")).toBe(true);
    expect(isVesselOperationScheduledOnLocalDate({
      expected_arrival_at: "2026-08-18T07:00:00.000Z",
      actual_arrival_at: "2026-08-19T09:00:00.000Z",
      status: "completed",
    }, "2026-08-19")).toBe(false);
  });

  it("does not count cancelled operations or created-today operations without today's expected arrival", () => {
    expect(isVesselOperationScheduledOnLocalDate({
      expected_arrival_at: "2026-08-19T07:00:00.000Z",
      status: "cancelled",
    }, "2026-08-19")).toBe(false);
    expect(isVesselOperationScheduledOnLocalDate({
      expected_arrival_at: "2026-08-20T07:00:00.000Z",
      created_at: "2026-08-19T01:00:00.000Z",
      status: "draft",
    }, "2026-08-19")).toBe(false);
  });

  it("uses the expected-arrival calendar key rather than UTC conversion of actual arrival", () => {
    expect(isVesselOperationScheduledOnLocalDate({
      expected_arrival_at: "2026-08-19T23:30:00.000Z",
      actual_arrival_at: "2026-08-20T00:15:00.000Z",
      status: "confirmed",
    }, "2026-08-19")).toBe(true);
  });

  it("excludes cancelled operations from tomorrow using the same local-date helper as today", () => {
    expect(isVesselOperationScheduledOnLocalDate({
      expected_arrival_at: "2026-08-20T07:00:00.000Z",
      status: "confirmed",
    }, "2026-08-20")).toBe(true);
    expect(isVesselOperationScheduledOnLocalDate({
      expected_arrival_at: "2026-08-20T07:00:00.000Z",
      status: "cancelled",
    }, "2026-08-20")).toBe(false);
  });

  it("labels cancelled vessel operations as Cancelled rather than Completed", () => {
    expect(getVesselOperationStatusLabel("cancelled")).toBe("Cancelled");
    expect(getVesselOperationStatusLabel("completed")).toBe("Completed");
  });
});
