import { describe, expect, it, vi } from "vitest";
import { createOperationalAlert, operationalAlertTestUtils, type OperationalAlertRow } from "@/lib/operational-alerts";

const makeAlert = (overrides: Partial<OperationalAlertRow> = {}): OperationalAlertRow => ({
  id: overrides.id ?? "alert-1",
  alert_key: overrides.alert_key ?? "inspection:Inspection missing photos:00000000-0000-4000-8000-000000000222",
  alert_type: overrides.alert_type ?? "inspection_inspection_missing_photos",
  severity: overrides.severity ?? "warning",
  status: overrides.status ?? "active",
  title: overrides.title ?? "Inspection missing photos",
  description: overrides.description ?? "Completed inspection has no linked photos.",
  trailer_id: overrides.trailer_id ?? "00000000-0000-4000-8000-000000000111",
  trailer_number: overrides.trailer_number ?? "FS100",
  source_module: overrides.source_module ?? "inspection",
  source_record_id: overrides.source_record_id ?? "00000000-0000-4000-8000-000000000222",
  metadata: overrides.metadata ?? {},
  acknowledged_at: overrides.acknowledged_at ?? null,
  acknowledged_by: overrides.acknowledged_by ?? null,
  resolved_at: overrides.resolved_at ?? null,
  resolved_by: overrides.resolved_by ?? null,
  resolution_note: overrides.resolution_note ?? null,
  dismissed_at: overrides.dismissed_at ?? null,
  dismissed_by: overrides.dismissed_by ?? null,
  created_at: overrides.created_at ?? "2026-08-01T10:00:00.000Z",
  updated_at: overrides.updated_at ?? "2026-08-01T10:00:00.000Z",
});

type MockInsertError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

const makeSelectChain = (result: { data: OperationalAlertRow[] | null; error: MockInsertError | null }) => {
  const chain: {
    eq: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    then: (onfulfilled: (value: typeof result) => unknown) => Promise<unknown>;
  } = {
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: (onfulfilled) => Promise.resolve(onfulfilled(result)),
  };

  chain.eq.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);

  return chain;
};

const makeClient = (options: {
  selectResults: Array<{ data: OperationalAlertRow[] | null; error: MockInsertError | null }>;
  insertResult: { data: OperationalAlertRow | null; error: MockInsertError | null };
  updateResult?: { data: OperationalAlertRow | null; error: MockInsertError | null };
}) => {
  const selectChains = options.selectResults.map((result) => makeSelectChain(result));

  const select = vi.fn().mockImplementation(() => {
    const chain = selectChains.shift();
    if (!chain) {
      throw new Error("No select chain left in mock queue.");
    }
    return chain;
  });

  const updateSingle = vi.fn().mockResolvedValue(options.updateResult ?? { data: null, error: { message: "Unable to update operational alert." } });
  const updateSelect = vi.fn().mockReturnValue({ single: updateSingle });
  const updateEq = vi.fn().mockReturnValue({ select: updateSelect });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  const insertSingle = vi.fn().mockResolvedValue(options.insertResult);
  const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
  const insert = vi.fn().mockReturnValue({ select: insertSelect });

  const from = vi.fn().mockImplementation(() => ({
    select,
    update,
    insert,
  }));

  const client = {
    from,
    auth: {
      getUser: vi.fn(),
    },
  } as never;

  return {
    client,
    mocks: {
      select,
      update,
      updateEq,
      updateSelect,
      updateSingle,
      insert,
      insertSelect,
      insertSingle,
      from,
      selectChains,
    },
  };
};

