import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../route.ts", import.meta.url), "utf8");

describe("Fleet transport API contract", () => {
  it("keeps unit lifecycle mutation as insert/update with no hard delete", () => {
    expect(source).toContain('from("fleet_transport_units").insert');
    expect(source).toContain('from("fleet_transport_units").update');
    expect(source).not.toMatch(/\.from\("fleet_transport_units"\)\.delete/);
  });

  it("updates the same transport job identity for assignment and lifecycle changes", () => {
    expect(source).toContain('from("transport_jobs").update');
    expect(source).toContain(".eq(\"id\", id)");
    expect(source).toContain("driver_id: payload.driverId ?? null");
    expect(source).toContain("unit_id: payload.unitId ?? null");
    expect(source).toContain("trailer_id: payload.trailerId ?? null");
    expect(source).toContain("completed_at");
    expect(source).toContain("cancelled_at");
  });

  it("uses non-blocking warnings for active Driver and Unit conflicts", () => {
    expect(source).toContain('const activeJobStatuses = ["planned", "assigned", "in_progress"]');
    expect(source).toContain("findAssignmentWarnings");
    expect(source).toContain("already assigned to active job");
  });

  it("keeps server authorization authoritative for view/create/edit", () => {
    expect(source).toContain('requireFleet(request, "view")');
    expect(source).toContain('requireFleet(request, "create")');
    expect(source).toContain('requireFleet(request, "edit")');
  });
});
