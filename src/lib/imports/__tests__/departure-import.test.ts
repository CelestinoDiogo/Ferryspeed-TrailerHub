import { describe, expect, it } from "vitest";
import { previewDepartureImport } from "@/lib/imports/departure-import";

const trailers = [
  { id: "a", trailer_number: "PRO810", customer: "Acme", departure_date: null, operational_status: "In Compound", is_local: false },
  { id: "b", trailer_number: "PFC102", customer: "Beta", departure_date: "2026-08-19T10:00:00.000Z", operational_status: "Departed", is_local: false },
  { id: "c", trailer_number: "LOCAL01", customer: "Local", departure_date: null, operational_status: "In Compound", is_local: true },
];

describe("departure import preview", () => {
  it("accepts an eligible trailer number without creating a departure", () => {
    const preview = previewDepartureImport("PRO810", trailers);

    expect(preview.accepted).toHaveLength(1);
    expect(preview.accepted[0].trailer.id).toBe("a");
  });

  it("classifies already departed, ineligible, duplicate and unknown rows", () => {
    const preview = previewDepartureImport(["PRO810", "PRO810", "PFC102", "LOCAL01", "UNKNOWN99"].join("\n"), trailers);

    expect(preview.accepted.map((row) => row.trailer_number)).toEqual(["PRO810"]);
    expect(preview.duplicates[0]?.trailerNumber).toBe("PRO810");
    expect(preview.alreadyDeparted[0]?.trailerNumber).toBe("PFC102");
    expect(preview.ineligible[0]?.trailerNumber).toBe("LOCAL01");
    expect(preview.invalid.some((item) => item.trailerNumber === "UNKNOWN99")).toBe(true);
  });
});
