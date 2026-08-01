export type TrailerOwnershipType = "company" | "outsourcing" | "unknown";

export type TrailerOwnershipInput = {
  trailerSource?: string | null;
  externalCompany?: string | null;
  isLocal?: boolean | null;
  trailerNumber?: string | null;
  companyTrailerNumbers?: Set<string>;
};

const normalizeText = (value?: string | null) => (value ?? "").trim().toLowerCase();

export const normalizeTrailerNumberForOwnership = (value?: string | null) =>
  (value ?? "").trim().toUpperCase();

const COMPANY_SOURCE_VALUES = new Set(["company", "fleet", "internal", "owned"]);
const OUTSOURCING_SOURCE_VALUES = new Set(["outsourced", "outsourcing", "external", "supplier"]);

export const getTrailerOwnershipType = (input: TrailerOwnershipInput): TrailerOwnershipType => {
  const source = normalizeText(input.trailerSource);
  const hasExternalCompany = normalizeText(input.externalCompany).length > 0;

  if (OUTSOURCING_SOURCE_VALUES.has(source) || hasExternalCompany) {
    return "outsourcing";
  }

  if (COMPANY_SOURCE_VALUES.has(source)) {
    return "company";
  }

  const trailerNumber = normalizeTrailerNumberForOwnership(input.trailerNumber);
  if (trailerNumber && input.companyTrailerNumbers?.has(trailerNumber)) {
    return "company";
  }

  return "unknown";
};

export const getTrailerOwnershipLabel = (ownership: TrailerOwnershipType) => {
  if (ownership === "company") {
    return "Company Trailer";
  }

  if (ownership === "outsourcing") {
    return "Outsourcing Trailer";
  }

  return "Unknown Ownership";
};

export const getTrailerOwnershipBadgeLabel = (ownership: TrailerOwnershipType) => {
  if (ownership === "company") {
    return "Company";
  }

  if (ownership === "outsourcing") {
    return "Outsourcing";
  }

  return "Unknown";
};
