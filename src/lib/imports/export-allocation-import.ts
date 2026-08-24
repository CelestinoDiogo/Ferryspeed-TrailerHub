import {
  isTrailerAvailableForExportAllocation,
  UNASSIGNED_EXPORT_TRAILER_LABEL,
  type ExportAllocationPriority,
} from "@/lib/export-allocation";
import {
  normalizeSpreadsheetHeader,
  readSpreadsheetWorkbookGrids,
} from "@/lib/imports/spreadsheet";
import {
  asImportOperationalTrailerNumber,
  looksLikeExcelSerial,
  normalizeImportTrailerNumber,
  parseImportDate,
  parseImportDateTime,
} from "@/lib/imports/import-normalize";
import { SpreadsheetImportValidationError } from "@/lib/imports/spreadsheet-security";
import {
  isTrailerEligibleForNewExportJob,
  TRAILER_ACTIVE_EXPORT_ALLOCATION_MESSAGE,
  TRAILER_RESERVED_FOR_DELIVERY_MESSAGE,
} from "@/lib/trailer-job-eligibility";

export const EXPORT_ALLOCATIONS_REQUIRE_TRAILER_ID = false;

export { UNASSIGNED_EXPORT_TRAILER_LABEL };

export const UNASSIGNED_EXPORT_SCHEMA_MESSAGE =
  "Unassigned export rows are created without a trailer. Assign an eligible trailer later from Export Operations.";

export type ExportAllocationImportField =
  | "trailer_number"
  | "customer"
  | "collection_address"
  | "haulier"
  | "booking_reference"
  | "load_type"
  | "collection_date"
  | "expected_return_at"
  | "priority"
  | "notes";

export type ExportAllocationImportCandidate = {
  id: string;
  trailer_number?: string | null;
  load_status?: string | null;
  departure_date?: string | null;
  operational_status?: string | null;
  is_local?: boolean | null;
  compound_position?: string | null;
  hasActiveDelivery?: boolean | null;
  activeExportStatus?: string | null;
};

export type ExportAllocationImportParsedRow = {
  trailer_number: string;
  customer: string;
  collection_address: string;
  haulier: string;
  booking_reference: string;
  load_type: string;
  collection_date: string;
  expected_return_at: string;
  priority: ExportAllocationPriority;
  notes: string;
  sourceLine: string;
  rowNumber: number;
};

export type ExportAllocationImportIssue = {
  trailerNumber?: string;
  sourceLine: string;
  reason: string;
  rowNumber?: number;
};

export type ExportAllocationImportAcceptedRow = ExportAllocationImportParsedRow & {
  trailer: ExportAllocationImportCandidate;
};

export type ExportAllocationImportUnassignedRow = ExportAllocationImportParsedRow & {
  trailerLabel: typeof UNASSIGNED_EXPORT_TRAILER_LABEL;
  persistBlocked: false;
};

export type ExportAllocationImportPreview = {
  accepted: ExportAllocationImportAcceptedRow[];
  unassigned: ExportAllocationImportUnassignedRow[];
  warnings: string[];
  invalid: ExportAllocationImportIssue[];
  duplicates: ExportAllocationImportIssue[];
  conflicts: ExportAllocationImportIssue[];
  wroteRecords: false;
};

export type ExportAllocationImportConfirmRow = {
  trailerId?: string | null;
  trailerNumber?: string | null;
  customer: string;
  collectionAddress?: string | null;
  haulier?: string | null;
  bookingReference?: string | null;
  loadType?: string | null;
  collectionDate: string;
  expectedReturnAt?: string | null;
  priority?: ExportAllocationPriority | string | null;
  notes?: string | null;
  sourceLine?: string | null;
  rowNumber?: number | null;
};

const HEADER_ALIASES: Record<string, ExportAllocationImportField> = {
  trailer: "trailer_number",
  "trailer no": "trailer_number",
  "trailer no.": "trailer_number",
  "trailer number": "trailer_number",
  "trailer #": "trailer_number",
  unit: "trailer_number",
  customer: "customer",
  "customer name": "customer",
  "collection address": "collection_address",
  collection: "collection_address",
  address: "collection_address",
  "pickup address": "collection_address",
  "pick up address": "collection_address",
  haulier: "haulier",
  "haulier name": "haulier",
  carrier: "haulier",
  booking: "booking_reference",
  "booking reference": "booking_reference",
  "booking ref": "booking_reference",
  reference: "booking_reference",
  "load type": "load_type",
  load: "load_type",
  cargo: "load_type",
  "cargo description": "load_type",
  "collection date": "collection_date",
  "collect date": "collection_date",
  date: "collection_date",
  "expected return": "expected_return_at",
  "expected return at": "expected_return_at",
  "expected return date": "expected_return_at",
  "return date": "expected_return_at",
  return: "expected_return_at",
  priority: "priority",
  notes: "notes",
  comment: "notes",
  comments: "notes",
  "planning notes": "notes",
};