describe("operational alert compound timestamp hierarchy", () => {
  it("normalizes legacy open alerts as active", () => {
    expect(operationalAlertTestUtils.normalizeAlertStatus("open")).toBe("active");
    expect(operationalAlertTestUtils.normalizeAlertStatus("resolved")).toBe("resolved");
  });

  it("prefers trailer arrival_date for compound entry timestamp", () => {
    const entry = operationalAlertTestUtils.resolveCompoundEntryTimestamp(
      {
        arrival_date: "2026-01-10T10:00:00.000Z",
        created_at: "2026-01-09T08:00:00.000Z",
      },
      [
        {
          trailer_id: "a",
          normalized_trailer_number: "FS123",
          event_type: "compound_entered",
          created_at: "2026-01-11T12:00:00.000Z",
        },
      ],
    );

    expect(entry).toBe("2026-01-10T10:00:00.000Z");
  });

  it("falls back to earliest movement activity when arrival_date is missing", () => {
    const entry = operationalAlertTestUtils.resolveCompoundEntryTimestamp(
      {
        arrival_date: null,
        created_at: "2026-01-09T08:00:00.000Z",
      },
      [
        {
          trailer_id: "a",
          normalized_trailer_number: "FS123",
          event_type: "compound_position_changed",
          created_at: "2026-01-12T12:00:00.000Z",
        },
        {
          trailer_id: "a",
          normalized_trailer_number: "FS123",
          event_type: "compound_entered",
          created_at: "2026-01-10T07:00:00.000Z",
        },
      ],
    );

    expect(entry).toBe("2026-01-10T07:00:00.000Z");
  });

  it("uses latest movement activity for no-movement baseline", () => {
    const movement = operationalAlertTestUtils.resolveLatestCompoundMovementTimestamp(
      {
        arrival_date: "2026-01-08T09:00:00.000Z",
        created_at: "2026-01-08T09:00:00.000Z",
      },
      [
        {
          trailer_id: "a",
          normalized_trailer_number: "FS123",
          event_type: "compound_entered",
          created_at: "2026-01-10T07:00:00.000Z",
        },
        {
          trailer_id: "a",
          normalized_trailer_number: "FS123",
          event_type: "compound_position_changed",
          created_at: "2026-01-12T11:00:00.000Z",
        },
      ],
    );

    expect(movement).toBe("2026-01-12T11:00:00.000Z");
  });

  it("falls back to entry timestamp when movement history is absent", () => {
    const movement = operationalAlertTestUtils.resolveLatestCompoundMovementTimestamp(
      {
        arrival_date: null,
        created_at: "2026-01-08T09:00:00.000Z",
      },
      [],
    );

    expect(movement).toBe("2026-01-08T09:00:00.000Z");
  });
});

