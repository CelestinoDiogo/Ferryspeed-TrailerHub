import { describe, expect, it, vi } from "vitest";
import { getVesselOperationReport } from "@/lib/vessel-report";

type AnyRow = Record<string, unknown>;

type MockDataset = {
  vessel_operations?: AnyRow[];
  vessel_operation_trailers?: AnyRow[];
  trailers?: AnyRow[];
  vessel_inspection_photos?: AnyRow[];
  vessel_inspection_damages?: AnyRow[];
  vessel_inspection_temperatures?: AnyRow[];
  export_allocations?: AnyRow[];
  operational_alerts?: AnyRow[];
  trailer_activity_log?: AnyRow[];
};

type QueryFilter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "in"; column: string; values: unknown[] };

class QueryBuilder {
  private readonly table: keyof MockDataset;
  private readonly dataset: MockDataset;
  private filters: QueryFilter[] = [];
  private isSingle = false;

  constructor(table: keyof MockDataset, dataset: MockDataset) {
    this.table = table;
    this.dataset = dataset;
  }

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ kind: "in", column, values });
    return this;
  }

  order(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  single(): Promise<{ data: AnyRow | null; error: null }> {
    this.isSingle = true;
    return this.execSingle();
  }

  then<TResult1 = { data: AnyRow[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: AnyRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execMany().then(onfulfilled ?? ((value) => value as TResult1), onrejected ?? undefined);
  }

  private applyFilters(rows: AnyRow[]): AnyRow[] {
    return rows.filter((row) => {
      return this.filters.every((filter) => {
        if (filter.kind === "eq") {
          return row[filter.column] === filter.value;
        }

        return filter.values.includes(row[filter.column]);
      });
    });
  }

  private async execMany(): Promise<{ data: AnyRow[]; error: null }> {
    const tableRows = [...(this.dataset[this.table] ?? [])];
    return { data: this.applyFilters(tableRows), error: null };
  }

  private async execSingle(): Promise<{ data: AnyRow | null; error: null }> {
    const many = await this.execMany();
    return { data: many.data[0] ?? null, error: null };
  }
}

const makeSupabaseMock = (
  dataset: MockDataset,
  options?: {
    signedUrlByPath?: Record<string, string | null>;
    throwSignedUrlForPaths?: string[];
    publicUrlByPath?: Record<string, string | null>;
  },
) => {
  const signedUrlByPath = options?.signedUrlByPath ?? {};
  const throwPaths = new Set(options?.throwSignedUrlForPaths ?? []);
  const publicUrlByPath = options?.publicUrlByPath ?? {};

  const createSignedUrl = vi.fn(async (path: string, ttl: number) => {
    void ttl;
    if (throwPaths.has(path)) {
      throw new Error("Signed URL generation failed");
    }

    if (Object.prototype.hasOwnProperty.call(signedUrlByPath, path)) {
      const signedUrl = signedUrlByPath[path];
      return { data: signedUrl ? { signedUrl } : null, error: signedUrl ? null : new Error("No URL") };
    }

    return { data: { signedUrl: `https://signed.example/${path}` }, error: null };
  });

  const getPublicUrl = vi.fn((path: string) => ({
    data: {
      publicUrl: Object.prototype.hasOwnProperty.call(publicUrlByPath, path)
        ? publicUrlByPath[path]
        : `https://public.example/${path}`,
    },
  }));

  const supabase = {
    from: (table: string) => new QueryBuilder(table as keyof MockDataset, dataset),
    storage: {
      from: () => ({
        createSignedUrl,
        getPublicUrl,
      }),
    },
  };

  return {
    supabase,
    createSignedUrl,
    getPublicUrl,
  };
};

const makeBaseDataset = (photos: AnyRow[]): MockDataset => ({
  vessel_operations: [
    {
      id: "op-1",
      vessel_name: "MV Atlas",
      sailing_reference: "SAIL-1",
      origin_port: "Dover",
      berth: "B1",
      expected_arrival_at: "2026-08-01T09:00:00.000Z",
      actual_arrival_at: "2026-08-01T09:15:00.000Z",
      status: "in_progress",
      list_status: "confirmed",
      list_confirmed_at: "2026-08-01T08:30:00.000Z",
      list_confirmed_by: "Operator",
      notes: null,
      created_at: "2026-08-01T08:00:00.000Z",
      updated_at: "2026-08-01T10:00:00.000Z",
    },
  ],
  vessel_operation_trailers: [
    {
      id: "vt-1",
      vessel_operation_id: "op-1",
      trailer_id: "tr-1",
      trailer_number: "pro100",
      customer: "Customer A",
      booking_reference: "BR-1",
      load_status: "Loaded",
      temperature_required: null,
      expected_front_temperature: null,
      expected_rear_temperature: null,
      expected_temperature_unit: "C",
      priority_level: "normal",
      planning_notes: null,
      status: "inspected",
      arrived_at: "2026-08-01T09:20:00.000Z",
      arrival_status: "arrived",
      arrival_confirmed_at: "2026-08-01T09:20:00.000Z",
      arrival_record_id: null,
      arrival_confirmed_by: "Inspector",
      inspection_started_at: null,
      inspection_completed_at: "2026-08-01T09:30:00.000Z",
      position_assigned_at: null,
      assigned_position: "P01",
      has_damage: false,
      has_temperature_alert: false,
      created_at: "2026-08-01T08:10:00.000Z",
      updated_at: "2026-08-01T09:40:00.000Z",
    },
  ],
  trailers: [
    {
      id: "tr-1",
      trailer_number: "PRO100",
      load_status: "Loaded",
      customer: "Customer A",
      compound_position: "P01",
      notes: null,
      is_local: false,
      trailer_source: "company",
      external_company: null,
      operational_status: "inspected",
      arrival_date: "2026-08-01",
      departure_date: null,
    },
  ],
  vessel_inspection_photos: photos,
  vessel_inspection_damages: [],
  vessel_inspection_temperatures: [],
  export_allocations: [],
  operational_alerts: [],
  trailer_activity_log: [],
});

const makePhoto = (overrides: Partial<AnyRow> = {}): AnyRow => ({
  id: Object.prototype.hasOwnProperty.call(overrides, "id") ? overrides.id : "photo-1",
  vessel_trailer_id: Object.prototype.hasOwnProperty.call(overrides, "vessel_trailer_id") ? overrides.vessel_trailer_id : "vt-1",
  trailer_id: Object.prototype.hasOwnProperty.call(overrides, "trailer_id") ? overrides.trailer_id : "tr-1",
  trailer_number: Object.prototype.hasOwnProperty.call(overrides, "trailer_number") ? overrides.trailer_number : "PRO100",
  vessel_operation_id: Object.prototype.hasOwnProperty.call(overrides, "vessel_operation_id") ? overrides.vessel_operation_id : "op-1",
  category: Object.prototype.hasOwnProperty.call(overrides, "category") ? overrides.category : "inspection",
  storage_path: Object.prototype.hasOwnProperty.call(overrides, "storage_path") ? overrides.storage_path : "vessel-inspections/op-1/vt-1/a.jpg",
  file_name: Object.prototype.hasOwnProperty.call(overrides, "file_name") ? overrides.file_name : "a.jpg",
  description: Object.prototype.hasOwnProperty.call(overrides, "description") ? overrides.description : "Front view",
  uploaded_at: Object.prototype.hasOwnProperty.call(overrides, "uploaded_at") ? overrides.uploaded_at : "2026-08-01T09:35:00.000Z",
  uploaded_by: Object.prototype.hasOwnProperty.call(overrides, "uploaded_by") ? overrides.uploaded_by : "Inspector",
});

describe("getVesselOperationReport photo fallback behavior", () => {
  it("1) matches by vessel_trailer_id", async () => {
    const dataset = makeBaseDataset([makePhoto({ id: "p-vt", trailer_id: null, trailer_number: null })]);
    const { supabase } = makeSupabaseMock(dataset);

    const report = await getVesselOperationReport(supabase as never, "op-1");

    expect(report.trailers[0]?.photos.map((photo) => photo.id)).toEqual(["p-vt"]);
  });

  it("2) falls back to trailer_id", async () => {
    const dataset = makeBaseDataset([makePhoto({ id: "p-trailer", vessel_trailer_id: null })]);
    const { supabase } = makeSupabaseMock(dataset);

    const report = await getVesselOperationReport(supabase as never, "op-1");

    expect(report.trailers[0]?.photos.map((photo) => photo.id)).toEqual(["p-trailer"]);
  });

  it("3) falls back to normalized trailer_number", async () => {
    const dataset = makeBaseDataset([
      makePhoto({ id: "p-number", vessel_trailer_id: null, trailer_id: null, trailer_number: " pro100 " }),
    ]);
    const { supabase } = makeSupabaseMock(dataset);

    const report = await getVesselOperationReport(supabase as never, "op-1");

    expect(report.trailers[0]?.photos.map((photo) => photo.id)).toEqual(["p-number"]);
  });

  it("4) vessel_trailer_id takes priority over trailer_id in conflicting rows", async () => {
    const dataset = makeBaseDataset([
      makePhoto({ id: "p-good", vessel_trailer_id: "vt-1", trailer_id: "tr-1" }),
      makePhoto({ id: "p-conflict", vessel_trailer_id: "vt-OTHER", trailer_id: "tr-1" }),
    ]);
    const { supabase } = makeSupabaseMock(dataset);

    const report = await getVesselOperationReport(supabase as never, "op-1");

    expect(report.trailers[0]?.photos.map((photo) => photo.id)).toEqual(["p-good"]);
  });

  it("5) trailer_id takes priority over trailer_number in conflicting rows", async () => {
    const dataset = makeBaseDataset([
      makePhoto({ id: "p-good", vessel_trailer_id: null, trailer_id: "tr-1", trailer_number: "PRO100" }),
      makePhoto({ id: "p-conflict", vessel_trailer_id: null, trailer_id: "tr-OTHER", trailer_number: "PRO100" }),
    ]);
    const { supabase } = makeSupabaseMock(dataset);

    const report = await getVesselOperationReport(supabase as never, "op-1");

    expect(report.trailers[0]?.photos.map((photo) => photo.id)).toEqual(["p-good"]);
  });

  it("6) duplicate photo ID appears only once", async () => {
    const duplicate = makePhoto({ id: "dup-1", vessel_trailer_id: "vt-1", trailer_id: "tr-1" });
    const dataset = makeBaseDataset([duplicate, duplicate]);
    const { supabase } = makeSupabaseMock(dataset);

    const report = await getVesselOperationReport(supabase as never, "op-1");

    expect(report.trailers[0]?.photos.map((photo) => photo.id)).toEqual(["dup-1"]);
    expect(report.photos.map((photo) => photo.id)).toEqual(["dup-1"]);
  });

  it("7) null relationship fields do not discard valid trailer_number match", async () => {
    const dataset = makeBaseDataset([
      makePhoto({ id: "p-null-rel", vessel_trailer_id: null, trailer_id: null, trailer_number: "PRO100" }),
    ]);
    const { supabase } = makeSupabaseMock(dataset);

    const report = await getVesselOperationReport(supabase as never, "op-1");

    expect(report.trailers[0]?.photos.map((photo) => photo.id)).toEqual(["p-null-rel"]);
  });

  it("8) broken signed URL generation does not crash report", async () => {
    const dataset = makeBaseDataset([makePhoto({ id: "p-broken", storage_path: "vessel-inspections/op-1/vt-1/broken.jpg" })]);
    const { supabase } = makeSupabaseMock(dataset, {
      throwSignedUrlForPaths: ["vessel-inspections/op-1/vt-1/broken.jpg"],
      publicUrlByPath: { "vessel-inspections/op-1/vt-1/broken.jpg": null },
    });

    const report = await getVesselOperationReport(supabase as never, "op-1");

    expect(report.trailers[0]?.photos[0]?.id).toBe("p-broken");
    expect(report.trailers[0]?.photos[0]?.url).toBeNull();
  });

  it("9) legacy full storage URL is handled", async () => {
    const legacyStorageUrl = "https://abc.supabase.co/storage/v1/object/sign/vessel-inspection-photos/vessel-inspections/op-1/vt-1/legacy.jpg?token=1";
    const dataset = makeBaseDataset([makePhoto({ id: "p-legacy", storage_path: legacyStorageUrl })]);
    const { supabase, createSignedUrl } = makeSupabaseMock(dataset, {
      signedUrlByPath: { "vessel-inspections/op-1/vt-1/legacy.jpg": "https://signed.example/vessel-inspections/op-1/vt-1/legacy.jpg" },
    });

    const report = await getVesselOperationReport(supabase as never, "op-1");

    expect(createSignedUrl).toHaveBeenCalledWith("vessel-inspections/op-1/vt-1/legacy.jpg", 3600);
    expect(report.trailers[0]?.photos[0]?.url).toContain("legacy.jpg");
  });

  it("10) multiple photos for one trailer are preserved", async () => {
    const dataset = makeBaseDataset([
      makePhoto({ id: "p-1", uploaded_at: "2026-08-01T09:31:00.000Z", storage_path: "vessel-inspections/op-1/vt-1/1.jpg" }),
      makePhoto({ id: "p-2", uploaded_at: "2026-08-01T09:32:00.000Z", storage_path: "vessel-inspections/op-1/vt-1/2.jpg" }),
    ]);
    const { supabase } = makeSupabaseMock(dataset);

    const report = await getVesselOperationReport(supabase as never, "op-1");

    expect(report.trailers[0]?.photos.map((photo) => photo.id)).toEqual(["p-1", "p-2"]);
  });
});

describe("getVesselOperationReport operation scoping", () => {
  const makeRepeatedDataset = (): MockDataset => ({
    vessel_operations: [
      { id: "op-a", vessel_name: "Vessel A", sailing_reference: "A", status: "completed", list_status: "confirmed", created_at: "2026-08-01T07:00:00.000Z", updated_at: "2026-08-01T12:00:00.000Z" },
      { id: "op-b", vessel_name: "Vessel B", sailing_reference: "B", status: "completed", list_status: "confirmed", created_at: "2026-08-10T07:00:00.000Z", updated_at: "2026-08-10T12:00:00.000Z" },
    ],
    vessel_operation_trailers: [
      { id: "vt-a", vessel_operation_id: "op-a", trailer_id: "tr-a", trailer_number: "PFC01", priority_level: "priority", planning_notes: "Note A", status: "inspected", arrival_status: "arrived", arrived_at: "2026-08-01T09:00:00.000Z", arrival_confirmed_at: "2026-08-01T09:00:00.000Z", inspection_completed_at: "2026-08-01T09:30:00.000Z", has_damage: false, has_temperature_alert: false, expected_temperature_unit: "C" },
      { id: "vt-b", vessel_operation_id: "op-b", trailer_id: "tr-b", trailer_number: "PFC01", priority_level: "normal", planning_notes: "Note B", status: "inspected", arrival_status: "arrived", arrived_at: "2026-08-10T10:00:00.000Z", arrival_confirmed_at: "2026-08-10T10:00:00.000Z", inspection_completed_at: "2026-08-10T10:30:00.000Z", has_damage: true, has_temperature_alert: true, expected_temperature_unit: "C" },
    ],
    trailers: [
      { id: "tr-a", trailer_number: "CURRENT-A", load_status: "Empty", customer: "Current A", trailer_source: "company", operational_status: "Current A" },
      { id: "tr-b", trailer_number: "CURRENT-B", load_status: "Empty", customer: "Current B", trailer_source: "company", operational_status: "Current B" },
    ],
    vessel_inspection_temperatures: [
      { id: "ta-f", vessel_trailer_id: "vt-a", trailer_id: "tr-a", trailer_number: "PFC01", reading_point: "front", temperature_value: 5, temperature_unit: "C", recorded_at: "2026-08-01T09:15:00.000Z" },
      { id: "ta-r", vessel_trailer_id: "vt-a", trailer_id: "tr-a", trailer_number: "PFC01", reading_point: "rear", temperature_value: 6, temperature_unit: "C", recorded_at: "2026-08-01T09:16:00.000Z" },
      { id: "tb-f", vessel_trailer_id: "vt-b", trailer_id: "tr-b", trailer_number: "PFC01", reading_point: "front", temperature_value: -18, temperature_unit: "C", recorded_at: "2026-08-10T10:15:00.000Z" },
      { id: "tb-r", vessel_trailer_id: "vt-b", trailer_id: "tr-b", trailer_number: "PFC01", reading_point: "rear", temperature_value: -17, temperature_unit: "C", recorded_at: "2026-08-10T10:16:00.000Z" },
    ],
    vessel_inspection_damages: [
      { id: "damage-b", vessel_trailer_id: "vt-b", trailer_id: "tr-b", trailer_number: "PFC01", damage_type: "impact", damage_location: "rear", severity: "major", description: "Damage B", recorded_at: "2026-08-10T10:20:00.000Z" },
    ],
    vessel_inspection_photos: [
      makePhoto({ id: "photo-a", vessel_operation_id: "op-a", vessel_trailer_id: "vt-a", trailer_id: "tr-a", storage_path: "op-a/photo-a.jpg" }),
      makePhoto({ id: "photo-b", vessel_operation_id: "op-b", vessel_trailer_id: "vt-b", trailer_id: "tr-b", storage_path: "op-b/photo-b.jpg" }),
    ],
    export_allocations: [{ id: "unsafe-export", trailer_id: "tr-b", trailer_number: "PFC01", status: "completed" }],
    operational_alerts: [
      { id: "alert-a", trailer_id: "tr-a", trailer_number: "PFC01", source_module: "vessel", source_record_id: "vt-a", title: "Alert A" },
      { id: "alert-b", trailer_id: "tr-b", trailer_number: "PFC01", source_module: "vessel", source_record_id: "vt-b", title: "Alert B" },
      { id: "alert-unsafe", trailer_id: null, trailer_number: "PFC01", source_module: "vessel", source_record_id: null, title: "Unsafe fallback" },
    ],
    trailer_activity_log: [
      { id: "activity-a", trailer_id: "tr-a", trailer_number: "PFC01", source_module: "vessel", source_record_id: "vt-a", event_title: "Activity A", created_at: "2026-08-01T09:10:00.000Z" },
      { id: "activity-b", trailer_id: "tr-b", trailer_number: "PFC01", source_module: "vessel", source_record_id: "vt-b", event_title: "Activity B", created_at: "2026-08-10T10:10:00.000Z" },
      { id: "activity-unsafe", trailer_id: null, trailer_number: "PFC01", source_module: "vessel", source_record_id: null, event_title: "Unsafe activity", created_at: "2026-08-05T10:10:00.000Z" },
    ],
  });

  it("keeps repeated-trailer inspection facts inside the selected operation", async () => {
    const { supabase } = makeSupabaseMock(makeRepeatedDataset());
    const reportA = await getVesselOperationReport(supabase as never, "op-a");
    const reportB = await getVesselOperationReport(supabase as never, "op-b");

    expect(reportA.trailers).toHaveLength(1);
    expect(reportA.trailers[0]).toMatchObject({ trailerNumber: "PFC01", customer: null, loadStatus: null, operationalStatus: "inspected", compoundPosition: null, frontTemperature: 5, rearTemperature: 6, hasDamage: false, priority: "priority", notes: "Note A", arrivedAt: "2026-08-01T09:00:00.000Z" });
    expect(reportA.trailers[0]?.photos.map((photo) => photo.id)).toEqual(["photo-a"]);
    expect(reportA.damages).toHaveLength(0);
    expect(reportB.trailers[0]).toMatchObject({ frontTemperature: -18, rearTemperature: -17, hasDamage: true, priority: "normal", notes: "Note B", arrivedAt: "2026-08-10T10:00:00.000Z" });
    expect(reportB.trailers[0]?.photos.map((photo) => photo.id)).toEqual(["photo-b"]);
    expect(reportB.damages.map((damage) => damage.id)).toEqual(["damage-b"]);
  });

  it("does not backfill number-only or another-operation intelligence", async () => {
    const { supabase } = makeSupabaseMock(makeRepeatedDataset());
    const reportA = await getVesselOperationReport(supabase as never, "op-a");

    expect(reportA.exportActivity.allocationsAffected).toBe(0);
    expect(reportA.operationalAlerts.map((alert) => alert.title)).toEqual(["Alert A"]);
    expect(reportA.timeline.map((entry) => entry.event)).toContain("Activity A");
    expect(reportA.timeline.map((entry) => entry.event)).not.toEqual(expect.arrayContaining(["Activity B", "Unsafe activity"]));
  });

  it("keeps discharged, pending, cancelled, no-show, and not-discharged totals distinct", async () => {
    const dataset = makeRepeatedDataset();
    dataset.vessel_operation_trailers = [
      { id: "vt-arrived", vessel_operation_id: "op-a", trailer_number: "ARRIVED", status: "inspected", arrival_status: "arrived" },
      { id: "vt-expected", vessel_operation_id: "op-a", trailer_number: "EXPECTED", status: "expected", arrival_status: "expected" },
      { id: "vt-not-discharged", vessel_operation_id: "op-a", trailer_number: "NOTDISCHARGED", status: "not_discharged", arrival_status: "not_discharged" },
      { id: "vt-cancelled", vessel_operation_id: "op-a", trailer_number: "CANCELLED", status: "cancelled", arrival_status: "cancelled" },
      { id: "vt-no-show", vessel_operation_id: "op-a", trailer_number: "NOSHOW", status: "no_show", arrival_status: "no_show" },
      { id: "vt-inspection", vessel_operation_id: "op-a", trailer_number: "INSPECTION", status: "in_progress", arrival_status: "arrived" },
    ];
    dataset.vessel_inspection_temperatures = [];
    dataset.vessel_inspection_damages = [];
    dataset.vessel_inspection_photos = [];
    dataset.operational_alerts = [];
    dataset.trailer_activity_log = [];
    const { supabase } = makeSupabaseMock(dataset);

    const report = await getVesselOperationReport(supabase as never, "op-a");

    expect(report.statistics).toMatchObject({
      totalTrailers: 6,
      expectedTrailers: 4,
      arrivedTrailers: 2,
      finalDischargedTrailers: 2,
      pendingTrailers: 1,
      notDischargedTrailers: 1,
      cancelledTrailers: 1,
      noShowTrailers: 1,
      pendingInspections: 1,
      completionPercentage: 25,
    });
    expect(report.trailers).toHaveLength(6);
    expect(report.trailers.map((trailer) => trailer.trailerNumber)).toEqual([
      "ARRIVED",
      "EXPECTED",
      "NOTDISCHARGED",
      "CANCELLED",
      "NOSHOW",
      "INSPECTION",
    ]);
  });

  it("leaves selected-operation inspection facts missing instead of borrowing them", async () => {
    const dataset = makeRepeatedDataset();
    dataset.vessel_inspection_temperatures = dataset.vessel_inspection_temperatures?.filter((row) => row.vessel_trailer_id !== "vt-a");
    dataset.vessel_inspection_photos = dataset.vessel_inspection_photos?.filter((row) => row.vessel_trailer_id !== "vt-a");
    const { supabase } = makeSupabaseMock(dataset);

    const reportA = await getVesselOperationReport(supabase as never, "op-a");
    const reportB = await getVesselOperationReport(supabase as never, "op-b");

    expect(reportA.trailers).toHaveLength(1);
    expect(reportA.trailers[0]).toMatchObject({
      frontTemperature: null,
      rearTemperature: null,
      hasDamage: false,
      priority: "priority",
      notes: "Note A",
      arrivedAt: "2026-08-01T09:00:00.000Z",
    });
    expect(reportA.trailers[0]?.photos).toEqual([]);
    expect(reportA.damages).toEqual([]);
    expect(reportB.trailers[0]).toMatchObject({ frontTemperature: -18, rearTemperature: -17, hasDamage: true });
    expect(reportB.trailers[0]?.photos.map((photo) => photo.id)).toEqual(["photo-b"]);
  });
});
