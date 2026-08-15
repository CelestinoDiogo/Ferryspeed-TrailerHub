import { describe, expect, it } from "vitest";
import {
  applyPlanningOwnershipSelection,
  deriveVesselWorkflowStep,
  getCompletionReadiness,
  getPlanningReadiness,
  resolveVesselReceptionLoadStatus,
  resolveVesselReceptionOwnership,
  validateTrailerPlanning,
  type VesselOperationRecord,
  type VesselOperationTrailerRecord,
} from "@/lib/vessel-operations";

const makeOperation = (overrides: Partial<VesselOperationRecord> = {}): VesselOperationRecord => ({
  id: "op-1",
  status: "draft",
  list_status: "draft",
  list_confirmed_at: null,
  list_confirmed_by: null,
  completed_at: null,
  completed_by: null,
  final_locked_at: null,
  ...overrides,
});

const makeTrailer = (overrides: Partial<VesselOperationTrailerRecord> = {}): VesselOperationTrailerRecord => ({
  id: "vt-1",
  vessel_operation_id: "op-1",
  trailer_number: "PRO100",
  customer: "Customer A",
  booking_reference: "BR-1",
  load_status: "Loaded",
  load_description: "Frozen cargo",
  temperature_required: "required",
  expected_front_temperature: -18,
  expected_rear_temperature: -18,
  expected_temperature_unit: "C",
  priority_level: "normal",
  priority_reason: null,
  planned_destination: "Compound",
  planning_notes: "Planned",
  ownership_type: "outsourcing",
  trailer_source: "outsourced",
  external_company: "Supplier Co",
  added_after_confirmation: false,
  added_after_confirmation_at: null,
  added_after_confirmation_by: null,
  manifest_change_reason: null,
  status: "expected",
  arrival_status: "expected",
  arrival_confirmed_at: null,
  inspection_completed_at: null,
  has_damage: false,
  has_temperature_alert: false,
  ...overrides,
});

describe("vessel workflow regression", () => {
  it("keeps physical load state independent from operational lifecycle state", () => {
    expect(resolveVesselReceptionLoadStatus("Empty", "Loaded")).toBe("Loaded");
    expect(resolveVesselReceptionLoadStatus("Loaded", "Empty")).toBe("Loaded");
    expect(resolveVesselReceptionLoadStatus("Empty", "Empty")).toBe("Empty");
  });

  it("preserves outsourced manifest ownership through reception", () => {
    expect(resolveVesselReceptionOwnership({
      ownershipType: "outsourcing",
      vesselTrailerSource: "outsourced",
      vesselExternalCompany: "Carrier Z",
      currentTrailerSource: "company",
      trailerNumber: "PFC200",
    })).toEqual({
      ownershipType: "outsourcing",
      trailerSource: "outsourced",
      externalCompany: "Carrier Z",
    });
  });

  it("does not coerce unknown reception ownership to company", () => {
    expect(resolveVesselReceptionOwnership({ trailerNumber: "UNKNOWN1" })).toEqual({
      ownershipType: "unknown",
      trailerSource: null,
      externalCompany: null,
    });
  });

  it("keeps Confirm List available after planning save and allows arrival after confirmation", () => {
    const operation = makeOperation({ status: "draft", list_status: "draft" });
    const trailer = makeTrailer();

    const readinessAfterPlanning = getPlanningReadiness([trailer]);
    expect(readinessAfterPlanning.canConfirmList).toBe(true);

    const stepAfterPlanning = deriveVesselWorkflowStep(operation, [trailer]);
    expect(stepAfterPlanning).toBe("planning");

    const confirmedOperation = makeOperation({ status: "draft", list_status: "confirmed" });
    const trailerReadyForArrival = makeTrailer({ arrival_status: "available_for_arrival" });

    const stepAfterConfirm = deriveVesselWorkflowStep(confirmedOperation, [trailerReadyForArrival]);
    expect(stepAfterConfirm).toBe("confirmed");

    const arrivedTrailer = makeTrailer({ arrival_status: "arrived", status: "arrived" });
    const stepAfterArrival = deriveVesselWorkflowStep(confirmedOperation, [arrivedTrailer]);
    expect(stepAfterArrival).toBe("checks");
  });

  it("blocks Confirm List with explicit planning gaps", () => {
    const incomplete = makeTrailer({
      trailer_number: "",
      ownership_type: null,
      planned_destination: "",
      expected_front_temperature: null,
      expected_rear_temperature: null,
      external_company: "",
      customer: "",
    });

    const readiness = getPlanningReadiness([incomplete]);
    expect(readiness.canConfirmList).toBe(false);
    expect(readiness.incompleteTrailers[0].issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining([
        "trailer_number",
        "ownership_type",
        "planned_destination",
        "expected_front_temperature",
        "expected_rear_temperature",
      ]),
    );
  });
});

