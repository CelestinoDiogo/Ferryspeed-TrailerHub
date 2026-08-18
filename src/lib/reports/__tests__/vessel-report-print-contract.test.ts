import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const printSource = readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/vessel-operations/[id]/print/page.tsx"),
  "utf8",
);
const consolidatedTable = printSource.match(/Consolidated Trailer Report[\s\S]*?<h2[^>]*>Damage Details/)?.[0] ?? "";

describe("Vessel Report consolidated print contract", () => {
  it("shows total listed separately from expected", () => {
    expect(printSource).toContain(">Total Listed</p>");
    expect(printSource).toContain("reportData.statistics.totalTrailers");
    expect(printSource).toContain(">Expected</p>");
    expect(printSource).toContain("reportData.statistics.expectedTrailers");
  });

  it("keeps the approved operation-scoped columns", () => {
    for (const heading of ["Trailer", "Discharged Time", "Front Temp", "Rear Temp", "Damage", "Priority", "Notes"]) {
      expect(consolidatedTable).toContain(`>${heading}</th>`);
    }
  });

  it("excludes Customer and Position from the consolidated table", () => {
    expect(consolidatedTable).not.toContain(">Customer</th>");
    expect(consolidatedTable).not.toContain(">Position</th>");
  });
});