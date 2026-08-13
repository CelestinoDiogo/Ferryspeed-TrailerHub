import type { SupabaseClient, User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createTrailerActivity } from "@/lib/trailer-activity";
import { applyDriverTaskAction, loadDriverMobileTasksForDriver, loadDriverMobileTasksForUser } from "@/lib/driver-mobile-service";
import type { Database } from "@/lib/database.types";

vi.mock("@/lib/trailer-activity", () => ({
  createTrailerActivity: vi.fn(async () => ({ id: "activity-id" })),
}));

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
  driver_acknowledged_at?: string | null;
  driver_acknowledged_by?: string | null;
  temperature_required?: boolean;
  collected_temperature_c?: number | null;
};

type TrailerRow = {
  id: string;
  trailer_number: string | null;
};

type VesselTempRow = {
  trailer_id: string | null;
  temperature_required: string | null;
  expected_front_temperature: number | null;
  expected_rear_temperature: number | null;
  expected_temperature_unit: string | null;
  updated_at: string | null;
};

type CreateMockInput = {
  driver: DriverRow | null;
  bookings: BookingRow[];
  trailers?: TrailerRow[];
  vesselTemps?: VesselTempRow[];
};

const createMockSupabase = (input: CreateMockInput) => {
  const driverQueryState: { userId: string | null; active: boolean | null } = { userId: null, active: null };
  const bookingQueryState: { driverId: string | null; id: string | null } = { driverId: null, id: null };
  const updateState: { patch: Partial<BookingRow> | null; id: string | null; driverId: string | null } = {
    patch: null,
    id: null,
    driverId: null,
  };

  const bookings = [...input.bookings];
  const trailers = input.trailers ?? [];
  const vesselTemps = input.vesselTemps ?? [];

  const createDriverChain = () => {
    const chain = {
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

  const createDeliverySelectChain = () => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        if (column === "driver_id") {
          bookingQueryState.driverId = typeof value === "string" ? value : null;
        }
        if (column === "id") {
          bookingQueryState.id = typeof value === "string" ? value : null;
        }
        return chain;
      }),
      order: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => {
        const match = bookings.find((row) => row.id === bookingQueryState.id && row.driver_id === bookingQueryState.driverId) ?? null;
        return { data: match, error: null };
      }),
      then: (resolve: (value: { data: BookingRow[]; error: null }) => void) => {
        const scopedRows = bookings.filter((row) => row.driver_id === bookingQueryState.driverId);
        resolve({ data: scopedRows, error: null });
      },
    };

    return chain;
  };

  const createDeliveryUpdateChain = (patch: Partial<BookingRow>) => {
    const chain = {
      eq: vi.fn((column: string, value: unknown) => {
        if (column === "id") {
          updateState.id = typeof value === "string" ? value : null;
        }

        if (column === "driver_id") {
          updateState.driverId = typeof value === "string" ? value : null;
        }

        return chain;
      }),
      select: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => {
        const index = bookings.findIndex((row) => row.id === updateState.id && row.driver_id === updateState.driverId);
        if (index === -1) {
          return { data: null, error: { message: "not found" } };
        }

        bookings[index] = {
          ...bookings[index],
          ...patch,
        };

        return { data: bookings[index], error: null };
      }),
    };

    return chain;
  };

  const createTrailerSelectChain = () => {
    const state = { id: null as string | null, ids: [] as string[] };
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        if (column === "id") {
          state.id = typeof value === "string" ? value : null;
        }
        return chain;
      }),
      in: vi.fn((column: string, values: unknown[]) => {
        if (column === "id") {
          state.ids = values.filter((value): value is string => typeof value === "string");
        }
        return chain;
      }),
      maybeSingle: vi.fn(async () => {
        const row = trailers.find((item) => item.id === state.id) ?? null;
        return { data: row, error: null };
      }),
      then: (resolve: (value: { data: TrailerRow[]; error: null }) => void) => {
        const rows = trailers.filter((item) => state.ids.includes(item.id));
        resolve({ data: rows, error: null });
      },
    };
    return chain;
  };

  const createVesselTempChain = () => {
    const state = { trailerIds: [] as string[] };
    const chain = {
      select: vi.fn(() => chain),
      in: vi.fn((column: string, values: unknown[]) => {
        if (column === "trailer_id") {
          state.trailerIds = values.filter((value): value is string => typeof value === "string");
        }
        return chain;
      }),
      then: (resolve: (value: { data: VesselTempRow[]; error: null }) => void) => {
        const rows = vesselTemps.filter((item) => item.trailer_id && state.trailerIds.includes(item.trailer_id));
        resolve({ data: rows, error: null });
      },
    };
    return chain;
  };

  const trailerEventsInsert = vi.fn(async () => ({ error: null }));

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "drivers") {
        return createDriverChain();
      }

      if (table === "delivery_bookings") {
        return {
          select: vi.fn(() => createDeliverySelectChain()),
          update: vi.fn((patch: Partial<BookingRow>) => {
            updateState.patch = patch;
            return createDeliveryUpdateChain(patch);
          }),
        };
      }

      if (table === "trailers") {
        return createTrailerSelectChain();
      }

      if (table === "vessel_operation_trailers") {
        return createVesselTempChain();
      }

      if (table === "trailer_events") {
        return {
          insert: trailerEventsInsert,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  } as unknown as SupabaseClient<Database>;

  return { supabase, driverQueryState, bookingQueryState, updateState, trailerEventsInsert };
};

