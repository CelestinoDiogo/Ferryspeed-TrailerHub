import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getTrailerOwnershipLabel, getTrailerOwnershipType } from "@/lib/trailer-ownership";

export const GLOBAL_SEARCH_MAX_RESULTS = 20;

export type GlobalSearchCategory =
  | "trailers"
  | "export_operations"
  | "vessel_operations"
  | "arrival_records"
  | "inspection_records"
  | "damage_reports"
  | "temperature_records"
  | "photos"
  | "users"
  | "reports"
  | "compound_positions";

export type GlobalSearchResultItem = {
  id: string;
  category: GlobalSearchCategory;
  title: string;
  subtitle: string;
  status: string;
  href: string;
  quickActionLabel: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

export type GlobalSearchResultGroup = {
  category: GlobalSearchCategory;
  label: string;
  count: number;
  items: GlobalSearchResultItem[];
};

export type GlobalSearchResponse = {
  query: string;
  normalizedQuery: string;
  limit: number;
  offset: number;
  totalMatched: number;
  hasMore: boolean;
  results: GlobalSearchResultItem[];
  groups: GlobalSearchResultGroup[];
};

export type SearchGlobalIndexOptions = {
  query: string;
  limit?: number;
  offset?: number;
};

type TrailersRow = Pick<
  Database["public"]["Tables"]["trailers"]["Row"],
  "id" | "trailer_number" | "customer" | "consignee" | "container_number" | "compound_position" | "operational_status" | "load_status" | "trailer_source" | "external_company" | "is_local"
>;
type ExportRow = Pick<
  Database["public"]["Tables"]["export_allocations"]["Row"],
  "id" | "trailer_number" | "customer" | "booking_reference" | "haulier" | "collection_address" | "status"
>;
type VesselOperationRow = Pick<
  Database["public"]["Tables"]["vessel_operations"]["Row"],
  "id" | "vessel_name" | "sailing_reference" | "status" | "expected_arrival_at" | "actual_arrival_at" | "updated_at"
>;
type VesselTrailerRow = Pick<
  Database["public"]["Tables"]["vessel_operation_trailers"]["Row"],
  | "id"
  | "vessel_operation_id"
  | "trailer_number"
  | "customer"
  | "booking_reference"
  | "arrival_status"
  | "inspection_completed_at"
>;
type DamageRow = Pick<
  Database["public"]["Tables"]["vessel_inspection_damages"]["Row"],
  "id" | "vessel_operation_id" | "vessel_trailer_id" | "trailer_number" | "damage_type" | "damage_location" | "severity" | "description"
>;
type TemperatureRow = Pick<
  Database["public"]["Tables"]["vessel_inspection_temperatures"]["Row"],
  "id" | "vessel_trailer_id" | "trailer_number" | "temperature_value" | "temperature_unit" | "reading_point" | "is_out_of_range" | "recorded_at"
>;
type PhotoRow = Pick<
  Database["public"]["Tables"]["vessel_inspection_photos"]["Row"],
  "id" | "vessel_operation_id" | "vessel_trailer_id" | "trailer_number" | "category" | "file_name" | "description" | "uploaded_at"
>;
type UserRow = Pick<
  Database["public"]["Tables"]["app_user_roles"]["Row"],
  "user_id" | "email" | "display_name" | "role_key" | "is_active"
>;
type ReportRow = Pick<
  Database["public"]["Tables"]["vessel_operation_reports"]["Row"],
  "id" | "vessel_operation_id" | "title" | "subject" | "report_number" | "report_status" | "generated_at"
>;

type RankedResult = GlobalSearchResultItem & {
  rank: number;
  secondaryRank: number;
};

const CATEGORY_LABELS: Record<GlobalSearchCategory, string> = {
  trailers: "Trailers",
  export_operations: "Export Operations",
  vessel_operations: "Vessel Operations",
  arrival_records: "Arrival Records",
  inspection_records: "Inspection Records",
  damage_reports: "Damage Reports",
  temperature_records: "Temperature Records",
  photos: "Photos",
  users: "Users",
  reports: "Reports",
  compound_positions: "Compound Positions",
};

const CATEGORY_WEIGHT: Record<GlobalSearchCategory, number> = {
  trailers: 0,
  export_operations: 1,
  vessel_operations: 2,
  arrival_records: 3,
  inspection_records: 4,
  damage_reports: 5,
  temperature_records: 6,
  photos: 7,
  users: 8,
  reports: 9,
  compound_positions: 10,
};

const normalizeSearchText = (value?: string | null) => (value ?? "").trim().toLowerCase();

export const normalizeSearchToken = (value?: string | null) => normalizeSearchText(value).replace(/\s+/g, "");

const sanitizeFilterToken = (value: string) => value.replace(/[%(),]/g, " ").replace(/\s+/g, " ").trim();

const toSingleLine = (parts: Array<string | null | undefined>) => parts.filter((part) => Boolean(part && part.trim())).join(" ");

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "Unknown time";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown time";
  }

  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const matchesContains = (query: string, ...fields: Array<string | null | undefined>) => {
  const normalizedQuery = normalizeSearchToken(query);
  if (!normalizedQuery) {
    return true;
  }

  return fields.some((field) => normalizeSearchToken(field).includes(normalizedQuery));
};

