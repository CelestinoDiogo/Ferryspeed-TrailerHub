import { describe, expect, it } from "vitest";
import { previewVesselTrailerImport } from "@/lib/imports/vessel-trailer-list-import";

describe("vessel trailer list import preview", () => {
  it("accepts CSV rows with optional customer, booking, temperature, priority and notes", () => {
    const preview = previewVesselTrailerImport([
      "Trailer Number,Customer,Booking Reference,Expected Front Temperature,Expected Rear Temperature,Priority,Notes",
      "PRO810,Acme,BKG-1,-18,-18,priority,Keep frozen",
    ].join("\n"));

    expect(preview.accepted).toHaveLength(1);
    expect(preview.accepted[0]).toMatchObject({
      trailer_number: "PRO810",
      customer: "Acme",
      booking_reference: "BKG-1",
      expected_front_temperature: "-18",
      expected_rear_temperature: "-18",
      priority_level: "priority",
      planning_notes: "Keep frozen",
    });
  });

  it("treats existing vessel-list numbers as duplicates instead of accepted rows", () => {
    const preview = previewVesselTrailerImport("PRO810\nPFC102", ["PRO810"]);

    expect(preview.accepted.map((row) => row.trailer_number)).toEqual(["PFC102"]);
    expect(preview.duplicates.map((item) => item.row.trailer_number)).toEqual(["PRO810"]);
  });

  it("does not silently accept unrecognized lines", () => {
    const preview = previewVesselTrailerImport("this line has no trailer");

    expect(preview.accepted).toHaveLength(0);
    expect(preview.invalid.length).toBeGreaterThan(0);
  });
});
