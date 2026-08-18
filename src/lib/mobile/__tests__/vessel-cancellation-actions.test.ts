import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeMobileAction } from "@/lib/mobile/mobile-actions-service";

const { createTrailerActivityMock } = vi.hoisted(() => ({
  createTrailerActivityMock: vi.fn(),
}));

vi.mock("@/lib/trailer-activity", () => ({
  createTrailerActivity: createTrailerActivityMock,
}));

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Filter = { column: string; values: unknown[] };

class QueryMock implements PromiseLike<{ data: Row[]; error: null }> {
  private filters: Filter[] = [];
  private updatePatch: Row | null = null;
  private insertRows: Row[] | null = null;

  constructor(
    private readonly table: string,
    private readonly tables: Tables,
    private readonly calls: string[],
  ) {
    calls.push(table);
  }

  select() {
    return this;
  }

  update(patch: Row) {
    this.updatePatch = patch;
    return this;
  }

  insert(rows: Row | Row[]) {
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, values: [value] });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push({ column, values });
    return this;
  }

  private matchingRows() {
    return (this.tables[this.table] ?? []).filter((row) =>
      this.filters.every((filter) => filter.values.includes(row[filter.column])),
    );
  }

  private execute() {
    if (this.insertRows) {
      this.tables[this.table] ??= [];
      this.tables[this.table].push(...this.insertRows);
      return { data: this.insertRows, error: null };
    }

    const rows = this.matchingRows();
    if (this.updatePatch) {
      rows.forEach((row) => Object.assign(row, this.updatePatch));
    }
    return { data: rows, error: null };
  }

  async maybeSingle() {
    const result = this.execute();
    return { data: result.data[0] ?? null, error: null };
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

const makeState = (overrides: Row = {}) => {
  const tables: Tables = {
    vessel_operations: [{ id: "11111111-1111-4111-8111-111111111111", status: "confirmed", list_status: "confirmed", final_locked_at: null }],
    vessel_operation_trailers: [{
      id: "22222222-2222-4222-8222-222222222222",
      vessel_operation_id: "11111111-1111-4111-8111-111111111111",
      trailer_id: "33333333-3333-4333-8333-333333333333",
      trailer_number: "PFC01",
      customer: "Customer A",
      load_status: "Loaded",
      status: "expected",
      arrival_status: "available_for_arrival",
      arrival_record_id: null,
      inspection_started_at: null,
      inspection_completed_at: null,
      ownership_type: "outsourcing",
      priority_level: "priority",
      planning_notes: "Historical plan",
      cancelled_at: null,
      cancelled_by: null,
      cancellation_reason: null,
      no_show_at: null,
      no_show_by: null,
      no_show_reason: null,
      has_damage: false,
      has_temperature_alert: false,
      ...overrides,
    }],
    trailer_events: [],
  };
  const calls: string[] = [];
  const supabase = {
    from: (table: string) => new QueryMock(table, tables, calls),
  } as never;
  return { supabase, tables, calls };
};

const user = {
  id: "44444444-4444-4444-8444-444444444444",
  email: "supervisor@example.com",
  user_metadata: { full_name: "Supervisor One" },
} as never;

const cancelAction = {
  actionType: "MARK_CANCELLED" as const,
  payload: {
    vesselTrailerId: "22222222-2222-4222-8222-222222222222",
    trailerNumber: "PFC01",
    reason: "Changed sailing",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  createTrailerActivityMock.mockResolvedValue(undefined);
});

describe("authoritative vessel cancellation actions", () => {
  it("cancels one operation row without changing global or planning state", async () => {
    const state = makeState();

    const result = await executeMobileAction(state.supabase, user, cancelAction);
    const row = state.tables.vessel_operation_trailers[0];

    expect(result.status).toBe("success");
    expect(row).toMatchObject({
      arrival_status: "cancelled",
      status: "not_arrived",
      cancellation_reason: "Changed sailing",
      load_status: "Loaded",
      ownership_type: "outsourcing",
      priority_level: "priority",
      planning_notes: "Historical plan",
    });
    expect(state.calls).not.toContain("trailers");
    expect(state.tables.trailer_events).toHaveLength(1);
    expect(state.tables.trailer_events[0]?.event_type).toBe("vessel_trailer_cancelled");
    expect(createTrailerActivityMock).toHaveBeenCalledTimes(1);
  });

  it("treats duplicate cancel as idempotent without duplicate history", async () => {
    const state = makeState({ status: "not_arrived", arrival_status: "cancelled", cancellation_reason: "Changed sailing" });

    const result = await executeMobileAction(state.supabase, user, cancelAction);

    expect(result.status).toBe("success");
    expect(result.message).toContain("already marked Cancelled");
    expect(state.tables.trailer_events).toHaveLength(0);
    expect(createTrailerActivityMock).not.toHaveBeenCalled();
  });

  it("rejects cancellation after arrival or reception", async () => {
    const arrived = makeState({ status: "arrived", arrival_status: "arrived" });
    const received = makeState({ status: "arrived", arrival_status: "arrived", arrival_record_id: "33333333-3333-4333-8333-333333333333" });

    const arrivedResult = await executeMobileAction(arrived.supabase, user, cancelAction);
    const receivedResult = await executeMobileAction(received.supabase, user, cancelAction);

    expect(arrivedResult.status).toBe("conflict");
    expect(arrivedResult.conflict?.code).toBe("arrival_already_started");
    expect(receivedResult.status).toBe("conflict");
    expect(received.tables.trailer_events).toHaveLength(0);
  });

  it("rejects stale arrival after cancellation and records undo separately", async () => {
    const state = makeState();

    const cancelled = await executeMobileAction(state.supabase, user, cancelAction);
    const staleArrival = await executeMobileAction(state.supabase, user, {
      actionType: "MARK_ARRIVED",
      payload: {
        vesselTrailerId: "22222222-2222-4222-8222-222222222222",
        trailerNumber: "PFC01",
        operationId: "11111111-1111-4111-8111-111111111111",
      },
    });
    const undone = await executeMobileAction(state.supabase, user, {
      actionType: "UNDO_CANCELLED",
      payload: {
        vesselTrailerId: "22222222-2222-4222-8222-222222222222",
        trailerNumber: "PFC01",
      },
    });

    expect(cancelled.status).toBe("success");
    expect(staleArrival.status).toBe("conflict");
    expect(undone.status).toBe("success");
    expect(state.tables.vessel_operation_trailers[0]).toMatchObject({
      arrival_status: "available_for_arrival",
      status: "expected",
      cancellation_reason: null,
      load_status: "Loaded",
      ownership_type: "outsourcing",
      priority_level: "priority",
      planning_notes: "Historical plan",
    });
    expect(state.tables.trailer_events.map((row) => row.event_type)).toEqual([
      "vessel_trailer_cancelled",
      "vessel_trailer_cancelled_undo",
    ]);
  });
});
