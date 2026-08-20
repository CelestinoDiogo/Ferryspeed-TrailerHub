import { describe, expect, it } from "vitest";
import { previewVesselTrailerSpreadsheet } from "@/lib/imports/vessel-trailer-list-import";
import { validateSpreadsheetUpload } from "@/lib/imports/spreadsheet-security";
import { buildVesselPresentationWorkbook } from "@/lib/imports/__tests__/spreadsheet-fixtures";

const bytes = buildVesselPresentationWorkbook();

describe("vessel Excel import preview", () => {
  it("parses alphanumeric, numeric-only and hyphenated trailer numbers without writing records", () => {
    const preview = previewVesselTrailerSpreadsheet(bytes);

    expect(preview.accepted.map((row) => row.trailer_number)).toEqual([
      "PFD1353",
      "26330073",
      "MAIL18-10",
    ]);
    expect(preview.accepted[0]).toMatchObject({
      load_description: "Chilled goods",
      planned_destination: "Portsmouth",
      priority_level: "priority",
      expected_front_temperature: "2",
    });
    expect(["+2", "2"]).toContain(preview.accepted[0].raw_temperature);
    expect(preview.accepted[1].raw_temperature).toBe("DRY");
    expect(preview.accepted[1].expected_front_temperature).toBe("");
    expect(preview.accepted[1].planning_notes).toContain("Temp: DRY");
    expect(preview.accepted[2].raw_temperature).toBe("+2/+8");
    expect(preview.accepted[2].expected_front_temperature).toBe("");
  });

  it("ignores blank rows, SHIPPING headings and empty STAND-BY/OUTSTANDING rows", () => {
    const preview = previewVesselTrailerSpreadsheet(bytes);

    expect(preview.invalid.some((item) => /shipping/i.test(item.sourceLine))).toBe(false);
    expect(preview.standBy.map((row) => row.trailer_number)).toEqual(["PKD7"]);
    expect(preview.outstanding.map((row) => row.trailer_number)).toEqual(["FS72"]);
    expect(preview.accepted.map((row) => row.trailer_number)).not.toContain("PKD7");
    expect(preview.accepted.map((row) => row.trailer_number)).not.toContain("FS72");
    expect(preview.accepted.some((row) => row.sourceLine.toLowerCase().includes("final list"))).toBe(false);
  });

  it("treats duplicate trailer numbers as duplicates instead of a second accepted row", () => {
    const preview = previewVesselTrailerSpreadsheet(bytes);

    expect(preview.duplicates.map((item) => item.row.trailer_number)).toEqual(["PFD1353"]);
  });

  it("does not treat existing vessel-list numbers as new accepted rows", () => {
    const preview = previewVesselTrailerSpreadsheet(bytes, ["PFD1353"]);

    expect(preview.accepted.map((row) => row.trailer_number)).toEqual(["26330073", "MAIL18-10"]);
    expect(preview.duplicates[0]?.row.trailer_number).toBe("PFD1353");
  });

  it("validates workbook bytes without exposing filesystem paths", () => {
    expect(() => validateSpreadsheetUpload({
      fileName: "vessel-list.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      byteLength: bytes.byteLength,
      bytes,
    })).not.toThrow();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});
