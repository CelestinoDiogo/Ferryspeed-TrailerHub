import { describe, expect, it } from "vitest";
import {
  isBoatReportRelevantTrailer,
  selectBoatReportTrailers,
} from "@/lib/reports/boat-report-trailers";

describe("Boat Report operational trailer filter", () => {
  it("includes a temperature-required trailer", () => {
    expect(isBoatReportRelevantTrailer({
      temperatureRequired: true,
      hasDamage: false,
    })).toBe(true);

    expect(isBoatReportRelevantTrailer({
      expectedFrontTemperature: -18,
      hasDamage: false,
    })).toBe(true);
  });

  it("includes a damaged trailer", () => {
    expect(isBoatReportRelevantTrailer({
      temperatureRequired: false,
      hasDamage: true,
    })).toBe(true);

    expect(isBoatReportRelevantTrailer({
      expectedFrontTemperature: null,
      expectedRearTemperature: null,
      damageCount: 1,
    })).toBe(true);
  });

  it("includes a trailer with both conditions once", () => {
    const trailer = {
      id: "both",
      temperatureRequired: true,
      expectedFrontTemperature: 2,
      hasDamage: true,
    };

    expect(selectBoatReportTrailers([trailer, trailer])).toEqual([trailer]);
  });

  it("excludes a trailer with neither condition", () => {
    expect(isBoatReportRelevantTrailer({
      temperatureRequired: false,
      expectedFrontTemperature: null,
      expectedRearTemperature: null,
      temperatureRequiredText: "  ",
      hasDamage: false,
      damageCount: 0,
    })).toBe(false);
  });

  it("keeps mixed lists in original order without duplicating both-condition trailers", () => {
    const temperatureOnly = { id: "temp", temperatureRequired: true, hasDamage: false };
    const damageOnly = { id: "damage", temperatureRequired: false, hasDamage: true };
    const both = { id: "both", expectedFrontTemperature: 1, hasDamage: true };
    const neither = { id: "neither", temperatureRequired: false, hasDamage: false };

    expect(selectBoatReportTrailers([neither, temperatureOnly, both, damageOnly, both, neither])).toEqual([
      temperatureOnly,
      both,
      damageOnly,
    ]);
  });
});