const makeUser = (id: string): User =>
  ({
    id,
    app_metadata: {},
    user_metadata: { full_name: "Driver One" },
    aud: "authenticated",
    created_at: "2026-08-11T00:00:00.000Z",
  }) as User;

describe("driver mobile service", () => {
  it("loads only tasks assigned to the resolved active driver", async () => {
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
        delivery_location: "Dock A",
        booking_reference: "BK-A",
        escort_required: false,
        status: "scheduled",
        notes: null,
        created_at: "2026-08-11T00:00:00.000Z",
        updated_at: "2026-08-11T00:00:00.000Z",
        delivered_at: null,
        waiting_collection_since: null,
        collection_due_date: null,
        collected_at: null,
        demurrage_free_days: null,
        demurrage_daily_rate: null,
        demurrage_currency: null,
        demurrage_notes: null,
        temperature_required: false,
        collected_temperature_c: null,
      },
      {
        id: "booking-b",
        trailer_id: "trailer-b",
        driver_id: "driver-b",
        delivery_date: "2026-08-11",
        delivery_time: null,
        customer: "Customer B",
        consignee: null,
        delivery_location: "Dock B",
        booking_reference: "BK-B",
        escort_required: false,
        status: "scheduled",
        notes: null,
        created_at: "2026-08-11T00:00:00.000Z",
        updated_at: "2026-08-11T00:00:00.000Z",
        delivered_at: null,
        waiting_collection_since: null,
        collection_due_date: null,
        collected_at: null,
        demurrage_free_days: null,
        demurrage_daily_rate: null,
        demurrage_currency: null,
        demurrage_notes: null,
        temperature_required: false,
        collected_temperature_c: null,
      },
      {
        id: "booking-unassigned",
        trailer_id: "trailer-c",
        driver_id: null,
        delivery_date: "2026-08-11",
        delivery_time: null,
        customer: "Customer C",
        consignee: "Consignee C",
        delivery_location: "Dock C",
        booking_reference: "BK-C",
        escort_required: false,
        status: "scheduled",
        notes: null,
        created_at: "2026-08-11T00:00:00.000Z",
        updated_at: "2026-08-11T00:00:00.000Z",
        delivered_at: null,
        waiting_collection_since: null,
        collection_due_date: null,
        collected_at: null,
        demurrage_free_days: null,
        demurrage_daily_rate: null,
        demurrage_currency: null,
        demurrage_notes: null,
        temperature_required: false,
        collected_temperature_c: null,
      },
    ];

    const { supabase, bookingQueryState, driverQueryState } = createMockSupabase({
      driver,
      bookings,
      trailers: [{ id: "trailer-a", trailer_number: "FS1001" }],
    });

    const result = await loadDriverMobileTasksForUser(supabase, "user-a");

    expect(driverQueryState).toEqual({ userId: "user-a", active: true });
    expect(bookingQueryState.driverId).toBe("driver-a");
    expect(result.driver?.id).toBe("driver-a");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.bookingId).toBe("booking-a");
    expect(result.tasks[0]?.consignee).toBeNull();
    expect(result.tasks[0]?.nextAction).toBe("ACKNOWLEDGED");
    expect(result.tasks[0]?.temperature.required).toBe(false);

    const previewResult = await loadDriverMobileTasksForDriver(supabase, driver);
    expect(previewResult.tasks).toHaveLength(1);
    expect(previewResult.tasks[0]?.bookingId).toBe("booking-a");
    expect(previewResult.tasks.some((task) => task.bookingId === "booking-b")).toBe(false);
  });

  it("classifies waiting_collection work as collection tasks", async () => {
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
        id: "booking-collection",
        trailer_id: "trailer-a",
        driver_id: "driver-a",
        delivery_date: "2026-08-11",
        delivery_time: null,
        customer: "Customer A",
        consignee: "Consignee A",
        delivery_location: "Dock A",
        booking_reference: "BK-A",
        escort_required: false,
        status: "waiting_collection",
        notes: null,
        created_at: "2026-08-11T00:00:00.000Z",
        updated_at: "2026-08-11T00:00:00.000Z",
        delivered_at: "2026-08-11T09:00:00.000Z",
        waiting_collection_since: "2026-08-11T09:10:00.000Z",
        collection_due_date: "2026-08-12",
        collected_at: null,
        demurrage_free_days: null,
        demurrage_daily_rate: null,
        demurrage_currency: null,
        demurrage_notes: null,
        temperature_required: false,
        collected_temperature_c: null,
      },
    ];

    const { supabase } = createMockSupabase({
      driver,
      bookings,
      trailers: [{ id: "trailer-a", trailer_number: "FS1001" }],
    });

    const result = await loadDriverMobileTasksForUser(supabase, "user-a");

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({
      bookingId: "booking-collection",
      taskKind: "collection",
      nextAction: "ACKNOWLEDGED",
      waitingCollectionSince: "2026-08-11T09:10:00.000Z",
    });
  });

  it("acknowledges owned booking once and keeps subsequent acknowledgements idempotent", async () => {
    const driver: DriverRow = {
      id: "driver-a",
      user_id: "user-a",
      display_name: "Driver A",
      phone: null,
      active: true,
      created_at: "2026-08-11T00:00:00.000Z",
      updated_at: "2026-08-11T00:00:00.000Z",
    };

    const booking: BookingRow = {
      id: "booking-a",
      trailer_id: "trailer-a",
      driver_id: "driver-a",
      delivery_date: "2026-08-11",
      delivery_time: null,
      customer: "Customer A",
      consignee: null,
      delivery_location: "Dock A",
      booking_reference: "BK-A",
      escort_required: false,
      status: "scheduled",
      notes: null,
      created_at: "2026-08-11T00:00:00.000Z",
      updated_at: "2026-08-11T00:00:00.000Z",
      delivered_at: null,
      waiting_collection_since: null,
      collection_due_date: null,
      collected_at: null,
      demurrage_free_days: null,
      demurrage_daily_rate: null,
      demurrage_currency: null,
      demurrage_notes: null,
      driver_acknowledged_at: null,
      driver_acknowledged_by: null,
      temperature_required: false,
      collected_temperature_c: null,
    };

    const { supabase, trailerEventsInsert } = createMockSupabase({
      driver,
      bookings: [booking],
      trailers: [{ id: "trailer-a", trailer_number: "FS1001" }],
    });

    const createTrailerActivityMock = vi.mocked(createTrailerActivity);
    createTrailerActivityMock.mockClear();

    const first = await applyDriverTaskAction({
      supabase,
      user: makeUser("user-a"),
      bookingId: "booking-a",
      action: "ACKNOWLEDGED",
    });

    const second = await applyDriverTaskAction({
      supabase,
      user: makeUser("user-a"),
      bookingId: "booking-a",
      action: "ACKNOWLEDGED",
    });

    expect(first.driver_acknowledged_at).toBeTruthy();
    expect(second.driver_acknowledged_at).toBe(first.driver_acknowledged_at);
    expect(second.driver_acknowledged_by).toBe("user-a");
    expect(trailerEventsInsert).toHaveBeenCalledTimes(1);
    expect(createTrailerActivityMock).toHaveBeenCalledTimes(1);
  });

  it("rejects updates for booking outside authenticated driver ownership", async () => {
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
          delivery_location: "Dock B",
          booking_reference: "BK-B",
          escort_required: false,
          status: "on_delivery",
          notes: null,
          created_at: "2026-08-11T00:00:00.000Z",
          updated_at: "2026-08-11T00:00:00.000Z",
          delivered_at: null,
          waiting_collection_since: null,
          collection_due_date: null,
          collected_at: null,
          demurrage_free_days: null,
          demurrage_daily_rate: null,
          demurrage_currency: null,
          demurrage_notes: null,
          temperature_required: false,
          collected_temperature_c: null,
        },
      ],
    });

    await expect(
      applyDriverTaskAction({
        supabase,
        user: makeUser("user-a"),
        bookingId: "booking-b",
        action: "DELIVERED",
      }),
    ).rejects.toThrow("Task not found or not assigned to the authenticated driver.");
  });

  it("updates owned booking and records event metadata for collected action", async () => {
    const driver: DriverRow = {
      id: "driver-a",
      user_id: "user-a",
      display_name: "Driver A",
      phone: null,
      active: true,
      created_at: "2026-08-11T00:00:00.000Z",
      updated_at: "2026-08-11T00:00:00.000Z",
    };

    const booking: BookingRow = {
      id: "booking-a",
      trailer_id: "trailer-a",
      driver_id: "driver-a",
      delivery_date: "2026-08-11",
      delivery_time: null,
      customer: "Customer A",
      consignee: null,
      delivery_location: "Dock A",
      booking_reference: "BK-A",
      escort_required: false,
      status: "scheduled",
      notes: null,
      created_at: "2026-08-11T00:00:00.000Z",
      updated_at: "2026-08-11T00:00:00.000Z",
      delivered_at: null,
      waiting_collection_since: null,
      collection_due_date: null,
      collected_at: null,
      demurrage_free_days: null,
      demurrage_daily_rate: null,
      demurrage_currency: null,
      demurrage_notes: null,
      driver_acknowledged_at: "2026-08-11T09:00:00.000Z",
      driver_acknowledged_by: "user-a",
      temperature_required: false,
      collected_temperature_c: null,
    };

    const { supabase, updateState, trailerEventsInsert } = createMockSupabase({
      driver,
      bookings: [booking],
      trailers: [{ id: "trailer-a", trailer_number: "FS1001" }],
    });

    const updated = await applyDriverTaskAction({
      supabase,
      user: makeUser("user-a"),
      bookingId: "booking-a",
      action: "COLLECTED",
      temperatureC: 1.2,
    });

    expect(updateState.driverId).toBe("driver-a");
    expect(updateState.id).toBe("booking-a");
    expect(updateState.patch?.collected_temperature_c).toBe(1.2);
    expect(updated.status).toBe("on_delivery");
    expect(trailerEventsInsert).toHaveBeenCalledTimes(1);
  });

  it("closes a waiting collection task when collected and records history", async () => {
    const driver: DriverRow = {
      id: "driver-a",
      user_id: "user-a",
      display_name: "Driver A",
      phone: null,
      active: true,
      created_at: "2026-08-11T00:00:00.000Z",
      updated_at: "2026-08-11T00:00:00.000Z",
    };

    const booking: BookingRow = {
      id: "booking-a",
      trailer_id: "trailer-a",
      driver_id: "driver-a",
      delivery_date: "2026-08-11",
      delivery_time: null,
      customer: "Customer A",
      consignee: null,
      delivery_location: "Dock A",
      booking_reference: "BK-A",
      escort_required: false,
      status: "waiting_collection",
      notes: null,
      created_at: "2026-08-11T00:00:00.000Z",
      updated_at: "2026-08-12T08:00:00.000Z",
      delivered_at: "2026-08-11T08:00:00.000Z",
      waiting_collection_since: "2026-08-11T08:30:00.000Z",
      collection_due_date: "2026-08-12",
      collected_at: null,
      demurrage_free_days: null,
      demurrage_daily_rate: null,
      demurrage_currency: null,
      demurrage_notes: null,
      driver_acknowledged_at: "2026-08-11T09:00:00.000Z",
      driver_acknowledged_by: "user-a",
      temperature_required: false,
      collected_temperature_c: null,
    };

    const { supabase, updateState, trailerEventsInsert } = createMockSupabase({
      driver,
      bookings: [booking],
      trailers: [{ id: "trailer-a", trailer_number: "FS1001" }],
    });

    const createTrailerActivityMock = vi.mocked(createTrailerActivity);
    createTrailerActivityMock.mockClear();

    const updated = await applyDriverTaskAction({
      supabase,
      user: makeUser("user-a"),
      bookingId: "booking-a",
      action: "COLLECTED",
    });

    expect(updateState.patch?.status).toBe("collected");
    expect(updateState.patch?.collected_at).toBeTruthy();
    expect(updated.status).toBe("collected");
    expect(trailerEventsInsert).toHaveBeenCalledTimes(1);
    expect(createTrailerActivityMock).toHaveBeenCalledTimes(1);
  });

  it("blocks collected action when booking requires temperature and reading is missing", async () => {
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
          id: "booking-a",
          trailer_id: "trailer-a",
          driver_id: "driver-a",
          delivery_date: "2026-08-11",
          delivery_time: null,
          customer: "Customer A",
          consignee: null,
          delivery_location: "Dock A",
          booking_reference: "BK-A",
          escort_required: false,
          status: "ready",
          notes: null,
          created_at: "2026-08-11T00:00:00.000Z",
          updated_at: "2026-08-11T00:00:00.000Z",
          delivered_at: null,
          waiting_collection_since: null,
          collection_due_date: null,
          collected_at: null,
          demurrage_free_days: null,
          demurrage_daily_rate: null,
          demurrage_currency: null,
          demurrage_notes: null,
          temperature_required: true,
          collected_temperature_c: null,
        },
      ],
      trailers: [{ id: "trailer-a", trailer_number: "FS1001" }],
    });

    await expect(
      applyDriverTaskAction({
        supabase,
        user: makeUser("user-a"),
        bookingId: "booking-a",
        action: "COLLECTED",
      }),
    ).rejects.toThrow("Temperature reading is required before marking this booking as collected.");
  });

  it("blocks lifecycle action before acknowledgement is recorded", async () => {
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
          id: "booking-a",
          trailer_id: "trailer-a",
          driver_id: "driver-a",
          delivery_date: "2026-08-11",
          delivery_time: null,
          customer: "Customer A",
          consignee: null,
          delivery_location: "Dock A",
          booking_reference: "BK-A",
          escort_required: false,
          status: "ready",
          notes: null,
          created_at: "2026-08-11T00:00:00.000Z",
          updated_at: "2026-08-11T00:00:00.000Z",
          delivered_at: null,
          waiting_collection_since: null,
          collection_due_date: null,
          collected_at: null,
          demurrage_free_days: null,
          demurrage_daily_rate: null,
          demurrage_currency: null,
          demurrage_notes: null,
          driver_acknowledged_at: null,
          driver_acknowledged_by: null,
          temperature_required: false,
          collected_temperature_c: null,
        },
      ],
      trailers: [{ id: "trailer-a", trailer_number: "FS1001" }],
    });

    await expect(
      applyDriverTaskAction({
        supabase,
        user: makeUser("user-a"),
        bookingId: "booking-a",
        action: "COLLECTED",
      }),
    ).rejects.toThrow("Task must be acknowledged before lifecycle status updates.");
  });

  it("allows collected action without temperature for non-temperature bookings", async () => {
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
          id: "booking-a",
          trailer_id: "trailer-a",
          driver_id: "driver-a",
          delivery_date: "2026-08-11",
          delivery_time: null,
          customer: "Customer A",
          consignee: null,
          delivery_location: "Dock A",
          booking_reference: "BK-A",
          escort_required: false,
          status: "ready",
          notes: null,
          created_at: "2026-08-11T00:00:00.000Z",
          updated_at: "2026-08-11T00:00:00.000Z",
          delivered_at: null,
          waiting_collection_since: null,
          collection_due_date: null,
          collected_at: null,
          demurrage_free_days: null,
          demurrage_daily_rate: null,
          demurrage_currency: null,
          demurrage_notes: null,
          driver_acknowledged_at: "2026-08-11T09:00:00.000Z",
          driver_acknowledged_by: "user-a",
          temperature_required: false,
          collected_temperature_c: null,
        },
      ],
      trailers: [{ id: "trailer-a", trailer_number: "FS1001" }],
    });

    const updated = await applyDriverTaskAction({
      supabase,
      user: makeUser("user-a"),
      bookingId: "booking-a",
      action: "COLLECTED",
    });

    expect(updated.status).toBe("on_delivery");
    expect(updated.collected_temperature_c).toBeNull();
  });

  it("rejects delivered action when prior state is not on_delivery", async () => {
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
          id: "booking-a",
          trailer_id: "trailer-a",
          driver_id: "driver-a",
          delivery_date: "2026-08-11",
          delivery_time: null,
          customer: "Customer A",
          consignee: null,
          delivery_location: "Dock A",
          booking_reference: "BK-A",
          escort_required: false,
          status: "scheduled",
          notes: null,
          created_at: "2026-08-11T00:00:00.000Z",
          updated_at: "2026-08-11T00:00:00.000Z",
          delivered_at: null,
          waiting_collection_since: null,
          collection_due_date: null,
          collected_at: null,
          demurrage_free_days: null,
          demurrage_daily_rate: null,
          demurrage_currency: null,
          demurrage_notes: null,
          driver_acknowledged_at: "2026-08-11T09:00:00.000Z",
          driver_acknowledged_by: "user-a",
          temperature_required: false,
          collected_temperature_c: null,
        },
      ],
      trailers: [{ id: "trailer-a", trailer_number: "FS1001" }],
    });

    await expect(
      applyDriverTaskAction({
        supabase,
        user: makeUser("user-a"),
        bookingId: "booking-a",
        action: "DELIVERED",
      }),
    ).rejects.toThrow("Task is not eligible for the Delivered action.");
  });
});
