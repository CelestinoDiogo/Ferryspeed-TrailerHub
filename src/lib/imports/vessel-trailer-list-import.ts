import {
  composeOperationalNotes,
  normalizePriorityHint,
  parseFerryspeedPresentationList,
  splitNumericTemperature,
  type PresentationListRow,
} from "@/lib/imports/spreadsheet";
import { extractTrailerNumberCandidates, splitImportLines } from "@/lib/imports/trailer-tokens";
import { normalizeExpectedTemperatureUnit, normalizeTrailerNumber } from "@/lib/vessel-operations";

export type VesselTrailerImportRow = {
  trailer_number: string;
  customer: string;
  booking_reference: string;
  expected_front_temperature: string;
  expected_rear_temperature: string;
  expected_temperature_unit: string;
  priority_level: string;
  planning_notes: string;
  load_description: string;
  planned_destination: string;
  vessel: string;
  fs_pf: string;
  commodity: string;
  haz: string;
  unit_reg: string;
  raw_temperature: string;
  list_section: PresentationListRow["list_section"];
  sourceLine: string;
};

export type VesselTrailerImportIssue = {
  sourceLine: string;
  reason: string;
};

export type VesselTrailerImportPreview = {
  accepted: VesselTrailerImportRow[];
  duplicates: Array<{ row: VesselTrailerImportRow; reason: string }>;
  warnings: string[];
  invalid: VesselTrailerImportIssue[];
  standBy: VesselTrailerImportRow[];
  outstanding: VesselTrailerImportRow[];
  cancelled: VesselTrailerImportRow[];
};

const normalizeImportHeader = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type MappedField = Exclude<keyof VesselTrailerImportRow, "sourceLine" | "list_section" | "raw_temperature">;

const IMPORT_HEADER_ALIASES: Record<string, MappedField> = {
  trailer: "trailer_number",
  "trailer number": "trailer_number",
  "trailer no": "trailer_number",
  customer: "customer",
  booking: "booking_reference",
  "booking reference": "booking_reference",
  "booking ref": "booking_reference",
  reference: "booking_reference",
  "expected front temperature": "expected_front_temperature",
  "front temperature": "expected_front_temperature",
  "front temp": "expected_front_temperature",
  temperature: "expected_front_temperature",
  "temperature required": "expected_front_temperature",
  temp: "expected_front_temperature",
  "expected rear temperature": "expected_rear_temperature",
  "rear temperature": "expected_rear_temperature",
  "rear temp": "expected_rear_temperature",
  "temperature unit": "expected_temperature_unit",
  unit: "expected_temperature_unit",
  priority: "priority_level",
  notes: "planning_notes",
  "planning notes": "planning_notes",
  "cargo description": "load_description",
  cargo: "load_description",
  destination: "planned_destination",
  "planned destination": "planned_destination",
  vessel: "vessel",
  "fs pf": "fs_pf",
  commodity: "commodity",
  haz: "haz",
  "unit reg": "unit_reg",
  "unit registration": "unit_reg",
};

const emptyVesselTrailerImportRow = (sourceLine = ""): VesselTrailerImportRow => ({
  trailer_number: "",
  customer: "",
  booking_reference: "",
  expected_front_temperature: "",
  expected_rear_temperature: "",
  expected_temperature_unit: "C",
  priority_level: "",
  planning_notes: "",
  load_description: "",
  planned_destination: "",
  vessel: "",
  fs_pf: "",
  commodity: "",
  haz: "",
  unit_reg: "",
  raw_temperature: "",
  list_section: null,
  sourceLine,
});

const looksDelimited = (line: string) => line.includes(",") || line.includes("\t");

