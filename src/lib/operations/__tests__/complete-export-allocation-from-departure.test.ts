import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  completeExportAllocationFromConfirmedDeparture,
  findCanonicalActiveExportAllocation,
} from "@/lib/operations/complete-export-allocation-from-departure";

const recordTrailerLifecycleEventMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/operations/trailer-lifecycle", () => ({
  recordTrailerLifecycleEvent: recordTrailerLifecycleEventMock,
}));

type QueryRow = Record<string, unknown>;

class QueryMock {
  private eqFilters = new Map<string, unknown>();
  private inFilters = new Map<string, unknown[]>();
  private updatePayload: QueryRow | null = null;

  constructor(
    private readonly table: string,
    private readonly tables: Record<string, QueryRow[]>,
    private readonly updateLog: QueryRow[],
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.eqFilters.set(column, value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.inFilters.set(column, [...values]);
    return this;
  }

  update(payload: QueryRow) {
    this.updatePayload = payload;
    this.updateLog.push(payload);
    return this;
  }

  private matchingRows() {
    return (this.tables[this.table] ?? []).filter((row) => {
      const eqOk = Array.from(this.eqFilters.entries()).every(([column, value]) => row[column] === value);
      const inOk = Array.from(this.inFilters.entries()).every(([column, values]) => values.includes(row[column]));
      return eqOk && inOk;
    });
  }

  maybeSingle() {
    const rows = this.matchingRows();
    const current = rows[0];
    if (!current) {
      return Promise.resolve({ data: null, error: null });
    }

    if (this.updatePayload) {
      Object.assign(current, this.updatePayload);
      return Promise.resolve({ data: { ...current }, error: null });
    }

    return Promise.resolve({ data: current, error: null });
  }

  then<TResult1>(
    onfulfilled?: ((value: { data: QueryRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
  ) {
    return Promise.resolve({ data: this.matchingRows(), error: null }).then(onfulfilled ?? undefined);
  }
}

const createSupabaseMock = (tables: Record<string, QueryRow[]>) => {
  const updateLog: QueryRow[] = [];
  return {
    updateLog,
    client: {
      from(table: string) {
        return new QueryMock(table, tables, updateLog);
      },
      rpc() {
        throw new Error("Departure export completion must not call lifecycle RPCs.");
      },
    },
  };
};

const allocation = (overrides: QueryRow): QueryRow => ({
  id: "export-1",
  trailer_id: "trailer-1",
  trailer_number: "PFC100",
  customer: "ABC CUSTOMER",
  status: "allocated",
  allocated_at: "2026-08-24T06:00:00.000Z",
  delivered_empty_at: null,
  waiting_loading_at: null,
  collected_loaded_at: null,
  completed_at: null,
  cancelled_at: null,
  ...overrides,
});

describe("completeExportAllocationFromConfirmedDeparture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordTrailerLifecycleEventMock.mockResolvedValue({
      occurredAt: "2026-08-24T08:42:00.000Z",
      idempotencyKey: "export-completed-from-departure:export-1",
    });
  });

  it("does not match an unassigned export by trailer number or customer", () => {
    const match = findCanonicalActiveExportAllocation(
      [allocation({ trailer_id: null, trailer_number: "PFC100", customer: "ABC CUSTOMER" })] as never,
      { trailerId: "trailer-1", trailerNumber: "PFC100" },
    );
    expect(match).toEqual({ match: "none" });
  });

  it("stops automatic completion when multiple active exports exist for the same trailer", () => {
    const match = findCanonicalActiveExportAllocation(
      [
        allocation({ id: "export-1", status: "allocated" }),
        allocation({ id: "export-2", status: "waiting_loading" }),
      ] as never,
      { trailerId: "trailer-1", trailerNumber: "PFC100" },
    );
    expect(match.match).toBe("conflict");
  });

