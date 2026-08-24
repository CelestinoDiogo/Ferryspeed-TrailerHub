import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../route.ts", import.meta.url), "utf8");

describe("PDF import API contract", () => {
  it("previews extracted rows and never writes vessel or departure records", () => {
    expect(source).toContain("previewVesselTrailerImport");
    expect(source).toContain("previewDepartureImport");
    expect(source).toContain("validatePdfUpload");
    expect(source).toContain("extractPdfText");
    expect(source).not.toMatch(/\.from\("vessel_operation_trailers"\)\.(insert|upsert)/);
    expect(source).not.toMatch(/\.from\("trailers"\)\.(insert|update|upsert)/);
    expect(source).not.toMatch(/\.from\("export_allocations"\)\.(insert|update|upsert)/);
    expect(source).not.toContain("process.cwd(");
    expect(source).not.toContain("__dirname");
  });

  it("authorizes vessel list and departure imports separately", () => {
    expect(source).toContain('purpose === "vessel_list" ? "vessel_operations" : "departures"');
    expect(source).toContain('"edit"');
  });
});
