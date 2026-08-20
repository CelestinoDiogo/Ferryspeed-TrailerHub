export const SPREADSHEET_MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
export const SPREADSHEET_ACCEPTED_EXTENSIONS = [".xlsx"] as const;
export const SPREADSHEET_ACCEPTED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
  "application/zip",
]);

const ZIP_MAGIC = "PK";

export class SpreadsheetImportValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SpreadsheetImportValidationError";
    this.status = status;
  }
}

const normalizeMimeType = (value?: string | null) => (value ?? "").trim().toLowerCase();

const hasXlsxExtension = (fileName?: string | null) =>
  (fileName ?? "").trim().toLowerCase().endsWith(".xlsx");

const bytesStartWithZipMagic = (bytes: Uint8Array) => {
  if (bytes.byteLength < ZIP_MAGIC.length) {
    return false;
  }

  return new TextDecoder("latin1").decode(bytes.slice(0, ZIP_MAGIC.length)) === ZIP_MAGIC;
};

export function validateSpreadsheetUpload(input: {
  fileName?: string | null;
  mimeType?: string | null;
  byteLength: number;
  bytes: Uint8Array;
}) {
  if (input.byteLength <= 0) {
    throw new SpreadsheetImportValidationError("The uploaded spreadsheet is empty.");
  }

  if (input.byteLength > SPREADSHEET_MAX_FILE_SIZE_BYTES) {
    throw new SpreadsheetImportValidationError("Excel files must be 8 MB or smaller.");
  }

  if (!hasXlsxExtension(input.fileName)) {
    throw new SpreadsheetImportValidationError("Only .xlsx Excel files can be imported.");
  }

  const mimeType = normalizeMimeType(input.mimeType);
  if (mimeType.length > 0 && !SPREADSHEET_ACCEPTED_MIME_TYPES.has(mimeType)) {
    throw new SpreadsheetImportValidationError("Only .xlsx Excel files can be imported.");
  }

  if (!bytesStartWithZipMagic(input.bytes)) {
    throw new SpreadsheetImportValidationError("The uploaded file is not a valid Excel workbook.");
  }
}