const HEADER_SCAN_ROWS = 40;

const canPersistUnassignedExportAllocation = () => !EXPORT_ALLOCATIONS_REQUIRE_TRAILER_ID;

const emptyParsedRow = (rowNumber: number, sourceLine = ""): ExportAllocationImportParsedRow => ({
  trailer_number: "",
  customer: "",
  collection_address: "",
  haulier: "",
  booking_reference: "",
  load_type: "",
  collection_date: "",
  expected_return_at: "",
  priority: "normal",
  notes: "",
  sourceLine,
  rowNumber,
});

const isEmptyRow = (cells: string[]) => cells.every((cell) => !cell.trim());

export const parseExportDate = parseImportDate;

export function parseExportDateTime(value?: string | null): string | null {
  return parseImportDateTime(value);
}

export function isCurrentExportFleetTrailer(trailer: ExportAllocationImportCandidate) {
  const status = (trailer.operational_status ?? "").trim().toLowerCase();
  if (status === "departed" || status === "cancelled") {
    return false;
  }

  return !(trailer.departure_date ?? "").trim();
}

export function resolveExportFleetMatch(matches: ExportAllocationImportCandidate[]) {
  const current = matches.filter(isCurrentExportFleetTrailer);

  if (current.length === 1) {
    return { status: "match" as const, trailer: current[0] };
  }

  if (current.length > 1) {
    return { status: "conflict" as const };
  }

  return { status: "none" as const };
}

const displayImportCell = (value: string, field?: ExportAllocationImportField) => {
  if (field === "collection_date") {
    return parseImportDate(value) ?? "";
  }

  if (field === "expected_return_at") {
    return parseImportDateTime(value) ?? "";
  }

  if (field === "trailer_number") {
    return normalizeImportTrailerNumber(value) || value.trim();
  }

  if (!field && looksLikeExcelSerial(value)) {
    return parseImportDateTime(value) ?? value;
  }

  return value;
};

export function normalizeExportImportPriority(value?: string | null): ExportAllocationPriority {
  const normalized = (value ?? "").trim().toLowerCase();

  if (normalized === "urgent" || normalized === "u") {
    return "urgent";
  }

  if (normalized === "high" || normalized === "h" || normalized === "priority" || normalized === "yes" || normalized === "y") {
    return "high";
  }

  if (normalized === "low" || normalized === "l") {
    return "low";
  }

  return "normal";
}

const headerMapForRow = (row: string[]) => {
  const headerMap = new Map<number, ExportAllocationImportField>();

  row.forEach((cell, index) => {
    const mapped = HEADER_ALIASES[normalizeSpreadsheetHeader(cell)];
    if (mapped && !Array.from(headerMap.values()).includes(mapped)) {
      headerMap.set(index, mapped);
    }
  });

  return headerMap;
};

const findExportHeader = (rows: string[][]) => {
  const scanLimit = Math.min(rows.length, HEADER_SCAN_ROWS);
  let best: { index: number; headerMap: Map<number, ExportAllocationImportField> } | null = null;

  for (let index = 0; index < scanLimit; index += 1) {
    const headerMap = headerMapForRow(rows[index] ?? []);
    const hasJobField = Array.from(headerMap.values()).some((field) => field === "customer" || field === "booking_reference" || field === "collection_date" || field === "trailer_number");
    if (!hasJobField) {
      continue;
    }

    if (!best || headerMap.size > best.headerMap.size) {
      best = { index, headerMap };
    }
  }

  return best;
};

