export const DEFAULT_TEMPERATURE_LOWER_TOLERANCE = 3;
export const DEFAULT_TEMPERATURE_UPPER_TOLERANCE = 3;
export const TEMPERATURE_TOLERANCE_STORAGE_KEY = "ferryspeed.temperature-tolerance";

export type TemperatureToleranceSettings = {
  lowerTolerance: number;
  upperTolerance: number;
};

export type TemperatureStatus = "within_range" | "high_alert" | "low_alert" | "not_assessed" | "not_required";

const normalizeTolerance = (value: unknown, fallback: number) => {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
};

export const getDefaultTemperatureToleranceSettings = (): TemperatureToleranceSettings => ({
  lowerTolerance: DEFAULT_TEMPERATURE_LOWER_TOLERANCE,
  upperTolerance: DEFAULT_TEMPERATURE_UPPER_TOLERANCE,
});

export const normalizeTemperatureToleranceSettings = (
  raw?: Partial<TemperatureToleranceSettings> | null,
): TemperatureToleranceSettings => {
  const defaults = getDefaultTemperatureToleranceSettings();

  return {
    lowerTolerance: normalizeTolerance(raw?.lowerTolerance, defaults.lowerTolerance),
    upperTolerance: normalizeTolerance(raw?.upperTolerance, defaults.upperTolerance),
  };
};

export const getTemperatureToleranceSettingsFromStorage = (): TemperatureToleranceSettings => {
  if (typeof window === "undefined") {
    return getDefaultTemperatureToleranceSettings();
  }

  try {
    const raw = window.localStorage.getItem(TEMPERATURE_TOLERANCE_STORAGE_KEY);
    if (!raw) {
      return getDefaultTemperatureToleranceSettings();
    }

    const parsed = JSON.parse(raw) as Partial<TemperatureToleranceSettings>;
    return normalizeTemperatureToleranceSettings(parsed);
  } catch {
    return getDefaultTemperatureToleranceSettings();
  }
};

export const saveTemperatureToleranceSettingsToStorage = (settings: TemperatureToleranceSettings) => {
  if (typeof window === "undefined") {
    return;
  }

  const normalized = normalizeTemperatureToleranceSettings(settings);
  window.localStorage.setItem(TEMPERATURE_TOLERANCE_STORAGE_KEY, JSON.stringify(normalized));
};

export const getAcceptedTemperatureRange = (
  expectedTemperature: number,
  settings: TemperatureToleranceSettings,
) => ({
  minimumAcceptedTemperature: expectedTemperature - settings.lowerTolerance,
  maximumAcceptedTemperature: expectedTemperature + settings.upperTolerance,
});

export const evaluateTemperatureStatus = (
  measuredTemperature: number | null,
  expectedTemperature: number | null,
  settings: TemperatureToleranceSettings,
): TemperatureStatus => {
  if (expectedTemperature === null) {
    return "not_required";
  }

  if (measuredTemperature === null) {
    return "not_assessed";
  }

  const { minimumAcceptedTemperature, maximumAcceptedTemperature } = getAcceptedTemperatureRange(expectedTemperature, settings);

  if (measuredTemperature < minimumAcceptedTemperature) {
    return "low_alert";
  }

  if (measuredTemperature > maximumAcceptedTemperature) {
    return "high_alert";
  }

  return "within_range";
};

export const isTemperatureOutOfRange = (
  measuredTemperature: number | null,
  expectedTemperature: number | null,
  settings: TemperatureToleranceSettings,
) => {
  const status = evaluateTemperatureStatus(measuredTemperature, expectedTemperature, settings);
  return status === "high_alert" || status === "low_alert";
};

export const getTemperatureStatusLabel = (status: TemperatureStatus) => {
  if (status === "within_range") return "Within Range";
  if (status === "high_alert") return "High Temperature Alert";
  if (status === "low_alert") return "Low Temperature Alert";
  if (status === "not_assessed") return "Not Assessed";
  return "Not Required";
};
