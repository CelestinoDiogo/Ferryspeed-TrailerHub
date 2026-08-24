import { describe, expect, it } from "vitest";
import {
  computeVesselOperationSummary,
  getVesselArrivalWorkflowState,
  getVesselOperationalQueueStage,
  getVesselTrailerDischargedAt,
  getVesselTrailerReceptionAt,
  matchesVesselOperationalListFilter,
  sortVesselOperationTrailersForArrivals,
  type VesselOperationTrailerRecord,
} from "@/lib/vessel-operations";

const makeTrailer = (overrides: Partial<VesselOperationTrailerRecord> = {}): VesselOperationTrailerRecord => ({
  id: "vt-1",
  vessel_operation_id: "op-1",
  trailer_number: "PFC01",
  customer: "Customer A",
  booking_reference: "BR-1",
  load_status: "Loaded",
  load_description: "Frozen cargo",
  temperature_required: "required",
  expected_front_temperature: -18,
  expected_rear_temperature: -18,
  expected_temperature_unit: "C",
  priority_level: "priority",
  priority_reason: "Hot delivery",
  planned_destination: "Compound",
  planning_notes: "Keep notes",
  ownership_type: "company",
  trailer_source: "company",
  external_company: null,
  status: "expected",
  arrival_status: "expected",
  discharged_at: null,
  arrived_at: null,
  arrival_confirmed_at: null,
  arrival_record_id: null,
  inspection_started_at: null,
  inspection_completed_at: null,
  assigned_position: null,
  has_damage: false,
  has_temperature_alert: false,
  ...overrides,
});