const getMatchRank = (query: string, item: GlobalSearchResultItem) => {
  const normalizedQuery = normalizeSearchToken(query);
  if (!normalizedQuery) {
    return { rank: 99, secondaryRank: CATEGORY_WEIGHT[item.category] };
  }

  const normalizedTitle = normalizeSearchToken(item.title);
  const normalizedSubtitle = normalizeSearchToken(item.subtitle);
  const normalizedStatus = normalizeSearchToken(item.status);
  const combined = normalizeSearchToken(`${item.title} ${item.subtitle} ${item.status}`);

  if (normalizedTitle.startsWith(normalizedQuery)) {
    return { rank: 0, secondaryRank: CATEGORY_WEIGHT[item.category] };
  }

  if (normalizedSubtitle.startsWith(normalizedQuery)) {
    return { rank: 1, secondaryRank: CATEGORY_WEIGHT[item.category] };
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    return { rank: 2, secondaryRank: CATEGORY_WEIGHT[item.category] };
  }

  if (normalizedSubtitle.includes(normalizedQuery)) {
    return { rank: 3, secondaryRank: CATEGORY_WEIGHT[item.category] };
  }

  if (normalizedStatus.includes(normalizedQuery) || combined.includes(normalizedQuery)) {
    return { rank: 4, secondaryRank: CATEGORY_WEIGHT[item.category] };
  }

  return { rank: Number.POSITIVE_INFINITY, secondaryRank: Number.POSITIVE_INFINITY };
};

export const buildIlikePatterns = (query: string) => {
  const sanitized = sanitizeFilterToken(query);
  const compact = normalizeSearchToken(query);
  const tokens = [sanitized, compact].filter(Boolean);
  const deduped = Array.from(new Set(tokens));
  return deduped.map((token) => `%${token}%`);
};

export const buildIlikeOrFilter = (fields: string[], patterns: string[]) => {
  const conditions: string[] = [];
  for (const field of fields) {
    for (const pattern of patterns) {
      conditions.push(`${field}.ilike.${pattern}`);
    }
  }

  return conditions.join(",");
};

const groupResults = (items: GlobalSearchResultItem[]) => {
  const grouped = new Map<GlobalSearchCategory, GlobalSearchResultItem[]>();

  for (const item of items) {
    const bucket = grouped.get(item.category) ?? [];
    bucket.push(item);
    grouped.set(item.category, bucket);
  }

  const groups: GlobalSearchResultGroup[] = [];
  for (const [category, groupItems] of grouped.entries()) {
    groups.push({
      category,
      label: CATEGORY_LABELS[category],
      count: groupItems.length,
      items: groupItems,
    });
  }

  groups.sort((left, right) => CATEGORY_WEIGHT[left.category] - CATEGORY_WEIGHT[right.category]);
  return groups;
};

