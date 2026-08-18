import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/departure/page.tsx"),
  "utf8",
);

describe("Departure page lifecycle contract", () => {
  it("uses the same forward transition for single and batch departures", () => {
    expect(pageSource.match(/await performDeparture\(/g)).toHaveLength(2);
  });

  it("routes Undo through the authoritative helper with the exact departure token", () => {
    const undoHandler = pageSource.match(/const handleUndoLastDeparture[\s\S]*?\n  return \(/)?.[0] ?? "";

    expect(undoHandler).toContain("await undoDeparture(supabase");
    expect(undoHandler).toContain("expectedDepartureAt: lastDepartureSnapshot.expectedDepartureAt");
    expect(undoHandler).not.toContain('.from("trailers")');
    expect(undoHandler).not.toContain("createTrailerActivity");
  });

  it("refreshes authoritative state after success or conflict without navigating away", () => {
    const undoHandler = pageSource.match(/const handleUndoLastDeparture[\s\S]*?\n  return \(/)?.[0] ?? "";

    expect(undoHandler).toContain("await loadDepartureTrailers({ showLoading: false })");
    expect(undoHandler).not.toContain("router.push");
  });
});