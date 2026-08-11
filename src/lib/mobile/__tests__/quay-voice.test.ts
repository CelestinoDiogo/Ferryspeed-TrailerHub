import { describe, expect, it, vi } from "vitest";
import {
  buildQuayTrailerVoiceSummary,
  buildQuayArrivedVoiceText,
  executeQuayVoiceCommand,
  parseQuayVoiceCommand,
  resolveQuayVoiceTrailer,
  type QuayVoiceTrailerMeta,
  type QuayVoiceTrailerRecord,
} from "@/lib/mobile/quay-voice";

const makeRow = (overrides: Partial<QuayVoiceTrailerRecord> = {}): QuayVoiceTrailerRecord => ({
  id: overrides.id ?? "vt-1",
  vesselOperationId: overrides.vesselOperationId ?? "op-1",
  trailerNumber: overrides.trailerNumber ?? "PFC12",
  customer: overrides.customer !== undefined ? overrides.customer : "Client One",
  arrivalStatus: overrides.arrivalStatus !== undefined ? overrides.arrivalStatus : "expected",
  priorityLevel: overrides.priorityLevel !== undefined ? overrides.priorityLevel : null,
  temperatureRequired: overrides.temperatureRequired !== undefined ? overrides.temperatureRequired : null,
  expectedFrontTemperature: overrides.expectedFrontTemperature !== undefined ? overrides.expectedFrontTemperature : null,
  expectedRearTemperature: overrides.expectedRearTemperature !== undefined ? overrides.expectedRearTemperature : null,
  expectedTemperatureUnit: overrides.expectedTemperatureUnit !== undefined ? overrides.expectedTemperatureUnit : "C",
  inspectionCompletedAt: overrides.inspectionCompletedAt !== undefined ? overrides.inspectionCompletedAt : null,
  hasTemperatureAlert: overrides.hasTemperatureAlert !== undefined ? overrides.hasTemperatureAlert : false,
  hasDamage: overrides.hasDamage !== undefined ? overrides.hasDamage : false,
});

const makeMeta = (overrides: Partial<QuayVoiceTrailerMeta> = {}): QuayVoiceTrailerMeta => ({
  trailerNumber: overrides.trailerNumber ?? "PFC12",
  customer: overrides.customer !== undefined ? overrides.customer : "Client One",
  compoundPosition: overrides.compoundPosition !== undefined ? overrides.compoundPosition : "P12",
  operationalStatus: overrides.operationalStatus !== undefined ? overrides.operationalStatus : "Ready",
});

describe("quay voice parser", () => {
  it("normalizes trailer formats with spaces and hyphens", () => {
    expect(parseQuayVoiceCommand("PFC 12").trailerNumber).toBe("PFC12");
    expect(parseQuayVoiceCommand("PRO-21").trailerNumber).toBe("PRO21");
    expect(parseQuayVoiceCommand("PKD1").trailerNumber).toBe("PKD1");
  });

  it("extracts trailer from common lookup and arrived phrasing", () => {
    expect(parseQuayVoiceCommand("What is trailer PFC 12?").intent).toBe("lookup");
    expect(parseQuayVoiceCommand("PFC 12 chegou").intent).toBe("mark_arrived");
  });

  it("fails safely for invalid phrases", () => {
    const parsed = parseQuayVoiceCommand("show me status");
    expect(parsed.intent).toBe("unknown");
    expect(parsed.clarification).toContain("trailer number");
  });
});

