import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  buildActiveExportStatusByTrailerId,
  EXPORT_ACTIVE_STATUSES,
  isTrailerPresentInCompoundInventory,
} from "@/lib/export-allocation";
import type { StockCheck, StockCheckItem } from "@/lib/compound-stock-check";

type ReportSupabase = SupabaseClient<Database>;

const PAGE_SIZE = 1000;

export type CanonicalStockCheckTrailer = {
  id: string;
  trailer_number?: string | null;
  compound_position?: string | null;
  load_status?: string | null;
  operational_status?: string | null;
  departure_date?: string | null;
  is_local?: boolean | null;
};

export type StockCheckExpectedItemSnapshot = Pick<
  StockCheckItem,
  | "id"
  | "trailer_id"
  | "trailer_number"
  | "expected_in_compound"
  | "expected_position"
  | "physically_present"
  | "actual_position"
  | "checked_at"
  | "discrepancy_type"
  | "resolution_status"
  | "notes"
>;

export type OpenStockCheckExpectedReuseUpdate = {
  id: string;
  trailer: CanonicalStockCheckTrailer;
};

export type OpenStockCheckExpectedReconcilePlan = {
  unexpectIds: string[];
  preservedObservationIds: string[];
  reuseUpdates: OpenStockCheckExpectedReuseUpdate[];
  toInsert: CanonicalStockCheckTrailer[];
  expectedTotal: number;
};

export const normalizeStockCheckTrailerNumber = (value?: string | null) =>
  (value ?? "").trim().toUpperCase() || null;

export const shouldOfferStartStockCheck = ({
  isLoading,
  openStockCheck,
  pageError,
}: {
  isLoading: boolean;
  openStockCheck: Pick<StockCheck, "id"> | null;
  pageError: string | null;
}) => !isLoading && !openStockCheck && !pageError;

export const STOCK_CHECK_EXPECTED_PREDICATE =
  "isTrailerPresentInCompoundInventory: no departure_date, is_local !== true, valid P01-P50 position, export status not off-compound. ALLOCATED remains included.";

export const isCanonicalStockCheckExpectedTrailer = (
  trailer: CanonicalStockCheckTrailer,
  activeExportStatus?: string | null,
) =>
  isTrailerPresentInCompoundInventory(
    {
      id: trailer.id,
      compound_position: trailer.compound_position,
      departure_date: trailer.departure_date,
      is_local: trailer.is_local,
      operational_status: trailer.operational_status,
    },
    activeExportStatus,
  );

export const filterCanonicalStockCheckExpectedTrailers = (
  trailers: CanonicalStockCheckTrailer[],
  exportStatusByTrailerId: Map<string, string | null | undefined>,
) =>
  trailers.filter((trailer) =>
    isCanonicalStockCheckExpectedTrailer(trailer, exportStatusByTrailerId.get(trailer.id) ?? null),
  );

export const selectStaleStockCheckExpectedItems = <
  T extends Pick<StockCheckItem, "id" | "trailer_id" | "expected_in_compound">,
>(
  items: T[],
  canonicalTrailerIds: Set<string>,
) =>
  items.filter((item) => {
    if (item.expected_in_compound === false) {
      return false;
    }
    const trailerId = item.trailer_id?.trim();
    if (!trailerId) {
      return true;
    }
    return !canonicalTrailerIds.has(trailerId);
  });

export const hasPreservedStockCheckObservation = (item: StockCheckExpectedItemSnapshot) =>
  item.physically_present != null ||
  Boolean(item.actual_position?.trim()) ||
  Boolean(item.checked_at) ||
  (Boolean(item.discrepancy_type) && item.discrepancy_type !== "unchecked") ||
  (Boolean(item.resolution_status) && item.resolution_status !== "unresolved") ||
  Boolean(item.notes?.trim());

export const isVisibleOpenStockCheckWorkingItem = (
  item: Pick<StockCheckItem, "expected_in_compound" | "physically_present">,
) => item.expected_in_compound !== false || item.physically_present === true;

export function planOpenStockCheckExpectedReconcile(
  existingItems: StockCheckExpectedItemSnapshot[],
  canonicalTrailers: CanonicalStockCheckTrailer[],
): OpenStockCheckExpectedReconcilePlan {
  const existingByTrailerId = new Map<string, StockCheckExpectedItemSnapshot>();
  const existingByTrailerNumber = new Map<string, StockCheckExpectedItemSnapshot>();

  for (const item of existingItems) {
    const trailerId = item.trailer_id?.trim();
    if (trailerId && !existingByTrailerId.has(trailerId)) {
      existingByTrailerId.set(trailerId, item);
    }
    const trailerNumber = normalizeStockCheckTrailerNumber(item.trailer_number);
    if (trailerNumber && !existingByTrailerNumber.has(trailerNumber)) {
      existingByTrailerNumber.set(trailerNumber, item);
    }
  }

  const claimedItemIds = new Set<string>();
  const reuseUpdates: OpenStockCheckExpectedReuseUpdate[] = [];
  const toInsert: CanonicalStockCheckTrailer[] = [];

  for (const trailer of canonicalTrailers) {
    const trailerNumber = normalizeStockCheckTrailerNumber(trailer.trailer_number);
    const existing =
      existingByTrailerId.get(trailer.id) ?? (trailerNumber ? existingByTrailerNumber.get(trailerNumber) : undefined);

    if (existing && !claimedItemIds.has(existing.id)) {
      claimedItemIds.add(existing.id);
      const needsReuseUpdate =
        existing.expected_in_compound !== true ||
        (existing.trailer_id ?? null) !== trailer.id ||
        (existing.expected_position ?? null) !== (trailer.compound_position ?? null);
      if (needsReuseUpdate) {
        reuseUpdates.push({ id: existing.id, trailer });
      }
      continue;
    }

    toInsert.push(trailer);
  }

  const staleItems = existingItems.filter((item) => !claimedItemIds.has(item.id) && item.expected_in_compound !== false);

  return {
    unexpectIds: staleItems.map((item) => item.id),
    preservedObservationIds: staleItems.filter(hasPreservedStockCheckObservation).map((item) => item.id),
    reuseUpdates,
    toInsert,
    expectedTotal: canonicalTrailers.length,
  };
}

