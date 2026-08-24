import { describe, expect, it } from "vitest";
import { isTrailerEligibleForCompoundViews } from "@/lib/export-allocation";
import {
  getTrailerIdsReservedByActiveExportAllocations,
  getTrailerJobReservationLabel,
  describeLinkedExportForDeparture,
  isTrailerEligibleForCompoundDeparture,
  isTrailerEligibleForNewDeliveryJob,
  isTrailerEligibleForNewExportJob,
  TRAILER_ACTIVE_EXPORT_ALLOCATION_CODE,
  TrailerJobConflictError,
  withTrailerJobCommitments,
} from "@/lib/trailer-job-eligibility";

describe("canonical trailer job eligibility", () => {
  it("blocks a new delivery booking when the trailer has an active export allocation", () => {
    expect(isTrailerEligibleForNewDeliveryJob({
      hasActiveDelivery: false,
      activeExportStatus: "allocated",
    })).toBe(false);
    expect(isTrailerEligibleForNewDeliveryJob({
      hasActiveDelivery: false,
      activeExportStatus: "delivered_empty",
    })).toBe(false);
  });

  it("allows a new delivery booking after export is completed or cancelled", () => {
    expect(isTrailerEligibleForNewDeliveryJob({
      hasActiveDelivery: false,
      activeExportStatus: "completed",
    })).toBe(true);
    expect(isTrailerEligibleForNewDeliveryJob({
      hasActiveDelivery: false,
      activeExportStatus: "cancelled",
    })).toBe(true);
  });

  it("blocks a new export allocation when the trailer has an active delivery booking", () => {
    expect(isTrailerEligibleForNewExportJob({
      hasActiveDelivery: true,
      activeExportStatus: null,
    })).toBe(false);
  });

  it("keeps ALLOCATED trailers physically in Compound while blocking incompatible jobs", () => {
    const compoundTrailer = {
      id: "export-trailer",
      trailer_number: "FS9001",
      compound_position: "P01",
      departure_date: null,
      is_local: false,
    };

    expect(isTrailerEligibleForCompoundViews(compoundTrailer, "allocated")).toBe(true);
    expect(isTrailerEligibleForNewDeliveryJob({ activeExportStatus: "allocated" })).toBe(false);
    expect(isTrailerEligibleForCompoundDeparture({ activeExportStatus: "allocated" })).toBe(true);
  });

  it("keeps DELIVERED EMPTY trailers out of Compound while allowing confirmed departure", () => {
    const compoundTrailer = {
      id: "export-trailer",
      trailer_number: "FS9001",
      compound_position: null,
      departure_date: null,
      is_local: false,
    };

    expect(isTrailerEligibleForCompoundViews(compoundTrailer, "delivered_empty")).toBe(false);
    expect(isTrailerEligibleForCompoundDeparture({ activeExportStatus: "delivered_empty" })).toBe(true);
  });

  it("blocks departure of a trailer with an active delivery booking", () => {
    expect(isTrailerEligibleForCompoundDeparture({
      hasActiveDelivery: true,
      activeExportStatus: null,
    })).toBe(false);
  });

  it("allows departure after delivery is released even if export is still active", () => {
    expect(isTrailerEligibleForCompoundDeparture({
      hasActiveDelivery: false,
      activeExportStatus: "allocated",
    })).toBe(true);
  });

  it("describes a linked export for departure without treating it as a departure block", () => {
    expect(describeLinkedExportForDeparture({
      hasActiveDelivery: false,
      activeExportStatus: "allocated",
      activeExportCustomer: "ABC CUSTOMER",
    })).toEqual({
      badge: "EXPORT",
      customer: "ABC CUSTOMER",
      statusLabel: "Allocated",
      summary: "Export: ABC CUSTOMER",
    });
  });

  it("labels active Delivery and Export reservations for mobile visibility", () => {
    expect(getTrailerJobReservationLabel({ hasActiveDelivery: true })).toBe("Reserved - Delivery");
    expect(getTrailerJobReservationLabel({ activeExportStatus: "allocated" })).toBe("Reserved - Export");
    expect(getTrailerJobReservationLabel({
      hasActiveDelivery: true,
      activeExportStatus: "waiting_loading",
    })).toBe("Reserved - Delivery + Export");
    expect(getTrailerJobReservationLabel({
      hasActiveDelivery: false,
      activeExportStatus: "completed",
    })).toBeNull();
  });

  it("collects reserved trailer ids from active export rows only", () => {
    const reserved = getTrailerIdsReservedByActiveExportAllocations([
      { trailer_id: "a", status: "allocated" },
      { trailer_id: "b", status: "cancelled" },
      { trailer_id: "c", status: "delivered_empty" },
      { trailer_id: "d", status: "completed" },
    ]);

    expect([...reserved].sort()).toEqual(["a", "c"]);
  });

  it("attaches commitment fields without duplicating trailer rows", () => {
    const enriched = withTrailerJobCommitments(
      [{ id: "a" }, { id: "b" }],
      {
        reservedByDelivery: ["a"],
        exportStatusByTrailerId: new Map([["b", "allocated"]]),
      },
    );

    expect(enriched).toHaveLength(2);
    expect(enriched[0]).toMatchObject({ id: "a", hasActiveDelivery: true, activeExportStatus: null });
    expect(enriched[1]).toMatchObject({ id: "b", hasActiveDelivery: false, activeExportStatus: "allocated" });
  });

  it("uses a 409 conflict error for incompatible assignment writes", () => {
    const error = new TrailerJobConflictError(
      TRAILER_ACTIVE_EXPORT_ALLOCATION_CODE,
      "blocked",
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe(TRAILER_ACTIVE_EXPORT_ALLOCATION_CODE);
  });
});