const toTrailersResults = (rows: TrailersRow[]): GlobalSearchResultItem[] => rows
  .map((row) => {
    const ownershipType = getTrailerOwnershipType({
      trailerSource: row.trailer_source,
      externalCompany: row.external_company,
      isLocal: row.is_local,
      trailerNumber: row.trailer_number,
    });

    const ownershipLabel = getTrailerOwnershipLabel(ownershipType);

    return {
      id: `trailer:${row.id}`,
      category: "trailers" as const,
      title: row.trailer_number?.trim() || "Trailer",
      subtitle: toSingleLine([row.customer, row.consignee, row.container_number, ownershipLabel]),
      status: row.operational_status ?? row.load_status ?? ownershipType,
      href: `/dashboard/trailers/${row.id}`,
      quickActionLabel: "Open trailer",
      metadata: {
        trailerId: row.id,
        compoundPosition: row.compound_position,
        ownershipType,
        trailerSource: row.trailer_source,
        externalCompany: row.external_company,
      },
    };
  })
  .filter((item) => Boolean(item.title));

const toCompoundResults = (rows: TrailersRow[]): GlobalSearchResultItem[] => rows
  .filter((row) => row.is_local !== true && Boolean(row.compound_position?.trim()))
  .map((row) => ({
    id: `compound:${row.id}`,
    category: "compound_positions" as const,
    title: row.compound_position?.trim() || "Compound position",
    subtitle: toSingleLine([row.trailer_number, row.customer]),
    status: row.operational_status ?? "in_compound",
    href: `/dashboard/trailers/${row.id}`,
    quickActionLabel: "Locate trailer",
    metadata: {
      trailerId: row.id,
    },
  }));

const toExportResults = (rows: ExportRow[]): GlobalSearchResultItem[] => rows
  .map((row) => ({
    id: `export:${row.id}`,
    category: "export_operations" as const,
    title: row.booking_reference?.trim() || row.trailer_number?.trim() || "Export allocation",
    subtitle: toSingleLine([row.customer, row.haulier, row.collection_address]),
    status: row.status,
    href: `/dashboard/export-operations/${row.id}`,
    quickActionLabel: "Open export allocation",
  }));

const toVesselOperationResults = (rows: VesselOperationRow[]): GlobalSearchResultItem[] => rows
  .map((row) => ({
    id: `vessel:${row.id}`,
    category: "vessel_operations" as const,
    title: row.vessel_name?.trim() || "Vessel operation",
    subtitle: toSingleLine([row.sailing_reference, row.expected_arrival_at ? `ETA ${formatDateTime(row.expected_arrival_at)}` : null]),
    status: row.status,
    href: `/dashboard/vessel-operations/${row.id}`,
    quickActionLabel: "Open vessel operation",
  }));

const toArrivalResults = (rows: VesselTrailerRow[]): GlobalSearchResultItem[] => rows
  .map((row) => ({
    id: `arrival:${row.id}`,
    category: "arrival_records" as const,
    title: row.trailer_number?.trim() || "Arrival record",
    subtitle: toSingleLine([row.customer, row.booking_reference]),
    status: row.arrival_status ?? "pending",
    href: `/dashboard/vessel-operations/${row.vessel_operation_id}/boat-check/${row.id}`,
    quickActionLabel: "Open arrival",
  }));

const toInspectionResults = (rows: VesselTrailerRow[]): GlobalSearchResultItem[] => rows
  .map((row) => ({
    id: `inspection:${row.id}`,
    category: "inspection_records" as const,
    title: row.trailer_number?.trim() || "Inspection record",
    subtitle: toSingleLine([row.customer, row.booking_reference]),
    status: row.inspection_completed_at ? "inspected" : "inspection_pending",
    href: `/dashboard/vessel-operations/${row.vessel_operation_id}/boat-check/${row.id}`,
    quickActionLabel: "Open inspection",
  }));

