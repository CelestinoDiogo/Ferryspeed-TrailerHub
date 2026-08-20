import { asOperationalTrailerNumber } from "@/lib/imports/trailer-tokens";
import { SpreadsheetImportValidationError } from "@/lib/imports/spreadsheet-security";
import * as XLSX from "xlsx";

export type PresentationListSection =
  | "shipping"
  | "stand-by"
  | "outstanding"
  | "cancelled"
  | "additional"
  | null;

export type PresentationListField =
  | "trailer_number"
  | "length"
  | "load_description"
  | "priority_level"
  | "vessel"
  | "temperature"
  | "destination"
  | "fs_pf"
  | "commodity"
  | "haz"
  | "unit_reg"
  | "customer"
  | "booking_reference";

export type PresentationListRow = {
  trailer_number: string;
  length: string;
  load_description: string;
  priority_level: string;
  vessel: string;
  temperature: string;
  destination: string;
  fs_pf: string;
  commodity: string;
  haz: string;
  unit_reg: string;
  customer: string;
  booking_reference: string;
  list_section: PresentationListSection;
  sourceLine: string;
};

const MAX_ROWS = 2000;
const MAX_COLS = 32;
const HEADER_SCAN_ROWS = 60;

const PRESENTATION_LIST_HEADERS: Record<string, PresentationListField> = {
  trailer: "trailer_number",
  "trailer number": "trailer_number",
  "trailer no": "trailer_number",
  length: "length",
  "cargo description": "load_description",
  cargo: "load_description",
  priority: "priority_level",
  vessel: "vessel",
  temp: "temperature",
  temperature: "temperature",
  destination: "destination",
  "planned destination": "destination",
  "fs pf": "fs_pf",
  fspf: "fs_pf",
  commodity: "commodity",
  haz: "haz",
  hazardous: "haz",
  "unit reg": "unit_reg",
  "unit registration": "unit_reg",
  customer: "customer",
  booking: "booking_reference",
  "booking reference": "booking_reference",
  "booking ref": "booking_reference",
};

const emptyPresentationRow = (sourceLine = ""): PresentationListRow => ({
  trailer_number: "",
  length: "",
  load_description: "",
  priority_level: "",
  vessel: "",
  temperature: "",
  destination: "",
  fs_pf: "",
  commodity: "",
  haz: "",
  unit_reg: "",
  customer: "",
  booking_reference: "",
  list_section: null,
  sourceLine,
});

const normalizeHeader = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const normalizeSectionText = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const encodeCell = (cell: XLSX.CellObject | undefined) => {
  if (!cell) {
    return "";
  }

  if (cell.t === "e") {
    return "";
  }

  if (typeof cell.v === "number" && Number.isFinite(cell.v)) {
    return Number.isInteger(cell.v) ? String(cell.v) : String(cell.v);
  }

  if (typeof cell.v === "boolean") {
    return cell.v ? "YES" : "NO";
  }

  if (typeof cell.v === "string") {
    return cell.v.replace(/\s+/g, " ").trim();
  }

  if (cell.w) {
    return String(cell.w).replace(/\s+/g, " ").trim();
  }

  return "";
};

const sheetToGrid = (sheet: XLSX.WorkSheet) => {
  const ref = sheet["!ref"];
  if (!ref) {
    return [] as string[][];
  }

  const range = XLSX.utils.decode_range(ref);
  const maxRow = Math.min(range.e.r, range.s.r + MAX_ROWS - 1);
  const maxCol = Math.min(range.e.c, range.s.c + MAX_COLS - 1);
  const rows: string[][] = [];

  for (let rowIndex = range.s.r; rowIndex <= maxRow; rowIndex += 1) {
    const row: string[] = [];
    for (let colIndex = range.s.c; colIndex <= maxCol; colIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      row.push(encodeCell(sheet[address] as XLSX.CellObject | undefined));
    }
    rows.push(row);
  }

  return rows;
};

const headerMapForRow = (row: string[]) => {
  const headerMap = new Map<number, PresentationListField>();
  row.forEach((cell, index) => {
    const mapped = PRESENTATION_LIST_HEADERS[normalizeHeader(cell)];
    if (mapped && !Array.from(headerMap.values()).includes(mapped)) {
      headerMap.set(index, mapped);
    }
  });
  return headerMap;
};

const findHeader = (rows: string[][]) => {
  const scanLimit = Math.min(rows.length, HEADER_SCAN_ROWS);
  let best: { index: number; headerMap: Map<number, PresentationListField> } | null = null;

  for (let index = 0; index < scanLimit; index += 1) {
    const headerMap = headerMapForRow(rows[index] ?? []);
    if (!Array.from(headerMap.values()).includes("trailer_number")) {
      continue;
    }

    if (!best || headerMap.size > best.headerMap.size) {
      best = { index, headerMap };
    }
  }

  return best;
};

