import { getTrailerOwnershipType, type TrailerOwnershipType } from "@/lib/trailer-ownership";

export type HistoricalOwnershipSnapshot = {
  ownership_type?: string | null;
  trailer_source?: string | null;
  external_company?: string | null;
  is_local?: boolean | null;
};

type HistoricalOwnershipEvidence = {
  operationSnapshot?: HistoricalOwnershipSnapshot | null;
  sourceSnapshot?: HistoricalOwnershipSnapshot | null;
  eventSnapshot?: HistoricalOwnershipSnapshot | null;
};

const classifySnapshot = (snapshot: HistoricalOwnershipSnapshot): TrailerOwnershipType =>
  getTrailerOwnershipType({
    ownershipType: snapshot.ownership_type,
    trailerSource: snapshot.trailer_source,
    externalCompany: snapshot.external_company,
    isLocal: snapshot.is_local,
  });

export const resolveHistoricalOwnership = ({
  operationSnapshot,
  sourceSnapshot,
  eventSnapshot,
}: HistoricalOwnershipEvidence): TrailerOwnershipType => {
  if (operationSnapshot !== undefined && operationSnapshot !== null) {
    const ownership = classifySnapshot(operationSnapshot);
    if (ownership !== "unknown") {
      return ownership;
    }
  }

  if (sourceSnapshot !== undefined && sourceSnapshot !== null) {
    const ownership = classifySnapshot(sourceSnapshot);
    if (ownership !== "unknown") {
      return ownership;
    }
  }

  if (eventSnapshot !== undefined && eventSnapshot !== null) {
    return classifySnapshot(eventSnapshot);
  }

  return "unknown";
};