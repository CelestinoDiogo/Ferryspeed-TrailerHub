import { describe, expect, it } from "vitest";
import { isTrailerPresentInCompoundInventory } from "@/lib/export-allocation";
import {
  filterCanonicalStockCheckExpectedTrailers,
  hasPreservedStockCheckObservation,
  isCanonicalStockCheckExpectedTrailer,
  isVisibleOpenStockCheckWorkingItem,
  planOpenStockCheckExpectedReconcile,
  selectStaleStockCheckExpectedItems,
  shouldOfferStartStockCheck,
  syncOpenStockCheckExpectedStock,
} from "@/lib/compound-stock-check-expected";

const trailer = (overrides: Record<string, unknown> = {}) => ({
  id: "t1",
  trailer_number: "PRO810",
  compound_position: "P10",
  load_status: "empty",
  operational_status: "In Compound",
  departure_date: null,
  is_local: false,
  ...overrides,
});

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "item-1",
  trailer_id: "t1",
  trailer_number: "PRO810",
  expected_in_compound: true,
  expected_position: "P10",
  physically_present: null,
  actual_position: null,
  checked_at: null,
  discrepancy_type: "unchecked",
  resolution_status: "unresolved",
  notes: null,
  ...overrides,
});

describe("canonical Stock Check expected stock", () => {
  it("includes a current Compound trailer", () => {
    expect(isCanonicalStockCheckExpectedTrailer(trailer())).toBe(true);
    expect(isCanonicalStockCheckExpectedTrailer(trailer({ load_status: "loaded" }))).toBe(true);
  });

  it("excludes a departed trailer", () => {
    expect(isCanonicalStockCheckExpectedTrailer(trailer({ departure_date: "2026-08-22" }))).toBe(false);
  });

  it("excludes a departed trailer with a stale compound_position", () => {
    expect(
      isCanonicalStockCheckExpectedTrailer(
        trailer({ departure_date: "2026-08-21", compound_position: "P04" }),
      ),
    ).toBe(false);
  });

  it("excludes Local trailers from Main Compound stock", () => {
    expect(isCanonicalStockCheckExpectedTrailer(trailer({ is_local: true, compound_position: "P12" }))).toBe(false);
  });

  it("keeps Export ALLOCATED trailers that are still physically present", () => {
    expect(isCanonicalStockCheckExpectedTrailer(trailer(), "allocated")).toBe(true);
  });

  it("excludes physically off-compound export statuses", () => {
    expect(isCanonicalStockCheckExpectedTrailer(trailer(), "delivered_empty")).toBe(false);
    expect(isCanonicalStockCheckExpectedTrailer(trailer(), "waiting_loading")).toBe(false);
    expect(isCanonicalStockCheckExpectedTrailer(trailer(), "collected_loaded")).toBe(false);
    expect(isCanonicalStockCheckExpectedTrailer(trailer(), "completed")).toBe(false);
  });

  it("does not treat a stale position alone as presence", () => {
    expect(isCanonicalStockCheckExpectedTrailer(trailer({ compound_position: "BAY 4" }))).toBe(false);
  });

  it("does not resurrect departed trailers from an old Stock Check snapshot", () => {
    const canonical = filterCanonicalStockCheckExpectedTrailers(
      [
        trailer({ id: "present" }),
        trailer({ id: "departed", departure_date: "2026-08-03", compound_position: "P01" }),
      ],
      new Map(),
    );
    const stale = selectStaleStockCheckExpectedItems(
      [
        { id: "item-present", trailer_id: "present", expected_in_compound: true },
        { id: "item-departed", trailer_id: "departed", expected_in_compound: true },
        { id: "item-unexpected", trailer_id: "ghost", expected_in_compound: false },
      ],
      new Set(canonical.map((row) => row.id)),
    );

    expect(canonical.map((row) => row.id)).toEqual(["present"]);
    expect(stale.map((row) => row.id)).toEqual(["item-departed"]);
  });
});

