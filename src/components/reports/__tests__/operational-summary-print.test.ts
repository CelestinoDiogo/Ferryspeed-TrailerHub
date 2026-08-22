import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const operationalSummarySource = readFileSync(
  new URL("../operational-summary-report.tsx", import.meta.url),
  "utf8",
);
const stoppedTrailersSource = readFileSync(
  new URL("../stopped-trailers-report.tsx", import.meta.url),
  "utf8",
);

describe("operational summary and stopped-trailer print", () => {
  it("prints Operational Summary headline totals, daily breakdown and ownership fields", () => {
    expect(operationalSummarySource).toContain('import { PrintButton } from "@/components/print/print-button"');
    expect(operationalSummarySource).toContain('title="OPERATIONAL SUMMARY"');
    expect(operationalSummarySource).toContain('{ label: "Arrivals", value: summary.kpis.arrivals }');
    expect(operationalSummarySource).toContain('{ label: "Departures", value: summary.kpis.departures }');
    expect(operationalSummarySource).toContain('{ label: "Deliveries", value: summary.kpis.deliveries }');
    expect(operationalSummarySource).toContain('{ label: "Collections", value: summary.kpis.collections }');
    expect(operationalSummarySource).toContain('{ label: "Outsourcings", value: summary.kpis.outsourcings }');
    expect(operationalSummarySource).toContain('[...summary.dailyRows, summary.dailyTotal]');
    expect(operationalSummarySource).toContain('{ key: "date", header: "Date"');
    expect(operationalSummarySource).toContain("Ferryspeed / Own");
    expect(operationalSummarySource).toContain("createHistoryDateRange(\"last_7_days\")");
  });

  it("prints the stopped-trailer report fields and oldest-first list", () => {
    expect(stoppedTrailersSource).toContain('import { PrintButton } from "@/components/print/print-button"');
    expect(stoppedTrailersSource).toContain('title="TRAILERS STOPPED IN COMPOUND >3 DAYS"');
    expect(stoppedTrailersSource).toContain('{ key: "trailer", header: "Trailer"');
    expect(stoppedTrailersSource).toContain('{ key: "position", header: "Position"');
    expect(stoppedTrailersSource).toContain('{ key: "load", header: "Load Status"');
    expect(stoppedTrailersSource).toContain('{ key: "customer", header: "Customer"');
    expect(stoppedTrailersSource).toContain('{ key: "ownership", header: "Ownership"');
    expect(stoppedTrailersSource).toContain('{ key: "entry", header: "Arrival / Entry"');
    expect(stoppedTrailersSource).toContain('{ key: "days", header: "Days Stopped"');
    expect(stoppedTrailersSource).toContain('{ key: "job", header: "Reservation / Job"');
  });
});
