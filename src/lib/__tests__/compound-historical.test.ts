import { describe, expect, it } from "vitest";
import { createHistoryDateRange } from "@/lib/history-date-range";
import { filterCompoundActivity, ownershipForCompoundTrailer, type CompoundActivityRecord } from "@/lib/reports/compound-historical";

const rows: CompoundActivityRecord[] = [
  { id: "a", occurredAt: "2026-08-14T10:00:00Z", trailerNumber: "PRO100", eventType: "compound_position_changed", ownershipType: "company", previousPosition: "P01", newPosition: "P02", previousStatus: null, newStatus: null, sourceModule: "compound", performedBy: "Operator", description: "Position updated" },
  { id: "b", occurredAt: "2026-08-13T10:00:00Z", trailerNumber: "PFC200", eventType: "compound_entered", ownershipType: "outsourcing", previousPosition: null, newPosition: "P03", previousStatus: null, newStatus: "Loaded", sourceModule: "arrival", performedBy: "Operator", description: "Entered compound" },
];

describe("compound historical reporting", () => {
  it("filters activity by period, ownership, event type, and trailer search chronologically", () => {
    const filtered = filterCompoundActivity(rows, { preset: "custom", startDate: "2026-08-13", endDate: "2026-08-14" }, "company", "PRO100", "compound_position_changed");
    expect(filtered.map((row) => row.id)).toEqual(["a"]);
  });

  it("supports today ranges and the existing ownership model", () => {
    expect(filterCompoundActivity(rows, createHistoryDateRange("today", "2026-08-14"), "all", "", "all")).toHaveLength(1);
    expect(ownershipForCompoundTrailer({ trailer_source: "outsourced", external_company: "Carrier Z" })).toBe("outsourcing");
    expect(ownershipForCompoundTrailer({ trailer_source: "company" })).toBe("company");
  });

  it("returns no events for excluded periods", () => {
    expect(filterCompoundActivity(rows, { preset: "custom", startDate: "2026-08-01", endDate: "2026-08-01" }, "all", "", "all")).toHaveLength(0);
  });
});
