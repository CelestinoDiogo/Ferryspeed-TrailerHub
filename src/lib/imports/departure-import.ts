import { extractTrailerNumberCandidates, splitImportLines } from "@/lib/imports/trailer-tokens";
import {
  parseFerryspeedPresentationList,
  type PresentationListRow,
} from "@/lib/imports/spreadsheet";
import { normalizeTrailerNumber } from "@/lib/vessel-operations";

export type DepartureImportCandidate = {
  id: string;
  trailer_number: string | null;
  customer?: string | null;
  consignee?: string | null;
  compound_position?: string | null;
  arrival_date?: string | null;
  departure_date?: string | null;
  departure_time?: string | null;
  operational_status?: string | null;
  is_local?: boolean | null;
  load_status?: string | null;
};

export type DepartureImportParsedRow = {
  trailer_number: string;
  customer: string;
  booking_reference: string;
  destination: string;
  vessel_or_sailing: string;
  departure_at: string;
  load_description: string;
  haz: string;
  fs_pf: string;
  commodity: string;
  unit_reg: string;
  temperature: string;
  list_section: PresentationListRow["list_section"];
  sourceLine: string;
};

export type DepartureImportIssue = {
  trailerNumber?: string;
  sourceLine: string;
  reason: string;
};

export type DepartureImportPreview = {
  accepted: Array<DepartureImportParsedRow & { trailer: DepartureImportCandidate }>;
  duplicates: DepartureImportIssue[];
  alreadyDeparted: DepartureImportIssue[];
  ineligible: DepartureImportIssue[];
  invalid: DepartureImportIssue[];
  warnings: string[];
  cancelled: DepartureImportIssue[];
  standBy: DepartureImportIssue[];
  outstanding: DepartureImportIssue[];
};

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const isMissingDepartureDate = (value?: string | null) => {
  if (value === null || value === undefined) {
    return true;
  }

  return value.trim().length === 0;
};

export function isEligibleForDeparture(trailer: Pick<DepartureImportCandidate, "trailer_number" | "departure_date" | "is_local" | "operational_status">) {
  if (!trailer.trailer_number?.trim()) {
    return false;
  }

  if (!isMissingDepartureDate(trailer.departure_date)) {
    return false;
  }

  if (trailer.is_local === true) {
    return false;
  }

  if (normalizeText(trailer.operational_status) === "departed") {
    return false;
  }

  return true;
}

const emptyDepartureParsedRow = (sourceLine = ""): DepartureImportParsedRow => ({
  trailer_number: "",
  customer: "",
  booking_reference: "",
  destination: "",
  vessel_or_sailing: "",
  departure_at: "",
  load_description: "",
  haz: "",
  fs_pf: "",
  commodity: "",
  unit_reg: "",
  temperature: "",
  list_section: null,
  sourceLine,
});

