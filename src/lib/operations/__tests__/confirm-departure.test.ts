import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmTrailerDeparture } from "@/lib/operations/confirm-departure";
import { TRAILER_NOT_AVAILABLE_FOR_DEPARTURE_CODE, TrailerJobConflictError } from "@/lib/trailer-job-eligibility";

const { createTrailerActivityMock, logTrailerEventMock, completeExportFromDepartureMock } = vi.hoisted(() => ({
  createTrailerActivityMock: vi.fn(),
  logTrailerEventMock: vi.fn(),
  completeExportFromDepartureMock: vi.fn(),
}));

vi.mock("@/lib/trailer-activity", () => ({
  createTrailerActivity: createTrailerActivityMock,
}));

vi.mock("@/lib/trailer-audit-log", () => ({
  logTrailerEvent: logTrailerEventMock,
}));

vi.mock("@/lib/operations/complete-export-allocation-from-departure", () => ({
  completeExportAllocationFromConfirmedDeparture: completeExportFromDepartureMock,
}));

type QueryRow = Record<string, unknown>;

class QueryMock {
  private eqFilters = new Map<string, unknown>();
  private isFilters = new Map<string, unknown>();
  private updatePayload: QueryRow | null = null;

  constructor(
    private readonly table: string,
    private readonly tables: Record<string, QueryRow[]>,
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.eqFilters.set(column, value);
    return this;
  }

  is(column: string, value: unknown) {
    this.isFilters.set(column, value);
    return this;
  }

  not() {
    return this;
  }

  in() {
    return this;
  }

  limit() {
    return this;
  }

  update(payload: QueryRow) {
    this.updatePayload = payload;
    return this;
  }

  insert() {
    return Promise.resolve({ data: null, error: null });
  }

  private matchingRows() {
    return (this.tables[this.table] ?? []).filter((row) => {
      return Array.from(this.eqFilters.entries()).every(([column, value]) => row[column] === value);
    });
  }

  single() {
    const rows = this.matchingRows();
    return Promise.resolve({ data: (rows[0] ?? null) as QueryRow | null, error: rows[0] ? null : { message: "not found" } });
  }

  maybeSingle() {
    if (this.updatePayload) {
      const rows = this.matchingRows().filter((row) => {
        return Array.from(this.isFilters.entries()).every(([column, value]) => (row[column] ?? null) === value);
      });
      const current = rows[0];
      if (!current) {
        return Promise.resolve({ data: null, error: null });
      }

      Object.assign(current, this.updatePayload);
      return Promise.resolve({ data: { id: current.id }, error: null });
    }

    return Promise.resolve({ data: this.matchingRows()[0] ?? null, error: null });
  }

  then<TResult1>(
    onfulfilled?: ((value: { data: QueryRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
  ) {
    return Promise.resolve({ data: this.matchingRows(), error: null }).then(onfulfilled ?? undefined);
  }
}

const createSupabaseMock = (tables: Record<string, QueryRow[]>) => ({
  from(table: string) {
    return new QueryMock(table, tables);
  },
});

describe("confirmTrailerDeparture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTrailerActivityMock.mockResolvedValue({});
    logTrailerEventMock.mockResolvedValue({ ok: true });
    completeExportFromDepartureMock.mockResolvedValue({ outcome: "none" });
  });

  it("rejects a trailer reserved by an active delivery booking", async () => {
    const supabase = createSupabaseMock({
      trailers: [
        {
          id: "trailer-1",
          trailer_number: "FS1001",
          departure_date: null,
          departure_time: null,
          compound_position: "P10",
          operational_status: "Ready",
          is_local: false,
        },
      ],
      delivery_bookings: [{ trailer_id: "trailer-1", status: "scheduled" }],
      export_allocations: [],
    });

    await expect(
      confirmTrailerDeparture(supabase as never, {
        trailerId: "trailer-1",
        operatorName: "Supervisor One",
      }),
    ).rejects.toMatchObject({
      code: TRAILER_NOT_AVAILABLE_FOR_DEPARTURE_CODE,
    });

    expect(createTrailerActivityMock).not.toHaveBeenCalled();
  });

  it("confirms a trailer with an active export allocation and reconciles that allocation", async () => {
    completeExportFromDepartureMock.mockResolvedValue({
      outcome: "completed",
      allocationId: "export-1",
      previousStatus: "allocated",
      customer: "ABC CUSTOMER",
    });

    const supabase = createSupabaseMock({
      trailers: [
        {
          id: "trailer-1",
          trailer_number: "FS1001",
          departure_date: null,
          departure_time: null,
          compound_position: "P10",
          operational_status: "Ready",
          is_local: false,
        },
      ],
      delivery_bookings: [],
      export_allocations: [{ id: "export-1", trailer_id: "trailer-1", status: "allocated" }],
      trailer_events: [],
    });

    const result = await confirmTrailerDeparture(supabase as never, {
      trailerId: "trailer-1",
      operatorName: "Supervisor One",
      now: new Date("2026-08-20T12:00:00.000Z"),
    });

    expect(result.alreadyDeparted).toBe(false);
    expect(result.exportReconciliation).toMatchObject({
      outcome: "completed",
      allocationId: "export-1",
      previousStatus: "allocated",
    });
    expect(completeExportFromDepartureMock).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        trailerId: "trailer-1",
        trailerNumber: "FS1001",
        departedAt: "2026-08-20T12:00:00.000Z",
        performedBy: "Supervisor One",
      }),
    );
  });

  it("returns alreadyDeparted without rewriting history", async () => {
    const supabase = createSupabaseMock({
      trailers: [
        {
          id: "trailer-1",
          trailer_number: "FS1001",
          departure_date: "2026-08-20T10:00:00.000Z",
          departure_time: "11:00:00",
          compound_position: null,
          operational_status: "Departed",
          is_local: false,
        },
      ],
    });

    const result = await confirmTrailerDeparture(supabase as never, {
      trailerId: "trailer-1",
      operatorName: "Supervisor One",
    });

    expect(result.alreadyDeparted).toBe(true);
    expect(createTrailerActivityMock).not.toHaveBeenCalled();
    expect(completeExportFromDepartureMock).toHaveBeenCalled();
  });

  it("confirms an eligible trailer and writes departure history", async () => {
    const supabase = createSupabaseMock({
      trailers: [
        {
          id: "trailer-1",
          trailer_number: "FS1001",
          departure_date: null,
          departure_time: null,
          compound_position: "P10",
          operational_status: "Ready",
          is_local: false,
        },
      ],
      delivery_bookings: [],
      export_allocations: [],
      trailer_events: [],
    });

    const result = await confirmTrailerDeparture(supabase as never, {
      trailerId: "trailer-1",
      operatorName: "Supervisor One",
      now: new Date("2026-08-20T12:00:00.000Z"),
    });

    expect(result.alreadyDeparted).toBe(false);
    expect(result.updated?.operational_status).toBe("Departed");
    expect(result.updated?.compound_position).toBeNull();
    expect(createTrailerActivityMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "departed",
      sourceModule: "operations",
      performedBy: "Supervisor One",
    }));
    expect(logTrailerEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "departure_registered",
      sourceModule: "departure",
    }));
  });
});
