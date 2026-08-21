import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../route.ts", import.meta.url), "utf8");

describe("Export allocation trailer assignment API contract", () => {
  it("re-checks eligibility on the server before saving a trailer", () => {
    expect(source).toContain("assignExportAllocationTrailer");
    expect(source).toContain("export_operations");
    expect(source).toContain('"edit"');
    expect(source).toContain("TrailerJobConflictError");
  });
});
