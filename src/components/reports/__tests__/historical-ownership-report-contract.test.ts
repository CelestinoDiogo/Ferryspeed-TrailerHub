import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const historicalSource = readFileSync(
  path.resolve(process.cwd(), "src/components/reports/historical-operations-report.tsx"),
  "utf8",
);
const compoundSource = readFileSync(
  path.resolve(process.cwd(), "src/components/reports/compound-historical-report.tsx"),
  "utf8",
);

describe("historical ownership report contracts", () => {
  it("uses vessel snapshots directly for arrivals without a current-trailer fallback", () => {
    expect(historicalSource).toContain("ownershipType: ownershipForArrival(row)");
    expect(historicalSource).not.toContain("ownershipForArrival(row, trailer)");
  });

  it("uses exact source vessel links for departures, deliveries, and collections", () => {
    expect(historicalSource).toContain("source_vessel_operation_trailer_id");
    expect(historicalSource).toContain('from("vessel_operation_trailers")');
    expect(historicalSource).toContain("historicalOwnership:");
    expect(historicalSource).not.toContain("trailers(trailer_number, trailer_source, external_company, is_local)");
  });

  it("uses event/source evidence for Compound activity but keeps snapshot mapping separate", () => {
    expect(compoundSource).toContain("ownershipForCompoundActivity");
    expect(compoundSource).toContain("source_record_id, metadata");
    expect(compoundSource).toContain("setSnapshot((data ?? []).map(toCompoundSnapshotRecord))");
  });

  it("uses one resolved row set for screen and print", () => {
    expect(historicalSource).toContain("const filtered = useMemo");
    expect(historicalSource).toContain("<PrintTable rows={filtered}");
    expect(compoundSource).toContain("const rows = mode === \"snapshot\" ? filteredSnapshot : filteredActivity");
    expect(compoundSource).toContain("const printRows = rows");
  });
});