  it("completes an allocated export without fabricating intermediate timestamps", async () => {
    const row = allocation({ status: "allocated" });
    const { client, updateLog } = createSupabaseMock({ export_allocations: [row] });

    const result = await completeExportAllocationFromConfirmedDeparture(client as never, {
      trailerId: "trailer-1",
      trailerNumber: "PFC100",
      departedAt: "2026-08-24T08:42:00.000Z",
      performedBy: "Supervisor One",
    });

    expect(result).toMatchObject({
      outcome: "completed",
      allocationId: "export-1",
      previousStatus: "allocated",
    });
    expect(updateLog[0]).toEqual({
      status: "completed",
      completed_at: "2026-08-24T08:42:00.000Z",
      updated_at: "2026-08-24T08:42:00.000Z",
    });
    expect(row.delivered_empty_at).toBeNull();
    expect(row.waiting_loading_at).toBeNull();
    expect(row.collected_loaded_at).toBeNull();
    expect(recordTrailerLifecycleEventMock).toHaveBeenCalledTimes(1);
    expect(recordTrailerLifecycleEventMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        eventType: "export_allocation_completed_from_departure",
        sourceModule: "departure",
        idempotencyKey: "export-completed-from-departure:export-1",
        metadata: expect.objectContaining({
          previous_status: "allocated",
          delivered_empty_at: null,
          waiting_loading_at: null,
          collected_loaded_at: null,
        }),
      }),
    );
  });

  it("preserves a real delivered_empty timestamp when completing from departure", async () => {
    const row = allocation({
      status: "delivered_empty",
      delivered_empty_at: "2026-08-24T07:10:00.000Z",
    });
    const { client } = createSupabaseMock({ export_allocations: [row] });

    await completeExportAllocationFromConfirmedDeparture(client as never, {
      trailerId: "trailer-1",
      trailerNumber: "PFC100",
      departedAt: "2026-08-24T08:42:00.000Z",
      performedBy: "Supervisor One",
    });

    expect(row.delivered_empty_at).toBe("2026-08-24T07:10:00.000Z");
    expect(row.waiting_loading_at).toBeNull();
    expect(row.collected_loaded_at).toBeNull();
    expect(row.status).toBe("completed");
  });

  it("preserves waiting_loading timestamps when completing from departure", async () => {
    const row = allocation({
      status: "waiting_loading",
      delivered_empty_at: "2026-08-24T07:10:00.000Z",
      waiting_loading_at: "2026-08-24T07:40:00.000Z",
    });
    const { client } = createSupabaseMock({ export_allocations: [row] });

    await completeExportAllocationFromConfirmedDeparture(client as never, {
      trailerId: "trailer-1",
      trailerNumber: "PFC100",
      departedAt: "2026-08-24T08:42:00.000Z",
      performedBy: "Supervisor One",
    });

    expect(row.delivered_empty_at).toBe("2026-08-24T07:10:00.000Z");
    expect(row.waiting_loading_at).toBe("2026-08-24T07:40:00.000Z");
    expect(row.collected_loaded_at).toBeNull();
  });

  it("preserves collected_loaded_at when completing a collected_loaded export", async () => {
    const row = allocation({
      status: "collected_loaded",
      delivered_empty_at: "2026-08-24T07:10:00.000Z",
      waiting_loading_at: "2026-08-24T07:40:00.000Z",
      collected_loaded_at: "2026-08-24T08:05:00.000Z",
    });
    const { client, updateLog } = createSupabaseMock({ export_allocations: [row] });

    const result = await completeExportAllocationFromConfirmedDeparture(client as never, {
      trailerId: "trailer-1",
      trailerNumber: "PFC100",
      departedAt: "2026-08-24T08:42:00.000Z",
      performedBy: "Supervisor One",
    });

    expect(result.previousStatus).toBe("collected_loaded");
    expect(row.collected_loaded_at).toBe("2026-08-24T08:05:00.000Z");
    expect(updateLog[0]).not.toHaveProperty("collected_loaded_at");
  });

  it("is a no-op when the linked export is already completed", async () => {
    const { client, updateLog } = createSupabaseMock({
      export_allocations: [allocation({ status: "completed", completed_at: "2026-08-24T08:00:00.000Z" })],
    });

    const result = await completeExportAllocationFromConfirmedDeparture(client as never, {
      trailerId: "trailer-1",
      trailerNumber: "PFC100",
      departedAt: "2026-08-24T08:42:00.000Z",
      performedBy: "Supervisor One",
    });

    expect(result.outcome).toBe("already_completed");
    expect(updateLog).toHaveLength(0);
    expect(recordTrailerLifecycleEventMock).not.toHaveBeenCalled();
  });

  it("does not reopen a cancelled export", async () => {
    const { client, updateLog } = createSupabaseMock({
      export_allocations: [allocation({ status: "cancelled", cancelled_at: "2026-08-24T07:00:00.000Z" })],
    });

    const result = await completeExportAllocationFromConfirmedDeparture(client as never, {
      trailerId: "trailer-1",
      trailerNumber: "PFC100",
      departedAt: "2026-08-24T08:42:00.000Z",
      performedBy: "Supervisor One",
    });

    expect(result.outcome).toBe("none");
    expect(updateLog).toHaveLength(0);
  });

  it("returns conflict without writing when two active exports share the trailer", async () => {
    const { client, updateLog } = createSupabaseMock({
      export_allocations: [
        allocation({ id: "export-1", status: "allocated" }),
        allocation({ id: "export-2", status: "delivered_empty" }),
      ],
    });

    const result = await completeExportAllocationFromConfirmedDeparture(client as never, {
      trailerId: "trailer-1",
      trailerNumber: "PFC100",
      departedAt: "2026-08-24T08:42:00.000Z",
      performedBy: "Supervisor One",
    });

    expect(result.outcome).toBe("conflict");
    expect(updateLog).toHaveLength(0);
    expect(recordTrailerLifecycleEventMock).not.toHaveBeenCalled();
  });

  it("leaves departure confirmation as a normal departure when no export is linked", async () => {
    const { client, updateLog } = createSupabaseMock({ export_allocations: [] });

    const result = await completeExportAllocationFromConfirmedDeparture(client as never, {
      trailerId: "trailer-1",
      trailerNumber: "PFC100",
      departedAt: "2026-08-24T08:42:00.000Z",
      performedBy: "Supervisor One",
    });

    expect(result.outcome).toBe("none");
    expect(updateLog).toHaveLength(0);
  });

  it("does not guess an unassigned export from the confirmed departure trailer number", async () => {
    const { client, updateLog } = createSupabaseMock({
      export_allocations: [allocation({ trailer_id: null, trailer_number: "PFC100" })],
    });

    const result = await completeExportAllocationFromConfirmedDeparture(client as never, {
      trailerId: "trailer-1",
      trailerNumber: "PFC100",
      departedAt: "2026-08-24T08:42:00.000Z",
      performedBy: "Supervisor One",
    });

    expect(result.outcome).toBe("none");
    expect(updateLog).toHaveLength(0);
  });

  it("writes history once and stays idempotent on a second confirm", async () => {
    const row = allocation({ status: "allocated" });
    const { client, updateLog } = createSupabaseMock({ export_allocations: [row] });
    const input = {
      trailerId: "trailer-1",
      trailerNumber: "PFC100",
      departedAt: "2026-08-24T08:42:00.000Z",
      performedBy: "Supervisor One",
    };

    const first = await completeExportAllocationFromConfirmedDeparture(client as never, input);
    const second = await completeExportAllocationFromConfirmedDeparture(client as never, input);

    expect(first.outcome).toBe("completed");
    expect(second.outcome).toBe("already_completed");
    expect(updateLog).toHaveLength(1);
    expect(recordTrailerLifecycleEventMock).toHaveBeenCalledTimes(1);
  });

  it("does not use the adjacent export lifecycle RPC", () => {
    const source = readFileSync(new URL("../complete-export-allocation-from-departure.ts", import.meta.url), "utf8");
    expect(source).not.toContain("advance_export_allocation_load_lifecycle");
    expect(source).not.toContain("advanceExportAllocationStatus");
    expect(source).toContain('status: "completed"');
    expect(source).toContain("completed_at");
  });
});
