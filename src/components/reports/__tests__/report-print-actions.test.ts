import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const historicalOperationsSource = readFileSync(
  new URL("../historical-operations-report.tsx", import.meta.url),
  "utf8",
);
const compoundHistoricalSource = readFileSync(
  new URL("../compound-historical-report.tsx", import.meta.url),
  "utf8",
);

describe("report print actions", () => {
  it("keeps the shared guarded print action on historical operation reports", () => {
    expect(historicalOperationsSource).toContain('import { PrintButton } from "@/components/print/print-button";');
    expect(historicalOperationsSource).toContain("<PrintButton disabled={isLoading || filtered.length === 0} />");
  });

  it("keeps the shared guarded print action on Compound reports", () => {
    expect(compoundHistoricalSource).toContain('import { PrintButton } from "@/components/print/print-button";');
    expect(compoundHistoricalSource).toContain("<PrintButton disabled={loading || rows.length === 0} />");
  });
});
