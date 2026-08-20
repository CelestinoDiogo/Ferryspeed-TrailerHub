import { describe, expect, it } from "vitest";
import { previewDepartureSpreadsheet } from "@/lib/imports/departure-import";
import { buildDeparturePresentationWorkbook } from "@/lib/imports/__tests__/spreadsheet-fixtures";

const trailers = [
  { id: "a", trailer_number: "PRO810", customer: "Acme", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "b", trailer_number: "PFC102", customer: "Beta", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "c", trailer_number: "LOCAL01", customer: "Local", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "d", trailer_number: "3335066", customer: "Numeric", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "e", trailer_number: "MAIL18-10", customer: "Mail", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "f", trailer_number: "CR443", customer: "Standby", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "g", trailer_number: "PKD31", customer: "Outstanding", departure_date: null, operational_status: "In Compound", is_local: false },
];

describe("departure Excel import preview", () => {
  it("parses normal, numeric-only and hyphenated trailers without executing a departure", () => {
    const preview = previewDepartureSpreadsheet(buildDeparturePresentationWorkbook(), trailers);

    expect(preview.accepted.map((row) => row.trailer_number)).toEqual([
      "PRO810",
      "3335066",
      "MAIL18-10",
      "LOCAL01",
    ]);
    expect(preview.accepted[0].haz).toBe("YES");
    expect(preview.accepted.find((row) => row.trailer_number === "LOCAL01")?.list_section).toBe("additional");
    expect(preview.warnings.some((warning) => warning.includes("ADDITIONAL"))).toBe(true);
  });

  it("classifies CANCELLED rows as excluded instead of accepted departures", () => {
    const preview = previewDepartureSpreadsheet(buildDeparturePresentationWorkbook(), trailers);

    expect(preview.cancelled.map((item) => item.trailerNumber)).toEqual(["PFC102"]);
    expect(preview.accepted.some((row) => row.trailer_number === "PFC102")).toBe(false);
  });

  it("ignores blank and footer rows", () => {
    const preview = previewDepartureSpreadsheet(buildDeparturePresentationWorkbook(), trailers);

    expect(preview.invalid.some((item) => /final list/i.test(item.sourceLine))).toBe(false);
    expect(preview.standBy.map((item) => item.trailerNumber)).toEqual(["CR443"]);
    expect(preview.outstanding.map((item) => item.trailerNumber)).toEqual(["PKD31"]);
    expect(preview.accepted.some((row) => row.trailer_number === "CR443")).toBe(false);
    expect(preview.accepted.some((row) => row.trailer_number === "PKD31")).toBe(false);
  });
});