const classifyHeading = (row: string[]): PresentationListSection | "footer" | null => {
  const compact = normalizeSectionText(row.filter(Boolean).join(" "));
  if (!compact) {
    return null;
  }

  if (
    compact === "shipping"
    || compact.startsWith("shipping ")
  ) {
    return "shipping";
  }

  if (
    compact === "stand by"
    || compact === "standby"
    || compact.startsWith("stand by ")
    || compact.startsWith("standby ")
  ) {
    return "stand-by";
  }

  if (compact === "outstanding" || compact.startsWith("outstanding ")) {
    return "outstanding";
  }

  if (compact === "cancelled" || compact === "canceled" || compact.startsWith("cancelled ") || compact.startsWith("canceled ")) {
    return "cancelled";
  }

  if (compact === "additional" || compact.startsWith("additional ")) {
    return "additional";
  }

  if (
    compact.includes("final list")
    || compact.startsWith("signature")
    || compact.startsWith("authorised")
    || compact.startsWith("authorized")
    || compact.startsWith("signed")
  ) {
    return "footer";
  }

  return null;
};

const rowLooksCancelled = (row: PresentationListRow, cells: string[]) => {
  if (row.list_section === "cancelled") {
    return true;
  }

  return cells.some((cell) => {
    const compact = normalizeSectionText(cell);
    return compact === "cancelled" || compact === "canceled";
  });
};

const rowLooksAdditional = (row: PresentationListRow, cells: string[]) => {
  if (row.list_section === "additional") {
    return true;
  }

  return cells.some((cell) => normalizeSectionText(cell) === "additional");
};

const preferredSheetOrder = (sheetNames: string[]) => {
  const scored = sheetNames.map((name, index) => {
    const normalized = name.trim().toLowerCase();
    let score = 0;
    if (normalized.includes("vpl")) score += 4;
    if (normalized.includes("ferryspeed")) score += 3;
    if (normalized.includes("voyage") || normalized.includes("presentation")) score += 2;
    return { name, index, score };
  });

  return scored
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.name);
};

const parseSheetRows = (
  rows: string[][],
  headerIndex: number,
  headerMap: Map<number, PresentationListField>,
) => {
  const trailerColumn = Array.from(headerMap.entries()).find(([, field]) => field === "trailer_number")?.[0];
  if (trailerColumn === undefined) {
    return [] as PresentationListRow[];
  }

  let currentSection: PresentationListSection = "shipping";
  const parsed: PresentationListRow[] = [];

  for (const cells of rows.slice(headerIndex + 1)) {
    const heading = classifyHeading(cells);
    const trailerCell = asOperationalTrailerNumber(cells[trailerColumn]);

    if (!trailerCell && heading) {
      if (heading === "footer") {
        continue;
      }
      currentSection = heading;
      continue;
    }

    if (!trailerCell) {
      continue;
    }

    const imported = emptyPresentationRow(cells.filter(Boolean).join(" | "));
    imported.list_section = currentSection;
    cells.forEach((value, cellIndex) => {
      const key = headerMap.get(cellIndex);
      if (!key) {
        return;
      }
      imported[key] = value.trim();
    });
    imported.trailer_number = trailerCell;
    imported.priority_level = imported.priority_level.trim();
    imported.temperature = imported.temperature.trim();

    if (rowLooksCancelled(imported, cells)) {
      imported.list_section = "cancelled";
    } else if (rowLooksAdditional(imported, cells) && imported.list_section !== "stand-by" && imported.list_section !== "outstanding") {
      imported.list_section = "additional";
    }

    parsed.push(imported);
  }

  return parsed;
};

export function parseFerryspeedPresentationList(bytes: Uint8Array): {
  sheetName: string;
  rows: PresentationListRow[];
} {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
      bookFiles: false,
      sheetStubs: false,
      sheetRows: MAX_ROWS,
    });
  } catch {
    throw new SpreadsheetImportValidationError("This workbook could not be read. Save the file as .xlsx and try again.");
  }

  const sheetNames = workbook.SheetNames ?? [];
  if (sheetNames.length === 0) {
    throw new SpreadsheetImportValidationError("This workbook does not contain any worksheets.");
  }

  for (const sheetName of preferredSheetOrder(sheetNames)) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      continue;
    }

    const grid = sheetToGrid(sheet);
    const header = findHeader(grid);
    if (!header) {
      continue;
    }

    return {
      sheetName,
      rows: parseSheetRows(grid, header.index, header.headerMap),
    };
  }

  throw new SpreadsheetImportValidationError("No operational trailer list was found in this workbook.");
}

export function normalizePriorityHint(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  if (["priority", "yes", "y", "true", "1", "high", "p"].includes(normalized)) {
    return "priority";
  }

  if (["normal", "no", "n", "false", "0"].includes(normalized)) {
    return "";
  }

  return value.trim();
}

export function splitNumericTemperature(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return { numeric: "", raw: "" };
  }

  if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) {
    return { numeric: String(Number(trimmed)), raw: trimmed };
  }

  return { numeric: "", raw: trimmed };
}

export function composeOperationalNotes(row: Pick<
  PresentationListRow,
  "length" | "vessel" | "fs_pf" | "commodity" | "haz" | "unit_reg" | "temperature"
> & { rawTemperature?: string; extra?: string }) {
  const parts = [
    row.length ? `Length: ${row.length}` : "",
    row.vessel ? `Vessel: ${row.vessel}` : "",
    row.fs_pf ? `FS/PF: ${row.fs_pf}` : "",
    row.commodity ? `Commodity: ${row.commodity}` : "",
    row.haz ? `Haz: ${row.haz}` : "",
    row.unit_reg ? `Unit Reg: ${row.unit_reg}` : "",
    row.rawTemperature ? `Temp: ${row.rawTemperature}` : "",
    row.extra?.trim() ?? "",
  ].filter(Boolean);

  return parts.join(" · ");
}
