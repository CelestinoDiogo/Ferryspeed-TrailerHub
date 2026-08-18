import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const reportSource = readFileSync(
  path.resolve(process.cwd(), "src/lib/reports/executive-dashboard-report.ts"),
  "utf8",
);

describe("executive dashboard unresolved alert contract", () => {
  it("includes acknowledged alerts in the active operational count", () => {
    expect(reportSource).toContain('status: ["active", "acknowledged"]');
    expect(reportSource).not.toContain('status: ["active"]');
  });
});