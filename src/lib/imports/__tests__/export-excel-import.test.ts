import { describe, expect, it } from "vitest";
import {
  confirmRowsToParsedRows,
  EXPORT_ALLOCATIONS_REQUIRE_TRAILER_ID,
  previewExportAllocationImportRows,
  previewExportAllocationSpreadsheet,
  toExportAllocationConfirmRows,
  UNASSIGNED_EXPORT_TRAILER_LABEL,
  UNASSIGNED_EXPORT_SCHEMA_MESSAGE,
} from "@/lib/imports/export-allocation-import";
import { buildExportAllocationWorkbook } from "@/lib/imports/__tests__/spreadsheet-fixtures";
import { TRAILER_ACTIVE_EXPORT_ALLOCATION_MESSAGE, TRAILER_RESERVED_FOR_DELIVERY_MESSAGE } from "@/lib/trailer-job-eligibility";

const trailers = [
  { id: "a", trailer_number: "PRO810", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "b", trailer_number: "PFC102", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false, hasActiveDelivery: true },
  { id: "c", trailer_number: "FS59", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false, activeExportStatus: "allocated" },
];

describe("export Excel import preview", () => {
  it("accepts a valid row with a trailer and does not write records", () => {
    const preview = previewExportAllocationSpreadsheet(buildExportAllocationWorkbook(), trailers);

    expect(preview.wroteRecords).toBe(false);
    expect(preview.accepted).toHaveLength(1);
    expect(preview.accepted[0]).toMatchObject({
      trailer_number: "PRO810",
      customer: "Acme Exports",
      collection_address: "Yard 1",
      haulier: "Haulier A",
      booking_reference: "EXP-1",
      load_type: "Empty",
      collection_date: "2026-08-21",
      priority: "high",
    });
    expect(preview.accepted[0].trailer.id).toBe("a");
  });

  it("keeps a valid row without a trailer as unassigned instead of rejecting it", () => {
    const preview = previewExportAllocationSpreadsheet(buildExportAllocationWorkbook(), trailers);

    expect(preview.unassigned).toHaveLength(1);
    expect(preview.unassigned[0]).toMatchObject({
      customer: "Blank Trailer Customer",
      trailer_number: "",
      trailerLabel: UNASSIGNED_EXPORT_TRAILER_LABEL,
      persistBlocked: false,
    });
    expect(preview.warnings.some((warning) => warning.includes("created as unassigned"))).toBe(true);
    expect(EXPORT_ALLOCATIONS_REQUIRE_TRAILER_ID).toBe(false);
  });

  it("classifies invalid, duplicate and conflict rows without dropping them", () => {
    const preview = previewExportAllocationSpreadsheet(
      buildExportAllocationWorkbook([
        ["Trailer No.", "Customer", "Collection Date"],
        ["PRO810", "Acme Exports", "2026-08-21"],
        ["PRO810", "Acme Exports", "2026-08-22"],
        ["PFC102", "Delivery Reserved", "2026-08-21"],
        ["FS59", "Export Reserved", "2026-08-21"],
        ["UNKNOWN99", "Missing Trailer", "2026-08-21"],
        ["", "", "2026-08-21"],
      ]),
      trailers,
    );

    expect(preview.accepted.map((row) => row.trailer_number)).toEqual(["PRO810"]);
    expect(preview.duplicates[0].reason).toContain("PRO810");
    expect(preview.conflicts.some((item) => item.reason === TRAILER_RESERVED_FOR_DELIVERY_MESSAGE)).toBe(true);
    expect(preview.conflicts.some((item) => item.reason === TRAILER_ACTIVE_EXPORT_ALLOCATION_MESSAGE)).toBe(true);
    expect(preview.invalid.some((item) => item.reason.includes("UNKNOWN99"))).toBe(true);
    expect(preview.invalid.some((item) => item.reason.includes("Customer is required"))).toBe(true);
    expect(preview.wroteRecords).toBe(false);
  });

  it("includes unassigned rows in the confirm payload so they cannot disappear silently", () => {
    const preview = previewExportAllocationSpreadsheet(buildExportAllocationWorkbook(), trailers);
    const confirmRows = toExportAllocationConfirmRows(preview);

    expect(confirmRows).toHaveLength(2);
    expect(confirmRows[0].trailerNumber).toBe("PRO810");
    expect(confirmRows[1].trailerNumber).toBe("");
    expect(confirmRows[1].customer).toBe("Blank Trailer Customer");
    expect(UNASSIGNED_EXPORT_SCHEMA_MESSAGE).toContain("created without a trailer");
  });

  it("re-checks trailer eligibility on confirm rows before any write", () => {
    const preview = previewExportAllocationImportRows(
      confirmRowsToParsedRows([
        { trailerNumber: "PRO810", customer: "Acme Exports", collectionDate: "2026-08-21" },
        { trailerNumber: "FS59", customer: "Export Reserved", collectionDate: "2026-08-21" },
        { trailerNumber: "", customer: "Later Assign", collectionDate: "2026-08-21" },
      ]),
      trailers,
    );

    expect(preview.wroteRecords).toBe(false);
    expect(preview.accepted.map((row) => row.trailer_number)).toEqual(["PRO810"]);
    expect(preview.conflicts.some((item) => item.trailerNumber === "FS59")).toBe(true);
    expect(preview.unassigned[0].customer).toBe("Later Assign");
  });
});
