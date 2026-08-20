import { extractText } from "unpdf";
import { PdfImportValidationError, SCANNED_PDF_MESSAGE } from "@/lib/imports/pdf-security";

const normalizeExtractedText = (value: string | string[]) => {
  const joined = Array.isArray(value) ? value.join("\n") : value;
  return joined.replace(/\u0000/g, " ").replace(/[ \t]+\n/g, "\n").trim();
};

export async function extractPdfText(bytes: Uint8Array) {
  try {
    const extracted = await extractText(bytes, { mergePages: true });
    const text = normalizeExtractedText(extracted.text);

    if (!text) {
      throw new PdfImportValidationError(SCANNED_PDF_MESSAGE);
    }

    return text;
  } catch (error) {
    if (error instanceof PdfImportValidationError) {
      throw error;
    }

    throw new PdfImportValidationError("Unable to read text from this PDF. Use a text-based PDF and try again.");
  }
}
