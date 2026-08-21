import { beforeEach, describe, expect, it, vi } from "vitest";
import { markVesselTrailerDischarged } from "@/lib/operations/mark-vessel-trailer-discharged";
import { getVesselTrailerDischargedAt, getVesselTrailerReceptionAt } from "@/lib/vessel-operations";

const { createTrailerActivityMock } = vi.hoisted(() => ({
  createTrailerActivityMock: vi.fn(),
}));

vi.mock("@/lib/trailer-activity", () => ({
  createTrailerActivity: createTrailerActivityMock,
}));

type QueryRow = Record<string, unknown>;

class QueryMock {
  private eqFilters = new Map<string, unknown>();
  private inFilters = new Map<string, unknown[]>();
  private isFilters = new Map<string, unknown>();
  private updatePayload: QueryRow | null = null;
  private insertPayload: QueryRow | QueryRow[] | null = null;

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

  in(column: string, values: unknown[]) {
    this.inFilters.set(column, values);
    return this;
  }

  is(column: string, value: unknown) {
    this.isFilters.set(column, value);
    return this;
  }

  update(payload: QueryRow) {
    this.updatePayload = payload;
    return this;
  }

  insert(payload: QueryRow | QueryRow[]) {
    this.insertPayload = payload;
    const rows = Array.isArray(payload) ? payload : [payload];
    this.tables[this.table] = [...(this.tables[this.table] ?? []), ...rows];
    return this;
  }

  private matchingRows() {
    return (this.tables[this.table] ?? []).filter((row) => {
      const eqMatch = Array.from(this.eqFilters.entries()).every(([column, value]) => row[column] === value);
      const inMatch = Array.from(this.inFilters.entries()).every(([column, values]) => values.includes(row[column]));
      const isMatch = Array.from(this.isFilters.entries()).every(([column, value]) => (row[column] ?? null) === value);
      return eqMatch && inMatch && isMatch;
    });
  }

  maybeSingle() {
    if (this.updatePayload) {
      const rows = this.matchingRows();
      const current = rows[0];
      if (!current) {
        return Promise.resolve({ data: null, error: null });
      }
      Object.assign(current, this.updatePayload);
      return Promise.resolve({ data: { ...current }, error: null });
    }

    const rows = this.matchingRows();
    return Promise.resolve({ data: (rows[0] ?? null) as QueryRow | null, error: null });
  }

  then<TResult1>(
    onfulfilled?: ((value: { data: QueryRow | QueryRow[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
  ) {
    return Promise.resolve({ data: this.insertPayload ? this.matchingRows() : this.matchingRows(), error: null }).then(
      onfulfilled ?? undefined,
    );
  }
}

const createSupabaseMock = (tables: Record<string, QueryRow[]>) => {
  return {
    tables,
    from(table: string) {
      return new QueryMock(table, tables);
    },
  };
};

const pendingTrailer = {
  id: "vt-1",
  vessel_operation_id: "op-1",
  trailer_id: "trailer-1",
  trailer_number: "FS59",
  status: "expected",
  arrival_status: "available_for_arrival",
  arrival_record_id: null,
  discharged_at: null,
  arrived_at: null,
  arrival_confirmed_at: null,
  arrival_confirmed_by: null,
  inspection_started_at: null,
  inspection_completed_at: null,
};

describe("markVesselTrailerDischarged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTrailerActivityMock.mockResolvedValue({});
  });

  it("writes discharged_at once for the physical discharge action", async () => {
    const supabase = createSupabaseMock({
      vessel_operation_trailers: [{ ...pendingTrailer }],
      trailer_events: [],
    });

    const result = await markVesselTrailerDischarged({
      supabase: supabase as never,
      vesselTrailerId: "vt-1",
      operatorName: "Operator",
      dischargedAt: "2026-08-21T10:00:00.000Z",
    });

    expect(result.alreadyDischarged).toBe(false);
    expect(result.dischargedAt).toBe("2026-08-21T10:00:00.000Z");
    expect(supabase.tables.vessel_operation_trailers[0]).toMatchObject({
      arrival_status: "arrived",
      discharged_at: "2026-08-21T10:00:00.000Z",
      inspection_started_at: null,
      inspection_completed_at: null,
    });
    expect(createTrailerActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "vessel_arrived",
        eventTitle: "Trailer discharged from vessel",
        metadata: expect.objectContaining({ discharged_at: "2026-08-21T10:00:00.000Z" }),
      }),
    );
  });

  it("does not replace the original discharge timestamp on repeat", async () => {
    const supabase = createSupabaseMock({
      vessel_operation_trailers: [{
        ...pendingTrailer,
        arrival_status: "arrived",
        discharged_at: "2026-08-21T10:00:00.000Z",
        arrived_at: "2026-08-21T10:00:00.000Z",
      }],
      trailer_events: [],
    });

    const result = await markVesselTrailerDischarged({
      supabase: supabase as never,
      vesselTrailerId: "vt-1",
      operatorName: "Operator",
      dischargedAt: "2026-08-21T11:00:00.000Z",
    });

    expect(result.alreadyDischarged).toBe(true);
    expect(result.dischargedAt).toBe("2026-08-21T10:00:00.000Z");
    expect(supabase.tables.vessel_operation_trailers[0].discharged_at).toBe("2026-08-21T10:00:00.000Z");
    expect(createTrailerActivityMock).not.toHaveBeenCalled();
  });

  it("does not backfill discharged_at for historical arrived rows", async () => {
    const supabase = createSupabaseMock({
      vessel_operation_trailers: [{
        ...pendingTrailer,
        arrival_status: "arrived",
        discharged_at: null,
        arrived_at: "2026-08-01T09:00:00.000Z",
        arrival_confirmed_at: "2026-08-01T09:30:00.000Z",
      }],
      trailer_events: [],
    });

    const result = await markVesselTrailerDischarged({
      supabase: supabase as never,
      vesselTrailerId: "vt-1",
      operatorName: "Operator",
      dischargedAt: "2026-08-21T11:00:00.000Z",
    });

    expect(result.alreadyDischarged).toBe(true);
    expect(result.dischargedAt).toBeNull();
    expect(supabase.tables.vessel_operation_trailers[0].discharged_at).toBeNull();
  });
});

describe("vessel timestamp helpers", () => {
  it("keeps discharge and reception timestamps independent", () => {
    const trailer = {
      discharged_at: "2026-08-21T10:00:00.000Z",
      arrived_at: "2026-08-21T10:15:00.000Z",
      arrival_confirmed_at: "2026-08-21T10:15:00.000Z",
    };

    expect(getVesselTrailerDischargedAt(trailer)).toBe("2026-08-21T10:00:00.000Z");
    expect(getVesselTrailerReceptionAt(trailer)).toBe("2026-08-21T10:15:00.000Z");
    expect(getVesselTrailerDischargedAt({ discharged_at: null })).toBeNull();
  });
});
