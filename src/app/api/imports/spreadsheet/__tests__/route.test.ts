import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../route.ts", import.meta.url), "utf8");

describe("Spreadsheet import API contract", () => {
  it("previews extracted rows and never writes vessel or departure records", () => {
    expect(source).toContain("previewVesselTrailerSpreadsheet");
    expect(source).toContain("previewDepartureSpreadsheet");
    expect(source).toContain("previewExportAllocationSpreadsheet");
    expect(source).toContain("validateSpreadsheetUpload");
    expect(source).not.toMatch(/\.from\("vessel_operation_trailers"\)\.(insert|upsert)/);
    expect(source).not.toMatch(/\.from\("export_allocations"\)\.(insert|update|upsert)/);
    expect(source).not.toMatch(/\.from\("trailers"\)\.(insert|update|upsert)/);
    expect(source).not.toContain("process.cwd(");
    expect(source).not.toContain("__dirname");
  });

  it("authorizes vessel list, departure and export imports separately", () => {
    expect(source).toContain('purpose === "vessel_list" ? "vessel_operations" : purpose === "export" ? "export_operations" : "departures"');
    expect(source).toContain('"edit"');
  });
});