const fetchPaged = async <T,>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) => {
  const rows: T[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await loadPage(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(error.message);
    }
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) {
      break;
    }
    from += PAGE_SIZE;
  }

  return rows;
};

export async function loadCanonicalStockCheckExpectedTrailers(
  supabase: ReportSupabase,
): Promise<CanonicalStockCheckTrailer[]> {
  const [trailers, allocations] = await Promise.all([
    fetchPaged((from, to) =>
      supabase
        .from("trailers")
        .select("id, trailer_number, compound_position, load_status, operational_status, departure_date, is_local")
        .range(from, to),
    ),
    fetchPaged((from, to) =>
      supabase
        .from("export_allocations")
        .select("id, trailer_id, status, updated_at")
        .in("status", Array.from(EXPORT_ACTIVE_STATUSES))
        .range(from, to),
    ),
  ]);

  const statusByTrailerId = buildActiveExportStatusByTrailerId(allocations);
  return filterCanonicalStockCheckExpectedTrailers(trailers, statusByTrailerId);
}

export async function syncOpenStockCheckExpectedStock(
  supabase: ReportSupabase,
  stockCheck: Pick<StockCheck, "id" | "status">,
): Promise<StockCheck> {
  if (stockCheck.status !== "in_progress") {
    const { data, error } = await supabase
      .from("compound_stock_checks")
      .select("*")
      .eq("id", stockCheck.id)
      .maybeSingle();
    if (error) {
      throw new Error(error.message);
    }
    return (data ?? stockCheck) as StockCheck;
  }

  const [canonicalTrailers, existingItems] = await Promise.all([
    loadCanonicalStockCheckExpectedTrailers(supabase),
    fetchPaged((from, to) =>
      supabase
        .from("compound_stock_check_items")
        .select(
          "id, stock_check_id, trailer_id, trailer_number, expected_in_compound, physically_present, expected_position, actual_position, system_load_status, system_operational_status, discrepancy_type, checked_at, checked_by, resolution_status, resolution_action, resolved_at, resolved_by, notes, created_at, updated_at",
        )
        .eq("stock_check_id", stockCheck.id)
        .range(from, to),
    ),
  ]);

  const plan = planOpenStockCheckExpectedReconcile(existingItems, canonicalTrailers);

  if (plan.unexpectIds.length > 0) {
    const { error } = await supabase
      .from("compound_stock_check_items")
      .update({ expected_in_compound: false })
      .eq("stock_check_id", stockCheck.id)
      .in("id", plan.unexpectIds);
    if (error) {
      throw new Error(error.message);
    }
  }

  for (const reuse of plan.reuseUpdates) {
    const { error } = await supabase
      .from("compound_stock_check_items")
      .update({
        expected_in_compound: true,
        trailer_id: reuse.trailer.id,
        trailer_number: normalizeStockCheckTrailerNumber(reuse.trailer.trailer_number),
        expected_position: reuse.trailer.compound_position ?? null,
        system_load_status: reuse.trailer.load_status ?? null,
        system_operational_status: reuse.trailer.operational_status ?? null,
      })
      .eq("stock_check_id", stockCheck.id)
      .eq("id", reuse.id);
    if (error) {
      throw new Error(error.message);
    }
  }

  if (plan.toInsert.length > 0) {
    const { error } = await supabase.from("compound_stock_check_items").insert(
      plan.toInsert.map((trailer) => ({
        stock_check_id: stockCheck.id,
        trailer_id: trailer.id,
        trailer_number: normalizeStockCheckTrailerNumber(trailer.trailer_number),
        expected_in_compound: true,
        physically_present: null,
        expected_position: trailer.compound_position ?? null,
        actual_position: null,
        system_load_status: trailer.load_status ?? null,
        system_operational_status: trailer.operational_status ?? null,
        discrepancy_type: "unchecked",
        resolution_status: "unresolved",
      })),
    );
    if (error) {
      throw new Error(error.message);
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from("compound_stock_checks")
    .update({ expected_total: plan.expectedTotal })
    .eq("id", stockCheck.id)
    .select("*")
    .maybeSingle();

  if (updateError) {
    throw new Error(updateError.message);
  }

  return (updated ?? { ...stockCheck, expected_total: plan.expectedTotal }) as StockCheck;
}
