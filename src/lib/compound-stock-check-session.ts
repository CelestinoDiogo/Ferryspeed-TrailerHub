import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  isCancelledStockCheckStatus,
  isCompletedStockCheckStatus,
  isOpenStockCheckStatus,
  recountStockCheckObservationTotals,
  recountStockCheckResolutionTotals,
  type StockCheck,
  type StockCheckItem,
} from "@/lib/compound-stock-check";

type SessionSupabase = SupabaseClient<Database>;

export class StockCheckSessionError extends Error {
  status: number;
  code: "STOCK_CHECK_NOT_FOUND" | "STOCK_CHECK_NOT_OPEN" | "STOCK_CHECK_ALREADY_COMPLETED";

  constructor(
    message: string,
    code: "STOCK_CHECK_NOT_FOUND" | "STOCK_CHECK_NOT_OPEN" | "STOCK_CHECK_ALREADY_COMPLETED",
    status = 409,
  ) {
    super(message);
    this.name = "StockCheckSessionError";
    this.status = status;
    this.code = code;
  }
}

export const CLOSE_STOCK_CHECK_CONFIRMATION =
  "Closing this Stock Check preserves its results and allows a new check to be started.";

export type CancelCompoundStockCheckResult = {
  stockCheck: StockCheck;
  items: StockCheckItem[];
  alreadyCancelled: boolean;
};

export type CompleteCompoundStockCheckResult = {
  stockCheck: StockCheck;
  items: StockCheckItem[];
  alreadyCompleted: boolean;
  unresolvedCount: number;
};

export const STOCK_CHECK_SELECT =
  "id, status, started_at, completed_at, cancelled_at, started_by, completed_by, expected_total, checked_total, present_total, missing_total, unexpected_total, wrong_position_total, wrong_status_total, notes, created_at, updated_at";

export const STOCK_CHECK_ITEM_SELECT =
  "id, stock_check_id, trailer_id, trailer_number, expected_in_compound, physically_present, expected_position, actual_position, system_load_status, system_operational_status, discrepancy_type, checked_at, checked_by, resolution_status, resolution_action, resolved_at, resolved_by, notes, created_at, updated_at";

export const loadStockCheck = async (supabase: SessionSupabase, stockCheckId: string) => {
  const { data, error } = await supabase
    .from("compound_stock_checks")
    .select(STOCK_CHECK_SELECT)
    .eq("id", stockCheckId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to load stock check session.");
  }

  return (data ?? null) as StockCheck | null;
};

export const loadStockCheckItems = async (supabase: SessionSupabase, stockCheckId: string) => {
  const { data, error } = await supabase
    .from("compound_stock_check_items")
    .select(STOCK_CHECK_ITEM_SELECT)
    .eq("stock_check_id", stockCheckId)
    .order("expected_position", { ascending: true })
    .order("trailer_number", { ascending: true });

  if (error) {
    throw new Error(error.message || "Unable to load stock check items.");
  }

  return (data ?? []) as StockCheckItem[];
};

export async function cancelCompoundStockCheck(
  supabase: SessionSupabase,
  input: { stockCheckId: string; cancelledBy?: string | null },
): Promise<CancelCompoundStockCheckResult> {
  const session = await loadStockCheck(supabase, input.stockCheckId);
  if (!session) {
    throw new StockCheckSessionError("Stock check not found.", "STOCK_CHECK_NOT_FOUND", 404);
  }

  const items = await loadStockCheckItems(supabase, session.id);

  if (isCancelledStockCheckStatus(session.status)) {
    return { stockCheck: session, items, alreadyCancelled: true };
  }

  if (isCompletedStockCheckStatus(session.status)) {
    throw new StockCheckSessionError(
      "Completed stock checks are historical and cannot be closed or changed.",
      "STOCK_CHECK_ALREADY_COMPLETED",
      409,
    );
  }

  if (!isOpenStockCheckStatus(session.status)) {
    throw new StockCheckSessionError(
      "Only an in-progress stock check can be closed.",
      "STOCK_CHECK_NOT_OPEN",
      409,
    );
  }

  const nowIso = new Date().toISOString();
  const totals = recountStockCheckObservationTotals(items);
  const cancelledBy = input.cancelledBy?.trim() || null;
  const nextNotes = session.notes?.trim() ? session.notes : cancelledBy ? `Closed by ${cancelledBy}` : session.notes;

  const { data: updated, error: updateError } = await supabase
    .from("compound_stock_checks")
    .update({
      status: "cancelled",
      cancelled_at: nowIso,
      updated_at: nowIso,
      notes: nextNotes,
      checked_total: totals.checked_total,
      present_total: totals.present_total,
      missing_total: totals.missing_total,
      unexpected_total: totals.unexpected_total,
      wrong_position_total: totals.wrong_position_total,
      wrong_status_total: totals.wrong_status_total,
    })
    .eq("id", session.id)
    .eq("status", "in_progress")
    .select(STOCK_CHECK_SELECT)
    .maybeSingle();

  if (updateError) {
    throw new Error(updateError.message || "Unable to close stock check.");
  }

  if (updated) {
    return {
      stockCheck: updated as StockCheck,
      items,
      alreadyCancelled: false,
    };
  }

  const refreshed = await loadStockCheck(supabase, session.id);
  if (refreshed && isCancelledStockCheckStatus(refreshed.status)) {
    return { stockCheck: refreshed, items, alreadyCancelled: true };
  }

  if (refreshed && isCompletedStockCheckStatus(refreshed.status)) {
    throw new StockCheckSessionError(
      "Completed stock checks are historical and cannot be closed or changed.",
      "STOCK_CHECK_ALREADY_COMPLETED",
      409,
    );
  }

  throw new Error("Unable to close stock check.");
}