describe("createOperationalAlert existing lookup", () => {
  it("falls back to a database lookup when existingAlert is null and updates the matching active alert", async () => {
    const existing = makeAlert();
    const updated = makeAlert({ updated_at: "2026-08-01T11:00:00.000Z", severity: "high" });

    const { client, mocks } = makeClient({
      selectResults: [{ data: [existing], error: null }],
      insertResult: { data: null, error: { message: "insert should not be called" } },
      updateResult: { data: updated, error: null },
    });

    const result = await createOperationalAlert(
      {
        existingAlert: null,
        severity: "high",
        title: "Inspection missing photos",
        description: "Completed inspection has no linked photos.",
        sourceModule: "inspection",
        sourceRecordId: existing.source_record_id,
        trailerId: existing.trailer_id,
        trailerNumber: existing.trailer_number,
        metadata: { vessel_trailer_id: existing.source_record_id },
      },
      client,
    );

    expect(result.ok).toBe(true);
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});

describe("createOperationalAlert insert and race recovery", () => {
  it("inserts a genuinely new alert", async () => {
    const inserted = makeAlert({ id: "inserted-1" });
    const { client, mocks } = makeClient({
      selectResults: [{ data: [], error: null }],
      insertResult: { data: inserted, error: null },
    });

    const result = await createOperationalAlert(
      {
        severity: "warning",
        title: "Inspection missing photos",
        description: "Completed inspection has no linked photos.",
        sourceModule: "inspection",
        sourceRecordId: inserted.source_record_id,
        trailerId: inserted.trailer_id,
        trailerNumber: inserted.trailer_number,
        metadata: { vessel_trailer_id: inserted.source_record_id },
        performedBy: "tester",
      },
      client,
    );

    expect(result.ok).toBe(true);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("recovers from concurrent duplicate insert by fetching active canonical row and updating it", async () => {
    const existingActive = makeAlert({ id: "existing-active", metadata: { previous: true } });
    const updated = makeAlert({ id: "existing-active", severity: "high" });
    const duplicateErrorMessage = "duplicate key value violates unique constraint \"operational_alerts_active_dedupe_idx\"";

    const initialLookup = makeSelectChain({ data: [], error: null });
    const recoveryLookup = makeSelectChain({ data: [existingActive], error: null });

    const updateSingle = vi.fn().mockResolvedValue({ data: updated, error: null });
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle });
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    const insertSingle = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message: duplicateErrorMessage,
        details: null,
        hint: null,
      },
    });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });

    const select = vi.fn().mockReturnValueOnce(initialLookup).mockReturnValueOnce(recoveryLookup);
    const client = {
      from: vi.fn().mockReturnValue({
        select,
        update,
        insert,
      }),
      auth: {
        getUser: vi.fn(),
      },
    } as never;

    const result = await createOperationalAlert(
      {
        severity: "high",
        title: "Inspection missing photos",
        description: "Completed inspection has no linked photos.",
        sourceModule: "inspection",
        sourceRecordId: existingActive.source_record_id,
        trailerId: existingActive.trailer_id,
        trailerNumber: existingActive.trailer_number,
        metadata: { vessel_trailer_id: existingActive.source_record_id },
        performedBy: "tester",
      },
      client,
    );

    expect(result.ok).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(recoveryLookup.eq).toHaveBeenCalledWith("alert_key", existingActive.alert_key);
    expect(recoveryLookup.eq).toHaveBeenCalledWith("status", "active");
    expect(recoveryLookup.eq).toHaveBeenCalledWith("source_record_id", existingActive.source_record_id);
    expect(recoveryLookup.eq).toHaveBeenCalledWith("trailer_id", existingActive.trailer_id);
  });

  it("uses null-safe identity matching during recovery when source_record_id and trailer_id are null", async () => {
    const existingActive = makeAlert({
      id: "existing-null-identity",
      source_record_id: null,
      trailer_id: null,
      alert_key: "compound:Compound occupancy warning:global",
    });
    const duplicateErrorMessage = "duplicate key value violates unique constraint \"operational_alerts_active_dedupe_idx\"";

    const initialLookup = makeSelectChain({ data: [], error: null });
    const recoveryLookup = makeSelectChain({ data: [existingActive], error: null });

    const updateSingle = vi.fn().mockResolvedValue({ data: existingActive, error: null });
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle });
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    const insertSingle = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message: duplicateErrorMessage,
        details: null,
        hint: null,
      },
    });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });

    const select = vi.fn().mockReturnValueOnce(initialLookup).mockReturnValueOnce(recoveryLookup);
    const client = {
      from: vi.fn().mockReturnValue({
        select,
        update,
        insert,
      }),
      auth: {
        getUser: vi.fn(),
      },
    } as never;

    const result = await createOperationalAlert(
      {
        severity: "warning",
        title: "Compound occupancy warning",
        description: "Compound occupancy is above threshold.",
        sourceModule: "compound",
        metadata: { occupancy: 91 },
        performedBy: "tester",
      },
      client,
    );

    expect(result.ok).toBe(true);
    expect(recoveryLookup.is).toHaveBeenCalledWith("source_record_id", null);
    expect(recoveryLookup.is).toHaveBeenCalledWith("trailer_id", null);
  });

  it("returns recovered active row as success when recovery update fails", async () => {
    const existingActive = makeAlert({ id: "existing-recovery-row" });
    const duplicateErrorMessage = "duplicate key value violates unique constraint \"operational_alerts_active_dedupe_idx\"";

    const initialLookup = makeSelectChain({ data: [], error: null });
    const recoveryLookup = makeSelectChain({ data: [existingActive], error: null });

    const updateSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "Unable to update operational alert." } });
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle });
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    const insertSingle = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message: duplicateErrorMessage,
        details: null,
        hint: null,
      },
    });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });

    const select = vi.fn().mockReturnValueOnce(initialLookup).mockReturnValueOnce(recoveryLookup);
    const client = {
      from: vi.fn().mockReturnValue({
        select,
        update,
        insert,
      }),
      auth: {
        getUser: vi.fn(),
      },
    } as never;

    const result = await createOperationalAlert(
      {
        severity: "warning",
        title: "Inspection missing photos",
        description: "Completed inspection has no linked photos.",
        sourceModule: "inspection",
        sourceRecordId: existingActive.source_record_id,
        trailerId: existingActive.trailer_id,
        trailerNumber: existingActive.trailer_number,
        metadata: { vessel_trailer_id: existingActive.source_record_id },
        performedBy: "tester",
      },
      client,
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.id : null).toBe(existingActive.id);
  });

  it("rethrows unrelated unique violations", async () => {
    const { client, mocks } = makeClient({
      selectResults: [{ data: [], error: null }],
      insertResult: {
        data: null,
        error: {
          code: "23505",
          message: "duplicate key value violates unique constraint \"operational_alerts_other_idx\"",
          details: null,
          hint: null,
        },
      },
    });

    const result = await createOperationalAlert(
      {
        severity: "warning",
        title: "Inspection missing photos",
        description: "Completed inspection has no linked photos.",
        sourceModule: "inspection",
        sourceRecordId: "00000000-0000-4000-8000-000000000222",
        trailerId: "00000000-0000-4000-8000-000000000111",
        trailerNumber: "FS100",
        metadata: { vessel_trailer_id: "00000000-0000-4000-8000-000000000222" },
        performedBy: "tester",
      },
      client,
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("operational_alerts_other_idx");
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("repeated detection candidates produce one active alert by inserting once then updating", async () => {
    const inserted = makeAlert({ id: "insert-once" });
    const updated = makeAlert({ id: "insert-once", updated_at: "2026-08-01T10:30:00.000Z" });

    const initialSelect = makeSelectChain({ data: [], error: null });
    const secondSelect = makeSelectChain({ data: [inserted], error: null });
    const select = vi.fn().mockReturnValueOnce(initialSelect).mockReturnValueOnce(secondSelect);

    const updateSingle = vi.fn().mockResolvedValue({ data: updated, error: null });
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle });
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    const insertSingle = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });

    const client = {
      from: vi.fn().mockReturnValue({
        select,
        update,
        insert,
      }),
      auth: {
        getUser: vi.fn(),
      },
    } as never;

    const input = {
      severity: "warning" as const,
      title: "Inspection missing photos",
      description: "Completed inspection has no linked photos.",
      sourceModule: "inspection",
      sourceRecordId: inserted.source_record_id,
      trailerId: inserted.trailer_id,
      trailerNumber: inserted.trailer_number,
      metadata: { vessel_trailer_id: inserted.source_record_id },
      performedBy: "tester",
    };

    const firstResult = await createOperationalAlert(input, client);
    const secondResult = await createOperationalAlert(input, client);

    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("retries insert status from open to active when constraint is operational_alerts_status_check", async () => {
    const inserted = makeAlert({ id: "inserted-status-check-fallback", status: "active" });
    const initialLookup = makeSelectChain({ data: [], error: null });

    const insertSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "23514",
          message: "new row for relation \"operational_alerts\" violates check constraint \"operational_alerts_status_check\"",
          details: "Failing row contains status open.",
          hint: null,
        },
      })
      .mockResolvedValueOnce({ data: inserted, error: null });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });

    const updateSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "update should not be called" } });
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle });
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    const select = vi.fn().mockReturnValue(initialLookup);
    const client = {
      from: vi.fn().mockReturnValue({
        select,
        update,
        insert,
      }),
      auth: {
        getUser: vi.fn(),
      },
    } as never;

    const result = await createOperationalAlert(
      {
        severity: "warning",
        title: "Inspection missing photos",
        description: "Completed inspection has no linked photos.",
        sourceModule: "inspection",
        sourceRecordId: inserted.source_record_id,
        trailerId: inserted.trailer_id,
        trailerNumber: inserted.trailer_number,
        metadata: { vessel_trailer_id: inserted.source_record_id },
        performedBy: "tester",
      },
      client,
    );

    expect(result.ok).toBe(true);
    expect(insertSingle).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
    expect(insert.mock.calls[0]?.[0]?.status).toBe("open");
    expect(insert.mock.calls[1]?.[0]?.status).toBe("active");
  });

  it("retries insert status from open to active when constraint is operational_alerts_status_valid", async () => {
    const inserted = makeAlert({ id: "inserted-status-fallback", status: "active" });
    const initialLookup = makeSelectChain({ data: [], error: null });

    const insertSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "23514",
          message: "new row for relation \"operational_alerts\" violates check constraint \"operational_alerts_status_valid\"",
          details: "Failing row contains status open.",
          hint: null,
        },
      })
      .mockResolvedValueOnce({ data: inserted, error: null });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });

    const updateSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "update should not be called" } });
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle });
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    const select = vi.fn().mockReturnValue(initialLookup);
    const client = {
      from: vi.fn().mockReturnValue({
        select,
        update,
        insert,
      }),
      auth: {
        getUser: vi.fn(),
      },
    } as never;

    const result = await createOperationalAlert(
      {
        severity: "warning",
        title: "Inspection missing photos",
        description: "Completed inspection has no linked photos.",
        sourceModule: "inspection",
        sourceRecordId: inserted.source_record_id,
        trailerId: inserted.trailer_id,
        trailerNumber: inserted.trailer_number,
        metadata: { vessel_trailer_id: inserted.source_record_id },
        performedBy: "tester",
      },
      client,
    );

    expect(result.ok).toBe(true);
    expect(insertSingle).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
    expect(insert.mock.calls[0]?.[0]?.status).toBe("open");
    expect(insert.mock.calls[1]?.[0]?.status).toBe("active");
  });

  it("does not retry status when 23514 is for a non-status constraint", async () => {
    const initialLookup = makeSelectChain({ data: [], error: null });

    const insertSingle = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "23514",
        message: "new row for relation \"operational_alerts\" violates check constraint \"operational_alerts_severity_check\"",
        details: "Failing row contains invalid severity.",
        hint: null,
      },
    });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });

    const updateSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "update should not be called" } });
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle });
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    const select = vi.fn().mockReturnValue(initialLookup);
    const client = {
      from: vi.fn().mockReturnValue({
        select,
        update,
        insert,
      }),
      auth: {
        getUser: vi.fn(),
      },
    } as never;

    const result = await createOperationalAlert(
      {
        severity: "warning",
        title: "Inspection missing photos",
        description: "Completed inspection has no linked photos.",
        sourceModule: "inspection",
        sourceRecordId: "00000000-0000-4000-8000-000000000222",
        trailerId: "00000000-0000-4000-8000-000000000111",
        trailerNumber: "FS100",
        metadata: { vessel_trailer_id: "00000000-0000-4000-8000-000000000222" },
        performedBy: "tester",
      },
      client,
    );

    expect(result.ok).toBe(false);
    expect(insertSingle).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(insert.mock.calls[0]?.[0]?.status).toBe("open");
  });

  it("retries insert with compatibility payload when alert_key is missing from schema cache", async () => {
    const inserted = makeAlert({ id: "inserted-alert-key-compat" });
    const initialLookup = makeSelectChain({ data: [], error: null });

    const insertSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "PGRST204",
          message: "Could not find the 'alert_key' column of 'operational_alerts' in the schema cache",
          details: null,
          hint: null,
        },
      })
      .mockResolvedValueOnce({ data: inserted, error: null });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });

    const updateSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "update should not be called" } });
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle });
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    const select = vi.fn().mockReturnValue(initialLookup);
    const client = {
      from: vi.fn().mockReturnValue({
        select,
        update,
        insert,
      }),
      auth: {
        getUser: vi.fn(),
      },
    } as never;

    const result = await createOperationalAlert(
      {
        severity: "warning",
        title: "Inspection missing photos",
        description: "Completed inspection has no linked photos.",
        sourceModule: "inspection",
        sourceRecordId: inserted.source_record_id,
        trailerId: inserted.trailer_id,
        trailerNumber: inserted.trailer_number,
        metadata: { vessel_trailer_id: inserted.source_record_id },
        performedBy: "tester",
      },
      client,
    );

    expect(result.ok).toBe(true);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
    expect(insert.mock.calls[0]?.[0]?.alert_key).toBeTypeOf("string");
    expect(insert.mock.calls[1]?.[0]?.alert_key).toBeUndefined();
    expect(insertSelect.mock.calls[0]?.[0]).toBe("*");
    expect(insertSelect.mock.calls[1]?.[0]).toBe("id,alert_type,severity,status,title,description,trailer_id,trailer_number,source_module,source_record_id,metadata,created_at,updated_at");
  });
});