describe("additional trailer after confirmation", () => {
  it("supports added-after-confirmation trailer through planning, arrival, checks, and final lock readiness", () => {
    const operation = makeOperation({ status: "confirmed", list_status: "confirmed", list_confirmed_at: "2026-08-01T08:30:00.000Z" });

    const originalTrailer = makeTrailer({
      id: "vt-base",
      trailer_number: "PRO101",
      status: "inspected",
      arrival_status: "arrived",
      inspection_completed_at: "2026-08-01T10:00:00.000Z",
      added_after_confirmation: false,
    });

    const additionalTrailer = makeTrailer({
      id: "vt-extra",
      trailer_number: "OUT500",
      added_after_confirmation: true,
      added_after_confirmation_at: "2026-08-01T09:00:00.000Z",
      added_after_confirmation_by: "Planner",
      manifest_change_reason: "Late load accepted",
      ownership_type: "outsourcing",
      trailer_source: "outsourced",
      external_company: "Late Supplier",
      status: "inspected",
      arrival_status: "arrived",
      inspection_completed_at: "2026-08-01T11:00:00.000Z",
    });

    const planningReadiness = getPlanningReadiness([originalTrailer, additionalTrailer]);
    expect(planningReadiness.canConfirmList).toBe(true);

    const completionReadiness = getCompletionReadiness([originalTrailer, additionalTrailer]);
    expect(completionReadiness.canComplete).toBe(true);

    const step = deriveVesselWorkflowStep(operation, [originalTrailer, additionalTrailer]);
    expect(step === "discharge" || step === "checks").toBe(true);
  });

  it("does not block completion for cancelled and no-show trailers", () => {
    const arrivedAndInspected = makeTrailer({
      id: "vt-arrived",
      trailer_number: "ARR100",
      status: "inspected",
      arrival_status: "arrived",
      inspection_completed_at: "2026-08-02T10:00:00.000Z",
    });

    const cancelled = makeTrailer({
      id: "vt-cancel",
      trailer_number: "CAN100",
      status: "not_arrived",
      arrival_status: "cancelled",
      inspection_completed_at: null,
    });

    const noShow = makeTrailer({
      id: "vt-noshow",
      trailer_number: "NOS100",
      status: "not_arrived",
      arrival_status: "no_show",
      inspection_completed_at: null,
    });

    const completionReadiness = getCompletionReadiness([arrivedAndInspected, cancelled, noShow]);
    expect(completionReadiness.canComplete).toBe(true);
    expect(completionReadiness.blockers).toHaveLength(0);
  });
});

describe("planning ownership controls", () => {
  it("keeps company ownership canonical when selected", () => {
    const state = applyPlanningOwnershipSelection("company", "unknown", "Vendor X");
    expect(state.ownershipType).toBe("company");
    expect(state.trailerSource).toBe("company");
    expect(state.externalCompany).toBe("");
  });

  it("keeps outsourcing ownership canonical when selected", () => {
    const state = applyPlanningOwnershipSelection("outsourcing", "company", "Vendor X");
    expect(state.ownershipType).toBe("outsourcing");
    expect(state.trailerSource).toBe("outsourced");
    expect(state.externalCompany).toBe("Vendor X");
  });

  it("clears external company when switching outsourcing to company", () => {
    const outsourcing = applyPlanningOwnershipSelection("outsourcing", "outsourced", "Supplier Ltd");
    const company = applyPlanningOwnershipSelection("company", outsourcing.trailerSource, outsourcing.externalCompany);

    expect(company.ownershipType).toBe("company");
    expect(company.trailerSource).toBe("company");
    expect(company.externalCompany).toBe("");
  });

  it("preserves local source as separate from company/outsourcing", () => {
    const localAsCompany = applyPlanningOwnershipSelection("company", "local", "Supplier Ltd");
    const localAsOutsourcing = applyPlanningOwnershipSelection("outsourcing", "local", "Supplier Ltd");

    expect(localAsCompany.ownershipType).toBe("unknown");
    expect(localAsCompany.trailerSource).toBe("local");
    expect(localAsOutsourcing.ownershipType).toBe("unknown");
    expect(localAsOutsourcing.trailerSource).toBe("local");
  });

  it("requires external company for outsourcing trailers", () => {
    const trailer = makeTrailer({
      ownership_type: "outsourcing",
      external_company: "",
      customer: "Customer A",
    });

    const result = validateTrailerPlanning(trailer);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.map((issue) => issue.message)).toContain("Enter external company for outsourcing trailer.");
  });

  it("blocks readiness when ownership is unknown", () => {
    const trailer = makeTrailer({
      ownership_type: "unknown",
      external_company: "",
    });

    const readiness = getPlanningReadiness([trailer]);
    expect(readiness.canConfirmList).toBe(false);
    expect(readiness.incompleteTrailers[0].issues.map((issue) => issue.message)).toContain("Select trailer ownership.");
  });
});