describe("open Stock Check expected reconcile (3 Aug stale-session)", () => {
  it("A-D: a trailer valid at start that later departs is no longer expected, while the recorded observation remains", () => {
    const observedDeparted = item({
      id: "item-departed-observed",
      trailer_id: "departed-observed",
      expected_in_compound: true,
      physically_present: true,
      actual_position: "P04",
      checked_at: "2026-08-03T10:15:00.000Z",
      discrepancy_type: null,
      resolution_status: "unresolved",
    });
    const uncheckedDeparted = item({
      id: "item-departed-unchecked",
      trailer_id: "departed-unchecked",
      expected_in_compound: true,
    });
    const stillPresent = item({
      id: "item-present",
      trailer_id: "present",
      trailer_number: "PRO810",
      expected_in_compound: true,
    });

    const plan = planOpenStockCheckExpectedReconcile(
      [observedDeparted, uncheckedDeparted, stillPresent],
      [trailer({ id: "present", compound_position: "P10" })],
    );

    expect(plan.unexpectIds).toEqual(["item-departed-observed", "item-departed-unchecked"]);
    expect(plan.preservedObservationIds).toEqual(["item-departed-observed"]);
    expect(hasPreservedStockCheckObservation(observedDeparted)).toBe(true);
    expect(hasPreservedStockCheckObservation(uncheckedDeparted)).toBe(false);
    expect(plan.toInsert).toEqual([]);
    expect(plan.expectedTotal).toBe(1);
    expect(isVisibleOpenStockCheckWorkingItem({ expected_in_compound: false, physically_present: true })).toBe(true);
    expect(isVisibleOpenStockCheckWorkingItem({ expected_in_compound: false, physically_present: null })).toBe(false);
  });

  it("inserts newly valid current Compound trailers as unchecked expected rows", () => {
    const plan = planOpenStockCheckExpectedReconcile(
      [item({ id: "item-old", trailer_id: "old", expected_in_compound: true })],
      [trailer({ id: "old" }), trailer({ id: "new-arrival", trailer_number: "PRO900", compound_position: "P11" })],
    );

    expect(plan.toInsert.map((row) => row.id)).toEqual(["new-arrival"]);
    expect(plan.unexpectIds).toEqual([]);
    expect(plan.expectedTotal).toBe(2);
  });

  it("reuses an existing historical row when the same trailer number is currently canonical", () => {
    const historical = item({
      id: "item-fab12",
      trailer_id: "fa068123-departed",
      trailer_number: "FAB12",
      expected_in_compound: false,
      physically_present: true,
      actual_position: "P27",
      checked_at: "2026-08-03T09:00:00.000Z",
      notes: "seen on 3 Aug",
    });
    const plan = planOpenStockCheckExpectedReconcile(
      [historical],
      [trailer({ id: "0961e6ad-current", trailer_number: "FAB12", compound_position: "P27" })],
    );

    expect(plan.toInsert).toEqual([]);
    expect(plan.unexpectIds).toEqual([]);
    expect(plan.reuseUpdates).toEqual([
      {
        id: "item-fab12",
        trailer: expect.objectContaining({ id: "0961e6ad-current", trailer_number: "FAB12" }),
      },
    ]);
    expect(plan.expectedTotal).toBe(1);
  });

  it("is idempotent when current expected stock already matches canonical inventory", () => {
    const current = item({
      id: "item-current",
      trailer_id: "current",
      trailer_number: "PRO810",
      expected_in_compound: true,
      expected_position: "P10",
    });
    const stale = item({
      id: "item-stale",
      trailer_id: "departed",
      trailer_number: "OLD99",
      expected_in_compound: false,
    });
    const first = planOpenStockCheckExpectedReconcile(
      [current, stale],
      [trailer({ id: "current", trailer_number: "PRO810", compound_position: "P10" })],
    );
    const second = planOpenStockCheckExpectedReconcile(
      [current, stale],
      [trailer({ id: "current", trailer_number: "PRO810", compound_position: "P10" })],
    );

    expect(first).toEqual(second);
    expect(first.toInsert).toEqual([]);
    expect(first.unexpectIds).toEqual([]);
    expect(first.reuseUpdates).toEqual([]);
    expect(first.expectedTotal).toBe(1);
  });

  it("does not offer Start Stock Check when an in-progress session failed to reconcile", () => {
    expect(
      shouldOfferStartStockCheck({
        isLoading: false,
        openStockCheck: { id: "273206eb-2cb0-4529-8f67-e5d7d8fab4f1" },
        pageError: 'duplicate key value violates unique constraint "compound_stock_check_items_stock_check_id_trailer_number_key"',
      }),
    ).toBe(false);
    expect(
      shouldOfferStartStockCheck({
        isLoading: false,
        openStockCheck: null,
        pageError: "Unable to load stock check data.",
      }),
    ).toBe(false);
    expect(shouldOfferStartStockCheck({ isLoading: false, openStockCheck: null, pageError: null })).toBe(true);
  });

  it("E: Local trailers stay out of current expected stock", () => {
    expect(isCanonicalStockCheckExpectedTrailer(trailer({ is_local: true, compound_position: "P08" }))).toBe(false);
    const plan = planOpenStockCheckExpectedReconcile(
      [item({ trailer_id: "local-1", expected_in_compound: true })],
      [],
    );
    expect(plan.unexpectIds).toEqual(["item-1"]);
    expect(plan.expectedTotal).toBe(0);
  });

  it("I/J: off-compound Export is excluded and ALLOCATED physical presence remains included", () => {
    const allocated = trailer({ id: "allocated" });
    const deliveredEmpty = trailer({ id: "off-compound" });
    const canonical = filterCanonicalStockCheckExpectedTrailers(
      [allocated, deliveredEmpty],
      new Map([
        ["allocated", "allocated"],
        ["off-compound", "delivered_empty"],
      ]),
    );

    expect(canonical.map((row) => row.id)).toEqual(["allocated"]);
  });

  it("L: a fresh Stock Check expected set is current canonical stock only", () => {
    const canonical = filterCanonicalStockCheckExpectedTrailers(
      [
        trailer({ id: "compound" }),
        trailer({ id: "local", is_local: true, compound_position: "P02" }),
        trailer({ id: "departed", departure_date: "2026-08-03", compound_position: "P03" }),
        trailer({ id: "waiting", compound_position: null }),
      ],
      new Map(),
    );

    expect(canonical.map((row) => row.id)).toEqual(["compound"]);
  });

  it("M: a stale compound_position cannot resurrect a departed trailer", () => {
    expect(
      isTrailerPresentInCompoundInventory(
        trailer({ departure_date: "2026-08-04", compound_position: "P22" }),
        null,
      ),
    ).toBe(false);
  });
});

