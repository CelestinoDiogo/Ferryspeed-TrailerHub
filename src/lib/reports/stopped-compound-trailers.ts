import {
  isTrailerPresentInCompoundInventory,
  type ExportAllocationStatus,
} from "@/lib/export-allocation";
import { getTrailerOwnershipType, type TrailerOwnershipType } from "@/lib/trailer-ownership";

export const STOPPED_COMPOUND_THRESHOLD_DAYS = 3;
export const STOPPED_COMPOUND_DAY_MS = 86_400_000;

export type StoppedCompoundAgeBand = "attention" | "warning" | "critical";
export type StoppedCompoundLoadFilter = "all" | "loaded" | "empty";

export type StoppedCompoundTrailerInput = {
  id: string;
  trailer_number?: string | null;
  compound_position?: string | null;
  load_status?: string | null;
  customer?: string | null;
  ownership_type?: string | null;
  trailer_source?: string | null;
  external_company?: string | null;
  is_local?: boolean | null;
  arrival_date?: string | null;
  created_at?: string | null;
  departure_date?: string | null;
  operational_status?: string | null;
};

export type CompoundMovementActivityInput = {
  trailer_id?: string | null;
  normalized_trailer_number?: string | null;
  event_type?: string | null;
  created_at?: string | null;
};

export type StoppedCompoundTrailerRecord = {
  id: string;
  trailerNumber: string | null;
  compoundPosition: string | null;
  loadStatus: string | null;
  loadKind: "loaded" | "empty" | "other";
  customer: string | null;
  ownershipType: TrailerOwnershipType;
  entryAt: string;
  daysStopped: number;
  ageBand: StoppedCompoundAgeBand;
  reservationLabel: string | null;
};

export type StoppedCompoundFilters = {
  ownership: "all" | TrailerOwnershipType;
  load: StoppedCompoundLoadFilter;
  ageBand: "all" | StoppedCompoundAgeBand;
  customer: string;
  search: string;
};

const normalizeText = (value?: string | null) => (value ?? "").trim();
const normalizeKey = (value?: string | null) => normalizeText(value).toUpperCase();

const isCompoundMovementEventType = (eventType?: string | null) => {
  const normalized = normalizeText(eventType).toLowerCase();
  return (
    normalized === "compound_entered"
    || normalized === "compound_position_changed"
    || normalized === "arrived"
    || normalized === "vessel_arrived"
  );
};

const parseIsoMillis = (timestamp?: string | null) => {
  if (!timestamp) {
    return null;
  }

  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

export const resolveStoppedCompoundEntryTimestamp = (
  trailer: Pick<StoppedCompoundTrailerInput, "arrival_date" | "created_at">,
  activityRows: CompoundMovementActivityInput[] = [],
) => {
  if (trailer.arrival_date) {
    return trailer.arrival_date;
  }

  let earliest: string | null = null;
  let earliestMillis: number | null = null;

  for (const row of activityRows) {
    if (!isCompoundMovementEventType(row.event_type)) {
      continue;
    }

    const millis = parseIsoMillis(row.created_at);
    if (millis === null) {
      continue;
    }

    if (earliestMillis === null || millis < earliestMillis) {
      earliestMillis = millis;
      earliest = row.created_at ?? null;
    }
  }

  return earliest ?? trailer.created_at ?? null;
};

export const getStoppedCompoundDays = (entryAt: string, now: Date | string = new Date()) => {
  const entryMs = parseIsoMillis(entryAt);
  const nowMs = parseIsoMillis(typeof now === "string" ? now : now.toISOString());
  if (entryMs === null || nowMs === null) {
    return 0;
  }

  return Math.max(0, (nowMs - entryMs) / STOPPED_COMPOUND_DAY_MS);
};

export const isStoppedMoreThanThreeDays = (daysStopped: number) => daysStopped > STOPPED_COMPOUND_THRESHOLD_DAYS;

export const getStoppedCompoundAgeBand = (daysStopped: number): StoppedCompoundAgeBand | null => {
  if (!isStoppedMoreThanThreeDays(daysStopped)) {
    return null;
  }

  if (daysStopped <= 5) {
    return "attention";
  }

  if (daysStopped <= 7) {
    return "warning";
  }

  return "critical";
};

const normalizeLoadKind = (value?: string | null): "loaded" | "empty" | "other" => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "loaded") {
    return "loaded";
  }
  if (normalized === "empty") {
    return "empty";
  }
  return "other";
};