export function parseExportAllocationSpreadsheet(bytes: Uint8Array): ExportAllocationImportParsedRow[] {
  const sheets = readSpreadsheetWorkbookGrids(bytes);

  for (const sheet of sheets) {
    const header = findExportHeader(sheet.rows);
    if (!header) {
      continue;
    }

    const rows: ExportAllocationImportParsedRow[] = [];

    sheet.rows.slice(header.index + 1).forEach((cells, offset) => {
      if (isEmptyRow(cells)) {
        return;
      }

      const rowNumber = header.index + offset + 2;
      const sourceLine = cells
        .map((value, cellIndex) => displayImportCell(value, header.headerMap.get(cellIndex)))
        .filter(Boolean)
        .join(" | ");
      const parsed = emptyParsedRow(rowNumber, sourceLine);

      cells.forEach((value, cellIndex) => {
        const field = header.headerMap.get(cellIndex);
        if (!field) {
          return;
        }

        const trimmed = value.trim();
        if (field === "priority") {
          parsed.priority = normalizeExportImportPriority(trimmed);
          return;
        }

        if (field === "trailer_number") {
          parsed.trailer_number = normalizeImportTrailerNumber(trimmed);
          return;
        }

        if (field === "collection_date") {
          parsed.collection_date = parseImportDate(trimmed) ?? "";
          return;
        }

        if (field === "expected_return_at") {
          parsed.expected_return_at = parseImportDateTime(trimmed) ?? "";
          return;
        }

        parsed[field] = trimmed;
      });

      rows.push(parsed);
    });

    if (rows.length > 0) {
      return rows;
    }
  }

  throw new SpreadsheetImportValidationError("No export allocation rows were found in this workbook.");
}

const trailerConflictReason = (trailer: ExportAllocationImportCandidate) => {
  if (!isTrailerEligibleForNewExportJob({
    hasActiveDelivery: trailer.hasActiveDelivery === true,
    activeExportStatus: trailer.activeExportStatus ?? null,
  })) {
    if (trailer.hasActiveDelivery) {
      return TRAILER_RESERVED_FOR_DELIVERY_MESSAGE;
    }

    return TRAILER_ACTIVE_EXPORT_ALLOCATION_MESSAGE;
  }

  if (!isTrailerAvailableForExportAllocation(trailer, false)) {
    return "This trailer is not available for a new export allocation.";
  }

  return null;
};

export function previewExportAllocationImportRows(
  parsedRows: ExportAllocationImportParsedRow[],
  trailers: ExportAllocationImportCandidate[],
): ExportAllocationImportPreview {
  const byNumber = new Map<string, ExportAllocationImportCandidate[]>();
  for (const trailer of trailers) {
    const number = normalizeImportTrailerNumber(trailer.trailer_number);
    if (!number) {
      continue;
    }

    const existing = byNumber.get(number) ?? [];
    existing.push(trailer);
    byNumber.set(number, existing);
  }

  const accepted: ExportAllocationImportAcceptedRow[] = [];
  const unassigned: ExportAllocationImportUnassignedRow[] = [];
  const invalid: ExportAllocationImportIssue[] = [];
  const duplicates: ExportAllocationImportIssue[] = [];
  const conflicts: ExportAllocationImportIssue[] = [];
  const warnings: string[] = [];
  const seenTrailerNumbers = new Set<string>();
  const seenUnassignedKeys = new Set<string>();

  for (const row of parsedRows) {
    const customer = row.customer.trim();
    const collectionDate = parseImportDate(row.collection_date);
    const rawTrailer = normalizeImportTrailerNumber(row.trailer_number);
    const trailerNumber = asImportOperationalTrailerNumber(rawTrailer);

    if (!customer || !collectionDate) {
      invalid.push({
        trailerNumber: trailerNumber || rawTrailer || undefined,
        sourceLine: row.sourceLine,
        rowNumber: row.rowNumber,
        reason: !customer ? "Customer is required." : "Collection Date is required.",
      });
      continue;
    }

    const normalizedRow: ExportAllocationImportParsedRow = {
      ...row,
      customer,
      collection_date: collectionDate,
      expected_return_at: parseImportDateTime(row.expected_return_at) ?? "",
    };

    if (!rawTrailer) {
      const duplicateKey = [customer, collectionDate, normalizedRow.booking_reference.trim(), normalizedRow.collection_address.trim()].join("|").toLowerCase();
      if (seenUnassignedKeys.has(duplicateKey)) {
        duplicates.push({
          sourceLine: row.sourceLine,
          rowNumber: row.rowNumber,
          reason: `Duplicate unassigned row for ${customer} on ${collectionDate}.`,
        });
        continue;
      }

      seenUnassignedKeys.add(duplicateKey);
      unassigned.push({
        ...normalizedRow,
        trailerLabel: UNASSIGNED_EXPORT_TRAILER_LABEL,
        persistBlocked: false,
      });
      continue;
    }

    if (!trailerNumber) {
      invalid.push({
        trailerNumber: rawTrailer,
        sourceLine: row.sourceLine,
        rowNumber: row.rowNumber,
        reason: `Trailer number "${rawTrailer}" is not a valid operational trailer number.`,
      });
      continue;
    }

    if (seenTrailerNumbers.has(trailerNumber)) {
      duplicates.push({
        trailerNumber,
        sourceLine: row.sourceLine,
        rowNumber: row.rowNumber,
        reason: `Trailer ${trailerNumber} appears more than once in this workbook.`,
      });
      continue;
    }

    seenTrailerNumbers.add(trailerNumber);

    const matches = byNumber.get(trailerNumber) ?? [];
    const fleetMatch = resolveExportFleetMatch(matches);

    if (fleetMatch.status === "none") {
      invalid.push({
        trailerNumber,
        sourceLine: row.sourceLine,
        rowNumber: row.rowNumber,
        reason: `Trailer ${trailerNumber} was not found.`,
      });
      continue;
    }

    if (fleetMatch.status === "conflict") {
      conflicts.push({
        trailerNumber,
        sourceLine: row.sourceLine,
        rowNumber: row.rowNumber,
        reason: `Trailer ${trailerNumber} matches more than one fleet record.`,
      });
      continue;
    }

    const trailer = fleetMatch.trailer;
    const conflict = trailerConflictReason(trailer);
    if (conflict) {
      conflicts.push({
        trailerNumber,
        sourceLine: row.sourceLine,
        rowNumber: row.rowNumber,
        reason: conflict,
      });
      continue;
    }

    accepted.push({
      ...normalizedRow,
      trailer_number: trailerNumber,
      trailer,
    });
  }

  if (unassigned.length > 0 && canPersistUnassignedExportAllocation()) {
    warnings.push(
      `${unassigned.length} row${unassigned.length === 1 ? "" : "s"} ${unassigned.length === 1 ? "has" : "have"} no trailer yet and will be created as unassigned.`,
    );
  }

  return {
    accepted,
    unassigned,
    warnings,
    invalid,
    duplicates,
    conflicts,
    wroteRecords: false,
  };
}