describe("syncOpenStockCheckExpectedStock", () => {
  const createClient = (input: {
    stockCheck: { id: string; status: string; expected_total?: number };
    trailers: ReturnType<typeof trailer>[];
    items: Array<Record<string, unknown>>;
    allocations?: Array<{ trailer_id: string; status: string }>;
  }) => {
    const stockCheck = { ...input.stockCheck };
    const items = input.items.map((row) => ({ ...row }));
    const operations: string[] = [];

    const supabase = {
      from(table: string) {
        const state: {
          op: "select" | "update" | "insert" | "delete";
          payload: Record<string, unknown> | Array<Record<string, unknown>> | null;
          eq: Record<string, unknown>;
          inIds: string[] | null;
        } = { op: "select", payload: null, eq: {}, inIds: null };

        const builder = {
          select() {
            return builder;
          },
          in(column: string, values: string[]) {
            if (column === "id") {
              state.inIds = values;
            }
            return builder;
          },
          eq(column: string, value: unknown) {
            state.eq[column] = value;
            return builder;
          },
          range() {
            if (table === "trailers") {
              return Promise.resolve({ data: input.trailers, error: null });
            }
            if (table === "export_allocations") {
              return Promise.resolve({ data: input.allocations ?? [], error: null });
            }
            if (table === "compound_stock_check_items") {
              return Promise.resolve({ data: items, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          },
          update(payload: Record<string, unknown>) {
            state.op = "update";
            state.payload = payload;
            return builder;
          },
          insert(payload: Array<Record<string, unknown>>) {
            state.op = "insert";
            state.payload = payload;
            operations.push("insert");
            for (const row of payload) {
              const number = String(row.trailer_number ?? "").trim().toUpperCase();
              if (
                number &&
                items.some(
                  (existing) =>
                    String(existing.trailer_number ?? "").trim().toUpperCase() === number,
                )
              ) {
                operations.push("duplicate-key");
                return Promise.resolve({
                  data: null,
                  error: { message: 'duplicate key value violates unique constraint "compound_stock_check_items_stock_check_id_trailer_number_key"' },
                });
              }
            }
            items.push(...payload);
            return Promise.resolve({ data: payload, error: null });
          },
          delete() {
            state.op = "delete";
            operations.push("delete");
            return builder;
          },
          maybeSingle() {
            if (table === "compound_stock_checks") {
              if (state.op === "update" && state.payload && !Array.isArray(state.payload)) {
                Object.assign(stockCheck, state.payload);
                operations.push("update-check");
              }
              return Promise.resolve({ data: stockCheck, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve: (value: { data: unknown; error: null }) => unknown) {
            if (table === "compound_stock_check_items" && state.op === "update") {
              operations.push("update-items");
              const payload = state.payload as Record<string, unknown>;
              const targetIds = state.inIds ?? (typeof state.eq.id === "string" ? [state.eq.id] : []);
              for (const row of items) {
                if (targetIds.includes(String(row.id))) {
                  Object.assign(row, payload);
                }
              }
            }
            if (state.op === "delete") {
              operations.push("delete-applied");
            }
            return Promise.resolve(resolve({ data: null, error: null }));
          },
        };

        return builder;
      },
    };

    return { supabase, stockCheck, items, operations };
  };

  it("K: completed historical Stock Checks remain unchanged", async () => {
    const completed = {
      id: "check-completed",
      status: "completed",
      expected_total: 33,
    };
    const { supabase, items, operations } = createClient({
      stockCheck: completed,
      trailers: [trailer({ id: "present" })],
      items: [
        item({
          id: "historical-row",
          trailer_id: "departed",
          expected_in_compound: true,
          physically_present: true,
        }),
      ],
    });

    const result = await syncOpenStockCheckExpectedStock(supabase as never, completed);

    expect(result.expected_total).toBe(33);
    expect(items[0]?.expected_in_compound).toBe(true);
    expect(operations).toEqual([]);
  });

  it("reconciles an open 3 Aug-style session without deleting recorded observations", async () => {
    const openCheck = { id: "273206eb-2cb0-4529-8f67-e5d7d8fab4f1", status: "in_progress", expected_total: 33 };
    const { supabase, stockCheck, items, operations } = createClient({
      stockCheck: openCheck,
      trailers: [
        trailer({ id: "still-here", compound_position: "P10" }),
        trailer({ id: "departed-observed", departure_date: "2026-08-04", compound_position: "P04" }),
      ],
      items: [
        item({
          id: "item-observed",
          trailer_id: "departed-observed",
          expected_in_compound: true,
          physically_present: true,
          actual_position: "P04",
          checked_at: "2026-08-03T09:00:00.000Z",
        }),
        item({
          id: "item-present",
          trailer_id: "still-here",
          expected_in_compound: true,
        }),
      ],
    });

    const result = await syncOpenStockCheckExpectedStock(supabase as never, openCheck);

    expect(operations).not.toContain("delete");
    expect(operations).not.toContain("delete-applied");
    expect(items.find((row) => row.id === "item-observed")).toMatchObject({
      expected_in_compound: false,
      physically_present: true,
      actual_position: "P04",
      checked_at: "2026-08-03T09:00:00.000Z",
    });
    expect(items.find((row) => row.id === "item-present")?.expected_in_compound).toBe(true);
    expect(result.expected_total).toBe(1);
    expect(stockCheck.expected_total).toBe(1);
  });

  it("reuses FAB12 by trailer number instead of inserting a duplicate-key row", async () => {
    const openCheck = { id: "273206eb-2cb0-4529-8f67-e5d7d8fab4f1", status: "in_progress", expected_total: 33 };
    const { supabase, items, operations } = createClient({
      stockCheck: openCheck,
      trailers: [trailer({ id: "0961e6ad-current", trailer_number: "FAB12", compound_position: "P27" })],
      items: [
        item({
          id: "item-fab12",
          trailer_id: "fa068123-departed",
          trailer_number: "FAB12",
          expected_in_compound: false,
          physically_present: true,
          actual_position: "P27",
          checked_at: "2026-08-03T09:00:00.000Z",
          notes: "seen on 3 Aug",
        }),
      ],
    });

    const first = await syncOpenStockCheckExpectedStock(supabase as never, openCheck);
    const second = await syncOpenStockCheckExpectedStock(supabase as never, openCheck);

    expect(operations).not.toContain("duplicate-key");
    expect(operations.filter((operation) => operation === "insert")).toHaveLength(0);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "item-fab12",
      trailer_id: "0961e6ad-current",
      expected_in_compound: true,
      physically_present: true,
      actual_position: "P27",
      checked_at: "2026-08-03T09:00:00.000Z",
      notes: "seen on 3 Aug",
    });
    expect(first.expected_total).toBe(1);
    expect(second.expected_total).toBe(1);
  });
});
