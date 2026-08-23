import { describe, expect, it } from "vitest";
import { createHistoryDateRange } from "@/lib/history-date-range";
import { collectionRecord, filterHistoricalOperations, ownershipForArrival, type HistoricalOperationRecord } from "@/lib/reports/historical-operations";

const records: HistoricalOperationRecord[] = [
  { id: "a", trailerNumber: "PRO100", occurredAt: "2026-08-14T08:00:00Z", ownershipType: "company", customer: "Customer A", sourceOrDestination: "Vessel One", reference: "REF-A", loadStatus: "Loaded", notes: null },
  { id: "b", trailerNumber: "PFC200", occurredAt: "2026-08-13T08:00:00Z", ownershipType: "outsourcing", customer: "Customer B", sourceOrDestination: "Vessel Two", reference: "REF-B", loadStatus: "Empty", notes: null },
];

describe("historical operations filters", () => {
  it("keeps historical arrival ownership independent from the current trailer relation", () => {
    expect(ownershipForArrival({ ownership_type: "company", trailer_source: "company" })).toBe("company");
    expect(ownershipForArrival({ ownership_type: "outsourcing", trailer_source: "outsourced", external_company: "Carrier Z" })).toBe("outsourcing");
    expect(ownershipForArrival(
      { ownership_type: "outsourcing", trailer_source: "outsourced", external_company: "Carrier Z" },
    )).toBe("outsourcing");
    expect(ownershipForArrival(
      { trailer_source: "local", is_local: true },
    )).toBe("company");
    expect(ownershipForArrival({ ownership_type: "unknown", trailer_source: "unknown" })).toBe("unknown");
  });

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
    const collected = collectionRecord({ id: "collected", trailer_number: "PRO400", delivery_date: "2026-08-14", status: "collected", collected_at: "2026-08-14T10:00:00.000Z", customer: "Customer D" });
    const pickupOnly = collectionRecord({ id: "pickup", trailer_number: "PFC49", delivery_date: "2026-08-14", status: "on_delivery", collected_at: "2026-08-14T09:00:00.000Z", customer: "NORMAN PIETTE" });
    expect(filterHistoricalOperations([pending, collected], { range: createHistoryDateRange("today", "2026-08-14"), ownership: "all", search: "", collectionState: "pending", aging: "all", currentPending: true })).toEqual([pending]);
    expect(["orange", "red"]).toContain(pending.agingLevel);
    expect(collected.collectionState).toBe("collected");
    expect(pickupOnly.collectionState).toBe("pending");
  });

  it("uses source ownership for collection history and otherwise remains unknown", () => {
    expect(collectionRecord({ id: "historical", trailer_number: "SAME1", delivery_date: "2026-08-01", historicalOwnership: { ownership_type: "outsourcing", trailer_source: "outsourced" } }).ownershipType).toBe("outsourcing");
    expect(collectionRecord({ id: "unknown", trailer_number: "SAME1", delivery_date: "2026-08-01" }).ownershipType).toBe("unknown");
  });

  it("keeps repeated trailer numbers isolated by their own snapshots", () => {
    expect(ownershipForArrival({ ownership_type: "company", trailer_source: "company" })).toBe("company");
    expect(ownershipForArrival({ ownership_type: "outsourcing", trailer_source: "outsourced" })).toBe("outsourcing");
  });
});
