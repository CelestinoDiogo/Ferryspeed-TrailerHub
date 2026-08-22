// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyDriverMobileQueuedActions,
  coerceDriverMobileQueuedAction,
  createDriverMobileQueuedAction,
  isDriverMobileActionSatisfied,
  loadDriverMobileActionQueue,
  reconcileDriverMobileQueuedActions,
  saveDriverMobileActionQueue,
  upsertDriverMobileQueuedAction,
  type DriverMobileQueuedAction,
} from "@/lib/mobile/driver-mobile-action-queue";
import type { DriverMobileTask } from "@/lib/driver-mobile-service";

const STORAGE_KEY = "trailerhub.driver-mobile.action-queue.v1";

const makeTask = (overrides?: Partial<DriverMobileTask>): DriverMobileTask => ({
  taskId: "booking-a",
  driverId: "driver-a",
  taskKind: "delivery",
  bookingId: "booking-a",
  trailerId: "trailer-a",
  trailerNumber: "FS1234",
  customer: "Customer A",
  consignee: null,
  location: "Dock 1",
  bookingReference: "BK-A",
  notes: null,
  status: "ready",
  deliveryDate: "2026-08-13",
  deliveryTime: "12:00:00",
  group: "current",
  nextAction: "COLLECTED",
  deliveredAt: null,
  collectedAt: null,
  waitingCollectionSince: null,
  collectedTemperatureC: null,
  driverAcknowledgedAt: "2026-08-13T09:00:00.000Z",
  driverAcknowledgedBy: "user-a",
  temperature: {
    required: false,
  },
  collectionAging: null,
  ...overrides,
});

describe("driver mobile action queue", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists queue entries and ignores malformed storage", () => {
    const item = createDriverMobileQueuedAction({
      bookingId: "booking-a",
      action: "ACKNOWLEDGED",
      linkedInstructionIds: ["instruction-a"],
    });

    saveDriverMobileActionQueue([item]);
    expect(loadDriverMobileActionQueue()).toEqual([item]);
    expect(loadDriverMobileActionQueue()[0]?.linkedInstructionIds).toEqual(["instruction-a"]);

    window.localStorage.setItem(STORAGE_KEY, "{");
    expect(loadDriverMobileActionQueue()).toEqual([]);
  });

  it("preserves required temperature only when explicitly provided", () => {
    const tempItem = createDriverMobileQueuedAction({
      bookingId: "booking-temp",
      action: "COLLECTED",
      temperatureC: 2.5,
    });
    const plainItem = createDriverMobileQueuedAction({
      bookingId: "booking-plain",
      action: "COLLECTED",
    });

    expect(tempItem.temperatureC).toBe(2.5);
    expect(plainItem.temperatureC).toBeNull();
  });

  it("does not project pending collected or delivered actions as completed before server confirmation", () => {
    const collectedItem: DriverMobileQueuedAction = {
      ...createDriverMobileQueuedAction({ bookingId: "booking-a", action: "COLLECTED" }),
      state: "syncing",
      createdAt: "2026-08-13T10:00:00.000Z",
      lastAttemptAt: "2026-08-13T10:00:00.000Z",
    };
    const deliveredItem: DriverMobileQueuedAction = {
      ...createDriverMobileQueuedAction({ bookingId: "booking-b", action: "DELIVERED" }),
      bookingId: "booking-b",
      state: "pending",
      createdAt: "2026-08-13T11:00:00.000Z",
      lastAttemptAt: "2026-08-13T11:00:00.000Z",
    };

    const tasks = applyDriverMobileQueuedActions([
      makeTask({ bookingId: "booking-a", nextAction: "COLLECTED", status: "ready" }),
      makeTask({ bookingId: "booking-b", nextAction: "DELIVERED", status: "on_delivery", group: "current" }),
    ], [collectedItem, deliveredItem]);

    expect(tasks[0].status).toBe("ready");
    expect(tasks[0].nextAction).toBe("COLLECTED");
    expect(tasks[0].group).not.toBe("completed");
    expect(tasks[1].status).toBe("on_delivery");
    expect(tasks[1].group).toBe("current");
    expect(tasks[1].nextAction).toBe("DELIVERED");
  });

  it("keeps acknowledgement queue explicit and does not morph it into completion", () => {
    const queued = createDriverMobileQueuedAction({
      bookingId: "booking-a",
      action: "ACKNOWLEDGED",
    });

    const task = applyDriverMobileQueuedActions([
      makeTask({ nextAction: "ACKNOWLEDGED", driverAcknowledgedAt: null, driverAcknowledgedBy: null }),
    ], [queued])[0];

    expect(task.driverAcknowledgedAt).toBeTruthy();
    expect(task.nextAction).toBe("COLLECTED");
    expect(queued.action).toBe("ACKNOWLEDGED");
  });

  it("reconciles and removes stale queued actions once the server state already satisfies them", () => {
    const queued = upsertDriverMobileQueuedAction([], {
      ...createDriverMobileQueuedAction({ bookingId: "booking-a", action: "DELIVERED" }),
      state: "pending",
      lastAttemptAt: "2026-08-13T10:15:00.000Z",
    });

    const remaining = reconcileDriverMobileQueuedActions(queued, [
      makeTask({ bookingId: "booking-a", status: "delivered", nextAction: null, group: "completed", deliveredAt: "2026-08-13T10:16:00.000Z" }),
    ]);

    expect(remaining).toEqual([]);
    expect(isDriverMobileActionSatisfied(makeTask({ status: "delivered", nextAction: null, group: "completed" }), "DELIVERED")).toBe(true);
  });

  it("rejects malformed queue rows safely", () => {
    expect(coerceDriverMobileQueuedAction({ action: "INVALID" })).toBeNull();
    expect(coerceDriverMobileQueuedAction({ bookingId: "booking-a", action: "COLLECTED", temperatureC: "hot" })).not.toBeNull();
  });
});