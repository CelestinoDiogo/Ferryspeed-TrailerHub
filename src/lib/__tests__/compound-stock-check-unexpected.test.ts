import { describe, expect, it } from "vitest";
import {
  classifyStockCheckObservation,
  encodeStockCheckFindingNotes,
  isUnexpectedStockCheckFinding,
  parseStockCheckFindingNotes,
  recountStockCheckObservationTotals,
  recountStockCheckResolutionTotals,
} from "@/lib/compound-stock-check";
import { planOpenStockCheckExpectedReconcile } from "@/lib/compound-stock-check-expected";
import { listRelevantStockCheckResolutions } from "@/lib/compound-stock-check-resolution";
import { matchStockCheckItemByTrailer } from "@/lib/compound-stock-check-unexpected";
import type { StockCheckItem } from "@/lib/compound-stock-check";

const item = (overrides: Partial<StockCheckItem> = {}): StockCheckItem =>
  ({
    id: "item-1",
    stock_check_id: "check-1",
    trailer_id: "trailer-1",
    trailer_number: "PFC99",
    expected_in_compound: false,
    physically_present: true,
    expected_position: null,
    actual_position: "P32",
    system_load_status: "Empty",
    system_operational_status: "Main List",
    discrepancy_type: "unexpected",
    checked_at: "2026-08-23T10:00:00.000Z",
    checked_by: "Operator",
    resolution_status: "unresolved",
    resolution_action: null,
    resolved_at: null,
    resolved_by: null,
    notes: encodeStockCheckFindingNotes({
      physicalLoad: "loaded",
      positionConflictOccupant: "PRO815",
      unknownTrailer: false,
      operatorNote: null,
    }),
    created_at: "2026-08-23T10:00:00.000Z",
    updated_at: "2026-08-23T10:00:00.000Z",
    ...overrides,
  }) as StockCheckItem;

describe("stock check unexpected findings", () => {
  it("treats expected_in_compound=false and physically_present=true as Unexpected", () => {
    const classification = classifyStockCheckObservation(item());
    expect(classification.unexpected).toBe(true);
    expect(isUnexpectedStockCheckFinding(item())).toBe(true);
  });

  it("records physical load and occupied-bay conflict without changing Expected", () => {
    const finding = parseStockCheckFindingNotes(item().notes);
    expect(finding.physicalLoad).toBe("loaded");
    expect(finding.positionConflictOccupant).toBe("PRO815");
    expect(recountStockCheckObservationTotals([item()]).unexpected_total).toBe(1);
  });

  it("can record an unknown trailer without a trailer_id", () => {
    const unknown = item({
      trailer_id: null,
      trailer_number: "ZZZ999",
      notes: encodeStockCheckFindingNotes({
        physicalLoad: "empty",
        positionConflictOccupant: null,
        unknownTrailer: true,
        operatorNote: "found on yard",
      }),
    });
    expect(unknown.trailer_id).toBeNull();
    expect(parseStockCheckFindingNotes(unknown.notes).unknownTrailer).toBe(true);
    expect(classifyStockCheckObservation(unknown).unexpected).toBe(true);
  });

  it("reuses the existing item by trailer number and never duplicates FAB12-style rows", () => {
    const fabOld = item({
      id: "item-fab12",
      trailer_id: "old-id",
      trailer_number: "FAB12",
    });
    const matched = matchStockCheckItemByTrailer([fabOld], "FAB12", "0961e6ad-current");
    expect(matched?.id).toBe("item-fab12");
    expect(matchStockCheckItemByTrailer([fabOld], "FAB12", "other-id")?.id).toBe("item-fab12");
  });

  it("routes an expected trailer entered through Unexpected into the normal Found path", () => {
    const expected = item({
      expected_in_compound: true,
      physically_present: null,
      discrepancy_type: "unchecked",
      actual_position: null,
    });
    expect(classifyStockCheckObservation(expected).unexpected).toBe(false);
    const found = { ...expected, physically_present: true, actual_position: "P10", discrepancy_type: "matched" };
    expect(classifyStockCheckObservation(found).unexpected).toBe(false);
    expect(classifyStockCheckObservation(found).present).toBe(true);
  });

  it("does not add an unexpected finding to Expected during reconcile", () => {
    const plan = planOpenStockCheckExpectedReconcile(
      [
        {
          id: "item-unexpected",
          trailer_id: "pfc99",
          trailer_number: "PFC99",
          expected_in_compound: false,
          expected_position: null,
          physically_present: true,
          actual_position: "P32",
          checked_at: "2026-08-23T10:00:00.000Z",
          discrepancy_type: "unexpected",
          resolution_status: "unresolved",
          notes: "found extra",
        },
      ],
      [
        {
          id: "pfc99",
          trailer_number: "PFC99",
          compound_position: "P32",
          load_status: "loaded",
          operational_status: "In Compound",
          departure_date: null,
          is_local: false,
        },
      ],
    );

    expect(plan.toInsert).toEqual([]);
    expect(plan.reuseUpdates).toEqual([]);
    expect(plan.expectedTotal).toBe(0);
  });

  it("keeps Unexpected after resolution and still counts unresolved separately", () => {
    const resolved = item({
      resolution_status: "resolved",
      resolution_action: "update_compound_position",
      resolved_at: "2026-08-23T11:00:00.000Z",
      resolved_by: "Master",
    });
    expect(classifyStockCheckObservation(resolved).unexpected).toBe(true);
    expect(recountStockCheckObservationTotals([resolved]).unexpected_total).toBe(1);
    expect(recountStockCheckResolutionTotals([resolved])).toEqual({ resolved_total: 1, unresolved_total: 0 });
    expect(recountStockCheckResolutionTotals([item()])).toEqual({ resolved_total: 0, unresolved_total: 1 });
  });

  it("keeps Position and Load mismatches recorded after they are resolved", () => {
    const position = item({
      expected_in_compound: true,
      expected_position: "P44",
      actual_position: "P32",
      discrepancy_type: "wrong_position",
      resolution_status: "resolved",
    });
    const load = item({
      id: "item-load",
      expected_in_compound: true,
      physically_present: true,
      expected_position: "P10",
      actual_position: "P10",
      discrepancy_type: "wrong_load_status",
      resolution_status: "resolved",
    });
    const missing = item({
      id: "item-missing",
      expected_in_compound: true,
      physically_present: false,
      discrepancy_type: "missing",
      resolution_status: "unresolved",
    });

    expect(classifyStockCheckObservation(position).positionMismatch).toBe(true);
    expect(classifyStockCheckObservation(load).statusMismatch).toBe(true);
    expect(classifyStockCheckObservation(missing).missing).toBe(true);
    const totals = recountStockCheckObservationTotals([position, load, missing]);
    expect(totals.wrong_position_total).toBe(1);
    expect(totals.wrong_status_total).toBe(1);
    expect(totals.missing_total).toBe(1);
  });

  it("offers create trailer on desktop only for unknown findings", () => {
    const unknown = item({ trailer_id: null, trailer_number: "UNK1" });
    expect(listRelevantStockCheckResolutions(unknown, null, "desktop")).toContain("create_trailer");
    expect(listRelevantStockCheckResolutions(unknown, null, "master_mobile")).not.toContain("create_trailer");
    expect(listRelevantStockCheckResolutions(unknown, null, "master_mobile")).toContain("keep_unresolved");
  });
});
