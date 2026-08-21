import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeMobileAction } from "@/lib/mobile/mobile-actions-service";

const {
  moveCompoundTrailerMock,
  createTrailerActivityMock,
  getTemperatureToleranceSettingsFromStorageMock,
  isTemperatureOutOfRangeMock,
  confirmTrailerDepartureMock,
} = vi.hoisted(() => ({
  moveCompoundTrailerMock: vi.fn(),
  createTrailerActivityMock: vi.fn(),
  getTemperatureToleranceSettingsFromStorageMock: vi.fn(),
  isTemperatureOutOfRangeMock: vi.fn(),
  confirmTrailerDepartureMock: vi.fn(),
}));

vi.mock("@/lib/compound-yard", () => ({
  moveCompoundTrailer: moveCompoundTrailerMock,
}));

vi.mock("@/lib/trailer-activity", () => ({
  createTrailerActivity: createTrailerActivityMock,
}));

vi.mock("@/lib/temperature-tolerance", () => ({
  getTemperatureToleranceSettingsFromStorage: getTemperatureToleranceSettingsFromStorageMock,
  isTemperatureOutOfRange: isTemperatureOutOfRangeMock,
}));

vi.mock("@/lib/operations/confirm-departure", () => ({
  confirmTrailerDeparture: confirmTrailerDepartureMock,
}));

type QueryRow = Record<string, unknown>;

class SelectQueryMock {
  private eqFilters = new Map<string, unknown>();

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

  maybeSingle() {
    const rows = (this.tables[this.table] ?? []).filter((row) => {
      return Array.from(this.eqFilters.entries()).every(([column, value]) => row[column] === value);
    });

    return Promise.resolve({ data: (rows[0] ?? null) as QueryRow | null, error: null });
  }
}

const createSupabaseMock = (tables: Record<string, QueryRow[]>, rpcResult?: { data?: unknown; error?: { message?: string } | null }) => {
  return {
    from(table: string) {
      return new SelectQueryMock(table, tables);
    },
    rpc: vi.fn().mockResolvedValue({ data: rpcResult?.data ?? null, error: rpcResult?.error ?? null }),
  } as never;
};

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "supervisor@example.com",
  user_metadata: { full_name: "Supervisor One" },
} as never;