export function previewExportAllocationSpreadsheet(
  bytes: Uint8Array,
  trailers: ExportAllocationImportCandidate[],
): ExportAllocationImportPreview {
  return previewExportAllocationImportRows(parseExportAllocationSpreadsheet(bytes), trailers);
}

export function confirmRowsToParsedRows(
  rows: ExportAllocationImportConfirmRow[],
): ExportAllocationImportParsedRow[] {
  return rows.map((row, index) => ({
    trailer_number: normalizeImportTrailerNumber(row.trailerNumber),
    customer: (row.customer ?? "").trim(),
    collection_address: (row.collectionAddress ?? "").trim(),
    haulier: (row.haulier ?? "").trim(),
    booking_reference: (row.bookingReference ?? "").trim(),
    load_type: (row.loadType ?? "").trim(),
    collection_date: parseImportDate(row.collectionDate) ?? (row.collectionDate ?? "").trim(),
    expected_return_at: parseImportDateTime(row.expectedReturnAt) ?? (row.expectedReturnAt ?? "").trim(),
    priority: normalizeExportImportPriority(row.priority),
    notes: (row.notes ?? "").trim(),
    sourceLine: row.sourceLine?.trim() || `${row.customer ?? "Export row"} ${index + 1}`,
    rowNumber: row.rowNumber ?? index + 1,
  }));
}

export function toExportAllocationConfirmRows(
  preview: ExportAllocationImportPreview,
): ExportAllocationImportConfirmRow[] {
  return [
    ...preview.accepted.map((row) => ({
      trailerId: row.trailer.id,
      trailerNumber: row.trailer_number,
      customer: row.customer,
      collectionAddress: row.collection_address || null,
      haulier: row.haulier || null,
      bookingReference: row.booking_reference || null,
      loadType: row.load_type || null,
      collectionDate: row.collection_date,
      expectedReturnAt: row.expected_return_at || null,
      priority: row.priority,
      notes: row.notes || null,
      sourceLine: row.sourceLine,
      rowNumber: row.rowNumber,
    })),
    ...preview.unassigned.map((row) => ({
      trailerId: null,
      trailerNumber: "",
      customer: row.customer,
      collectionAddress: row.collection_address || null,
      haulier: row.haulier || null,
      bookingReference: row.booking_reference || null,
      loadType: row.load_type || null,
      collectionDate: row.collection_date,
      expectedReturnAt: row.expected_return_at || null,
      priority: row.priority,
      notes: row.notes || null,
      sourceLine: row.sourceLine,
      rowNumber: row.rowNumber,
    })),
  ];
}
