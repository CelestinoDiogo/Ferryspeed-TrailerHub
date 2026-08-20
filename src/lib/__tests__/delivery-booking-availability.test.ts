import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  createDeliveryBookingIfTrailerAvailable,
  DELIVERY_BOOKING_ACTIVE_STATUSES,
  DELIVERY_BOOKING_RELEASE_STATUS_QUERY,
  DELIVERY_BOOKING_RELEASE_STATUSES,
  excludeTrailersReservedByActiveDeliveryBookings,
  isActiveDeliveryBookingStatus,
  isReleasedDeliveryBookingStatus,
  listTrailersAvailableForDeliveryBooking,
  TRAILER_ACTIVE_DELIVERY_BOOKING_CODE,
  TRAILER_ACTIVE_DELIVERY_BOOKING_MESSAGE,
} from "@/lib/delivery-booking-availability";
import {
  isExportAllocationOffCompoundStatus,
  isTrailerEligibleForCompoundViews,
} from "@/lib/export-allocation";

type BookingRow = { id: string; trailer_id: string; status: string; booking_reference?: string | null };
type TrailerRow = {
  id: string;
  trailer_number: string;
  container_number?: string | null;
  customer?: string | null;
  consignee?: string | null;
  load_status?: string | null;
};

const trailers: TrailerRow[] = [
  {
    id: "trailer-loaded-active",
    trailer_number: "FS1001",
    customer: "Customer A",
    load_status: "Loaded",
  },
  {
    id: "trailer-loaded-free",
    trailer_number: "FS1002",
    customer: "Customer B",
    load_status: "Loaded",
  },
  {
    id: "trailer-empty-free",
    trailer_number: "FS1003",
    customer: "Customer C",
    load_status: "Empty",
  },
];

const createThenChain = (getResult: () => { data: unknown; error: null }) => {
  const state = { trailerId: null as string | null };
  const chain: Record<string, unknown> = {};
  const self = () => chain;

  chain.select = vi.fn(() => {
    state.trailerId = null;
    return chain;
  });
  chain.is = vi.fn(self);
  chain.in = vi.fn(self);
  chain.eq = vi.fn((column: string, value: string) => {
    if (column === "trailer_id") {
      state.trailerId = value;
    }
    return chain;
  });
  chain.not = vi.fn(self);
  chain.order = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.maybeSingle = vi.fn(async () => {
    const rows = (getResult().data as BookingRow[] | TrailerRow[] | null) ?? [];
    const match = Array.isArray(rows)
      ? rows.find((row) => !state.trailerId || ("trailer_id" in row && row.trailer_id === state.trailerId))
      : null;
    return { data: match ?? null, error: null };
  });
  chain.then = (resolve: (value: { data: unknown; error: null }) => unknown) =>
    Promise.resolve(getResult()).then(resolve);

  return chain;
};

describe("delivery booking availability statuses", () => {
  it("treats the existing non-final delivery statuses as active reservations", () => {
    for (const status of DELIVERY_BOOKING_ACTIVE_STATUSES) {
      expect(isActiveDeliveryBookingStatus(status)).toBe(true);
      expect(isReleasedDeliveryBookingStatus(status)).toBe(false);
    }
  });

  it("releases a trailer only when the booking is collected or cancelled", () => {
    for (const status of DELIVERY_BOOKING_RELEASE_STATUSES) {
      expect(isActiveDeliveryBookingStatus(status)).toBe(false);
      expect(isReleasedDeliveryBookingStatus(status)).toBe(true);
    }
  });
});

