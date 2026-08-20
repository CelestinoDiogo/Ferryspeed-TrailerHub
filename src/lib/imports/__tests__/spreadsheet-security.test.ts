import { describe, expect, it } from "vitest";
import { SpreadsheetImportValidationError, validateSpreadsheetUpload } from "@/lib/imports/spreadsheet-security";
import { buildVesselPresentationWorkbook } from "@/lib/imports/__tests__/spreadsheet-fixtures";

const xlsxBytes = buildVesselPresentationWorkbook();

describe("spreadsheet upload security", () => {
  it("accepts an xlsx workbook with a valid extension", () => {
    expect(() => validateSpreadsheetUpload({
      fileName: "list.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      byteLength: xlsxBytes.byteLength,
      bytes: xlsxBytes,
    })).not.toThrow();
  });

  it("rejects non-xlsx extensions", () => {
    expect(() => validateSpreadsheetUpload({
      fileName: "list.xls",
      mimeType: "application/vnd.ms-excel",
      byteLength: xlsxBytes.byteLength,
      bytes: xlsxBytes,
    })).toThrow(SpreadsheetImportValidationError);
  });

  it("rejects files that are too large", () => {
    expect(() => validateSpreadsheetUpload({
      fileName: "list.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      byteLength: 9 * 1024 * 1024,
      bytes: xlsxBytes,
    })).toThrow(/8 MB or smaller/);
  });

  it("rejects files that do not start with ZIP magic bytes", () => {
    expect(() => validateSpreadsheetUpload({
      fileName: "list.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      byteLength: 4,
      bytes: new TextEncoder().encode("XXXX"),
    })).toThrow(/not a valid Excel workbook/);
  });
});