describe("vessel operational queue stages", () => {
  it("starts expected trailers in pending discharge", () => {
    const trailer = makeTrailer();
    expect(getVesselOperationalQueueStage(trailer)).toBe("pending_discharge");
    expect(matchesVesselOperationalListFilter(trailer, "expected")).toBe(true);
    expect(matchesVesselOperationalListFilter(trailer, "arrived")).toBe(false);
  });

  it("moves Mark Arrived / discharged trailers into reception pending only", () => {
    const trailer = makeTrailer({
      status: "arrived",
      arrival_status: "arrived",
      discharged_at: "2026-08-24T08:00:00.000Z",
      arrived_at: "2026-08-24T08:00:00.000Z",
    });

    expect(getVesselOperationalQueueStage(trailer)).toBe("reception_pending");
    expect(getVesselArrivalWorkflowState(trailer)).toBe("arrived");
    expect(matchesVesselOperationalListFilter(trailer, "expected")).toBe(false);
    expect(matchesVesselOperationalListFilter(trailer, "arrived")).toBe(true);
    expect(matchesVesselOperationalListFilter(trailer, "inspection_pending")).toBe(false);
    expect(getVesselTrailerDischargedAt(trailer)).toBe("2026-08-24T08:00:00.000Z");
  });

  it("moves Confirm Reception into inspection pending and out of reception", () => {
    const trailer = makeTrailer({
      status: "arrived",
      arrival_status: "arrived",
      discharged_at: "2026-08-24T08:00:00.000Z",
      arrival_record_id: "arrival-1",
      arrival_confirmed_at: "2026-08-24T08:10:00.000Z",
      assigned_position: "P12",
    });

    expect(getVesselOperationalQueueStage(trailer)).toBe("inspection_pending");
    expect(matchesVesselOperationalListFilter(trailer, "arrived")).toBe(false);
    expect(matchesVesselOperationalListFilter(trailer, "inspection_pending")).toBe(true);
    expect(matchesVesselOperationalListFilter(trailer, "all", { allMode: "arrival_work" })).toBe(false);
    expect(matchesVesselOperationalListFilter(trailer, "all", { allMode: "active_work" })).toBe(true);
    expect(getVesselTrailerReceptionAt(trailer)).toBe("2026-08-24T08:10:00.000Z");
    expect(trailer.planned_destination).toBe("Compound");
    expect(trailer.assigned_position).toBe("P12");
  });

  it("does not duplicate a received trailer between reception and inspection", () => {
    const trailer = makeTrailer({
      arrival_status: "arrived",
      arrival_record_id: "arrival-1",
      discharged_at: "2026-08-24T08:00:00.000Z",
    });

    expect(matchesVesselOperationalListFilter(trailer, "arrived")).toBe(false);
    expect(matchesVesselOperationalListFilter(trailer, "inspection_pending")).toBe(true);
    expect(matchesVesselOperationalListFilter(trailer, "inspection_in_progress")).toBe(false);
  });

  it("treats started inspection as inspection in progress, not reception or pending inspection", () => {
    const trailer = makeTrailer({
      arrival_status: "arrived",
      arrival_record_id: "arrival-1",
      discharged_at: "2026-08-24T08:00:00.000Z",
      inspection_started_at: "2026-08-24T08:20:00.000Z",
    });

    expect(getVesselOperationalQueueStage(trailer)).toBe("inspection_pending");
    expect(matchesVesselOperationalListFilter(trailer, "arrived")).toBe(false);
    expect(matchesVesselOperationalListFilter(trailer, "inspection_pending")).toBe(false);
    expect(matchesVesselOperationalListFilter(trailer, "inspection_in_progress")).toBe(true);
  });

  it("removes inspection-complete trailers from inspection pending and does not return them to reception", () => {
    const trailer = makeTrailer({
      status: "inspected",
      arrival_status: "arrived",
      arrival_record_id: "arrival-1",
      inspection_completed_at: "2026-08-24T09:00:00.000Z",
      has_damage: true,
    });

    expect(getVesselOperationalQueueStage(trailer)).toBe("inspection_complete");
    expect(matchesVesselOperationalListFilter(trailer, "inspection_pending")).toBe(false);
    expect(matchesVesselOperationalListFilter(trailer, "inspection_in_progress")).toBe(false);
    expect(matchesVesselOperationalListFilter(trailer, "arrived")).toBe(false);
    expect(matchesVesselOperationalListFilter(trailer, "expected")).toBe(false);
    expect(matchesVesselOperationalListFilter(trailer, "completed")).toBe(true);
  });

  it("preserves priority, temperature-required and damage metadata across queue moves", () => {
    const received = makeTrailer({
      arrival_status: "arrived",
      arrival_record_id: "arrival-1",
      discharged_at: "2026-08-24T08:00:00.000Z",
      priority_level: "priority",
      temperature_required: "required",
      has_damage: true,
      expected_front_temperature: -20,
    });

    expect(received.priority_level).toBe("priority");
    expect(received.temperature_required).toBe("required");
    expect(received.has_damage).toBe(true);
    expect(received.expected_front_temperature).toBe(-20);
    expect(getVesselOperationalQueueStage(received)).toBe("inspection_pending");
  });

  it("keeps discharged_at and reception timestamps unchanged when classifying queues", () => {
    const trailer = makeTrailer({
      arrival_status: "arrived",
      discharged_at: "2026-08-24T08:00:00.000Z",
      arrival_confirmed_at: "2026-08-24T08:12:00.000Z",
      arrival_record_id: "arrival-1",
    });

    expect(getVesselTrailerDischargedAt(trailer)).toBe("2026-08-24T08:00:00.000Z");
    expect(getVesselTrailerReceptionAt(trailer)).toBe("2026-08-24T08:12:00.000Z");
  });

  it("uses desktop All working view as remaining discharge + reception + inspection only", () => {
    const pending = makeTrailer({ id: "pending" });
    const reception = makeTrailer({ id: "reception", arrival_status: "arrived", discharged_at: "2026-08-24T08:00:00.000Z" });
    const inspection = makeTrailer({
      id: "inspection",
      arrival_status: "arrived",
      arrival_record_id: "arrival-1",
      discharged_at: "2026-08-24T08:00:00.000Z",
    });
    const completed = makeTrailer({
      id: "completed",
      status: "inspected",
      arrival_status: "arrived",
      arrival_record_id: "arrival-2",
      inspection_completed_at: "2026-08-24T09:00:00.000Z",
    });

    const active = [pending, reception, inspection, completed].filter((row) =>
      matchesVesselOperationalListFilter(row, "all", { allMode: "active_work" }),
    );
    const arrivalWork = [pending, reception, inspection, completed].filter((row) =>
      matchesVesselOperationalListFilter(row, "all", { allMode: "arrival_work" }),
    );

    expect(active.map((row) => row.id)).toEqual(["pending", "reception", "inspection"]);
    expect(arrivalWork.map((row) => row.id)).toEqual(["pending", "reception"]);
  });

  it("keeps Master Mobile pending-discharge empty after discharge and inspection-pending empty until reception", () => {
    const discharged = makeTrailer({
      arrival_status: "arrived",
      discharged_at: "2026-08-24T08:00:00.000Z",
    });
    const received = makeTrailer({
      arrival_status: "arrived",
      discharged_at: "2026-08-24T08:00:00.000Z",
      arrival_record_id: "arrival-1",
    });

    expect(getVesselOperationalQueueStage(discharged)).toBe("reception_pending");
    expect(getVesselOperationalQueueStage(received)).toBe("inspection_pending");
    expect(matchesVesselOperationalListFilter(discharged, "expected")).toBe(false);
    expect(matchesVesselOperationalListFilter(received, "expected")).toBe(false);
    expect(matchesVesselOperationalListFilter(discharged, "inspection_pending")).toBe(false);
    expect(matchesVesselOperationalListFilter(received, "inspection_pending")).toBe(true);
  });

  it("keeps natural trailer sorting and summary inspection pending aligned to reception", () => {
    const sorted = sortVesselOperationTrailersForArrivals([
      makeTrailer({ id: "b", trailer_number: "PFC10" }),
      makeTrailer({ id: "a", trailer_number: "PFC2" }),
    ]);
    expect(sorted.map((row) => row.trailer_number)).toEqual(["PFC2", "PFC10"]);

    const summary = computeVesselOperationSummary([
      makeTrailer({ id: "pending", arrival_status: "expected" }),
      makeTrailer({ id: "discharged", arrival_status: "arrived", status: "arrived", discharged_at: "2026-08-24T08:00:00.000Z" }),
      makeTrailer({
        id: "received",
        arrival_status: "arrived",
        status: "arrived",
        arrival_record_id: "arrival-1",
        discharged_at: "2026-08-24T08:00:00.000Z",
      }),
    ]);

    expect(summary.inspectionPending).toBe(1);
    expect(summary.arrived).toBe(2);
  });
});