describe("quay voice resolution and response", () => {
  it("prefers selected vessel queue lookup", () => {
    const selected = [makeRow({ id: "vt-sel", trailerNumber: "PFC12", vesselOperationId: "op-1" })];
    const all = [
      ...selected,
      makeRow({ id: "vt-other", trailerNumber: "PFC12", vesselOperationId: "op-2" }),
    ];

    const resolution = resolveQuayVoiceTrailer({
      trailerNumber: "PFC12",
      selectedVesselId: "op-1",
      selectedVesselRows: selected,
      allRows: all,
    });

    expect(resolution.status).toBe("resolved_in_selected_vessel");
    if (resolution.status === "resolved_in_selected_vessel") {
      expect(resolution.trailer.id).toBe("vt-sel");
    }
  });

  it("returns concise trailer summary fields", () => {
    const summary = buildQuayTrailerVoiceSummary({
      trailer: makeRow({ trailerNumber: "PRO21", arrivalStatus: "arrived", expectedFrontTemperature: 2, priorityLevel: "priority" }),
      trailerMeta: makeMeta({ customer: "Ocean Cargo", compoundPosition: "P09" }),
      notOnSelectedVessel: false,
    });

    expect(summary.spoken).toContain("PRO21");
    expect(summary.spoken).toContain("Customer Ocean Cargo");
    expect(summary.spoken).toContain("Temperature required");
    expect(summary.spoken).toContain("Priority");
    expect(summary.spoken).toContain("Arrived, inspection pending");
  });

  it("formats lookup speech in Portuguese and omits missing fields cleanly", () => {
    const summary = buildQuayTrailerVoiceSummary({
      trailer: makeRow({
        trailerNumber: "FS1002",
        arrivalStatus: "arrived",
        customer: null,
        expectedFrontTemperature: null,
        expectedRearTemperature: null,
        priorityLevel: null,
      }),
      trailerMeta: makeMeta({ customer: null, compoundPosition: null }),
      notOnSelectedVessel: false,
      language: "pt-PT",
    });

    expect(summary.spoken).toBe("FS1002. Chegou, inspeção pendente.");
  });

  it("builds arrived success speech per language", () => {
    expect(buildQuayArrivedVoiceText("PFC12", "en-GB")).toBe("PFC12 marked arrived.");
    expect(buildQuayArrivedVoiceText("PFC12", "pt-PT")).toBe("PFC12 marcada como chegada.");
  });

  it("handles unknown trailer cleanly", async () => {
    const result = await executeQuayVoiceCommand({
      recognizedText: "What is trailer ZZZ999",
      selectedVesselId: "op-1",
      selectedVesselRows: [makeRow()],
      allRows: [makeRow()],
      trailerMetaByNumber: { PFC12: makeMeta() },
      canMarkArrived: true,
      isTrailerBusy: () => false,
      onMarkArrived: async () => true,
    });

    expect(result.status).toBe("error");
    expect(result.responseText).toContain("not found");
  });
});

describe("quay voice arrived action", () => {
  it("executes arrived for clear eligible command", async () => {
    const target = makeRow({ id: "vt-1", trailerNumber: "PFC12", arrivalStatus: "expected" });
    const onMarkArrived = vi.fn().mockResolvedValue(true);

    const result = await executeQuayVoiceCommand({
      recognizedText: "Mark PFC 12 arrived",
      selectedVesselId: "op-1",
      selectedVesselRows: [target],
      allRows: [target],
      trailerMetaByNumber: { PFC12: makeMeta() },
      canMarkArrived: true,
      isTrailerBusy: () => false,
      onMarkArrived,
    });

    expect(onMarkArrived).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("success");
    expect(result.responseText).toContain("marked arrived");
  });

  it("blocks execution for ambiguous match", async () => {
    const one = makeRow({ id: "vt-1", trailerNumber: "PFC12", vesselOperationId: "op-2" });
    const two = makeRow({ id: "vt-2", trailerNumber: "PFC12", vesselOperationId: "op-3" });
    const onMarkArrived = vi.fn().mockResolvedValue(true);

    const result = await executeQuayVoiceCommand({
      recognizedText: "PFC 12 chegou",
      selectedVesselId: "op-1",
      selectedVesselRows: [],
      allRows: [one, two],
      trailerMetaByNumber: { PFC12: makeMeta() },
      canMarkArrived: true,
      isTrailerBusy: () => false,
      onMarkArrived,
    });

    expect(onMarkArrived).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
    expect(result.responseText).toContain("multiple records");
  });

  it("blocks execution for ineligible trailer", async () => {
    const arrived = makeRow({ id: "vt-1", trailerNumber: "PFC12", arrivalStatus: "arrived" });
    const onMarkArrived = vi.fn().mockResolvedValue(true);

    const result = await executeQuayVoiceCommand({
      recognizedText: "PFC12 arrived",
      selectedVesselId: "op-1",
      selectedVesselRows: [arrived],
      allRows: [arrived],
      trailerMetaByNumber: { PFC12: makeMeta() },
      canMarkArrived: true,
      isTrailerBusy: () => false,
      onMarkArrived,
    });

    expect(onMarkArrived).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
    expect(result.responseText).toContain("not eligible");
  });
});