const toDamageResults = (rows: DamageRow[]): GlobalSearchResultItem[] => rows
  .map((row) => ({
    id: `damage:${row.id}`,
    category: "damage_reports" as const,
    title: row.trailer_number?.trim() || row.damage_type?.trim() || "Damage report",
    subtitle: toSingleLine([row.damage_type, row.damage_location, row.description]),
    status: row.severity ?? "reported",
    href: row.vessel_operation_id && row.vessel_trailer_id
      ? `/dashboard/vessel-operations/${row.vessel_operation_id}/boat-check/${row.vessel_trailer_id}`
      : "/dashboard/vessel-operations",
    quickActionLabel: "Open damage",
  }));

const toTemperatureResults = (
  rows: TemperatureRow[],
  vesselOperationByTrailerId: Map<string, string>,
): GlobalSearchResultItem[] => rows
  .map((row) => ({
    id: `temperature:${row.id}`,
    category: "temperature_records" as const,
    title: row.trailer_number?.trim() || "Temperature record",
    subtitle: toSingleLine([
      row.reading_point,
      row.temperature_value !== null ? `${row.temperature_value}${row.temperature_unit ?? "C"}` : null,
      row.recorded_at ? formatDateTime(row.recorded_at) : null,
    ]),
    status: row.is_out_of_range ? "out_of_range" : "normal",
    href: row.vessel_trailer_id && vesselOperationByTrailerId.get(row.vessel_trailer_id)
      ? `/dashboard/vessel-operations/${vesselOperationByTrailerId.get(row.vessel_trailer_id)}/boat-check/${row.vessel_trailer_id}`
      : "/dashboard/vessel-operations",
    quickActionLabel: "Open temperature",
  }));

const toPhotoResults = (rows: PhotoRow[]): GlobalSearchResultItem[] => rows
  .map((row) => ({
    id: `photo:${row.id}`,
    category: "photos" as const,
    title: row.trailer_number?.trim() || row.file_name?.trim() || "Inspection photo",
    subtitle: toSingleLine([row.category, row.description, row.uploaded_at ? formatDateTime(row.uploaded_at) : null]),
    status: "available",
    href: row.vessel_operation_id && row.vessel_trailer_id
      ? `/dashboard/vessel-operations/${row.vessel_operation_id}/boat-check/${row.vessel_trailer_id}`
      : "/dashboard/vessel-operations",
    quickActionLabel: "Open photo",
  }));

const toUserResults = (rows: UserRow[]): GlobalSearchResultItem[] => rows
  .map((row) => ({
    id: `user:${row.user_id}`,
    category: "users" as const,
    title: row.display_name?.trim() || row.email?.trim() || "User",
    subtitle: toSingleLine([row.email, row.role_key]),
    status: row.is_active ? "active" : "inactive",
    href: "/dashboard/settings/users",
    quickActionLabel: "Open user settings",
  }));

const toReportResults = (rows: ReportRow[]): GlobalSearchResultItem[] => rows
  .map((row) => ({
    id: `report:${row.id}`,
    category: "reports" as const,
    title: row.subject?.trim() || row.title?.trim() || row.report_number?.trim() || "Vessel report",
    subtitle: toSingleLine([row.report_number, row.generated_at ? formatDateTime(row.generated_at) : null]),
    status: row.report_status,
    href: `/dashboard/vessel-operations/${row.vessel_operation_id}/summary`,
    quickActionLabel: "Open report",
  }));

export const buildResponse = (
  query: string,
  limit: number,
  offset: number,
  rows: GlobalSearchResultItem[],
): GlobalSearchResponse => {
  const ranked: RankedResult[] = rows
    .map((item) => {
      const { rank, secondaryRank } = getMatchRank(query, item);
      return {
        ...item,
        rank,
        secondaryRank,
      };
    })
    .filter((item) => Number.isFinite(item.rank));

  ranked.sort((left, right) => {
    if (left.rank !== right.rank) {
      return left.rank - right.rank;
    }
    if (left.secondaryRank !== right.secondaryRank) {
      return left.secondaryRank - right.secondaryRank;
    }
    return left.title.localeCompare(right.title);
  });

  const totalMatched = ranked.length;
  const sliced = ranked.slice(offset, offset + limit).map((entry) => {
    const { rank, secondaryRank, ...item } = entry;
    void rank;
    void secondaryRank;
    return item;
  });
  const hasMore = offset + limit < totalMatched;

  return {
    query,
    normalizedQuery: normalizeSearchToken(query),
    limit,
    offset,
    totalMatched,
    hasMore,
    results: sliced,
    groups: groupResults(sliced),
  };
};

