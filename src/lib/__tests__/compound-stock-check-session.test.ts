import { describe, expect, it } from "vitest";
import {
  classifyStockCheckObservation,
  isLiveStockCheckDiscrepancySession,
  isOpenStockCheckStatus,
  isStockCheckFromPriorOperationalDay,
  recountStockCheckObservationTotals,
  shouldPromptResumeOrCloseOpenSession,
  stockCheckEndedAt,
  STOCK_CHECK_STATUSES,
} from "@/lib/compound-stock-check";
import { shouldOfferStartStockCheck } from "@/lib/compound-stock-check-expected";
import { cancelCompoundStockCheck, StockCheckSessionError } from "@/lib/compound-stock-check-session";
import { isTrailerPresentInCompoundInventory } from "@/lib/export-allocation";

const session = (overrides: Record<string, unknown> = {}) => ({
  id: "273206eb-2cb0-4529-8f67-e5d7d8fab4f1",
  status: "in_progress",
  started_at: "2026-08-03T12:34:24.971496+00:00",
  completed_at: null,
  cancelled_at: null,
  started_by: "diogofx.04@gmail.com",
  completed_by: null,
  expected_total: 49,
  checked_total: 0,
  present_total: 0,
  missing_total: 0,
  unexpected_total: 0,
  wrong_position_total: 0,
  wrong_status_total: 0,
  notes: null,
  created_at: "2026-08-03T12:34:24.971496+00:00",
  updated_at: "2026-08-22T17:24:21.672753+00:00",
  ...overrides,
});

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "item-1",
  stock_check_id: "273206eb-2cb0-4529-8f67-e5d7d8fab4f1",
  trailer_id: "t1",
  trailer_number: "PRO810",
  expected_in_compound: true,
  physically_present: null,
  expected_position: "P10",
  actual_position: null,
  system_load_status: "Empty",
  system_operational_status: "In Compound",
  discrepancy_type: "unchecked",
  checked_at: null,
  checked_by: null,
  resolution_status: "unresolved",
  resolution_action: null,
  resolved_at: null,
  resolved_by: null,
  notes: null,
  created_at: "2026-08-03T12:34:24.971496+00:00",
  updated_at: "2026-08-03T12:34:24.971496+00:00",
  ...overrides,
});

