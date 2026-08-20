import { normalizeTrailerNumber } from "@/lib/vessel-operations";

const TRAILER_TOKEN_PATTERN = /\b[A-Z]{2,}\d{2,}[A-Z0-9]*\b/g;
const PLAUSIBLE_TRAILER_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const REJECTED_TRAILER_TOKENS = new Set([
  "PDF",
  "HTTP",
  "HTTPS",
  "PAGE",
]);

export function isPlausibleTrailerNumber(value?: string | null) {
  const normalized = normalizeTrailerNumber(value);
  if (!normalized || normalized.length < 2 || normalized.length > 24) {
    return false;
  }

  if (!/\d/.test(normalized) || !PLAUSIBLE_TRAILER_PATTERN.test(normalized)) {
    return false;
  }

  if (/^\d+$/.test(normalized) && (normalized.length < 5 || normalized.length > 12)) {
    return false;
  }

  return !REJECTED_TRAILER_TOKENS.has(normalized);
}

export function asOperationalTrailerNumber(value?: string | null) {
  const normalized = normalizeTrailerNumber(value);
  return isPlausibleTrailerNumber(normalized) ? normalized : "";
}

export function extractTrailerNumberCandidates(rawText: string) {  const matches = rawText.toUpperCase().match(TRAILER_TOKEN_PATTERN) ?? [];
  const seen = new Set<string>();
  const numbers: string[] = [];

  for (const match of matches) {
    if (REJECTED_TRAILER_TOKENS.has(match) || /^\d{4}/.test(match)) {
      continue;
    }

    const normalized = normalizeTrailerNumber(match);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    numbers.push(normalized);
  }

  return numbers;
}

export function splitImportLines(rawText: string) {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
