import { describe, expect, it } from "vitest";
import {
  coerceQueueItem,
  createMobileActionQueueItem,
  getMobileActionDedupeKey,
  getMobileActionLabel,
} from "@/lib/mobile/mobile-actions";
import {
  classifyActionFailure,
  getMaxRetryCount,
  getRetryBackoffMs,
} from "@/lib/mobile/mobile-action-queue";

describe("mobile typed queue", () => {
  it("serializes deterministic queue records", () => {
    const item = createMobileActionQueueItem({
      actionType: "MOVE_COMPOUND_POSITION",
      payload: {
        trailerId: "11111111-1111-4111-8111-111111111111",
        trailerNumber: "FS1234",
        targetPosition: "P12",
        expectedCurrentPosition: "P10",
      },
      trailerNumber: "FS1234",
      operator: "Supervisor One",
    });

    expect(item.actionType).toBe("MOVE_COMPOUND_POSITION");
    expect(item.state).toBe("pending");
    expect(item.retryCount).toBe(0);
    expect(item.operator).toBe("Supervisor One");
    expect(getMobileActionLabel(item)).toContain("P12");
  });

  it("migrates legacy mark-arrived commands", () => {
    const migrated = coerceQueueItem({
      id: "legacy-1",
      createdAt: "2026-07-20T10:00:00.000Z",
      status: "pending",
      attempts: 2,
      trailerNumber: "FS9999",
      commandText: "mark arrived FS9999",
    });

    expect(migrated).not.toBeNull();
    expect(migrated?.actionType).toBe("MARK_ARRIVED");
    expect(migrated?.trailerNumber).toBe("FS9999");
    expect(migrated?.retryCount).toBe(2);
  });

  it("rejects malformed or non-migratable legacy records", () => {
    const malformed = coerceQueueItem({ foo: "bar" });
    const unsupportedLegacy = coerceQueueItem({ commandText: "where is trailer FS1234" });

    expect(malformed).toBeNull();
    expect(unsupportedLegacy).toBeNull();
  });

  it("classifies conflict and permanent failures", () => {
    const conflict = classifyActionFailure(new Error("Destination position is occupied conflict"));
    const unauthorized = classifyActionFailure(new Error("Unauthorized request"));

    expect(conflict.state).toBe("conflict");
    expect(conflict.retryable).toBe(false);
    expect(unauthorized.state).toBe("failed");
    expect(unauthorized.retryable).toBe(false);
  });

  it("classifies transient failures and applies retry backoff", () => {
    const transient = classifyActionFailure(new Error("Network timeout"));

    expect(transient.state).toBe("failed");
    expect(transient.retryable).toBe(true);
    expect(getRetryBackoffMs(0)).toBe(1000);
    expect(getRetryBackoffMs(3)).toBe(8000);
    expect(getMaxRetryCount()).toBe(5);
  });

  it("generates stable dedupe keys for repeated actions on the same target", () => {
    const first = getMobileActionDedupeKey({
      actionType: "MARK_ARRIVED",
      payload: {
        vesselTrailerId: "11111111-1111-4111-8111-111111111111",
        trailerNumber: "FS1234",
        operationId: "22222222-2222-4222-8222-222222222222",
      },
      trailerNumber: "FS1234",
    });

    const second = getMobileActionDedupeKey({
      actionType: "MARK_ARRIVED",
      payload: {
        vesselTrailerId: "11111111-1111-4111-8111-111111111111",
        trailerNumber: "fs1234",
        operationId: "22222222-2222-4222-8222-222222222222",
      },
      trailerNumber: "fs1234",
    });

    const different = getMobileActionDedupeKey({
      actionType: "MOVE_COMPOUND_POSITION",
      payload: {
        trailerId: "11111111-1111-4111-8111-111111111111",
        trailerNumber: "FS1234",
        targetPosition: "P12",
      },
      trailerNumber: "FS1234",
    });

    expect(first).toBe(second);
    expect(first).not.toBe(different);
  });

  it("generates dedupe keys for add-vessel-trailer regardless of casing", () => {
    const first = getMobileActionDedupeKey({
      actionType: "ADD_VESSEL_TRAILER",
      payload: {
        operationId: "22222222-2222-4222-8222-222222222222",
        trailerNumber: "FS7001",
        ownershipType: "company",
        plannedDestination: "Compound",
      },
      trailerNumber: "FS7001",
    });

    const second = getMobileActionDedupeKey({
      actionType: "ADD_VESSEL_TRAILER",
      payload: {
        operationId: "22222222-2222-4222-8222-222222222222",
        trailerNumber: "fs7001",
        ownershipType: "company",
        plannedDestination: "Compound",
      },
      trailerNumber: "fs7001",
    });

    expect(first).toBe(second);
  });

  it("returns user-friendly labels for no-show outcomes", () => {
    const noShowLabel = getMobileActionLabel({
      actionType: "MARK_NO_SHOW",
      payload: {
        vesselTrailerId: "11111111-1111-4111-8111-111111111111",
        trailerNumber: "FS5000",
      },
      trailerNumber: "FS5000",
    });

    const undoLabel = getMobileActionLabel({
      actionType: "UNDO_NO_SHOW",
      payload: {
        vesselTrailerId: "11111111-1111-4111-8111-111111111111",
        trailerNumber: "FS5000",
      },
      trailerNumber: "FS5000",
    });

    expect(noShowLabel).toContain("no show");
    expect(undoLabel).toContain("Undo no show");
  });
});