const parseDelimitedRows = (lines: string[]): VesselTrailerImportRow[] | null => {
  if (lines.length === 0 || !looksDelimited(lines[0])) {
    return null;
  }

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const cells = lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
  const headerMap = new Map<number, MappedField>();

  cells[0].forEach((headerCell, index) => {
    const mapped = IMPORT_HEADER_ALIASES[normalizeImportHeader(headerCell)];
    if (mapped) {
      headerMap.set(index, mapped);
    }
  });

  if (!Array.from(headerMap.values()).includes("trailer_number")) {
    return null;
  }

  return cells.slice(1).map((row, index) => {
    const imported = emptyVesselTrailerImportRow(lines[index + 1] ?? row.join(delimiter));
    row.forEach((value, cellIndex) => {
      const key = headerMap.get(cellIndex);
      if (!key) {
        return;
      }

      imported[key] = value;
    });
    imported.trailer_number = normalizeTrailerNumber(imported.trailer_number);
    imported.expected_temperature_unit = normalizeExpectedTemperatureUnit(imported.expected_temperature_unit || "C");
    imported.priority_level = imported.priority_level.trim().toLowerCase() === "priority" ? "priority" : imported.priority_level.trim();
    return imported;
  });
};

export function parseVesselTrailerImportText(rawText: string): VesselTrailerImportRow[] {
  const lines = splitImportLines(rawText);
  if (lines.length === 0) {
    return [];
  }

  const delimited = parseDelimitedRows(lines);
  if (delimited) {
    return delimited.filter((row) => Boolean(row.trailer_number));
  }

  const numberedLines = lines
    .map((line) => {
      const candidates = extractTrailerNumberCandidates(line);
      if (candidates.length !== 1) {
        return null;
      }

      return {
        ...emptyVesselTrailerImportRow(line),
        trailer_number: candidates[0],
      };
    })
    .filter((row): row is VesselTrailerImportRow => Boolean(row));

  if (numberedLines.length > 0) {
    return numberedLines;
  }

  return extractTrailerNumberCandidates(rawText).map((trailerNumber) => ({
    ...emptyVesselTrailerImportRow(trailerNumber),
    trailer_number: trailerNumber,
  }));
}

const applyTemperatureNormalization = (row: VesselTrailerImportRow, warnings: string[]) => {
  const front = splitNumericTemperature(row.expected_front_temperature || row.raw_temperature);
  if (row.expected_front_temperature && !front.numeric) {
    row.raw_temperature = row.raw_temperature || row.expected_front_temperature;
    warnings.push(`${row.trailer_number}: temperature "${row.raw_temperature}" was kept as text because it is not a single numeric value.`);
    if (!row.planning_notes.includes(`Temp: ${row.raw_temperature}`)) {
      row.planning_notes = [row.planning_notes, `Temp: ${row.raw_temperature}`].filter(Boolean).join(" · ");
    }
    row.expected_front_temperature = "";
  } else if (front.numeric) {
    row.expected_front_temperature = front.numeric;
    row.raw_temperature = row.raw_temperature || front.raw;
  }

  if (row.expected_rear_temperature && !Number.isFinite(Number(row.expected_rear_temperature))) {
    warnings.push(`${row.trailer_number}: rear temperature is present but not numeric, so it will be left blank.`);
    row.expected_rear_temperature = "";
  }
};

