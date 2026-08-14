import { describe, expect, it } from "vitest";
import { createHistoryDateRange } from "@/lib/history-date-range";
import { collectionRecord, filterHistoricalOperations, type HistoricalOperationRecord } from "@/lib/reports/historical-operations";

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

  it("keeps old pending collections visible in current-pending mode and preserves aging bands", () => {
    const pending = collectionRecord({ id: "pending", trailer_number: "PFC300", delivery_date: "2026-08-01", waiting_collection_since: "2026-08-12T00:00:00.000Z", customer: "Customer C" });
    const collected = collectionRecord({ id: "collected", trailer_number: "PRO400", delivery_date: "2026-08-14", collected_at: "2026-08-14T10:00:00.000Z", customer: "Customer D" });
    expect(filterHistoricalOperations([pending, collected], { range: createHistoryDateRange("today", "2026-08-14"), ownership: "all", search: "", collectionState: "pending", aging: "all", currentPending: true })).toEqual([pending]);
    expect(["orange", "red"]).toContain(pending.agingLevel);
    expect(collected.collectionState).toBe("collected");
  });
});
