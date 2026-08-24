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

  it("does not create departures during Excel or PDF upload preview", () => {
    const importHandler = pageSource.match(/const handleImportFileSelected[\s\S]*?const handleConfirmImportedDepartures/)?.[0] ?? "";
    expect(importHandler).toContain("/api/imports/spreadsheet?purpose=departure");
    expect(importHandler).toContain("/api/imports/pdf?purpose=departure");
    expect(importHandler).not.toContain("await performDeparture(");
    expect(pageSource).toContain("await runConfirmedDepartures(");
    expect(pageSource).toContain("Import Excel");
    expect(pageSource).toContain("Import PDF");
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

  it("excludes reserved trailers from departure eligibility and re-checks on write", () => {
    expect(pageSource).toContain("withTrailerJobCommitments");
    expect(pageSource).toContain("confirmTrailerDeparture");
    expect(pageSource).toContain("isEligibleForDeparture");
    expect(pageSource).toContain("describeLinkedExportForDeparture");
    expect(pageSource).toContain("EXPORT");
    expect(pageSource).not.toContain("advanceExportAllocationStatus");
  });
});