export async function searchGlobalIndex(
  supabase: SupabaseClient<Database>,
  options: SearchGlobalIndexOptions,
): Promise<GlobalSearchResponse> {
  const rawQuery = options.query ?? "";
  const query = rawQuery.trim();
  const limit = Math.max(1, Math.min(options.limit ?? GLOBAL_SEARCH_MAX_RESULTS, GLOBAL_SEARCH_MAX_RESULTS));
  const offset = Math.max(0, options.offset ?? 0);

  if (!query) {
    return {
      query: "",
      normalizedQuery: "",
      limit,
      offset,
      totalMatched: 0,
      hasMore: false,
      results: [],
      groups: [],
    };
  }

  const filterToken = sanitizeFilterToken(query);
  if (!filterToken) {
    return {
      query,
      normalizedQuery: normalizeSearchToken(query),
      limit,
      offset,
      totalMatched: 0,
      hasMore: false,
      results: [],
      groups: [],
    };
  }

  const sourceLimit = Math.min(40, Math.max(12, offset + limit + 6));
  const ilikePatterns = buildIlikePatterns(query);
  const trailerSearch = buildIlikeOrFilter(["trailer_number", "customer", "consignee", "container_number", "compound_position", "trailer_source", "external_company"], ilikePatterns);
  const exportSearch = buildIlikeOrFilter(["trailer_number", "customer", "booking_reference", "haulier", "collection_address"], ilikePatterns);
  const vesselOperationSearch = buildIlikeOrFilter(["vessel_name", "sailing_reference"], ilikePatterns);
  const vesselTrailerSearch = buildIlikeOrFilter(["trailer_number", "customer", "booking_reference", "arrival_status", "status"], ilikePatterns);
  const damageSearch = buildIlikeOrFilter(["trailer_number", "damage_type", "damage_location", "description", "severity"], ilikePatterns);
  const temperatureSearch = buildIlikeOrFilter(["trailer_number", "reading_point", "temperature_unit"], ilikePatterns);
  const photoSearch = buildIlikeOrFilter(["trailer_number", "category", "file_name", "description"], ilikePatterns);
  const userSearch = buildIlikeOrFilter(["email", "display_name", "role_key"], ilikePatterns);
  const reportSearch = buildIlikeOrFilter(["title", "subject", "report_number", "report_status"], ilikePatterns);

  const [
    trailersResult,
    exportsResult,
    operationsResult,
    vesselTrailersResult,
    damagesResult,
    temperaturesResult,
    photosResult,
    usersResult,
    reportsResult,
  ] = await Promise.all([
    supabase
      .from("trailers")
      .select("id, trailer_number, customer, consignee, container_number, compound_position, operational_status, load_status, trailer_source, external_company, is_local")
      .or(trailerSearch)
      .order("created_at", { ascending: false })
      .limit(sourceLimit),
    supabase
      .from("export_allocations")
      .select("id, trailer_number, customer, booking_reference, haulier, collection_address, status")
      .or(exportSearch)
      .order("updated_at", { ascending: false })
      .limit(sourceLimit),
    supabase
      .from("vessel_operations")
      .select("id, vessel_name, sailing_reference, status, expected_arrival_at, actual_arrival_at, updated_at")
      .or(vesselOperationSearch)
      .order("updated_at", { ascending: false })
      .limit(sourceLimit),
    supabase
      .from("vessel_operation_trailers")
      .select("id, vessel_operation_id, trailer_number, customer, booking_reference, arrival_status, inspection_completed_at")
      .or(vesselTrailerSearch)
      .order("updated_at", { ascending: false })
      .limit(sourceLimit),
    supabase
      .from("vessel_inspection_damages")
      .select("id, vessel_operation_id, vessel_trailer_id, trailer_number, damage_type, damage_location, severity, description")
      .or(damageSearch)
      .limit(sourceLimit),
    supabase
      .from("vessel_inspection_temperatures")
      .select("id, vessel_trailer_id, trailer_number, temperature_value, temperature_unit, reading_point, is_out_of_range, recorded_at")
      .or(temperatureSearch)
      .order("recorded_at", { ascending: false })
      .limit(sourceLimit),
    supabase
      .from("vessel_inspection_photos")
      .select("id, vessel_operation_id, vessel_trailer_id, trailer_number, category, file_name, description, uploaded_at")
      .or(photoSearch)
      .order("uploaded_at", { ascending: false })
      .limit(sourceLimit),
    supabase
      .from("app_user_roles")
      .select("user_id, email, display_name, role_key, is_active")
      .or(userSearch)
      .order("updated_at", { ascending: false })
      .limit(sourceLimit),
    supabase
      .from("vessel_operation_reports")
      .select("id, vessel_operation_id, title, subject, report_number, report_status, generated_at")
      .or(reportSearch)
      .order("generated_at", { ascending: false })
      .limit(sourceLimit),
  ]);

  const errors = [
    trailersResult.error,
    exportsResult.error,
    operationsResult.error,
    vesselTrailersResult.error,
    damagesResult.error,
    temperaturesResult.error,
    photosResult.error,
    usersResult.error,
    reportsResult.error,
  ].filter((error) => Boolean(error));

  if (errors.length > 0) {
    throw new Error(errors[0]?.message || "Unable to perform global search.");
  }

  const trailerRows = (trailersResult.data ?? []) as TrailersRow[];
  const exportRows = (exportsResult.data ?? []) as ExportRow[];
  const operationRows = (operationsResult.data ?? []) as VesselOperationRow[];
  const vesselTrailerRows = (vesselTrailersResult.data ?? []) as VesselTrailerRow[];
  const damageRows = (damagesResult.data ?? []) as DamageRow[];
  const temperatureRows = (temperaturesResult.data ?? []) as TemperatureRow[];
  const photoRows = (photosResult.data ?? []) as PhotoRow[];
  const userRows = (usersResult.data ?? []) as UserRow[];
  const reportRows = (reportsResult.data ?? []) as ReportRow[];

  const vesselOperationByTrailerId = new Map<string, string>();
  for (const row of vesselTrailerRows) {
    vesselOperationByTrailerId.set(row.id, row.vessel_operation_id);
  }

  const unresolvedTemperatureTrailerIds = Array.from(
    new Set(
      temperatureRows
        .map((row) => row.vessel_trailer_id)
        .filter((value): value is string => {
          if (!value) {
            return false;
          }

          return !vesselOperationByTrailerId.has(value);
        }),
    ),
  );

  if (unresolvedTemperatureTrailerIds.length > 0) {
    const vesselLookupResult = await supabase
      .from("vessel_operation_trailers")
      .select("id, vessel_operation_id")
      .in("id", unresolvedTemperatureTrailerIds.slice(0, sourceLimit));

    if (!vesselLookupResult.error) {
      for (const row of vesselLookupResult.data ?? []) {
        vesselOperationByTrailerId.set(row.id, row.vessel_operation_id);
      }
    }
  }

  const candidates = [
    ...toTrailersResults(trailerRows),
    ...toCompoundResults(trailerRows),
    ...toExportResults(exportRows),
    ...toVesselOperationResults(operationRows),
    ...toArrivalResults(vesselTrailerRows),
    ...toInspectionResults(vesselTrailerRows),
    ...toDamageResults(damageRows),
    ...toTemperatureResults(temperatureRows, vesselOperationByTrailerId),
    ...toPhotoResults(photoRows),
    ...toUserResults(userRows),
    ...toReportResults(reportRows),
  ].filter((item) => matchesContains(query, item.title, item.subtitle, item.status));

  return buildResponse(query, limit, offset, candidates);
}