export function previewVesselTrailerImportRows(
  rows: VesselTrailerImportRow[],
  existingTrailerNumbers: string[] = [],
  leftoverInvalid: VesselTrailerImportIssue[] = [],
): VesselTrailerImportPreview {
  const existing = new Set(existingTrailerNumbers.map((value) => normalizeTrailerNumber(value)).filter(Boolean));
  const accepted: VesselTrailerImportRow[] = [];
  const duplicates: VesselTrailerImportPreview["duplicates"] = [];
  const invalid: VesselTrailerImportIssue[] = [...leftoverInvalid];
  const warnings: string[] = [];
  const standBy: VesselTrailerImportRow[] = [];
  const outstanding: VesselTrailerImportRow[] = [];
  const cancelled: VesselTrailerImportRow[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row.trailer_number) {
      invalid.push({
        sourceLine: row.sourceLine,
        reason: "Trailer number is missing.",
      });
      continue;
    }

    if (row.list_section === "cancelled") {
      cancelled.push(row);
      warnings.push(`${row.trailer_number} is marked CANCELLED and was not added to the vessel list.`);
      continue;
    }

    if (row.list_section === "stand-by") {
      standBy.push(row);
      warnings.push(`${row.trailer_number} is listed under STAND-BY and was not added as a shipping trailer.`);
      continue;
    }

    if (row.list_section === "outstanding") {
      outstanding.push(row);
      warnings.push(`${row.trailer_number} is listed under OUTSTANDING and was not added as a shipping trailer.`);
      continue;
    }

    if (existing.has(row.trailer_number) || seen.has(row.trailer_number)) {
      duplicates.push({
        row,
        reason: existing.has(row.trailer_number)
          ? `${row.trailer_number} is already on this vessel list.`
          : `${row.trailer_number} appears more than once in the import.`,
      });
      continue;
    }

    if (row.list_section === "additional") {
      warnings.push(`${row.trailer_number} is listed as ADDITIONAL.`);
    }

    applyTemperatureNormalization(row, warnings);
    seen.add(row.trailer_number);
    accepted.push(row);
  }

  if (accepted.length === 0 && duplicates.length === 0 && invalid.length === 0 && standBy.length === 0 && outstanding.length === 0 && cancelled.length === 0) {
    invalid.push({
      sourceLine: "",
      reason: "No trailer numbers could be identified in this file.",
    });
  }

  return { accepted, duplicates, warnings, invalid, standBy, outstanding, cancelled };
}

export function previewVesselTrailerImport(rawText: string, existingTrailerNumbers: string[] = []): VesselTrailerImportPreview {
  const rows = parseVesselTrailerImportText(rawText);
  const leftoverLines = splitImportLines(rawText).filter((line) => {
    if (looksDelimited(line) && IMPORT_HEADER_ALIASES[normalizeImportHeader(line.split(/[,\t]/)[0] ?? "")]) {
      return false;
    }

    return !rows.some((row) => row.sourceLine === line || row.trailer_number === normalizeTrailerNumber(line));
  });

  const leftoverInvalid: VesselTrailerImportIssue[] = [];
  for (const line of leftoverLines) {
    if (extractTrailerNumberCandidates(line).length === 0 && line.length > 0) {
      leftoverInvalid.push({
        sourceLine: line,
        reason: "No trailer number could be identified on this line.",
      });
    }
  }

  return previewVesselTrailerImportRows(rows, existingTrailerNumbers, leftoverInvalid);
}

export function presentationRowToVesselImportRow(row: PresentationListRow): VesselTrailerImportRow {
  const temperature = splitNumericTemperature(row.temperature);
  const imported = emptyVesselTrailerImportRow(row.sourceLine);
  imported.trailer_number = row.trailer_number;
  imported.customer = row.customer;
  imported.booking_reference = row.booking_reference;
  imported.load_description = row.load_description;
  imported.planned_destination = row.destination;
  imported.vessel = row.vessel;
  imported.fs_pf = row.fs_pf;
  imported.commodity = row.commodity;
  imported.haz = row.haz;
  imported.unit_reg = row.unit_reg;
  imported.priority_level = normalizePriorityHint(row.priority_level);
  imported.list_section = row.list_section;
  imported.expected_front_temperature = temperature.numeric;
  imported.raw_temperature = temperature.raw || row.temperature;
  imported.planning_notes = composeOperationalNotes({
    ...row,
    rawTemperature: temperature.numeric ? "" : temperature.raw,
  });
  imported.expected_temperature_unit = "C";
  return imported;
}

export function previewVesselTrailerSpreadsheet(bytes: Uint8Array, existingTrailerNumbers: string[] = []): VesselTrailerImportPreview {
  const parsed = parseFerryspeedPresentationList(bytes);
  return previewVesselTrailerImportRows(
    parsed.rows.map(presentationRowToVesselImportRow),
    existingTrailerNumbers,
  );
}
