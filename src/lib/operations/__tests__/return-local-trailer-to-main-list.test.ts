import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTrailerPresentInCompoundInventory } from "@/lib/export-allocation";
import {
  LocalTrailerReturnError,
  returnLocalTrailerToMainList,
} from "@/lib/operations/return-local-trailer-to-main-list";

const { createTrailerActivityMock, logTrailerEventMock } = vi.hoisted(() => ({
  createTrailerActivityMock: vi.fn(),
  logTrailerEventMock: vi.fn(),
}));

vi.mock("@/lib/trailer-activity", () => ({
  createTrailerActivity: createTrailerActivityMock,
}));

vi.mock("@/lib/trailer-audit-log", () => ({
  logTrailerEvent: logTrailerEventMock,
}));

type QueryRow = Record<string, unknown>;

class QueryMock {
  private eqFilters = new Map<string, unknown>();
  private neqFilters = new Map<string, unknown>();
  private isFilters = new Map<string, unknown>();
  private updatePayload: QueryRow | null = null;
  private insertPayload: QueryRow | QueryRow[] | null = null;
  private updateError: { message: string; code?: string } | null = null;

  constructor(
    private readonly table: string,
    private readonly tables: Record<string, QueryRow[]>,
    private readonly inserted: QueryRow[],
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.eqFilters.set(column, value);
    return this;
  }

  neq(column: string, value: unknown) {
    this.neqFilters.set(column, value);
    return this;
  }

  is(column: string, value: unknown) {
    this.isFilters.set(column, value);
    return this;
  }

  limit() {
    return this;
  }

  update(payload: QueryRow) {
    this.updatePayload = payload;
    return this;
  }

  insert(payload: QueryRow | QueryRow[]) {
    this.insertPayload = payload;
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.executeMaybeSingle());
  }

  then(resolve: (value: { data: QueryRow[] | null; error: { message: string } | null }) => unknown) {
    return Promise.resolve(this.executeList()).then(resolve);
  }

  private rows() {
    return this.tables[this.table] ?? [];
  }

  private matches(row: QueryRow) {
    for (const [column, value] of this.eqFilters.entries()) {
      if (row[column] !== value) {
        return false;
      }
    }
    for (const [column, value] of this.neqFilters.entries()) {
      if (row[column] === value) {
        return false;
      }
    }
    for (const [column, value] of this.isFilters.entries()) {
      if (value === null && row[column] != null) {
        return false;
      }
    }
    return true;
  }

  private uniquePositionConflict(match: QueryRow) {
    if (!this.updatePayload || this.updatePayload.is_local === true) {
      return false;
    }
    const requested = this.updatePayload.compound_position;
    if (!requested) {
      return false;
    }
    return this.rows().some(
      (row) =>
        row.id !== match.id &&
        row.is_local !== true &&
        !(row.departure_date as string | null) &&
        row.compound_position === requested,
    );
  }

  private executeMaybeSingle() {
    if (this.table === "trailer_events" && this.insertPayload) {
      this.inserted.push(this.insertPayload as QueryRow);
      return { data: null, error: null };
    }

    const match = this.rows().find((row) => this.matches(row));
    if (this.updatePayload && match) {
      if (this.uniquePositionConflict(match)) {
        this.updateError = { message: "duplicate key value violates unique constraint", code: "23505" };
        return { data: null, error: this.updateError };
      }
      Object.assign(match, this.updatePayload);
      return { data: { ...match }, error: null };
    }

    return { data: match ? { ...match } : null, error: this.updateError };
  }

  private executeList() {
    if (this.table === "trailer_events" && this.insertPayload) {
      this.inserted.push(this.insertPayload as QueryRow);
      return { data: Array.isArray(this.insertPayload) ? this.insertPayload : [this.insertPayload], error: null };
    }

    return { data: this.rows().filter((row) => this.matches(row)), error: null };
  }
}

const localTrailer = {
  id: "local-1",
  trailer_number: "PRO820",
  is_local: true,
  compound_position: null,
  load_status: "Empty",
  load_description: "Empties",
  customer: "WAITROSE",
  consignee: "States",
  operational_status: "Local Trailer",
  departure_date: null,
};

