import { isPlausibleTrailerNumber } from "@/lib/imports/trailer-tokens";

const UNICODE_SPACES = /[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g;
const EXCEL_SERIAL_MIN = 20000;
const EXCEL_SERIAL_MAX = 80000;

export function normalizeImportTrailerNumber(value?: string | null) {
  return (value ?? "")
    .replace(UNICODE_SPACES, " ")
    .replace(/[\t\r\n\f\v]+/g, " ")
    .trim()
    .replace(/ +/g, "")
    .toUpperCase();
}

export function asImportOperationalTrailerNumber(value?: string | null) {
  const normalized = normalizeImportTrailerNumber(value);
  return isPlausibleTrailerNumber(normalized) ? normalized : "";
}

export function looksLikeExcelSerial(value?: string | null) {
  const trimmed = (value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return false;
  }

  const serial = Number(trimmed);
  return Number.isFinite(serial) && serial >= EXCEL_SERIAL_MIN && serial <= EXCEL_SERIAL_MAX;
}

export function excelSerialToUtcDate(serial: number) {
  if (!Number.isFinite(serial) || serial < EXCEL_SERIAL_MIN || serial > EXCEL_SERIAL_MAX) {
    return null;
  }

  const utcMs = Date.UTC(1899, 11, 30) + Math.round(serial * 86400000);
  const parsed = new Date(utcMs);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const parseUkDate = (value: string) => {
  const uk = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!uk) {
    return null;
  }

  const day = uk[1].padStart(2, "0");
  const month = uk[2].padStart(2, "0");
  const year = uk[3].length === 2 ? `20${uk[3]}` : uk[3];
  return `${year}-${month}-${day}`;
};

const parseIsoDateTime = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) {
    return null;
  }

  const normalized = value.includes("T") || value.includes(" ")
    ? value.replace(" ", "T")
    : `${value}T00:00:00.000Z`;
  const parsed = new Date(normalized.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const fromExcelSerialText = (value: string) => {
  if (!looksLikeExcelSerial(value)) {
    return null;
  }

  return excelSerialToUtcDate(Number(value));
};

export function parseImportDate(value?: string | null): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }

  const uk = parseUkDate(trimmed);
  if (uk) {
    return uk;
  }

  const serialDate = fromExcelSerialText(trimmed);
  if (serialDate) {
    return serialDate.toISOString().slice(0, 10);
  }

  return null;
}

export function parseImportDateTime(value?: string | null): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const iso = parseIsoDateTime(trimmed);
  if (iso) {
    const hasTime = /[T ]\d{2}:\d{2}/.test(trimmed);
    return hasTime ? iso.toISOString() : iso.toISOString().slice(0, 10);
  }

  const uk = parseUkDate(trimmed);
  if (uk) {
    return uk;
  }

  const serialDate = fromExcelSerialText(trimmed);
  if (serialDate) {
    const serial = Number(trimmed);
    const hasTime = !Number.isInteger(serial);
    return hasTime ? serialDate.toISOString() : serialDate.toISOString().slice(0, 10);
  }

  return null;
}

export function toExportPersistTimestamp(value?: string | null) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const dateOnly = parseImportDate(trimmed);
  if (!dateOnly) {
    return null;
  }

  return new Date(`${dateOnly}T12:00:00.000Z`).toISOString();
}
