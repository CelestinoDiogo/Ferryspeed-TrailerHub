import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatVesselDateTime,
  getVesselTrailerDischargedAt,
  VESSEL_OPERATIONAL_TIMEZONE,
} from "@/lib/vessel-operations";

const arrivalsSource = readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/vessel-operations/[id]/arrivals/page.tsx"),
  "utf8",
);
const boatPrintSource = readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/vessel-operations/[id]/print/page.tsx"),
  "utf8",
);
const vesselOpsSource = readFileSync(
  path.resolve(process.cwd(), "src/lib/vessel-operations.ts"),
  "utf8",
);
const operationalSummarySource = readFileSync(
  path.resolve(process.cwd(), "src/lib/reports/operational-summary.ts"),
  "utf8",
);
const formatterSource = vesselOpsSource.match(/export const formatVesselDateTime[\s\S]*?^};/m)?.[0] ?? "";

describe("Vessel Arrivals discharge display", () => {
  it("uses discharged_at only for Discharged At on screen and print", () => {
    expect(arrivalsSource).toContain('header: "Discharged At"');
    expect(arrivalsSource).toContain("Discharged At: {formatVesselDateTime(getVesselTrailerDischargedAt(trailer))}");
    expect(arrivalsSource).toContain("formatVesselDateTime(getVesselTrailerDischargedAt(trailer))");
    expect(arrivalsSource).not.toContain('header: "Arrived At"');
    expect(arrivalsSource).not.toContain("Arrived Time:");
    expect(arrivalsSource).not.toContain("formatVesselDateTime(trailer.arrival_confirmed_at ?? trailer.arrived_at)");
  });

  it("does not let arrived_at or arrival_confirmed_at populate Discharged At", () => {
    const arrivedOnly = {
      discharged_at: null,
      arrived_at: "2026-08-21T10:20:00.000Z",
    };
    const confirmedOnly = {
      discharged_at: null,
      arrival_confirmed_at: "2026-08-21T10:20:00.000Z",
    };
    const receptionOnly = {
      discharged_at: null,
      arrived_at: "2026-08-21T10:20:00.000Z",
      arrival_confirmed_at: "2026-08-21T10:25:00.000Z",
    };

    expect(getVesselTrailerDischargedAt(arrivedOnly)).toBeNull();
    expect(getVesselTrailerDischargedAt(confirmedOnly)).toBeNull();
    expect(formatVesselDateTime(getVesselTrailerDischargedAt(receptionOnly))).toBe("—");
  });

  it("shows an em dash when discharged_at is null", () => {
    expect(formatVesselDateTime(getVesselTrailerDischargedAt({ discharged_at: null }))).toBe("—");
    expect(formatVesselDateTime(null)).toBe("—");
  });
});

describe("Boat Report discharge display", () => {
  it("uses discharged_at only for Discharged Time", () => {
    expect(boatPrintSource).toContain(">Discharged Time</th>");
    expect(boatPrintSource).toContain("formatVesselDateTime(trailer.dischargedAt)");
    expect(boatPrintSource).not.toContain("formatVesselDateTime(trailer.arrivedAt)");
    expect(boatPrintSource).not.toContain("formatVesselDateTime(trailer.arrivalTime)");
    expect(boatPrintSource).toContain("selectBoatReportTrailers");
  });
});

describe("Guernsey operational timezone formatting", () => {
  it("pins vessel datetime display to Europe/Guernsey without hard-coded offsets", () => {
    expect(VESSEL_OPERATIONAL_TIMEZONE).toBe("Europe/Guernsey");
    expect(formatterSource).toContain("vesselDateTimeFormatter.format");
    expect(formatterSource).not.toContain("toISOString()");
    expect(formatterSource).not.toContain("toLocaleString");
    expect(formatterSource).not.toMatch(/[+-]0[01]/);
    expect(vesselOpsSource).toContain("timeZone: VESSEL_OPERATIONAL_TIMEZONE");
    expect(vesselOpsSource).not.toMatch(/timeZone:\s*"UTC"/);
  });

  it("formats summer BST as Guernsey local time", () => {
    expect(formatVesselDateTime("2026-08-21T09:00:00.000Z")).toMatch(/21 Aug 2026.*10:00/);
  });

  it("formats winter GMT as Guernsey local time", () => {
    expect(formatVesselDateTime("2026-01-15T09:00:00.000Z")).toMatch(/15 Jan 2026.*09:00/);
  });
});

describe("Operational Summary preservation", () => {
  it("keeps Operational Summary arrivals on reception timestamps", () => {
    expect(operationalSummarySource).toContain("getVesselTrailerReceptionAt(row)");
    expect(operationalSummarySource).not.toContain("getVesselTrailerDischargedAt");
    expect(operationalSummarySource).not.toContain("discharged_at");
  });
});
