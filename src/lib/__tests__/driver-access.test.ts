import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { loadActiveDriverForUser, loadAssignedDeliveryBookingsForUser } from "@/lib/driver-access";
import type { Database } from "@/lib/database.types";

type DriverRow = {
  id: string;
  user_id: string | null;
  display_name: string;
  phone: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type BookingRow = {
  id: string;
  trailer_id: string;
  driver_id: string | null;
  delivery_date: string;
  delivery_time: string | null;
  customer: string | null;
  consignee: string | null;
  delivery_location: string | null;
  booking_reference: string | null;
  escort_required: boolean | null;
  status: string;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  delivered_at: string | null;
  waiting_collection_since: string | null;
  collection_due_date: string | null;
  collected_at: string | null;
  demurrage_free_days: number | null;
  demurrage_daily_rate: number | null;
  demurrage_currency: string | null;
  demurrage_notes: string | null;
};

type CreateMockInput = {
  driver: DriverRow | null;
  bookings: BookingRow[];
};

const createMockSupabase = (input: CreateMockInput) => {
  const driverQueryState: { userId: string | null; active: boolean | null } = { userId: null, active: null };
  const bookingQueryState: { driverId: string | null } = { driverId: null };

  type DriverChain = {
    select: () => DriverChain;
    eq: (column: string, value: unknown) => DriverChain;
    maybeSingle: () => Promise<{ data: DriverRow | null; error: null }>;
  };

  type BookingChain = {
    select: () => BookingChain;
    eq: (column: string, value: unknown) => BookingChain;
    order: () => BookingChain;
    then: (resolve: (value: { data: BookingRow[]; error: null }) => void) => void;
  };

  const createDriverChain = (): DriverChain => {
    const chain: DriverChain = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        if (column === "user_id") {
          driverQueryState.userId = typeof value === "string" ? value : null;
        }

        if (column === "active") {
          driverQueryState.active = value === true;
        }

        return chain;
      }),
      maybeSingle: vi.fn(async () => {
        const row = input.driver;
        if (!row || row.user_id !== driverQueryState.userId || row.active !== driverQueryState.active) {
          return { data: null, error: null };
        }

        return { data: row, error: null };
      }),
    };

    return chain;
  };

  const createBookingChain = (): BookingChain => {
    const chain: BookingChain = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        if (column === "driver_id") {
          bookingQueryState.driverId = typeof value === "string" ? value : null;
        }

        return chain;
      }),
      order: vi.fn(() => chain),
      then: (resolve: (value: { data: BookingRow[]; error: null }) => void) => {
        const rows = input.bookings.filter((row) => row.driver_id === bookingQueryState.driverId);
        resolve({ data: rows, error: null });
      },
    };

    return chain;
  };

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "drivers") {
        return createDriverChain();
      }

      if (table === "delivery_bookings") {
        return createBookingChain();
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  } as unknown as SupabaseClient<Database>;

  return { supabase, driverQueryState, bookingQueryState };
};

describe("driver access helpers", () => {
  it("resolves the authenticated user to the active driver record", async () => {
    const driver: DriverRow = {
      id: "driver-a",
      user_id: "user-a",
      display_name: "Driver A",
      phone: null,
      active: true,
      created_at: "2026-08-11T00:00:00.000Z",
      updated_at: "2026-08-11T00:00:00.000Z",
    };

    const { supabase, driverQueryState } = createMockSupabase({ driver, bookings: [] });

    const result = await loadActiveDriverForUser(supabase, "user-a");

    expect(result).toEqual(driver);
    expect(driverQueryState).toEqual({ userId: "user-a", active: true });
  });

  it("returns no tasks for an unlinked or inactive driver", async () => {
    const { supabase } = createMockSupabase({ driver: null, bookings: [] });

    const result = await loadAssignedDeliveryBookingsForUser(supabase, "user-missing");

    expect(result.driver).toBeNull();
    expect(result.assignedBookings).toEqual([]);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("scopes assigned bookings to the resolved driver only", async () => {
    const driver: DriverRow = {
      id: "driver-a",
      user_id: "user-a",
      display_name: "Driver A",
      phone: null,
      active: true,
      created_at: "2026-08-11T00:00:00.000Z",
      updated_at: "2026-08-11T00:00:00.000Z",
    };

    const bookings: BookingRow[] = [
      {
        id: "booking-a",
        trailer_id: "trailer-a",
        driver_id: "driver-a",
        delivery_date: "2026-08-11",
        delivery_time: null,
        customer: "Customer A",
        consignee: null,
        delivery_location: "Port A",
        booking_reference: "REF-A",
        escort_required: false,
        status: "scheduled",
        notes: null,
        created_at: "2026-08-11T00:00:00.000Z",
        updated_at: "2026-08-11T00:00:00.000Z",
        delivered_at: null,
        waiting_collection_since: null,
        collection_due_date: null,
        collected_at: null,
        demurrage_free_days: 0,
        demurrage_daily_rate: null,
        demurrage_currency: "GBP",
        demurrage_notes: null,
      },
      {
        id: "booking-b",
        trailer_id: "trailer-b",
        driver_id: "driver-b",
        delivery_date: "2026-08-11",
        delivery_time: null,
        customer: "Customer B",
        consignee: null,
        delivery_location: "Port B",
        booking_reference: "REF-B",
        escort_required: false,
        status: "scheduled",
        notes: null,
        created_at: "2026-08-11T00:00:00.000Z",
        updated_at: "2026-08-11T00:00:00.000Z",
        delivered_at: null,
        waiting_collection_since: null,
        collection_due_date: null,
        collected_at: null,
        demurrage_free_days: 0,
        demurrage_daily_rate: null,
        demurrage_currency: "GBP",
        demurrage_notes: null,
      },
    ];

    const { supabase, bookingQueryState } = createMockSupabase({ driver, bookings });

    const result = await loadAssignedDeliveryBookingsForUser(supabase, "user-a");

    expect(result.driver?.id).toBe("driver-a");
    expect(result.assignedBookings).toHaveLength(1);
    expect(result.assignedBookings[0]?.driver_id).toBe("driver-a");
    expect(bookingQueryState.driverId).toBe("driver-a");
  });

  it("does not return another driver's bookings", async () => {
    const driver: DriverRow = {
      id: "driver-a",
      user_id: "user-a",
      display_name: "Driver A",
      phone: null,
      active: true,
      created_at: "2026-08-11T00:00:00.000Z",
      updated_at: "2026-08-11T00:00:00.000Z",
    };

    const { supabase } = createMockSupabase({
      driver,
      bookings: [
        {
          id: "booking-b",
          trailer_id: "trailer-b",
          driver_id: "driver-b",
          delivery_date: "2026-08-11",
          delivery_time: null,
          customer: "Customer B",
          consignee: null,
          delivery_location: "Port B",
          booking_reference: "REF-B",
          escort_required: false,
          status: "scheduled",
          notes: null,
          created_at: "2026-08-11T00:00:00.000Z",
          updated_at: "2026-08-11T00:00:00.000Z",
          delivered_at: null,
          waiting_collection_since: null,
          collection_due_date: null,
          collected_at: null,
          demurrage_free_days: 0,
          demurrage_daily_rate: null,
          demurrage_currency: "GBP",
          demurrage_notes: null,
        },
      ],
    });

    const result = await loadAssignedDeliveryBookingsForUser(supabase, "user-a");

    expect(result.assignedBookings).toEqual([]);
  });
});