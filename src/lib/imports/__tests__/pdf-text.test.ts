import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdfImportValidationError, SCANNED_PDF_MESSAGE } from "@/lib/imports/pdf-security";

const extractTextMock = vi.fn();

vi.mock("unpdf", () => ({
  extractText: (...args: unknown[]) => extractTextMock(...args),
}));

import { extractPdfText } from "@/lib/imports/pdf-text";

describe("PDF text extraction", () => {
  beforeEach(() => {
    extractTextMock.mockReset();
  });

  it("returns merged text from a text-based PDF", async () => {
    extractTextMock.mockResolvedValue({ text: "PRO810\nPFC102", totalPages: 1 });
    await expect(extractPdfText(new Uint8Array([1, 2, 3]))).resolves.toBe("PRO810\nPFC102");
  });

  it("returns a clear error for scanned or image-only PDFs", async () => {
    extractTextMock.mockResolvedValue({ text: "   ", totalPages: 1 });

    await expect(extractPdfText(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      message: SCANNED_PDF_MESSAGE,
    } satisfies Partial<PdfImportValidationError>);
  });
});