describe("returnLocalTrailerToMainList", () => {
  beforeEach(() => {
    createTrailerActivityMock.mockReset().mockResolvedValue({});
    logTrailerEventMock.mockReset().mockResolvedValue({ ok: true });
  });

  const createClient = (rows: QueryRow[]) => {
    const tables: Record<string, QueryRow[]> = {
      trailers: rows.map((row) => ({ ...row })),
      trailer_events: [],
    };
    const inserted: QueryRow[] = [];
    const supabase = {
      from: (table: string) => new QueryMock(table, tables, inserted),
    };
    return { supabase, tables, inserted };
  };

  it("F: returns a Local trailer to the Main List without fabricating a Compound position", async () => {
    const { supabase, tables, inserted } = createClient([{ ...localTrailer }]);
    const result = await returnLocalTrailerToMainList(supabase as never, {
      trailerId: "local-1",
      operatorName: "Diogo",
    });

    expect(result.alreadyMain).toBe(false);
    expect(result.trailer.id).toBe("local-1");
    expect(result.trailer.is_local).toBe(false);
    expect(result.trailer.compound_position).toBeNull();
    expect(result.trailer.load_status).toBe("Empty");
    expect(result.trailer.customer).toBe("WAITROSE");
    expect(result.trailer.consignee).toBe("States");
    expect(result.trailer.load_description).toBe("Empties");
    expect(tables.trailers).toHaveLength(1);
    expect(
      isTrailerPresentInCompoundInventory(
        {
          id: result.trailer.id,
          compound_position: result.trailer.compound_position,
          departure_date: result.trailer.departure_date,
          is_local: result.trailer.is_local,
        },
        null,
      ),
    ).toBe(false);
    expect(inserted[0]).toMatchObject({ event_type: "trailer_location_changed" });
    expect(logTrailerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "trailer_returned_to_main_list" }),
    );
    expect(createTrailerActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventTitle: "Trailer returned to Main List" }),
    );
  });

  it("G: assigning a valid explicit position makes the trailer canonically Compound-present", async () => {
    const { supabase, inserted } = createClient([{ ...localTrailer }]);
    const result = await returnLocalTrailerToMainList(supabase as never, {
      trailerId: "local-1",
      operatorName: "Diogo",
      compoundPosition: "10",
    });

    expect(result.trailer.is_local).toBe(false);
    expect(result.trailer.compound_position).toBe("P10");
    expect(result.trailer.operational_status).toBe("In Compound");
    expect(
      isTrailerPresentInCompoundInventory(
        {
          id: result.trailer.id,
          compound_position: result.trailer.compound_position,
          departure_date: result.trailer.departure_date,
          is_local: result.trailer.is_local,
        },
        null,
      ),
    ).toBe(true);
    expect(inserted.map((row) => row.event_type)).toEqual([
      "trailer_location_changed",
      "compound_position_changed",
    ]);
  });

  it("H: an occupied position fails safely and leaves the trailer Local", async () => {
    const occupant = {
      id: "other",
      trailer_number: "PFC49",
      compound_position: "P10",
      is_local: false,
      departure_date: null,
    };
    const { supabase, tables, inserted } = createClient([{ ...localTrailer }, occupant]);

    await expect(
      returnLocalTrailerToMainList(supabase as never, {
        trailerId: "local-1",
        operatorName: "Diogo",
        compoundPosition: "P10",
      }),
    ).rejects.toMatchObject({ code: "position_conflict" } satisfies Partial<LocalTrailerReturnError>);

    expect(tables.trailers[0]?.is_local).toBe(true);
    expect(tables.trailers[0]?.compound_position).toBeNull();
    expect(inserted).toHaveLength(0);
  });

  it("rejects an invalid or out-of-capacity position before flipping Local", async () => {
    const { supabase, tables } = createClient([{ ...localTrailer }]);

    await expect(
      returnLocalTrailerToMainList(supabase as never, {
        trailerId: "local-1",
        operatorName: "Diogo",
        compoundPosition: "P99",
      }),
    ).rejects.toMatchObject({ code: "invalid_position" } satisfies Partial<LocalTrailerReturnError>);

    expect(tables.trailers[0]?.is_local).toBe(true);
  });

  it("clears a leftover Local position when returning without an explicit bay", async () => {
    const { supabase } = createClient([{ ...localTrailer, compound_position: "P07" }]);
    const result = await returnLocalTrailerToMainList(supabase as never, {
      trailerId: "local-1",
      operatorName: "Diogo",
    });

    expect(result.trailer.is_local).toBe(false);
    expect(result.trailer.compound_position).toBeNull();
    expect(
      isTrailerPresentInCompoundInventory(
        {
          id: result.trailer.id,
          compound_position: result.trailer.compound_position,
          departure_date: result.trailer.departure_date,
          is_local: result.trailer.is_local,
        },
        null,
      ),
    ).toBe(false);
  });

  it("handles an already-main trailer idempotently", async () => {
    const { supabase } = createClient([
      { ...localTrailer, is_local: false, operational_status: "Awaiting Position" },
    ]);
    const result = await returnLocalTrailerToMainList(supabase as never, {
      trailerId: "local-1",
      operatorName: "Diogo",
    });

    expect(result.alreadyMain).toBe(true);
    expect(logTrailerEventMock).not.toHaveBeenCalled();
  });

  it("rejects a departed trailer", async () => {
    const { supabase } = createClient([{ ...localTrailer, departure_date: "2026-08-22" }]);
    await expect(
      returnLocalTrailerToMainList(supabase as never, { trailerId: "local-1", operatorName: "Diogo" }),
    ).rejects.toMatchObject({ code: "departed" } satisfies Partial<LocalTrailerReturnError>);
  });
});
