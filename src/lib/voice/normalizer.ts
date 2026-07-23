const DIACRITIC_PATTERN = /[\u0300-\u036f]/g;

export const normalizeVoiceText = (value: string) => {
  return value
    .normalize("NFD")
    .replace(DIACRITIC_PATTERN, "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
};

export const normalizeTrailerNumber = (value?: string | null) => {
  const compact = value?.trim().toUpperCase() ?? "";
  return compact.length > 0 ? compact : null;
};

export const normalizeCompoundPosition = (value?: string | null) => {
  const compact = value?.trim().toUpperCase() ?? "";
  if (!compact) {
    return null;
  }

  const match = compact.match(/^(P|A)?0*(\d{1,2})$/);
  if (!match) {
    return null;
  }

  const numeric = Number(match[2]);
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 50) {
    return null;
  }

  return `P${numeric.toString().padStart(2, "0")}`;
};
