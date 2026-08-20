import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/vessel-operations/[id]/planning/page.tsx"),
  "utf8",
);

describe("Vessel list import contract", () => {
  it("previews Excel and PDF rows before adding them to the draft list", () => {
    expect(pageSource).toContain("/api/imports/spreadsheet?purpose=vessel_list");
    expect(pageSource).toContain("/api/imports/pdf?purpose=vessel_list");
    expect(pageSource).toContain("Import Excel");
    expect(pageSource).toContain("Import PDF");
    expect(pageSource).toContain("Add accepted trailers");
    expect(pageSource).toContain("setImportPreview(payload.preview)");
    expect(pageSource).not.toContain(".from(\"vessel_operation_trailers\").insert");
  });

  it("reuses the same draft import mapping for file confirmation", () => {
    expect(pageSource).toContain("const applyImportedRows");
    expect(pageSource).toContain("applyImportedRows(importPreview.accepted)");
    expect(pageSource).toContain("applyImportedRows(preview.accepted)");
  });

  it("shows cancelled, stand-by, outstanding counts and ADDITIONAL accepted markers before write", () => {
    expect(pageSource).toContain("importPreview.cancelled.length} cancelled");
    expect(pageSource).toContain("importPreview.standBy.length} stand-by");
    expect(pageSource).toContain("importPreview.outstanding.length} outstanding");
    expect(pageSource).toContain('(ADDITIONAL)');
    expect(pageSource).toContain("Add accepted trailers");
  });
});