describe("executeMobileAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTrailerActivityMock.mockResolvedValue(undefined);
    moveCompoundTrailerMock.mockResolvedValue(undefined);
    getTemperatureToleranceSettingsFromStorageMock.mockReturnValue({});
    isTemperatureOutOfRangeMock.mockReturnValue(false);
  });

  it("returns conflict for stale load status", async () => {
    const supabase = createSupabaseMock({
      trailers: [
        {
          id: "trailer-1",
          trailer_number: "FS1001",
          load_status: "Loaded",
          compound_position: "P10",
          operational_status: "Ready",
          departure_date: null,
          is_local: false,
        },
      ],
    });

    const result = await executeMobileAction(supabase, user, {
      actionType: "CHANGE_LOAD_STATUS",
      payload: {
        trailerId: "trailer-1",
        trailerNumber: "FS1001",
        nextLoadStatus: "Empty",
        expectedCurrentLoadStatus: "Empty",
      },
    });

    expect(result.status).toBe("conflict");
    expect(result.conflict?.code).toBe("stale_load_status");
  });

  it("returns conflict for stale compound position", async () => {
    const supabase = createSupabaseMock({
      trailers: [
        {
          id: "trailer-1",
          trailer_number: "FS1001",
          load_status: "Empty",
          compound_position: "P08",
          operational_status: "Ready",
          departure_date: null,
          is_local: false,
        },
      ],
    });

    const result = await executeMobileAction(supabase, user, {
      actionType: "MOVE_COMPOUND_POSITION",
      payload: {
        trailerId: "trailer-1",
        trailerNumber: "FS1001",
        targetPosition: "P12",
        expectedCurrentPosition: "P10",
      },
    });

    expect(result.status).toBe("conflict");
    expect(result.conflict?.code).toBe("stale_position");
  });

  it("returns conflict when trailer departed before queued sync", async () => {
    const supabase = createSupabaseMock({
      trailers: [
        {
          id: "trailer-1",
          trailer_number: "FS1001",
          load_status: "Empty",
          compound_position: "P10",
          operational_status: "Ready",
          departure_date: "2026-07-26T10:00:00.000Z",
          is_local: false,
        },
      ],
    });

    const result = await executeMobileAction(supabase, user, {
      actionType: "MOVE_COMPOUND_POSITION",
      payload: {
        trailerId: "trailer-1",
        trailerNumber: "FS1001",
        targetPosition: "P12",
      },
    });

    expect(result.status).toBe("conflict");
    expect(result.conflict?.code).toBe("trailer_departed");
  });

  it("returns success for idempotent repeated arrival", async () => {
    const supabase = createSupabaseMock({
      vessel_operation_trailers: [
        {
          id: "vt-1",
          vessel_operation_id: "op-1",
          trailer_id: "trailer-1",
          trailer_number: "FS1001",
          arrival_status: "arrived",
          arrival_record_id: "trailer-1",
          status: "arrived",
          inspection_started_at: null,
          inspection_completed_at: null,
          expected_front_temperature: null,
          expected_rear_temperature: null,
          expected_temperature_unit: "C",
          temperature_required: null,
          has_damage: false,
          has_temperature_alert: false,
        },
      ],
    });

    const result = await executeMobileAction(supabase, user, {
      actionType: "MARK_ARRIVED",
      payload: {
        vesselTrailerId: "vt-1",
        trailerNumber: "FS1001",
      },
    });

    expect(result.status).toBe("success");
    expect(result.message).toContain("already marked as arrived");
  });

  it("returns failed when trailer is no longer visible in vessel operations", async () => {
    const supabase = createSupabaseMock({
      vessel_operation_trailers: [],
    });

    const result = await executeMobileAction(supabase, user, {
      actionType: "MARK_ARRIVED",
      payload: {
        vesselTrailerId: "vt-missing",
        trailerNumber: "FS1001",
      },
    });

    expect(result.status).toBe("failed");
    expect(result.retryable).toBe(false);
  });

  it("returns conflict when inspection already completed elsewhere", async () => {
    const supabase = createSupabaseMock({
      vessel_operation_trailers: [
        {
          id: "vt-1",
          vessel_operation_id: "op-1",
          trailer_id: "trailer-1",
          trailer_number: "FS1001",
          arrival_status: "arrived",
          arrival_record_id: "trailer-1",
          status: "inspected",
          inspection_started_at: "2026-07-26T10:00:00.000Z",
          inspection_completed_at: "2026-07-26T10:30:00.000Z",
          expected_front_temperature: 2,
          expected_rear_temperature: 3,
          expected_temperature_unit: "C",
          temperature_required: null,
          has_damage: false,
          has_temperature_alert: false,
        },
      ],
    });

    const result = await executeMobileAction(supabase, user, {
      actionType: "SAVE_INSPECTION_PROGRESS",
      payload: {
        vesselTrailerId: "vt-1",
        trailerNumber: "FS1001",
        frontTemperature: 2,
        rearTemperature: 3,
        unit: "C",
        notes: "ok",
        damage: { hasDamage: false },
      },
    });

    expect(result.status).toBe("conflict");
    expect(result.conflict?.code).toBe("inspection_completed");
  });

  it("returns success when inspection already started elsewhere", async () => {
    const supabase = createSupabaseMock({
      vessel_operation_trailers: [
        {
          id: "vt-1",
          vessel_operation_id: "op-1",
          trailer_id: "trailer-1",
          trailer_number: "FS1001",
          arrival_status: "arrived",
          arrival_record_id: "trailer-1",
          status: "arrived",
          inspection_started_at: "2026-07-26T10:00:00.000Z",
          inspection_completed_at: null,
          expected_front_temperature: 2,
          expected_rear_temperature: 3,
          expected_temperature_unit: "C",
          temperature_required: null,
          has_damage: false,
          has_temperature_alert: false,
        },
      ],
    });

    const result = await executeMobileAction(supabase, user, {
      actionType: "START_INSPECTION",
      payload: {
        vesselTrailerId: "vt-1",
        trailerNumber: "FS1001",
      },
    });

    expect(result.status).toBe("success");
    expect(result.message).toContain("inspection already started");
  });

  it("returns failed for permanent inspection validation errors", async () => {
    const supabase = createSupabaseMock({
      vessel_operation_trailers: [
        {
          id: "vt-1",
          vessel_operation_id: "op-1",
          trailer_id: "trailer-1",
          trailer_number: "FS1001",
          arrival_status: "arrived",
          arrival_record_id: "trailer-1",
          status: "arrived",
          inspection_started_at: null,
          inspection_completed_at: null,
          expected_front_temperature: 2,
          expected_rear_temperature: 3,
          expected_temperature_unit: "C",
          temperature_required: null,
          has_damage: false,
          has_temperature_alert: false,
        },
      ],
    });

    const result = await executeMobileAction(supabase, user, {
      actionType: "COMPLETE_INSPECTION",
      payload: {
        vesselTrailerId: "vt-1",
        trailerNumber: "FS1001",
        frontTemperature: null,
        rearTemperature: 3,
        unit: "C",
        notes: "",
        damage: { hasDamage: false },
      },
    });

    expect(result.status).toBe("failed");
    expect(result.retryable).toBe(false);
    expect(result.message).toContain("Front temperature is required");
  });

  it("returns retryable failed result when arrival RPC errors", async () => {
    const supabase = createSupabaseMock(
      {
        vessel_operation_trailers: [
          {
            id: "vt-1",
            vessel_operation_id: "op-1",
            trailer_id: "trailer-1",
            trailer_number: "FS1001",
            arrival_status: "expected",
            arrival_record_id: null,
            status: "expected",
            inspection_started_at: null,
            inspection_completed_at: null,
            expected_front_temperature: null,
            expected_rear_temperature: null,
            expected_temperature_unit: "C",
            temperature_required: null,
            has_damage: false,
            has_temperature_alert: false,
          },
        ],
      },
      { error: { message: "Temporary network error" } },
    );

    const result = await executeMobileAction(supabase, user, {
      actionType: "MARK_ARRIVED",
      payload: {
        vesselTrailerId: "vt-1",
        trailerNumber: "FS1001",
      },
    });

    expect(result.status).toBe("failed");
    expect(result.retryable).toBe(true);
  });

  it("rejects CONFIRM_DEPARTURE when the trailer is reserved", async () => {
    const { TrailerJobConflictError, TRAILER_NOT_AVAILABLE_FOR_DEPARTURE_CODE } = await import("@/lib/trailer-job-eligibility");
    confirmTrailerDepartureMock.mockRejectedValue(
      new TrailerJobConflictError(TRAILER_NOT_AVAILABLE_FOR_DEPARTURE_CODE, "Trailer FS1001 is reserved or is no longer available for departure."),
    );

    const result = await executeMobileAction(createSupabaseMock({}), user, {
      actionType: "CONFIRM_DEPARTURE",
      payload: {
        trailerId: "11111111-1111-4111-8111-111111111111",
        trailerNumber: "FS1001",
      },
    });

    expect(result.status).toBe("conflict");
    expect(result.conflict?.code).toBe(TRAILER_NOT_AVAILABLE_FOR_DEPARTURE_CODE);
    expect(result.ok).toBe(false);
  });

  it("treats repeated CONFIRM_DEPARTURE on an already departed trailer as success", async () => {
    confirmTrailerDepartureMock.mockResolvedValue({
      alreadyDeparted: true,
      trailerId: "11111111-1111-4111-8111-111111111111",
      trailerNumber: "FS1001",
      snapshot: {
        trailerId: "11111111-1111-4111-8111-111111111111",
        trailerNumber: "FS1001",
        expectedDepartureAt: "2026-08-20T10:00:00.000Z",
        previousDepartureDate: "2026-08-20T10:00:00.000Z",
        previousDepartureTime: "11:00:00",
        previousCompoundPosition: null,
        previousOperationalStatus: "Departed",
      },
      updated: null,
    });

    const result = await executeMobileAction(createSupabaseMock({}), user, {
      actionType: "CONFIRM_DEPARTURE",
      payload: {
        trailerId: "11111111-1111-4111-8111-111111111111",
        trailerNumber: "FS1001",
      },
    });

    expect(result.status).toBe("success");
    expect(result.message).toContain("already departed");
  });

  it("confirms an eligible departure through the shared helper", async () => {
    confirmTrailerDepartureMock.mockResolvedValue({
      alreadyDeparted: false,
      trailerId: "11111111-1111-4111-8111-111111111111",
      trailerNumber: "FS1001",
      snapshot: {
        trailerId: "11111111-1111-4111-8111-111111111111",
        trailerNumber: "FS1001",
        expectedDepartureAt: "2026-08-20T12:00:00.000Z",
        previousDepartureDate: null,
        previousDepartureTime: null,
        previousCompoundPosition: "P10",
        previousOperationalStatus: "Ready",
      },
      updated: {
        departure_date: "2026-08-20T12:00:00.000Z",
        departure_time: "13:00:00",
        operational_status: "Departed",
        compound_position: null,
      },
    });

    const result = await executeMobileAction(createSupabaseMock({}), user, {
      actionType: "CONFIRM_DEPARTURE",
      payload: {
        trailerId: "11111111-1111-4111-8111-111111111111",
        trailerNumber: "FS1001",
      },
    });

    expect(result.status).toBe("success");
    expect(result.message).toContain("departed");
    expect(confirmTrailerDepartureMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trailerId: "11111111-1111-4111-8111-111111111111",
        operatorName: "Supervisor One",
      }),
    );
  });
});