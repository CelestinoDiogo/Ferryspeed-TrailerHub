import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const reportSource = readFileSync(
  path.resolve(process.cwd(), "src/components/reports/historical-lists-report.tsx"),
  "utf8",
);
const arrivalsSource = readFileSync(
  path.resolve(process.cwd(), "src/lib/reports/historical-lists.ts"),
  "utf8",
);
const querySource = readFileSync(
  path.resolve(process.cwd(), "src/lib/reports/historical-lists-query.ts"),
  "utf8",
);
const summarySource = readFileSync(
  path.resolve(process.cwd(), "src/lib/reports/operational-summary.ts"),
  "utf8",
);
const stoppedSource = readFileSync(
  path.resolve(process.cwd(), "src/lib/reports/stopped-compound-trailers.ts"),
  "utf8",
);
const arrivalsPage = readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/vessel-operations/[id]/arrivals/page.tsx"),
  "utf8",
);

describe("historical lists print and csv contract", () => {
  it("prints the report type, date range, active filters, totals and filtered dataset", () => {
    expect(reportSource).toContain("PrintHeader");
    expect(reportSource).toContain("getHistoryDateRangeLabel(range)");
    expect(reportSource).toContain("PrintFilters items={printFilters}");
    expect(reportSource).toContain("totalRecords={filtered.length}");
    expect(reportSource).toContain("<PrintTable rows={filtered} columns={tableColumns} />");
    expect(reportSource).toContain("Download CSV");
    expect(reportSource).toContain("buildCsv(historicalCsvHeaders(kind), filtered.map(historicalCsvRow))");
  });
});

describe("historical lists discharge and summary regression", () => {
  it("keeps arrivals discharge and reception as separate fields", () => {
    expect(arrivalsSource).toContain("dischargedAt: getVesselTrailerDischargedAt(row)");
    expect(arrivalsSource).toContain("receptionAt: getVesselTrailerReceptionAt(row)");
    expect(arrivalsSource).toContain("\"Discharged At\"");
    expect(arrivalsSource).not.toContain("getVesselTrailerDischargedAt(row) ?? getVesselTrailerReceptionAt");
    expect(reportSource).toContain("header: \"Discharged At\"");
    expect(reportSource).toContain("header: \"Reception/Arrival At\"");
  });

  it("does not rebuild Operational Summary or Stopped >3 Days", () => {
    expect(summarySource).toContain("getVesselTrailerReceptionAt");
    expect(summarySource).not.toContain("discharged_at");
    expect(stoppedSource).toContain("STOPPED_COMPOUND_THRESHOLD_DAYS = 3");
    expect(arrivalsPage).toContain("formatVesselDateTime(getVesselTrailerDischargedAt(trailer))");
  });

  it("pages historical queries instead of using a silent 1000-row limit", () => {
    expect(querySource).toContain("HISTORICAL_LIST_PAGE_SIZE = 1000");
    expect(querySource).toContain("fetchAllPagedRows");
    expect(querySource).not.toContain(".limit(1000)");
    expect(querySource).not.toContain(".limit(1200)");
  });
});