export const persistStockCheckObservationTotals = async (
  supabase: SessionSupabase,
  stockCheck: Pick<StockCheck, "id" | "expected_total">,
  items: StockCheckItem[],
) => {
  const totals = recountStockCheckObservationTotals(items);
  const { data, error } = await supabase
    .from("compound_stock_checks")
    .update({
      checked_total: totals.checked_total,
      present_total: totals.present_total,
      missing_total: totals.missing_total,
      unexpected_total: totals.unexpected_total,
      wrong_position_total: totals.wrong_position_total,
      wrong_status_total: totals.wrong_status_total,
      updated_at: new Date().toISOString(),
    })
    .eq("id", stockCheck.id)
    .select(STOCK_CHECK_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to update stock check totals.");
  }

  return (data ?? { ...stockCheck, ...totals }) as StockCheck;
};

export const requireOpenStockCheck = async (supabase: SessionSupabase, stockCheckId: string) => {
  const session = await loadStockCheck(supabase, stockCheckId);
  if (!session) {
    throw new StockCheckSessionError("Stock check not found.", "STOCK_CHECK_NOT_FOUND", 404);
  }
  if (isCompletedStockCheckStatus(session.status) || isCancelledStockCheckStatus(session.status)) {
    throw new StockCheckSessionError(
      "Historical stock checks are read-only and cannot be changed.",
      "STOCK_CHECK_ALREADY_COMPLETED",
      409,
    );
  }
  if (!isOpenStockCheckStatus(session.status)) {
    throw new StockCheckSessionError("Only an in-progress stock check can be changed.", "STOCK_CHECK_NOT_OPEN", 409);
  }
  const items = await loadStockCheckItems(supabase, session.id);
  return { session, items };
};

export const COMPLETE_STOCK_CHECK_CONFIRMATION =
  "Complete this physical Stock Check? Unresolved discrepancies can still be corrected afterwards from history only if the session remains open. Completing marks the physical audit as finished.";

export async function completeCompoundStockCheck(
  supabase: SessionSupabase,
  input: { stockCheckId: string; completedBy?: string | null },
): Promise<CompleteCompoundStockCheckResult> {
  const session = await loadStockCheck(supabase, input.stockCheckId);
  if (!session) {
    throw new StockCheckSessionError("Stock check not found.", "STOCK_CHECK_NOT_FOUND", 404);
  }

  const items = await loadStockCheckItems(supabase, session.id);
  const unresolvedCount = recountStockCheckResolutionTotals(items).unresolved_total;

  if (isCompletedStockCheckStatus(session.status)) {
    return { stockCheck: session, items, alreadyCompleted: true, unresolvedCount };
  }

  if (isCancelledStockCheckStatus(session.status)) {
    throw new StockCheckSessionError(
      "Cancelled stock checks are historical and cannot be completed.",
      "STOCK_CHECK_NOT_OPEN",
      409,
    );
  }

  if (!isOpenStockCheckStatus(session.status)) {
    throw new StockCheckSessionError(
      "Only an in-progress stock check can be completed.",
      "STOCK_CHECK_NOT_OPEN",
      409,
    );
  }

  const nowIso = new Date().toISOString();
  const totals = recountStockCheckObservationTotals(items);
  const completedBy = input.completedBy?.trim() || null;

  const { data: updated, error: updateError } = await supabase
    .from("compound_stock_checks")
    .update({
      status: "completed",
      completed_at: nowIso,
      completed_by: completedBy,
      updated_at: nowIso,
      checked_total: totals.checked_total,
      present_total: totals.present_total,
      missing_total: totals.missing_total,
      unexpected_total: totals.unexpected_total,
      wrong_position_total: totals.wrong_position_total,
      wrong_status_total: totals.wrong_status_total,
    })
    .eq("id", session.id)
    .eq("status", "in_progress")
    .select(STOCK_CHECK_SELECT)
    .maybeSingle();

  if (updateError) {
    throw new Error(updateError.message || "Unable to complete stock check.");
  }

  if (updated) {
    return {
      stockCheck: updated as StockCheck,
      items,
      alreadyCompleted: false,
      unresolvedCount,
    };
  }

  const refreshed = await loadStockCheck(supabase, session.id);
  if (refreshed && isCompletedStockCheckStatus(refreshed.status)) {
    return { stockCheck: refreshed, items, alreadyCompleted: true, unresolvedCount };
  }

  throw new Error("Unable to complete stock check.");
}