const activityLookupKey = (row: { trailer_id?: string | null; trailer_number?: string | null; normalized_trailer_number?: string | null }) => {
  if (row.trailer_id) {
    return `id:${row.trailer_id}`;
  }

  const trailerNumber = normalizeKey(row.normalized_trailer_number ?? row.trailer_number);
  return trailerNumber ? `number:${trailerNumber}` : null;
};

export const buildStoppedCompoundTrailers = (
  trailers: StoppedCompoundTrailerInput[],
  options: {
    now?: Date | string;
    exportStatusByTrailerId?: Map<string, ExportAllocationStatus>;
    activityRows?: CompoundMovementActivityInput[];
    jobsByTrailerId?: Map<string, string>;
  } = {},
): StoppedCompoundTrailerRecord[] => {
  const now = options.now ?? new Date();
  const activityMap = new Map<string, CompoundMovementActivityInput[]>();

  for (const row of options.activityRows ?? []) {
    const key = activityLookupKey(row);
    if (!key) {
      continue;
    }
    const list = activityMap.get(key) ?? [];
    list.push(row);
    activityMap.set(key, list);
  }

  const records: StoppedCompoundTrailerRecord[] = [];

  for (const trailer of trailers) {
    const exportStatus = options.exportStatusByTrailerId?.get(trailer.id) ?? null;
    if (!isTrailerPresentInCompoundInventory(trailer, exportStatus)) {
      continue;
    }

    const trailerNumberKey = normalizeKey(trailer.trailer_number);
    const activityRows = [
      ...(activityMap.get(`id:${trailer.id}`) ?? []),
      ...(trailerNumberKey ? activityMap.get(`number:${trailerNumberKey}`) ?? [] : []),
    ];
    const entryAt = resolveStoppedCompoundEntryTimestamp(trailer, activityRows);
    if (!entryAt) {
      continue;
    }

    const daysStopped = getStoppedCompoundDays(entryAt, now);
    const ageBand = getStoppedCompoundAgeBand(daysStopped);
    if (!ageBand) {
      continue;
    }

    records.push({
      id: trailer.id,
      trailerNumber: trailer.trailer_number ?? null,
      compoundPosition: trailer.compound_position ?? null,
      loadStatus: trailer.load_status ?? null,
      loadKind: normalizeLoadKind(trailer.load_status),
      customer: trailer.customer ?? null,
      ownershipType: getTrailerOwnershipType({
        ownershipType: trailer.ownership_type,
        trailerSource: trailer.trailer_source,
        externalCompany: trailer.external_company,
        isLocal: trailer.is_local,
      }),
      entryAt,
      daysStopped,
      ageBand,
      reservationLabel: options.jobsByTrailerId?.get(trailer.id) ?? null,
    });
  }

  return records.sort((left, right) => {
    const age = right.daysStopped - left.daysStopped;
    if (age !== 0) {
      return age;
    }
    return (left.trailerNumber ?? "").localeCompare(right.trailerNumber ?? "", undefined, { numeric: true });
  });
};

export const filterStoppedCompoundTrailers = (
  records: StoppedCompoundTrailerRecord[],
  filters: StoppedCompoundFilters,
) => {
  const customer = filters.customer.trim().toLowerCase();
  const search = filters.search.trim().toLowerCase();

  return records.filter((record) => {
    if (filters.ownership !== "all" && record.ownershipType !== filters.ownership) {
      return false;
    }
    if (filters.load !== "all" && record.loadKind !== filters.load) {
      return false;
    }
    if (filters.ageBand !== "all" && record.ageBand !== filters.ageBand) {
      return false;
    }
    if (customer && (record.customer ?? "").toLowerCase() !== customer) {
      return false;
    }
    if (search) {
      const haystack = [record.trailerNumber, record.customer, record.compoundPosition, record.reservationLabel]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }
    return true;
  });
};

export const formatStoppedDuration = (daysStopped: number) => {
  const wholeDays = Math.floor(daysStopped);
  const hours = Math.floor((daysStopped - wholeDays) * 24);
  if (wholeDays <= 0) {
    return `${hours}h`;
  }
  return hours > 0 ? `${wholeDays}d ${hours}h` : `${wholeDays}d`;
};

export const stoppedAgeBandLabel = (band: StoppedCompoundAgeBand) => {
  if (band === "attention") {
    return ">3–5 days";
  }
  if (band === "warning") {
    return ">5–7 days";
  }
  return ">7 days";
};
