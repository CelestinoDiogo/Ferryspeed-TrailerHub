import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../route.ts", import.meta.url), "utf8");

describe("Export allocation Excel confirm API contract", () => {
  it("persists only after explicit confirm and reuses preview eligibility", () => {
    expect(source).toContain("persistExportAllocationImport");
    expect(source).toContain("export_operations");
    expect(source).toContain('"edit"');
    expect(source).not.toContain("UNASSIGNED_EXPORT_SCHEMA_MESSAGE");
  });
});
