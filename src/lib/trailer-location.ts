type TrailerLocationInput = {
  departureDate?: string | null;
  isLocal?: boolean | null;
  compoundPosition?: string | null;
  waitingForCompound?: boolean;
  exportLocation?: string | null;
  fallbackLocation?: string | null;
};

const normalizeText = (value?: string | null) => value?.trim() ?? "";

export const getTrailerCurrentLocationLabel = (input: TrailerLocationInput) => {
  if (normalizeText(input.departureDate)) {
    return "Departed";
  }

  if (input.isLocal === true) {
    return "Local Trailer";
  }

  if (normalizeText(input.compoundPosition)) {
    return `Compound – ${normalizeText(input.compoundPosition)}`;
  }

  if (input.waitingForCompound) {
    return "Waiting for Compound";
  }

  if (normalizeText(input.exportLocation)) {
    return input.exportLocation!.trim();
  }

  if (normalizeText(input.fallbackLocation)) {
    return input.fallbackLocation!.trim();
  }

  return "Location Pending";
};

export const getTrailerOperationalStatusLabel = (input: TrailerLocationInput & { operationalStageLabel?: string | null }) => {
  if (normalizeText(input.departureDate)) {
    return "Departed";
  }

  if (normalizeText(input.operationalStageLabel)) {
    return input.operationalStageLabel!.trim();
  }

  return "Operational Status Pending";
};
