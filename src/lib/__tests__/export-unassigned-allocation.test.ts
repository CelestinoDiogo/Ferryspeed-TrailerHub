import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistExportAllocationImport } from "@/lib/imports/export-allocation-import-persist";
import { assignExportAllocationTrailer } from "@/lib/operations/assign-export-allocation-trailer";
import {
  ASSIGN_TRAILER_BEFORE_OPERATION_MESSAGE,
  getExportAllocationTrailerLabel,
  hasAssignedTrailer,
} from "@/lib/export-allocation";
import {
  TRAILER_ACTIVE_EXPORT_ALLOCATION_MESSAGE,
  TRAILER_RESERVED_FOR_DELIVERY_MESSAGE,
  TrailerJobConflictError,
} from "@/lib/trailer-job-eligibility";

const { createTrailerActivityMock } = vi.hoisted(() => ({
  createTrailerActivityMock: vi.fn(),
}));

vi.mock("@/lib/trailer-activity", () => ({
  createTrailerActivity: createTrailerActivityMock,
}));

type QueryRow = Record<string, unknown>;

class QueryMock {
  private eqFilters = new Map<string, unknown>();
  private neqFilters = new Map<string, unknown>();
  private isFilters = new Map<string, unknown>();
  private inFilters = new Map<string, unknown[]>();
  private insertPayload: QueryRow | QueryRow[] | null = null;
  private updatePayload: QueryRow | null = null;

  constructor(
    private readonly table: string,
    private readonly tables: Record<string, QueryRow[]>,
    private readonly insertsByTable: Record<string, QueryRow[]>,
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

  in(column: string, values: unknown[]) {
    this.inFilters.set(column, values);
    return this;
  }

  not() {
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
    const rows = Array.isArray(payload) ? payload : [payload];
    this.insertsByTable[this.table] = [...(this.insertsByTable[this.table] ?? []), ...rows];
    if (this.table === "export_allocations") {
      rows.forEach((row) => {
        this.tables.export_allocations.push({
          id: `created-${this.tables.export_allocations.length + 1}`,
          ...row,
        });
      });
    }
    return this;
  }

  private matchingRows() {
    return (this.tables[this.table] ?? []).filter((row) => {
      const eqMatch = Array.from(this.eqFilters.entries()).every(([column, value]) => row[column] === value);
      const neqMatch = Array.from(this.neqFilters.entries()).every(([column, value]) => row[column] !== value);
      const isMatch = Array.from(this.isFilters.entries()).every(([column, value]) => (row[column] ?? null) === value);
      const inMatch = Array.from(this.inFilters.entries()).every(([column, values]) => values.includes(row[column]));
      return eqMatch && neqMatch && isMatch && inMatch;
    });
  }

  single() {
    if (this.insertPayload && this.table === "export_allocations") {
      const inserted = Array.isArray(this.insertPayload) ? this.insertPayload[0] : this.insertPayload;
      const created = this.tables.export_allocations.find((row) => row.customer === inserted.customer && row.trailer_id === inserted.trailer_id);
      return Promise.resolve({ data: { id: created?.id ?? `created-${this.tables.export_allocations.length}` }, error: null });
    }

    if (this.updatePayload) {
      const rows = this.matchingRows();
      const current = rows[0];
      if (!current) {
        return Promise.resolve({ data: null, error: { message: "not found" } });
      }
      Object.assign(current, this.updatePayload);
      return Promise.resolve({ data: { id: current.id }, error: null });
    }

    const rows = this.matchingRows();
    return Promise.resolve({ data: (rows[0] ?? null) as QueryRow | null, error: rows[0] ? null : { message: "not found" } });
  }

  then<TResult1>(
    onfulfilled?: ((value: { data: QueryRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
  ) {
    return Promise.resolve({ data: this.matchingRows(), error: null }).then(onfulfilled ?? undefined);
  }
}

const createSupabaseMock = (tables: Record<string, QueryRow[]>) => {
  const insertsByTable: Record<string, QueryRow[]> = {};
  return {
    insertsByTable,
    tables,
    from(table: string) {
      return new QueryMock(table, tables, insertsByTable);
    },
  };
};

const eligibleTrailer = {
  id: "trailer-eligible",
  trailer_number: "PRO810",
  load_status: "Empty",
  departure_date: null,
  operational_status: "In Compound",
  is_local: false,
  compound_position: "P01",
};

describe("unassigned export allocation helpers", () => {
  it("treats missing trailer_id as unassigned even if a number is present", () => {
    expect(hasAssignedTrailer({ trailer_id: null, trailer_number: "PRO810" })).toBe(false);
    expect(getExportAllocationTrailerLabel({ trailer_id: null, trailer_number: null })).toBe("Trailer to be selected");
    expect(getExportAllocationTrailerLabel({ trailer_id: "t-1", trailer_number: "PRO810" })).toBe("PRO810");
    expect(ASSIGN_TRAILER_BEFORE_OPERATION_MESSAGE).toBe("Assign a trailer before continuing this operation.");
  });
});

describe("persistExportAllocationImport unassigned rows", () => {
  beforeEach(() => {
    createTrailerActivityMock.mockResolvedValue({});
  });

  it("persists blank-trailer rows without creating a fake trailer", async () => {
    const supabase = createSupabaseMock({
      trailers: [eligibleTrailer],
      delivery_bookings: [],
      export_allocations: [],
      compound_waiting_list: [],
      trailer_events: [],
    });

    const result = await persistExportAllocationImport({
      supabase: supabase as never,
      operatorName: "Operator",
      rows: [
        { trailerNumber: "PRO810", customer: "Acme Exports", collectionDate: "2026-08-21" },
        { trailerNumber: "", customer: "Blank Trailer Customer", collectionDate: "2026-08-21", collectionAddress: "Yard 1", haulier: "Haulier A" },
        { trailerNumber: "", customer: "Second Unassigned", collectionDate: "2026-08-22" },
      ],
    });

    expect(result.created).toHaveLength(3);
    expect(result.created.filter((row) => row.unassigned)).toHaveLength(2);
    expect(result.blockedUnassigned).toEqual([]);
    expect(supabase.insertsByTable.trailers ?? []).toEqual([]);
    expect(supabase.insertsByTable.export_allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trailer_id: "trailer-eligible",
          trailer_number: "PRO810",
          customer: "Acme Exports",
          status: "allocated",
        }),
        expect.objectContaining({
          trailer_id: null,
          trailer_number: null,
          customer: "Blank Trailer Customer",
          collection_address: "Yard 1",
          haulier: "Haulier A",
          status: "allocated",
        }),
        expect.objectContaining({
          trailer_id: null,
          trailer_number: null,
          customer: "Second Unassigned",
          status: "allocated",
        }),
      ]),
    );
  });
});

