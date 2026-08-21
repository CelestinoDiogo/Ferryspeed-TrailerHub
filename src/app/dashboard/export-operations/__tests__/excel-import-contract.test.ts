import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/export-operations/page.tsx"),
  "utf8",
);

const persistSource = readFileSync(
  path.resolve(process.cwd(), "src/lib/imports/export-allocation-import-persist.ts"),
  "utf8",
);

const assignmentSource = readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/export-operations/[id]/page.tsx"),
  "utf8",
);

const mobileSource = readFileSync(
  path.resolve(process.cwd(), "src/components/mobile/supervisor-mobile-dashboard.tsx"),
  "utf8",
);

describe("Export Excel import contract", () => {
  it("previews Excel rows before any allocation write", () => {
    expect(pageSource).toContain("/api/imports/spreadsheet?purpose=export");
    expect(pageSource).toContain("Import Excel");
    expect(pageSource).toContain("setImportPreview(payload.preview)");
    expect(pageSource).toContain("Confirm import");
    expect(pageSource).not.toContain(".from(\"export_allocations\").insert");
  });

  it("re-checks trailer eligibility on confirm and never fakes a trailer id", () => {
    expect(pageSource).toContain("/api/imports/export-allocations");
    expect(persistSource).toContain("previewExportAllocationImportRows");
    expect(persistSource).toContain("trailerId: row.trailer.id");
    expect(persistSource).toContain("trailerId: null");
    expect(persistSource).toContain("trailerNumber: null");
    expect(persistSource).not.toContain("placeholder");
  });
});

describe("Export later trailer assignment contract", () => {
  it("assigns a trailer later through the server eligibility route", () => {
    expect(assignmentSource).toContain("Trailer cannot be changed after status progressed beyond allocated.");
    expect(assignmentSource).toContain("/api/export-allocations/assign-trailer");
    expect(assignmentSource).toContain("isTrailerEligibleForNewExportJob");
    expect(assignmentSource).toContain("formState.trailer_id");
    expect(assignmentSource).toContain("UNASSIGNED_EXPORT_TRAILER_LABEL");
  });
});

describe("Export unassigned display contract", () => {
  it("renders Trailer to be selected on list, detail, and mobile Export surfaces", () => {
    expect(pageSource).toContain("getExportAllocationTrailerLabel");
    expect(assignmentSource).toContain("getExportAllocationTrailerLabel");
    expect(mobileSource).toContain("getExportAllocationTrailerLabel(row)");
    expect(pageSource).toContain("UNASSIGNED_EXPORT_TRAILER_LABEL");
  });
});
