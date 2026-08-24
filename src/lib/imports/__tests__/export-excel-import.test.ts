import { describe, expect, it } from "vitest";
import {
  confirmRowsToParsedRows,
  EXPORT_ALLOCATIONS_REQUIRE_TRAILER_ID,
  previewExportAllocationImportRows,
  previewExportAllocationSpreadsheet,
  resolveExportFleetMatch,
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
  { id: "pfc25-current", trailer_number: "PFC25", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "pfc25-departed", trailer_number: "PFC25", load_status: "empty", departure_date: "2026-07-01", operational_status: "Departed", is_local: false },
  { id: "pfw1303-current", trailer_number: "PFW1303", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "pfw1303-departed", trailer_number: "PFW1303", load_status: "empty", departure_date: "2026-06-01", operational_status: "Departed", is_local: false },
  { id: "pfw1304-current", trailer_number: "PFW1304", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "pfw1304-departed", trailer_number: "PFW1304", load_status: "loaded", departure_date: "2026-05-01", operational_status: "Departed", is_local: false },
  { id: "pkd12-current", trailer_number: "PKD12", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "pkd12-departed", trailer_number: "PKD12", load_status: "loaded", departure_date: "2026-04-01", operational_status: "Departed", is_local: false },
  { id: "pkd22", trailer_number: "PKD22", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "pkd28-current", trailer_number: "PKD28", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "pkd28-departed", trailer_number: "PKD28", load_status: "empty", departure_date: "2026-03-01", operational_status: "Departed", is_local: false },
  { id: "fsc1310-current", trailer_number: "FSC1310", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "fsc1310-departed", trailer_number: "FSC1310", load_status: "empty", departure_date: "2026-02-01", operational_status: "Departed", is_local: false },
  { id: "fsc1336", trailer_number: "FSC1336", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "fs79", trailer_number: "FS79", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "fab12-current", trailer_number: "FAB12", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "fab12-departed", trailer_number: "FAB12", load_status: "empty", departure_date: "2026-01-01", operational_status: "Departed", is_local: false },
  { id: "fab12-cancelled", trailer_number: "FAB12", load_status: "empty", departure_date: null, operational_status: "Cancelled", is_local: false },
  { id: "crb504-current", trailer_number: "CRB504", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "crb504-departed", trailer_number: "CRB504", load_status: "empty", departure_date: "2025-12-01", operational_status: "Departed", is_local: false },
  { id: "pfc49", trailer_number: "PFC49", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "iow9", trailer_number: "IOW9", load_status: "empty", departure_date: null, operational_status: "Local Trailer", is_local: true },
  { id: "fs90", trailer_number: "FS90", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "ambiguous-a", trailer_number: "AMB01", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "ambiguous-b", trailer_number: "AMB01", load_status: "empty", departure_date: null, operational_status: "In Compound", is_local: false },
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

describe("export Excel import hardening", () => {
  const previewRows = (
    rows: Array<Array<string | number>>,
    fleet = trailers,
  ) => previewExportAllocationSpreadsheet(buildExportAllocationWorkbook(rows), fleet);

  it("accepts spaced operational trailer numbers as compact ids", () => {
    const preview = previewRows([
      ["Trailer No.", "Customer", "Collection Date"],
      ["PKD 22", "Spaced PKD", "2026-08-21"],
      ["FSC 1310", "Spaced FSC", "2026-08-21"],
      ["FS 79", "Spaced FS", "2026-08-21"],
      ["FAB 12", "Spaced FAB", "2026-08-21"],
      ["CRB 504", "Spaced CRB", "2026-08-21"],
      ["PKD 28", "Spaced PKD28", "2026-08-21"],
      ["FSC 1336", "Spaced FSC1336", "2026-08-21"],
    ]);

    expect(preview.invalid).toEqual([]);
    expect(preview.conflicts).toEqual([]);
    expect(preview.accepted.map((row) => row.trailer_number)).toEqual([
      "PKD22",
      "FSC1310",
      "FS79",
      "FAB12",
      "CRB504",
      "PKD28",
      "FSC1336",
    ]);
    expect(preview.accepted.map((row) => row.trailer.id)).toEqual([
      "pkd22",
      "fsc1310-current",
      "fs79",
      "fab12-current",
      "crb504-current",
      "pkd28-current",
      "fsc1336",
    ]);
  });

  it("reports valid-but-not-found separately from invalid format", () => {
    const preview = previewRows([
      ["Trailer No.", "Customer", "Collection Date"],
      ["DSV2045", "Missing Fleet", "2026-08-21"],
      ["***", "Bad Format", "2026-08-21"],
    ]);

    expect(preview.invalid.find((item) => item.trailerNumber === "DSV2045")?.reason).toBe("Trailer DSV2045 was not found.");
    expect(preview.invalid.find((item) => item.trailerNumber === "***")?.reason).toContain("is not a valid operational trailer number");
    expect(preview.conflicts).toEqual([]);
  });

  it("chooses the current operational row over historical or cancelled duplicates", () => {
    const preview = previewRows([
      ["Trailer No.", "Customer", "Collection Date"],
      ["PFC25", "PFC25 Customer", "2026-08-21"],
      ["PFW1303", "PFW1303 Customer", "2026-08-21"],
      ["PFW1304", "PFW1304 Customer", "2026-08-21"],
      ["PKD12", "PKD12 Customer", "2026-08-21"],
    ]);

    expect(preview.conflicts).toEqual([]);
    expect(preview.accepted.find((row) => row.trailer_number === "PFC25")?.trailer.id).toBe("pfc25-current");
    expect(preview.accepted.find((row) => row.trailer_number === "PFW1303")?.trailer.id).toBe("pfw1303-current");
    expect(preview.accepted.find((row) => row.trailer_number === "PFW1304")?.trailer.id).toBe("pfw1304-current");
    expect(preview.accepted.find((row) => row.trailer_number === "PKD12")?.trailer.id).toBe("pkd12-current");
    expect(resolveExportFleetMatch([
      trailers.find((row) => row.id === "pfc25-departed")!,
      trailers.find((row) => row.id === "pfc25-current")!,
    ]).status).toBe("match");
  });

  it("keeps genuine two-active fleet identity as a trailer conflict", () => {
    const preview = previewRows([
      ["Trailer No.", "Customer", "Collection Date"],
      ["AMB01", "Ambiguous", "2026-08-21"],
    ]);

    expect(preview.accepted).toEqual([]);
    expect(preview.conflicts[0]).toMatchObject({
      trailerNumber: "AMB01",
      reason: "Trailer AMB01 matches more than one fleet record.",
    });
    expect(toExportAllocationConfirmRows(preview)).toEqual([]);
  });

  it("keeps ready operator trailers ready, including local IOW9", () => {
    const preview = previewRows([
      ["Trailer No.", "Customer", "Collection Date"],
      ["PFC49", "Ready PFC", "2026-08-21"],
      ["IOW9", "Ready IOW", "2026-08-21"],
      ["FS90", "Ready FS", "2026-08-21"],
    ]);

    expect(preview.accepted.map((row) => row.trailer_number)).toEqual(["PFC49", "IOW9", "FS90"]);
    expect(preview.accepted.find((row) => row.trailer_number === "IOW9")?.trailer.is_local).toBe(true);
  });

  it("treats compact and spaced trailer numbers in one workbook as duplicates", () => {
    const preview = previewRows([
      ["Trailer No.", "Customer", "Collection Date"],
      ["FSC1310", "First", "2026-08-21"],
      ["FSC 1310", "Second", "2026-08-22"],
    ]);

    expect(preview.accepted.map((row) => row.trailer_number)).toEqual(["FSC1310"]);
    expect(preview.duplicates[0].reason).toContain("FSC1310");
  });

  it("converts Excel serial dates before preview and never shows the raw serial", () => {
    const preview = previewRows([
      ["Trailer No.", "Customer", "Collection Date", "Expected Return At"],
      ["PFC49", "Serial Dates", 46258, 46258.583333333336],
    ]);

    expect(preview.accepted).toHaveLength(1);
    expect(preview.accepted[0].collection_date).toBe("2026-08-24");
    expect(preview.accepted[0].expected_return_at).toBe("2026-08-24T14:00:00.000Z");
    expect(JSON.stringify(preview)).not.toContain("46258");
  });

  it("accepts blank Trailer No. as unassigned with customer and collection data preserved", () => {
    const preview = previewRows([
      ["Trailer No.", "Customer", "Collection Address", "Haulier", "Booking Reference", "Collection Date", "Notes"],
      ["", "Later Customer", "Dock 4", "Haulier Z", "BK-9", "21/08/2026", "Select later"],
    ]);

    expect(preview.unassigned).toHaveLength(1);
    expect(preview.unassigned[0]).toMatchObject({
      trailer_number: "",
      customer: "Later Customer",
      collection_address: "Dock 4",
      haulier: "Haulier Z",
      booking_reference: "BK-9",
      collection_date: "2026-08-21",
      notes: "Select later",
      trailerLabel: UNASSIGNED_EXPORT_TRAILER_LABEL,
      persistBlocked: false,
    });
    expect(preview.invalid).toEqual([]);
  });

  it("uses the same compact normalization and canonical trailer id on confirm as preview", () => {
    const preview = previewRows([
      ["Trailer No.", "Customer", "Collection Date"],
      ["PKD 22", "Spaced Confirm", "2026-08-21"],
      ["PFC25", "Historical Duplicate", "2026-08-21"],
      ["AMB01", "Ambiguous", "2026-08-21"],
    ]);
    const confirmRows = toExportAllocationConfirmRows(preview);
    const confirmed = previewExportAllocationImportRows(confirmRowsToParsedRows(confirmRows), trailers);

    expect(preview.wroteRecords).toBe(false);
    expect(confirmRows.map((row) => row.trailerNumber)).toEqual(["PKD22", "PFC25"]);
    expect(confirmRows.map((row) => row.trailerId)).toEqual(["pkd22", "pfc25-current"]);
    expect(confirmed.accepted.map((row) => row.trailer.id)).toEqual(["pkd22", "pfc25-current"]);
    expect(confirmed.conflicts).toEqual([]);
    expect(confirmRows.some((row) => row.trailerNumber === "AMB01")).toBe(false);

    const spacedConfirm = previewExportAllocationImportRows(
      confirmRowsToParsedRows([
        { trailerNumber: "PKD 22", customer: "Spaced Confirm", collectionDate: "2026-08-21" },
      ]),
      trailers,
    );
    expect(spacedConfirm.accepted[0]).toMatchObject({
      trailer_number: "PKD22",
      trailer: { id: "pkd22" },
    });
  });

  it("does not auto-confirm eligibility conflicts", () => {
    const preview = previewRows([
      ["Trailer No.", "Customer", "Collection Date"],
      ["PFC102", "Delivery Reserved", "2026-08-21"],
      ["FS59", "Export Reserved", "2026-08-21"],
    ]);

    expect(preview.accepted).toEqual([]);
    expect(toExportAllocationConfirmRows(preview)).toEqual([]);
    expect(preview.conflicts).toHaveLength(2);
  });
});
