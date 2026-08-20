import { describe, expect, it } from "vitest";
import { PdfImportValidationError, validatePdfUpload } from "@/lib/imports/pdf-security";

const pdfBytes = new TextEncoder().encode("%PDF-1.1 minimal");

describe("PDF upload security", () => {
  it("accepts a PDF with valid MIME type and magic bytes", () => {
    expect(() => validatePdfUpload({
      fileName: "list.pdf",
      mimeType: "application/pdf",
      byteLength: pdfBytes.byteLength,
      bytes: pdfBytes,
    })).not.toThrow();
  });

  it("rejects non-PDF MIME types", () => {
    expect(() => validatePdfUpload({
      fileName: "list.pdf",
      mimeType: "image/png",
      byteLength: pdfBytes.byteLength,
      bytes: pdfBytes,
    })).toThrow(PdfImportValidationError);
  });

  it("rejects files that are too large", () => {
    expect(() => validatePdfUpload({
      fileName: "list.pdf",
      mimeType: "application/pdf",
      byteLength: 9 * 1024 * 1024,
      bytes: pdfBytes,
    })).toThrow(/8 MB or smaller/);
  });

  it("rejects files that do not start with PDF magic bytes", () => {
    expect(() => validatePdfUpload({
      fileName: "list.pdf",
      mimeType: "application/pdf",
      byteLength: 4,
      bytes: new TextEncoder().encode("XXXX"),
    })).toThrow(/not a valid PDF/);
  });
});