describe("delivery booking trailer eligibility", () => {
  it("excludes a loaded trailer that already has an active delivery booking", () => {
    const available = excludeTrailersReservedByActiveDeliveryBookings(trailers, [
      { id: "booking-active", trailer_id: "trailer-loaded-active", status: "on_delivery" },
    ]);

    expect(available.map((trailer) => trailer.id)).toEqual(["trailer-loaded-free", "trailer-empty-free"]);
  });

  it("keeps a loaded trailer available when it has no active booking", () => {
    const available = excludeTrailersReservedByActiveDeliveryBookings(trailers, []);
    expect(available.map((trailer) => trailer.id)).toContain("trailer-loaded-free");
  });

  it("makes a trailer eligible again after the booking is collected", () => {
    const available = excludeTrailersReservedByActiveDeliveryBookings(trailers, [
      { id: "booking-done", trailer_id: "trailer-loaded-active", status: "collected" },
    ]);

    expect(available.map((trailer) => trailer.id)).toContain("trailer-loaded-active");
  });

  it("makes a trailer eligible again after the booking is cancelled", () => {
    const available = excludeTrailersReservedByActiveDeliveryBookings(trailers, [
      { id: "booking-cancelled", trailer_id: "trailer-loaded-active", status: "cancelled" },
    ]);

    expect(available.map((trailer) => trailer.id)).toContain("trailer-loaded-active");
  });

  it("ignores historical completed and cancelled bookings when a later active booking is absent", () => {
    const available = excludeTrailersReservedByActiveDeliveryBookings(trailers, [
      { id: "booking-old-collected", trailer_id: "trailer-loaded-free", status: "collected" },
      { id: "booking-old-cancelled", trailer_id: "trailer-loaded-free", status: "cancelled" },
    ]);

    expect(available.map((trailer) => trailer.id)).toContain("trailer-loaded-free");
  });

  it("still blocks a trailer when historical bookings exist alongside one active booking", () => {
    const available = excludeTrailersReservedByActiveDeliveryBookings(trailers, [
      { id: "booking-old", trailer_id: "trailer-loaded-active", status: "collected" },
      { id: "booking-current", trailer_id: "trailer-loaded-active", status: "waiting_collection" },
    ]);

    expect(available.map((trailer) => trailer.id)).not.toContain("trailer-loaded-active");
  });
});

