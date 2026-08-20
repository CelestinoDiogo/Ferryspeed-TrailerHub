export type BoatReportTrailerRelevanceInput = {
  temperatureRequired?: boolean | null;
  expectedFrontTemperature?: number | null;
  expectedRearTemperature?: number | null;
  temperatureRequiredText?: string | null;
  hasDamage?: boolean | null;
  damageCount?: number;
};

const hasNumericTemperature = (value?: number | null) => typeof value === "number" && Number.isFinite(value);

export function isTemperatureRequiredForBoatReport(trailer: BoatReportTrailerRelevanceInput) {
  if (trailer.temperatureRequired === true) {
    return true;
  }

  if (hasNumericTemperature(trailer.expectedFrontTemperature) || hasNumericTemperature(trailer.expectedRearTemperature)) {
    return true;
  }

  return Boolean(trailer.temperatureRequiredText?.trim());
}

export function isDamageRecordedForBoatReport(trailer: BoatReportTrailerRelevanceInput) {
  return trailer.hasDamage === true || (trailer.damageCount ?? 0) > 0;
}

export function isBoatReportRelevantTrailer(trailer: BoatReportTrailerRelevanceInput) {
  return isTemperatureRequiredForBoatReport(trailer) || isDamageRecordedForBoatReport(trailer);
}

export function selectBoatReportTrailers<T extends BoatReportTrailerRelevanceInput>(trailers: T[]) {
  const seen = new Set<T>();
  const selected: T[] = [];

  for (const trailer of trailers) {
    if (!isBoatReportRelevantTrailer(trailer) || seen.has(trailer)) {
      continue;
    }

    seen.add(trailer);
    selected.push(trailer);
  }

  return selected;
}
