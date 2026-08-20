export const PDF_MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
export const PDF_ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
]);

const PDF_MAGIC = "%PDF";

export class PdfImportValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PdfImportValidationError";
    this.status = status;
  }
}

const normalizeMimeType = (value?: string | null) => (value ?? "").trim().toLowerCase();

const hasPdfExtension = (fileName?: string | null) => (fileName ?? "").trim().toLowerCase().endsWith(".pdf");

const bytesStartWithPdfMagic = (bytes: Uint8Array) => {
  if (bytes.byteLength < PDF_MAGIC.length) {
    return false;
  }

  return new TextDecoder("latin1").decode(bytes.slice(0, PDF_MAGIC.length)) === PDF_MAGIC;
};

export function validatePdfUpload(input: {
  fileName?: string | null;
  mimeType?: string | null;
  byteLength: number;
  bytes: Uint8Array;
}) {
  if (input.byteLength <= 0) {
    throw new PdfImportValidationError("The uploaded PDF is empty.");
  }

  if (input.byteLength > PDF_MAX_FILE_SIZE_BYTES) {
    throw new PdfImportValidationError("PDF files must be 8 MB or smaller.");
  }

  const mimeType = normalizeMimeType(input.mimeType);
  const mimeOk = mimeType.length === 0 || PDF_ACCEPTED_MIME_TYPES.has(mimeType);
  const extensionOk = hasPdfExtension(input.fileName);

  if (!mimeOk) {
    throw new PdfImportValidationError("Only PDF files can be imported.");
  }

  if (!extensionOk && mimeType.length === 0) {
    throw new PdfImportValidationError("Only PDF files can be imported.");
  }

  if (!bytesStartWithPdfMagic(input.bytes)) {
    throw new PdfImportValidationError("The uploaded file is not a valid PDF.");
  }
}

export const SCANNED_PDF_MESSAGE =
  "This PDF does not contain readable text. Scanned or image-only PDFs cannot be imported. Please use a text-based PDF or enter the trailer numbers manually.";
