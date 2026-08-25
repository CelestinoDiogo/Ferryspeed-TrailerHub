import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getCompletionReadiness,
  getVesselInspectionProgressState,
  getVesselOperationalQueueStage,
  type VesselOperationTrailerRecord,
} from "@/lib/vessel-operations";

const boatCheckPage = readFileSync(new URL("../../../app/dashboard/vessel-operations/[id]/boat-check/[vesselTrailerId]/page.tsx", import.meta.url), "utf8");
const vesselHook = readFileSync(new URL("../../../app/dashboard/vessel-operations/[id]/hooks/use-vessel-operation.ts", import.meta.url), "utf8");
const mobileService = readFileSync(new URL("../../mobile/mobile-actions-service.ts", import.meta.url), "utf8");
const persistHelper = readFileSync(new URL("../persist-inspection-damage.ts", import.meta.url), "utf8");

const makeTrailer = (overrides: Partial<VesselOperationTrailerRecord> = {}): VesselOperationTrailerRecord => ({
  id: "vt-1",
  vessel_operation_id: "op-1",
  trailer_number: "FS1001",
  customer: "Customer A",
  booking_reference: "BR-1",
  load_status: "Loaded",
  load_description: "Cargo",
  temperature_required: null,
  expected_front_temperature: null,
  expected_rear_temperature: null,
  expected_temperature_unit: "C",
  priority_level: "normal",
  priority_reason: null,
  planned_destination: "Compound",
  planning_notes: "Damage recorded",
  ownership_type: "company",
  trailer_source: "company",
  external_company: null,
  added_after_confirmation: false,
  added_after_confirmation_at: null,
  added_after_confirmation_by: null,
  manifest_change_reason: null,
  status: "inspected",
  arrival_status: "arrived",
  discharged_at: "2026-08-25T07:00:00.000Z",
  arrival_confirmed_at: "2026-08-25T07:10:00.000Z",
  arrival_record_id: "arrival-1",
  inspection_started_at: "2026-08-25T07:20:00.000Z",
  inspection_completed_at: "2026-08-25T07:40:00.000Z",
  has_damage: true,
  has_temperature_alert: false,
  ...overrides,
});

describe("damaged trailer operational workflow", () => {
  it("reuses the canonical inspection damage persist helper on desktop and mobile save paths", () => {
    expect(boatCheckPage).toContain("persistVesselInspectionDamage");
    expect(vesselHook).toContain("persistVesselInspectionDamage");
    expect(mobileService).toContain("persistVesselInspectionDamage");
    expect(boatCheckPage).not.toMatch(/from\("vessel_inspection_damages"\)\s*\.insert\(\{\s*vessel_trailer_id:/);
    expect(persistHelper).not.toMatch(/vessel_operation_id:\s*input\.vesselOperationId/);
    expect(persistHelper).toContain("vessel_trailer_id: input.vesselTrailerId");
    expect(persistHelper).toContain("normalizeInspectionDamageSeverity");
    expect(boatCheckPage).toContain("LIVE_VESSEL_INSPECTION_DAMAGE_SEVERITIES");
  });

  it("lets a damaged inspected trailer complete the normal vessel workflow", () => {
    const damaged = makeTrailer();

    expect(getVesselInspectionProgressState(damaged)).toBe("issues_found");
    expect(getVesselOperationalQueueStage(damaged)).toBe("inspection_complete");
    expect(getCompletionReadiness([damaged]).canComplete).toBe(true);
    expect(getCompletionReadiness([damaged]).blockers).toEqual([]);
  });

  it("does not treat recorded damage as a lifecycle hold once inspection is saved", () => {
    const damaged = makeTrailer({
      status: "inspected",
      inspection_completed_at: "2026-08-25T07:40:00.000Z",
      has_damage: true,
    });

    expect(getVesselOperationalQueueStage(damaged)).not.toBe("inspection_pending");
    expect(getCompletionReadiness([damaged]).canComplete).toBe(true);
  });
});
