import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(process.cwd(), "src/components/dashboard/trailer-dashboard.tsx"), "utf8");

describe("mandatory Collections dashboard contract", () => {
  it("combines Delivery and Export obligations in the compact KPI", () => {
    expect(source).toContain("waitingCollectionSummary.count + exportSummary.atCustomer");
    expect(source).toContain('subtitle: "Outstanding"');
    expect(source).toContain('href: "/dashboard/collections"');
  });
});