import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(process.cwd(), "src/components/dashboard/executive-dashboard.tsx"), "utf8");

describe("business intelligence cleanup", () => {
  it("removes Priority SLA, Stock Accuracy, and SLA & Risk from the BI UI", () => {
    expect(source).not.toContain("Priority SLA");
    expect(source).not.toContain("Stock Accuracy");
    expect(source).not.toContain("SLA & Risk");
  });

  it("keeps remaining operational BI metrics", () => {
    expect(source).toContain("Compound Trailers");
    expect(source).toContain("Occupancy");
    expect(source).toContain("Vessel Performance");
    expect(source).toContain("Customer Metrics");
  });
});