describe("delivery booking availability queries", () => {
  const store = {
    trailers,
    bookings: [] as BookingRow[],
    exports: [] as Array<{ id: string; trailer_id: string; status: string }>,
    inserted: [] as Array<Record<string, unknown>>,
  };

  const supabase = {
    from: (table: string) => {
      if (table === "trailers") {
        return createThenChain(() => ({ data: store.trailers, error: null }));
      }

      if (table === "delivery_bookings") {
        const chain = createThenChain(() => ({ data: store.bookings.filter((row) => isActiveDeliveryBookingStatus(row.status)), error: null }));
        return {
          ...chain,
          insert: vi.fn((payload: Record<string, unknown>) => {
            store.inserted.push(payload);
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({ data: { id: "booking-new" }, error: null })),
              })),
            };
          }),
        };
      }

      if (table === "export_allocations") {
        return createThenChain(() => ({ data: store.exports, error: null }));
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  beforeEach(() => {
    store.bookings = [];
    store.exports = [];
    store.inserted = [];
  });

  it("excludes reserved trailers from the persisted available list used after refresh", async () => {
    store.bookings = [
      { id: "booking-active", trailer_id: "trailer-loaded-active", status: "scheduled" },
    ];

    const firstLoad = await listTrailersAvailableForDeliveryBooking(supabase);
    expect(firstLoad.map((trailer) => trailer.id)).not.toContain("trailer-loaded-active");
    expect(firstLoad.map((trailer) => trailer.id)).toContain("trailer-loaded-free");

    store.bookings = [
      { id: "booking-active", trailer_id: "trailer-loaded-active", status: "collected" },
    ];

    const afterRelease = await listTrailersAvailableForDeliveryBooking(supabase);
    expect(afterRelease.map((trailer) => trailer.id)).toContain("trailer-loaded-active");
  });

  it("rejects a second active booking for the same trailer without inserting", async () => {
    store.bookings = [
      { id: "booking-active", trailer_id: "trailer-loaded-active", status: "ready" },
    ];

    await expect(
      createDeliveryBookingIfTrailerAvailable(supabase, {
        trailer_id: "trailer-loaded-active",
        delivery_date: "2026-08-21",
      }),
    ).rejects.toMatchObject({
      name: "DeliveryBookingAvailabilityError",
      code: TRAILER_ACTIVE_DELIVERY_BOOKING_CODE,
      message: TRAILER_ACTIVE_DELIVERY_BOOKING_MESSAGE,
    });

    expect(store.inserted).toHaveLength(0);
  });

  it("creates a booking when the trailer has only released history", async () => {
    store.bookings = [
      { id: "booking-old", trailer_id: "trailer-loaded-free", status: "collected" },
      { id: "booking-cancelled", trailer_id: "trailer-loaded-free", status: "cancelled" },
    ];

    const created = await createDeliveryBookingIfTrailerAvailable(supabase, {
      trailer_id: "trailer-loaded-free",
      delivery_date: "2026-08-21",
      status: "scheduled",
    });

    expect(created).toEqual({ id: "booking-new" });
    expect(store.inserted).toHaveLength(1);
    expect(store.inserted[0]).toMatchObject({
      trailer_id: "trailer-loaded-free",
      delivery_date: "2026-08-21",
    });
  });

  it("rejects a delivery booking when the trailer already has an active export allocation", async () => {
    store.exports = [
      { id: "export-active", trailer_id: "trailer-empty-free", status: "allocated" },
    ];

    await expect(
      createDeliveryBookingIfTrailerAvailable(supabase, {
        trailer_id: "trailer-empty-free",
        delivery_date: "2026-08-21",
      }),
    ).rejects.toMatchObject({
      name: "TrailerJobConflictError",
      code: "TRAILER_ACTIVE_EXPORT_ALLOCATION",
    });

    expect(store.inserted).toHaveLength(0);

    const available = await listTrailersAvailableForDeliveryBooking(supabase);
    expect(available.map((trailer) => trailer.id)).not.toContain("trailer-empty-free");
  });
});

describe("delivery booking availability source contracts", () => {
  it("keeps the new delivery selector on the shared persisted availability helper", () => {
    const source = readFileSync(new URL("../../app/dashboard/deliveries/new/page.tsx", import.meta.url), "utf8");
    expect(source).toContain("listTrailersAvailableForDeliveryBooking");
    expect(source).toContain("createDeliveryBookingIfTrailerAvailable");
    expect(source).not.toContain('.is("departure_date", null)');
  });

  it("queries persisted delivery bookings rather than load_status alone", () => {
    const source = readFileSync(new URL("../delivery-booking-availability.ts", import.meta.url), "utf8");
    expect(source).toContain('.from("delivery_bookings")');
    expect(source).toContain("DELIVERY_BOOKING_RELEASE_STATUS_QUERY");
    expect(source).toContain(DELIVERY_BOOKING_RELEASE_STATUS_QUERY);
    expect(source).not.toContain("load_status");
  });
});

describe("export operations regression", () => {
  const compoundTrailer = {
    id: "export-trailer",
    trailer_number: "FS9001",
    compound_position: "P01",
    departure_date: null,
    is_local: false,
  };

  it("keeps ALLOCATED export trailers visible in Compound", () => {
    expect(isExportAllocationOffCompoundStatus("allocated")).toBe(false);
    expect(isTrailerEligibleForCompoundViews(compoundTrailer, "allocated")).toBe(true);
  });

  it("keeps DELIVERED EMPTY export trailers out of Compound", () => {
    expect(isExportAllocationOffCompoundStatus("delivered_empty")).toBe(true);
    expect(isTrailerEligibleForCompoundViews(compoundTrailer, "delivered_empty")).toBe(false);
  });
});
