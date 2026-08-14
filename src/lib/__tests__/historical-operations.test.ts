import { describe, expect, it } from "vitest";
import { createHistoryDateRange } from "@/lib/history-date-range";
import { filterHistoricalOperations, type HistoricalOperationRecord } from "@/lib/reports/historical-operations";

const records: HistoricalOperationRecord[] = [
  { id: "a", trailerNumber: "PRO100", occurredAt: "2026-08-14T08:00:00Z", ownershipType: "company", customer: "Customer A", sourceOrDestination: "Vessel One", reference: "REF-A", loadStatus: "Loaded", notes: null },
  { id: "b", trailerNumber: "PFC200", occurredAt: "2026-08-13T08:00:00Z", ownershipType: "outsourcing", customer: "Customer B", sourceOrDestination: "Vessel Two", reference: "REF-B", loadStatus: "Empty", notes: null },
];

describe("historical operations filters", () => {
  it("filters today, historical range, ownership, and trailer/reference search inclusively", () => {
    expect(filterHistoricalOperations(records, { range: createHistoryDateRange("today", "2026-08-14"), ownership: "all", search: "" })).toHaveLength(1);
    expect(filterHistoricalOperations(records, { range: { preset: "custom", startDate: "2026-08-13", endDate: "2026-08-14" }, ownership: "outsourcing", search: "PFC200" })).toHaveLength(1);
    expect(filterHistoricalOperations(records, { range: { preset: "custom", startDate: "2026-08-13", endDate: "2026-08-14" }, ownership: "company", search: "REF-A" })).toHaveLength(1);
  });

  it("returns no results when date or search excludes all records", () => {
    expect(filterHistoricalOperations(records, { range: createHistoryDateRange("today", "2026-08-12"), ownership: "all", search: "" })).toHaveLength(0);
    expect(filterHistoricalOperations(records, { range: { preset: "custom", startDate: "2026-08-13", endDate: "2026-08-14" }, ownership: "all", search: "missing" })).toHaveLength(0);
  });
});
