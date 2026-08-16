import { describe, expect, it } from "vitest";
import {
  calculateCollectionAging,
  compareCollections,
  formatCollectionDuration,
  getCollectionSeverity,
} from "@/lib/collection-aging";

describe("collection aging", () => {
  it("preserves the original pending timestamp while measuring elapsed hours", () => {
    const aging = calculateCollectionAging({
      delivery_date: "2026-08-12",
      pending_since: "2026-08-12T08:15:00.000Z",
      collection_due_at: "2026-08-13T08:15:00.000Z",
      referenceAt: "2026-08-13T07:15:00.000Z",
    });

    expect(aging.waitingSince).toBe("2026-08-12T08:15:00.000Z");
    expect(aging.waitingHours).toBeGreaterThanOrEqual(23);
    expect(aging.waitingHours).toBeLessThan(24);
    expect(aging.agingLevel).toBe("green");
    expect(aging.agingLabel).toBe("Green");
  });

  it("returns green, orange, and red bands from the original pending timestamp", () => {
    const green = calculateCollectionAging({
      delivery_date: "2026-08-12",
      waiting_collection_since: "2026-08-12T12:00:00.000Z",
      referenceAt: "2026-08-13T11:59:59.000Z",
    });

    const greenAt24 = calculateCollectionAging({
      delivery_date: "2026-08-12",
      waiting_collection_since: "2026-08-12T12:00:00.000Z",
      referenceAt: "2026-08-13T12:00:00.000Z",
    });

    const orangeAt48 = calculateCollectionAging({
      delivery_date: "2026-08-10",
      waiting_collection_since: "2026-08-10T12:00:00.000Z",
      referenceAt: "2026-08-12T12:00:00.000Z",
    });

    const red = calculateCollectionAging({
      delivery_date: "2026-08-10",
      waiting_collection_since: "2026-08-10T12:00:00.000Z",
      referenceAt: "2026-08-12T12:00:01.000Z",
    });

    expect(green.agingLevel).toBe("green");
    expect(greenAt24.agingLevel).toBe("green");
    expect(orangeAt48.agingLevel).toBe("orange");
    expect(red.agingLevel).toBe("red");
  });

  it("preserves due-date ageing for overdue pending collections", () => {
    const aging = calculateCollectionAging({
      delivery_date: "2026-08-11",
      waiting_collection_since: "2026-08-11T08:00:00.000Z",
      collection_due_at: "2026-08-12T08:00:00.000Z",
      referenceAt: "2026-08-13T08:00:00.000Z",
    });

    expect(aging.isOverdue).toBe(true);
    expect(aging.overdueDays).toBe(1);
    expect(aging.daysUntilDue).toBe(-1);
  });

  it("formats pending duration for operational display", () => {
    expect(formatCollectionDuration(23.8)).toBe("23h");
    expect(formatCollectionDuration(27.2)).toBe("1d 3h");
    expect(formatCollectionDuration(48)).toBe("2d");
  });

  it("sorts overdue and older pending collections first", () => {
    const older = calculateCollectionAging({
      delivery_date: "2026-08-10",
      waiting_collection_since: "2026-08-10T08:00:00.000Z",
      referenceAt: "2026-08-12T12:00:00.000Z",
    });

    const newer = calculateCollectionAging({
      delivery_date: "2026-08-11",
      waiting_collection_since: "2026-08-11T12:00:00.000Z",
      referenceAt: "2026-08-12T12:00:00.000Z",
    });

    expect(compareCollections({ ...older, _rawSince: "2026-08-10T08:00:00.000Z" }, { ...newer, _rawSince: "2026-08-11T12:00:00.000Z" })).toBeLessThan(0);
    expect(getCollectionSeverity(older)).toBe("critical");
  });
});