describe("assignExportAllocationTrailer", () => {
  beforeEach(() => {
    createTrailerActivityMock.mockResolvedValue({});
  });

  it("assigns an eligible trailer to an unassigned allocation and preserves allocated status", async () => {
    const supabase = createSupabaseMock({
      export_allocations: [{
        id: "alloc-1",
        trailer_id: null,
        trailer_number: null,
        status: "allocated",
        customer: "Blank Trailer Customer",
      }],
      trailers: [eligibleTrailer],
      delivery_bookings: [],
      compound_waiting_list: [],
      trailer_events: [],
    });

    const result = await assignExportAllocationTrailer({
      supabase: supabase as never,
      allocationId: "alloc-1",
      trailerId: "trailer-eligible",
      operatorName: "Operator",
    });

    expect(result).toMatchObject({
      allocationId: "alloc-1",
      trailerId: "trailer-eligible",
      trailerNumber: "PRO810",
      previousTrailerId: null,
    });
    expect(supabase.tables.export_allocations[0]).toMatchObject({
      trailer_id: "trailer-eligible",
      trailer_number: "PRO810",
      status: "allocated",
      customer: "Blank Trailer Customer",
    });
    expect(createTrailerActivityMock).toHaveBeenCalled();
  });

  it("rejects a trailer reserved by an active delivery", async () => {
    const supabase = createSupabaseMock({
      export_allocations: [{
        id: "alloc-1",
        trailer_id: null,
        trailer_number: null,
        status: "allocated",
        customer: "Blank Trailer Customer",
      }],
      trailers: [eligibleTrailer],
      delivery_bookings: [{ id: "del-1", trailer_id: "trailer-eligible", status: "scheduled" }],
    });

    await expect(assignExportAllocationTrailer({
      supabase: supabase as never,
      allocationId: "alloc-1",
      trailerId: "trailer-eligible",
      operatorName: "Operator",
    })).rejects.toMatchObject({
      name: "TrailerJobConflictError",
      message: TRAILER_RESERVED_FOR_DELIVERY_MESSAGE,
    });

    expect(supabase.tables.export_allocations[0].trailer_id).toBeNull();
  });

  it("rejects a trailer reserved by another active export", async () => {
    const supabase = createSupabaseMock({
      export_allocations: [
        {
          id: "alloc-1",
          trailer_id: null,
          trailer_number: null,
          status: "allocated",
          customer: "Blank Trailer Customer",
        },
        {
          id: "alloc-2",
          trailer_id: "trailer-eligible",
          trailer_number: "PRO810",
          status: "allocated",
          customer: "Existing Export",
        },
      ],
      trailers: [eligibleTrailer],
      delivery_bookings: [],
    });

    await expect(assignExportAllocationTrailer({
      supabase: supabase as never,
      allocationId: "alloc-1",
      trailerId: "trailer-eligible",
      operatorName: "Operator",
    })).rejects.toBeInstanceOf(TrailerJobConflictError);

    await expect(assignExportAllocationTrailer({
      supabase: supabase as never,
      allocationId: "alloc-1",
      trailerId: "trailer-eligible",
      operatorName: "Operator",
    })).rejects.toMatchObject({
      message: TRAILER_ACTIVE_EXPORT_ALLOCATION_MESSAGE,
    });

    expect(supabase.tables.export_allocations[0].trailer_id).toBeNull();
  });
});
