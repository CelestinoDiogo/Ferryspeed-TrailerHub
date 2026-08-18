import { describe, expect, it } from "vitest";
import { deriveMandatoryCollections, getMandatoryCollectionAge, projectDeliveryCollection, projectExportCollection } from "@/lib/mandatory-collections";

const delivery = { id: "delivery-a", trailer_id: "trailer-a", trailer_number: "FS100", customer: "Customer A", delivery_location: "Customer Yard", booking_reference: "DEL-1", delivery_date: "2026-08-13", delivered_at: "2026-08-13T08:00:00.000Z", waiting_collection_since: "2026-08-13T09:00:00.000Z", collection_due_date: "2026-08-14", collected_at: null, status: "waiting_collection" };
const exportAllocation = { id: "export-a", trailer_id: "trailer-b", trailer_number: "FS200", customer: "Customer B", collection_address: "Export Customer Yard", booking_reference: "EXP-1", collection_date: "2026-08-13", expected_return_at: "2026-08-14T10:00:00.000Z", delivered_empty_at: "2026-08-13T07:00:00.000Z", waiting_loading_at: null, collected_loaded_at: null, completed_at: null, cancelled_at: null, status: "delivered_empty" };

describe("mandatory collections", () => {
  it("does not treat a stale collected timestamp on a delivered booking as completed collection", () => {
    expect(projectDeliveryCollection({
      id: "delivery-stale",
      trailer_id: "trailer-stale",
      status: "delivered",
      delivery_date: "2026-08-15",
      delivered_at: "2026-08-15T09:00:00.000Z",
      collected_at: "2026-08-15T08:00:00.000Z",
    }, "2026-08-17T09:00:00.000Z")).toBeNull();
  });
  it.each([[0, "green"], [23 + 59 / 60, "green"], [24, "green"], [24 + 1 / 60, "orange"], [47 + 59 / 60, "orange"], [48, "orange"], [48 + 1 / 60, "red"]] as const)("classifies %s elapsed hours as %s", (hours, expected) => {
    const referenceAt = new Date(Date.parse("2026-08-14T00:00:00.000Z") + hours * 3_600_000);
    expect(getMandatoryCollectionAge("2026-08-14T00:00:00.000Z", referenceAt).ageLevel).toBe(expected);
  });

  it("keeps due-today, yesterday, and three-day-old obligations visible without changing original due dates", () => {
    const today = deriveMandatoryCollections({ deliveries: [delivery], exports: [exportAllocation], referenceAt: "2026-08-14T12:00:00.000Z" });
    const tomorrow = deriveMandatoryCollections({ deliveries: [delivery], exports: [exportAllocation], referenceAt: "2026-08-15T12:00:00.000Z" });
    const threeDaysLater = deriveMandatoryCollections({ deliveries: [delivery], exports: [exportAllocation], referenceAt: "2026-08-17T12:00:00.000Z" });
    expect(today.map((item) => item.key)).toEqual(["delivery:delivery-a", "export:export-a"]);
    expect(tomorrow).toHaveLength(2);
    expect(threeDaysLater).toHaveLength(2);
    expect(tomorrow[0].originalDueAt).toBe(today[0].originalDueAt);
    expect(threeDaysLater[0].ageHours).toBeGreaterThan(tomorrow[0].ageHours);
  });

  it("cannot duplicate obligations across refreshes or duplicate source rows", () => {
    const first = deriveMandatoryCollections({ deliveries: [delivery, delivery], exports: [exportAllocation, exportAllocation], referenceAt: "2026-08-15T12:00:00.000Z" });
    const refreshed = deriveMandatoryCollections({ deliveries: [delivery], exports: [exportAllocation], referenceAt: "2026-08-15T12:00:00.000Z" });
    expect(first.map((item) => item.key)).toEqual(refreshed.map((item) => item.key));
    expect(first).toHaveLength(2);
  });

  it("completes Delivery with either physical result and retains it in history", () => {
    const empty = projectDeliveryCollection({ ...delivery, status: "collected", collected_at: "2026-08-15T12:00:00.000Z", resulting_load_status: "Empty" }, "2026-08-20T12:00:00.000Z");
    const loaded = projectDeliveryCollection({ ...delivery, id: "delivery-b", status: "collected", collected_at: "2026-08-15T13:00:00.000Z", resulting_load_status: "Loaded" });
    const history = deriveMandatoryCollections({ deliveries: [{ ...delivery, status: "collected", collected_at: "2026-08-15T12:00:00.000Z", resulting_load_status: "Empty" }], exports: [], includeCompleted: true });
    expect(empty).toMatchObject({ isOutstanding: false, physicalResult: "Empty" });
    expect(empty?.ageHours).toBe(51);
    expect(loaded).toMatchObject({ isOutstanding: false, physicalResult: "Loaded" });
    expect(history).toHaveLength(1);
  });

  it("does not infer an obligation from an ambiguous Delivery status", () => {
    expect(projectDeliveryCollection({ ...delivery, status: "delivered", waiting_collection_since: null })).toBeNull();
    expect(projectDeliveryCollection({ ...delivery, status: "collected", collected_at: null })).toBeNull();
    expect(projectDeliveryCollection({ ...delivery, status: "cancelled", collected_at: "2026-08-15T12:00:00.000Z" })).toBeNull();
  });

  it("keeps Export pending through Waiting Loading and completes it as Loaded", () => {
    expect(projectExportCollection({ ...exportAllocation, status: "waiting_loading", waiting_loading_at: "2026-08-14T11:00:00.000Z" })?.isOutstanding).toBe(true);
    expect(projectExportCollection({ ...exportAllocation, status: "collected_loaded", collected_loaded_at: "2026-08-15T10:00:00.000Z" })).toMatchObject({ isOutstanding: false, physicalResult: "Loaded" });
    expect(projectExportCollection({ ...exportAllocation, status: "completed", completed_at: "2026-08-15T11:00:00.000Z" })).toMatchObject({ isOutstanding: false, physicalResult: "Loaded" });
  });

  it("excludes explicitly cancelled jobs", () => {
    expect(projectExportCollection({ ...exportAllocation, status: "cancelled", cancelled_at: "2026-08-14T12:00:00.000Z" })).toBeNull();
  });

  it("provides accessible age text in addition to colour", () => {
    expect(getMandatoryCollectionAge("2026-08-14T00:00:00.000Z", "2026-08-16T01:00:00.000Z")).toEqual(expect.objectContaining({ ageLevel: "red", ageLabel: "Pending 2d 1h" }));
  });
});