export function parseDepartureImportText(rawText: string): DepartureImportParsedRow[] {
  const lines = splitImportLines(rawText);
  const rows: DepartureImportParsedRow[] = [];

  if (lines.length > 0 && (lines[0].includes(",") || lines[0].includes("\t"))) {
    const delimiter = lines[0].includes("\t") ? "\t" : ",";
    const header = lines[0].split(delimiter).map((cell) => cell.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
    const trailerIndex = header.findIndex((cell) => cell === "trailer" || cell === "trailer number" || cell === "trailer no");
    const customerIndex = header.findIndex((cell) => cell === "customer");
    const bookingIndex = header.findIndex((cell) => cell === "booking" || cell === "booking reference" || cell === "booking ref" || cell === "reference");
    const destinationIndex = header.findIndex((cell) => cell === "destination" || cell === "planned destination");
    const vesselIndex = header.findIndex((cell) => cell === "vessel" || cell === "sailing" || cell === "voyage");
    const departureIndex = header.findIndex((cell) => cell === "departure" || cell === "departure date" || cell === "departure time");
    const hazIndex = header.findIndex((cell) => cell === "haz" || cell === "hazardous");

    if (trailerIndex >= 0) {
      for (const line of lines.slice(1)) {
        const cells = line.split(delimiter).map((cell) => cell.trim());
        const trailerNumber = normalizeTrailerNumber(cells[trailerIndex]);
        if (!trailerNumber) {
          continue;
        }

        rows.push({
          ...emptyDepartureParsedRow(line),
          trailer_number: trailerNumber,
          customer: customerIndex >= 0 ? cells[customerIndex] ?? "" : "",
          booking_reference: bookingIndex >= 0 ? cells[bookingIndex] ?? "" : "",
          destination: destinationIndex >= 0 ? cells[destinationIndex] ?? "" : "",
          vessel_or_sailing: vesselIndex >= 0 ? cells[vesselIndex] ?? "" : "",
          departure_at: departureIndex >= 0 ? cells[departureIndex] ?? "" : "",
          haz: hazIndex >= 0 ? cells[hazIndex] ?? "" : "",
        });
      }

      return rows;
    }
  }

  for (const line of lines) {
    const candidates = extractTrailerNumberCandidates(line);
    if (candidates.length !== 1) {
      continue;
    }

    rows.push({
      ...emptyDepartureParsedRow(line),
      trailer_number: candidates[0],
    });
  }

  if (rows.length > 0) {
    return rows;
  }

  return extractTrailerNumberCandidates(rawText).map((trailerNumber) => ({
    ...emptyDepartureParsedRow(trailerNumber),
    trailer_number: trailerNumber,
  }));
}

export function presentationRowToDepartureImportRow(row: PresentationListRow): DepartureImportParsedRow {
  return {
    ...emptyDepartureParsedRow(row.sourceLine),
    trailer_number: row.trailer_number,
    customer: row.customer,
    booking_reference: row.booking_reference,
    destination: row.destination,
    vessel_or_sailing: row.vessel,
    load_description: row.load_description,
    haz: row.haz,
    fs_pf: row.fs_pf,
    commodity: row.commodity,
    unit_reg: row.unit_reg,
    temperature: row.temperature,
    list_section: row.list_section,
  };
}

export function previewDepartureImportRows(
  parsedRows: DepartureImportParsedRow[],
  trailers: DepartureImportCandidate[],
  leftoverInvalid: DepartureImportIssue[] = [],
): DepartureImportPreview {
  const byNumber = new Map<string, DepartureImportCandidate[]>();
  for (const trailer of trailers) {
    const number = normalizeTrailerNumber(trailer.trailer_number);
    if (!number) {
      continue;
    }

    const existing = byNumber.get(number) ?? [];
    existing.push(trailer);
    byNumber.set(number, existing);
  }

  const accepted: DepartureImportPreview["accepted"] = [];
  const duplicates: DepartureImportIssue[] = [];
  const alreadyDeparted: DepartureImportIssue[] = [];
  const ineligible: DepartureImportIssue[] = [];
  const invalid: DepartureImportIssue[] = [...leftoverInvalid];
  const warnings: string[] = [];
  const cancelled: DepartureImportIssue[] = [];
  const standBy: DepartureImportIssue[] = [];
  const outstanding: DepartureImportIssue[] = [];
  const seen = new Set<string>();

  for (const row of parsedRows) {
    if (row.list_section === "cancelled") {
      cancelled.push({
        trailerNumber: row.trailer_number,
        sourceLine: row.sourceLine,
        reason: `${row.trailer_number} is marked CANCELLED and was not queued for departure.`,
      });
      continue;
    }

    if (row.list_section === "stand-by") {
      standBy.push({
        trailerNumber: row.trailer_number,
        sourceLine: row.sourceLine,
        reason: `${row.trailer_number} is listed under STAND-BY and was not queued as a normal departure.`,
      });
      continue;
    }

    if (row.list_section === "outstanding") {
      outstanding.push({
        trailerNumber: row.trailer_number,
        sourceLine: row.sourceLine,
        reason: `${row.trailer_number} is listed under OUTSTANDING and was not queued as a normal departure.`,
      });
      continue;
    }

    if (seen.has(row.trailer_number)) {
      duplicates.push({
        trailerNumber: row.trailer_number,
        sourceLine: row.sourceLine,
        reason: `${row.trailer_number} appears more than once in the import.`,
      });
      continue;
    }

    seen.add(row.trailer_number);
    const matches = byNumber.get(row.trailer_number) ?? [];

    if (matches.length === 0) {
      invalid.push({
        trailerNumber: row.trailer_number,
        sourceLine: row.sourceLine,
        reason: `${row.trailer_number} was not found in current trailer records.`,
      });
      continue;
    }

    if (matches.length > 1) {
      warnings.push(`${row.trailer_number} matched more than one trailer record and was not imported.`);
      invalid.push({
        trailerNumber: row.trailer_number,
        sourceLine: row.sourceLine,
        reason: `${row.trailer_number} matched multiple trailer records. Resolve the duplicate before importing.`,
      });
      continue;
    }

    const trailer = matches[0];
    if (!isMissingDepartureDate(trailer.departure_date) || normalizeText(trailer.operational_status) === "departed") {
      alreadyDeparted.push({
        trailerNumber: row.trailer_number,
        sourceLine: row.sourceLine,
        reason: `${row.trailer_number} has already departed.`,
      });
      continue;
    }

    if (!isEligibleForDeparture(trailer)) {
      ineligible.push({
        trailerNumber: row.trailer_number,
        sourceLine: row.sourceLine,
        reason: trailer.is_local === true
          ? `${row.trailer_number} is a local trailer and cannot depart through this list.`
          : `${row.trailer_number} is not eligible for departure.`,
      });
      continue;
    }

    if (row.list_section === "additional") {
      warnings.push(`${row.trailer_number} is listed as ADDITIONAL.`);
    }

    if (row.destination || row.vessel_or_sailing || row.departure_at || row.haz || row.fs_pf || row.commodity || row.unit_reg || row.temperature) {
      warnings.push(`${row.trailer_number}: extra list fields were shown for review only and will not change the existing departure record.`);
    }

    accepted.push({ ...row, trailer });
  }

  if (
    accepted.length === 0
    && duplicates.length === 0
    && alreadyDeparted.length === 0
    && ineligible.length === 0
    && invalid.length === 0
    && cancelled.length === 0
    && standBy.length === 0
    && outstanding.length === 0
  ) {
    invalid.push({
      sourceLine: "",
      reason: "No trailer numbers could be identified in this file.",
    });
  }

  return {
    accepted,
    duplicates,
    alreadyDeparted,
    ineligible,
    invalid,
    warnings,
    cancelled,
    standBy,
    outstanding,
  };
}

export function previewDepartureImport(
  rawText: string,
  trailers: DepartureImportCandidate[],
): DepartureImportPreview {
  const parsedRows = parseDepartureImportText(rawText);
  const leftoverInvalid: DepartureImportIssue[] = [];

  for (const line of splitImportLines(rawText)) {
    if (extractTrailerNumberCandidates(line).length === 0 && !line.toLowerCase().includes("trailer")) {
      leftoverInvalid.push({
        sourceLine: line,
        reason: "No trailer number could be identified on this line.",
      });
    }
  }

  return previewDepartureImportRows(parsedRows, trailers, leftoverInvalid);
}

export function previewDepartureSpreadsheet(
  bytes: Uint8Array,
  trailers: DepartureImportCandidate[],
): DepartureImportPreview {
  const parsed = parseFerryspeedPresentationList(bytes);
  return previewDepartureImportRows(
    parsed.rows.map(presentationRowToDepartureImportRow),
    trailers,
  );
}
