import { describe, expect, it } from "vitest";
import { isTrailerPresentInCompoundInventory } from "@/lib/export-allocation";
import {
  AWAITING_POSITION_OPERATIONAL_STATUS,
  DEPARTED_OPERATIONAL_STATUS,
  IN_COMPOUND_OPERATIONAL_STATUS,
  LOCAL_TRAILER_OPERATIONAL_STATUS,
  normalizeTrailerCurrentOperationalState,
  planTrailerCurrentStateRepair,
} from "@/lib/operations/trailer-current-state";

const present = {
  departure_date: null,
  departure_time: null,
  is_local: false,
  compound_position: "P01",
};

describe("normalizeTrailerCurrentOperationalState", () => {
  it("returned trailer with valid Pxx cannot remain Departed", () => {
    const result = normalizeTrailerCurrentOperationalState({
      ...present,
      operational_status: DEPARTED_OPERATIONAL_STATUS,
      departure_time: "10:26:50",
    });

    expect(result.operational_status).toBe(IN_COMPOUND_OPERATIONAL_STATUS);
    expect(result.departure_time).toBeNull();
    expect(result.clearDepartureTime).toBe(true);
    expect(result.patch).toEqual({
      operational_status: IN_COMPOUND_OPERATIONAL_STATUS,
      departure_time: null,
    });
  });

  it("valid Pxx cannot remain Awaiting Position after successful position assignment", () => {
    const result = normalizeTrailerCurrentOperationalState(
      {
        departure_date: null,
        is_local: false,
        compound_position: "P10",
        operational_status: AWAITING_POSITION_OPERATIONAL_STATUS,
      },
      { intent: "place_on_compound" },
    );

    expect(result.operational_status).toBe(IN_COMPOUND_OPERATIONAL_STATUS);
  });

  it("no-position Main trailer may remain Awaiting Position", () => {
    const result = normalizeTrailerCurrentOperationalState({
      departure_date: null,
      is_local: false,
      compound_position: null,
      operational_status: AWAITING_POSITION_OPERATIONAL_STATUS,
    });

    expect(result.changed).toBe(false);
    expect(result.operational_status).toBe(AWAITING_POSITION_OPERATIONAL_STATUS);
  });

  it("Local trailer remains Local while is_local=true", () => {
    const result = normalizeTrailerCurrentOperationalState({
      departure_date: null,
      is_local: true,
      compound_position: "P04",
      operational_status: LOCAL_TRAILER_OPERATIONAL_STATUS,
    });

    expect(result.operational_status).toBe(LOCAL_TRAILER_OPERATIONAL_STATUS);
    expect(result.changed).toBe(false);
  });

  it("does not rewrite a true current departure", () => {
    const result = normalizeTrailerCurrentOperationalState({
      departure_date: "2026-08-15T09:26:50.122Z",
      departure_time: "10:26:50",
      is_local: false,
      compound_position: null,
      operational_status: DEPARTED_OPERATIONAL_STATUS,
    });

    expect(result.changed).toBe(false);
    expect(result.operational_status).toBe(DEPARTED_OPERATIONAL_STATUS);
    expect(result.departure_time).toBe("10:26:50");
  });

  it("re-arrival onto a Compound bay clears stale current departure state", () => {
    const result = normalizeTrailerCurrentOperationalState(
      {
        departure_date: "2026-08-15T09:26:50.122Z",
        departure_time: "10:26:50",
        is_local: false,
        compound_position: "P01",
        operational_status: DEPARTED_OPERATIONAL_STATUS,
      },
      { intent: "place_on_compound" },
    );

    expect(result.operational_status).toBe(IN_COMPOUND_OPERATIONAL_STATUS);
    expect(result.departure_date).toBeNull();
    expect(result.departure_time).toBeNull();
    expect(result.patch.departure_date).toBeNull();
    expect(result.patch.departure_time).toBeNull();
  });

  it("preserves Export/Delivery special statuses", () => {
    expect(
      normalizeTrailerCurrentOperationalState({
        ...present,
        operational_status: "Allocated",
        activeExportStatus: "allocated",
      }).changed,
    ).toBe(false);

    expect(
      normalizeTrailerCurrentOperationalState({
        ...present,
        operational_status: "On Delivery",
      }).operational_status,
    ).toBe("On Delivery");

    expect(
      normalizeTrailerCurrentOperationalState({
        ...present,
        operational_status: "Maintenance",
      }).changed,
    ).toBe(false);
  });

  it("does not use operational_status as Compound presence truth", () => {
    expect(
      isTrailerPresentInCompoundInventory({
        id: "pff901",
        compound_position: "P01",
        departure_date: null,
        is_local: false,
        operational_status: DEPARTED_OPERATIONAL_STATUS,
      }),
    ).toBe(true);

    expect(
      isTrailerPresentInCompoundInventory({
        id: "gone",
        compound_position: "P01",
        departure_date: "2026-08-15",
        is_local: false,
        operational_status: IN_COMPOUND_OPERATIONAL_STATUS,
      }),
    ).toBe(false);
  });

  it("plans a read-only repair for PFF901-style drift", () => {
    const plan = planTrailerCurrentStateRepair([
      {
        trailer_number: "PFF901",
        ...present,
        operational_status: DEPARTED_OPERATIONAL_STATUS,
        departure_time: "10:26:50",
      },
      {
        trailer_number: "PKD12",
        ...present,
        compound_position: "P02",
        operational_status: AWAITING_POSITION_OPERATIONAL_STATUS,
      },
      {
        trailer_number: "FAB12",
        ...present,
        compound_position: "P27",
        operational_status: IN_COMPOUND_OPERATIONAL_STATUS,
      },
    ]);

    expect(plan).toEqual([
      {
        trailer_number: "PFF901",
        current_status: DEPARTED_OPERATIONAL_STATUS,
        proposed_status: IN_COMPOUND_OPERATIONAL_STATUS,
        departure_time_clear: "YES",
        reason: "compound_present",
        patch: {
          operational_status: IN_COMPOUND_OPERATIONAL_STATUS,
          departure_time: null,
        },
      },
      {
        trailer_number: "PKD12",
        current_status: AWAITING_POSITION_OPERATIONAL_STATUS,
        proposed_status: IN_COMPOUND_OPERATIONAL_STATUS,
        departure_time_clear: "NO",
        reason: "compound_present",
        patch: {
          operational_status: IN_COMPOUND_OPERATIONAL_STATUS,
        },
      },
    ]);
  });
});