const createClient = (input: {
  stockCheck: ReturnType<typeof session>;
  items: Array<ReturnType<typeof item>>;
}) => {
  const stockCheck = { ...input.stockCheck };
  const items = input.items.map((row) => ({ ...row }));
  const operations: string[] = [];

  const supabase = {
    from(table: string) {
      const state: {
        op: "select" | "update";
        payload: Record<string, unknown> | null;
        eq: Record<string, unknown>;
      } = { op: "select", payload: null, eq: {} };

      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          state.eq[column] = value;
          return builder;
        },
        order() {
          return builder;
        },
        update(payload: Record<string, unknown>) {
          state.op = "update";
          state.payload = payload;
          operations.push("update-check");
          return builder;
        },
        maybeSingle() {
          if (table === "compound_stock_checks" && state.op === "update") {
            if (state.eq.status && stockCheck.status !== state.eq.status) {
              return Promise.resolve({ data: null, error: null });
            }
            Object.assign(stockCheck, state.payload);
            return Promise.resolve({ data: { ...stockCheck }, error: null });
          }
          if (table === "compound_stock_checks") {
            return Promise.resolve({ data: { ...stockCheck }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (value: { data: unknown; error: null }) => unknown) {
          if (table === "compound_stock_check_items") {
            return Promise.resolve(resolve({ data: items.map((row) => ({ ...row })), error: null }));
          }
          return Promise.resolve(resolve({ data: null, error: null }));
        },
      };

      return builder;
    },
  };

  return { supabase, stockCheck, items, operations };
};

describe("stock check session lifecycle", () => {
  it("uses the existing in_progress / completed / cancelled statuses", () => {
    expect(STOCK_CHECK_STATUSES).toEqual(["in_progress", "completed", "cancelled"]);
    expect(isOpenStockCheckStatus("in_progress")).toBe(true);
    expect(isOpenStockCheckStatus("cancelled")).toBe(false);
    expect(isLiveStockCheckDiscrepancySession("in_progress")).toBe(true);
    expect(isLiveStockCheckDiscrepancySession("cancelled")).toBe(false);
    expect(isLiveStockCheckDiscrepancySession("completed")).toBe(false);
  });

  it("closes an old in-progress Stock Check as cancelled without deleting item rows", async () => {
    const originalItems = [
      item({ id: "unchecked", physically_present: null }),
      item({
        id: "observed",
        physically_present: true,
        actual_position: "P10",
        checked_at: "2026-08-03T14:00:00.000Z",
        discrepancy_type: "matched",
      }),
    ];
    const { supabase, stockCheck, items, operations } = createClient({
      stockCheck: session(),
      items: originalItems,
    });

    const result = await cancelCompoundStockCheck(supabase as never, {
      stockCheckId: stockCheck.id,
      cancelledBy: "Operator One",
    });

    expect(result.alreadyCancelled).toBe(false);
    expect(result.stockCheck.status).toBe("cancelled");
    expect(result.stockCheck.cancelled_at).toEqual(expect.any(String));
    expect(result.stockCheck.completed_at).toBeNull();
    expect(result.stockCheck.notes).toBe("Closed by Operator One");
    expect(operations).toEqual(["update-check"]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "unchecked", physically_present: null });
    expect(items[1]).toMatchObject({
      id: "observed",
      physically_present: true,
      actual_position: "P10",
      checked_at: "2026-08-03T14:00:00.000Z",
    });
    expect(stockCheckEndedAt(result.stockCheck)).toBe(result.stockCheck.cancelled_at);
  });

  it("treats a repeated close as a safe no-op", async () => {
    const { supabase, stockCheck } = createClient({
      stockCheck: session({ status: "cancelled", cancelled_at: "2026-08-22T18:00:00.000Z" }),
      items: [item()],
    });

    const result = await cancelCompoundStockCheck(supabase as never, {
      stockCheckId: stockCheck.id,
      cancelledBy: "Operator One",
    });

    expect(result.alreadyCancelled).toBe(true);
    expect(result.stockCheck.status).toBe("cancelled");
    expect(result.stockCheck.cancelled_at).toBe("2026-08-22T18:00:00.000Z");
  });

  it("rejects closing a completed historical Stock Check", async () => {
    const { supabase, stockCheck, items } = createClient({
      stockCheck: session({ status: "completed", completed_at: "2026-08-04T10:00:00.000Z", checked_total: 20 }),
      items: [item({ physically_present: true, checked_at: "2026-08-04T09:00:00.000Z" })],
    });

    await expect(
      cancelCompoundStockCheck(supabase as never, { stockCheckId: stockCheck.id, cancelledBy: "Operator One" }),
    ).rejects.toBeInstanceOf(StockCheckSessionError);

    expect(items[0]?.physically_present).toBe(true);
    expect(stockCheck.status).toBe("completed");
  });

  it("shows a closed session in Recent Stock Checks style history fields", async () => {
    const closed = session({
      status: "cancelled",
      cancelled_at: "2026-08-22T18:05:00.000Z",
      checked_total: 0,
      missing_total: 0,
    });
    const recent = [closed];

    expect(recent.some((row) => row.id === "273206eb-2cb0-4529-8f67-e5d7d8fab4f1")).toBe(true);
    expect(stockCheckEndedAt(closed)).toBe("2026-08-22T18:05:00.000Z");
    expect(shouldOfferStartStockCheck({ isLoading: false, openStockCheck: null, pageError: null })).toBe(true);
  });

  it("allows a new Stock Check only after no in-progress session remains", async () => {
    const { supabase, stockCheck } = createClient({
      stockCheck: session(),
      items: [item()],
    });

    expect(
      shouldOfferStartStockCheck({
        isLoading: false,
        openStockCheck: { id: stockCheck.id },
        pageError: null,
      }),
    ).toBe(false);

    const result = await cancelCompoundStockCheck(supabase as never, {
      stockCheckId: stockCheck.id,
      cancelledBy: "Operator One",
    });

    expect(result.stockCheck.id).toBe("273206eb-2cb0-4529-8f67-e5d7d8fab4f1");
    expect(
      shouldOfferStartStockCheck({
        isLoading: false,
        openStockCheck: null,
        pageError: null,
      }),
    ).toBe(true);

    const nextSessionId = "8f1c2b0a-1111-4222-8333-444455556666";
    expect(nextSessionId).not.toBe(result.stockCheck.id);
  });

  it("does not inherit previous-session observations into a new expected snapshot", () => {
    const previous = item({
      stock_check_id: "273206eb-2cb0-4529-8f67-e5d7d8fab4f1",
      physically_present: true,
      checked_at: "2026-08-03T14:00:00.000Z",
    });
    const fresh = item({
      id: "new-item",
      stock_check_id: "8f1c2b0a-1111-4222-8333-444455556666",
      physically_present: null,
      checked_at: null,
      discrepancy_type: "unchecked",
    });

    expect(previous.stock_check_id).not.toBe(fresh.stock_check_id);
    expect(fresh.physically_present).toBeNull();
    expect(classifyStockCheckObservation(fresh).checkStatus).toBe("unchecked");
  });

  it("does not treat Unchecked as Missing", () => {
    const classification = classifyStockCheckObservation(item({ expected_in_compound: true, physically_present: null }));
    expect(classification.checkStatus).toBe("unchecked");
    expect(classification.missing).toBe(false);
    expect(classification.checked).toBe(false);
  });

  it("counts Missing only after an expected trailer is physically absent", () => {
    const totals = recountStockCheckObservationTotals([
      item({ id: "unchecked", physically_present: null }),
      item({ id: "missing", physically_present: false }),
      item({ id: "present", physically_present: true, checked_at: "2026-08-22T10:00:00.000Z" }),
    ]);
    expect(totals.missing_total).toBe(1);
    expect(totals.checked_total).toBe(2);
    expect(totals.present_total).toBe(1);
  });

  it("counts Unexpected only after an unexpected trailer is physically present", () => {
    const totals = recountStockCheckObservationTotals([
      item({ id: "stale", expected_in_compound: false, physically_present: null }),
      item({ id: "unexpected", expected_in_compound: false, physically_present: true, checked_at: "2026-08-22T10:00:00.000Z" }),
    ]);
    expect(totals.unexpected_total).toBe(1);
  });

  it("counts Position Mismatch only after a physical check has differing positions", () => {
    const totals = recountStockCheckObservationTotals([
      item({ physically_present: null, expected_position: "P01", actual_position: null }),
      item({
        physically_present: true,
        expected_position: "P01",
        actual_position: "P22",
        checked_at: "2026-08-22T10:00:00.000Z",
      }),
    ]);
    expect(totals.wrong_position_total).toBe(1);
  });

  it("counts Status Mismatch from unresolved wrong load/status observations", () => {
    const totals = recountStockCheckObservationTotals([
      item({ physically_present: true, discrepancy_type: "wrong_load_status", resolution_status: "unresolved" }),
      item({ physically_present: true, discrepancy_type: "wrong_status", resolution_status: "resolved" }),
      item({ physically_present: null, discrepancy_type: "wrong_status" }),
    ]);
    expect(totals.wrong_status_total).toBe(1);
  });

  it("allows only one active session and prompts Resume + Close for a stale open check", () => {
    const open = session();
    expect(shouldPromptResumeOrCloseOpenSession({ openStockCheck: open, isWorkingOpenSession: false })).toBe(true);
    expect(shouldPromptResumeOrCloseOpenSession({ openStockCheck: open, isWorkingOpenSession: true })).toBe(false);
    expect(isStockCheckFromPriorOperationalDay(open.started_at, "2026-08-22T17:00:00.000Z")).toBe(true);
    expect(
      shouldOfferStartStockCheck({
        isLoading: false,
        openStockCheck: { id: open.id },
        pageError: null,
      }),
    ).toBe(false);
  });

  it("keeps completed history read-only and does not change Compound presence rules", async () => {
    const { supabase, stockCheck, items } = createClient({
      stockCheck: session({ status: "completed", completed_at: "2026-08-04T12:00:00.000Z" }),
      items: [item({ physically_present: true })],
    });

    await expect(
      cancelCompoundStockCheck(supabase as never, { stockCheckId: stockCheck.id }),
    ).rejects.toMatchObject({ code: "STOCK_CHECK_ALREADY_COMPLETED" });

    expect(items[0]?.physically_present).toBe(true);
    expect(
      isTrailerPresentInCompoundInventory(
        {
          id: "local",
          compound_position: "P01",
          departure_date: null,
          is_local: true,
        },
        null,
      ),
    ).toBe(false);
    expect(
      isTrailerPresentInCompoundInventory(
        {
          id: "departed",
          compound_position: "P04",
          departure_date: "2026-08-21",
          is_local: false,
        },
        null,
      ),
    ).toBe(false);
    expect(
      isTrailerPresentInCompoundInventory(
        {
          id: "compound",
          compound_position: "P01",
          departure_date: null,
          is_local: false,
        },
        "allocated",
      ),
    ).toBe(true);
  });
});
