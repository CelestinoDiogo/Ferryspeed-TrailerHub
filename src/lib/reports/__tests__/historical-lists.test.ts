import { describe, expect, it } from "vitest";
import { createHistoryDateRange } from "@/lib/history-date-range";
import { buildCsv, escapeCsvCell, historicalCsvFileName } from "@/lib/reports/csv-export";
import {
  HISTORICAL_TIMESTAMP_SEMANTICS,
  buildHistoricalListTotals,
  filterHistoricalListRecords,
  formatHistoricalDateTime,
  historicalCsvHeaders,
  historicalCsvRow,
  mapArrivalHistoryRecord,
  mapCollectionHistoryRecord,
  mapCompoundEventHistoryRecord,
  mapDeliveryHistoryRecord,
  mapDepartureHistoryRecord,
  parseHistoricalListKind,
  toGuernseyDateKey,
  type HistoricalListRecord,
} from "@/lib/reports/historical-lists";
import { mapDeliveryCollectionEvent, mapExportCollectionEvent } from "@/lib/reports/operational-summary";
import { getVesselTrailerDischargedAt, getVesselTrailerReceptionAt } from "@/lib/vessel-operations";

const last7 = createHistoryDateRange("last_7_days", "2026-08-22");
const today = createHistoryDateRange("today", "2026-08-22");
const last30 = createHistoryDateRange("last_30_days", "2026-08-22");

const record = (overrides: Partial<HistoricalListRecord> & Pick<HistoricalListRecord, "id" | "kind">): HistoricalListRecord => ({
  occurredAt: "2026-08-22T04:23:00.741Z",
  localDateKey: "2026-08-22",
  trailerNumber: "FSC1330",
  customer: "Customer A",
  haulier: null,
  ownershipType: "company",
  vesselName: "ISLANDER",
  sailingReference: "GY-1",
  bookingReference: "BK-1",
  status: "arrived",
  notes: null,
  sourceModule: "vessel_operation_trailers",
  ...overrides,
});

describe("historical list timestamps", () => {
  it("uses reception for arrivals and keeps discharged_at separate", () => {
    const mapped = mapArrivalHistoryRecord({
      id: "a1",
      trailer_number: "FSC1330",
      arrival_confirmed_at: "2026-08-22T04:40:00.000Z",
      arrived_at: "2026-08-22T04:23:00.741Z",
      discharged_at: "2026-08-22T04:23:00.741Z",
      assigned_position: "P10",
    }, { vessel_name: "ISLANDER", sailing_reference: "GY-1" });

    expect(mapped?.occurredAt).toBe("2026-08-22T04:40:00.000Z");
    expect(mapped?.receptionAt).toBe("2026-08-22T04:40:00.000Z");
    expect(mapped?.dischargedAt).toBe("2026-08-22T04:23:00.741Z");
    expect(getVesselTrailerReceptionAt({ arrival_confirmed_at: mapped?.receptionAt, arrived_at: "2026-08-22T04:23:00.741Z" })).toBe("2026-08-22T04:40:00.000Z");
    expect(getVesselTrailerDischargedAt({ discharged_at: mapped?.dischargedAt })).toBe("2026-08-22T04:23:00.741Z");
    expect(HISTORICAL_TIMESTAMP_SEMANTICS.arrivals).toContain("discharged_at is a separate");
  });

  it("shows an em dash for historical NULL discharge and never falls back to reception", () => {
    const mapped = mapArrivalHistoryRecord({
      id: "a2",
      trailer_number: "OLD1",
      arrival_confirmed_at: "2026-08-21T10:00:00.000Z",
      arrived_at: "2026-08-21T10:00:00.000Z",
      discharged_at: null,
    });
    expect(mapped?.dischargedAt).toBeNull();
    expect(formatHistoricalDateTime(mapped?.dischargedAt)).toBe("—");
    expect(formatHistoricalDateTime(getVesselTrailerDischargedAt({ discharged_at: null }))).toBe("—");
  });

  it("formats discharge display in Europe/Guernsey", () => {
    expect(formatHistoricalDateTime("2026-08-22T04:23:00.741Z")).toBe("22 Aug 2026, 05:23");
  });

  it("excludes cancelled and no-show arrivals", () => {
    expect(mapArrivalHistoryRecord({ id: "x", arrived_at: "2026-08-22T04:00:00.000Z", cancelled_at: "2026-08-22T05:00:00.000Z" })).toBeNull();
    expect(mapArrivalHistoryRecord({ id: "y", arrived_at: "2026-08-22T04:00:00.000Z", no_show_at: "2026-08-22T05:00:00.000Z" })).toBeNull();
    expect(mapArrivalHistoryRecord({ id: "z", arrived_at: "2026-08-22T04:00:00.000Z", arrival_status: "cancelled" })).toBeNull();
  });
});

describe("departures history", () => {
  it("uses departure_date and excludes cancelled operational status", () => {
    const mapped = mapDepartureHistoryRecord({
      id: "d1",
      trailer_number: "PRO100",
      departure_date: "2026-08-22T00:00:00.000Z",
      departure_time: "14:30:00",
      customer: "Customer A",
    });
    expect(mapped?.localDateKey).toBe("2026-08-22");
    expect(mapped?.occurredAt).toContain("2026-08-22");
    expect(mapDepartureHistoryRecord({
      id: "d2",
      departure_date: "2026-08-22T00:00:00.000Z",
      operational_status: "cancelled",
    })).toBeNull();
  });

  it("respects last 7 day date boundaries", () => {
    const rows = [
      record({ id: "before", kind: "departures", localDateKey: "2026-08-15", occurredAt: "2026-08-15T10:00:00Z" }),
      record({ id: "start", kind: "departures", localDateKey: "2026-08-16", occurredAt: "2026-08-16T10:00:00Z" }),
      record({ id: "end", kind: "departures", localDateKey: "2026-08-22", occurredAt: "2026-08-22T10:00:00Z" }),
    ];
    const filtered = filterHistoricalListRecords(rows, emptyFilters(last7));
    expect(filtered.map((row) => row.id)).toEqual(["end", "start"]);
  });
});

describe("deliveries and collections history", () => {
  it("keeps only actual delivered_at events", () => {
    expect(mapDeliveryHistoryRecord({ id: "open", status: "planned" })).toBeNull();
    expect(mapDeliveryHistoryRecord({ id: "done", delivered_at: "2026-08-22T11:00:00.000Z", status: "delivered" })?.occurredAt).toBe("2026-08-22T11:00:00.000Z");
    expect(mapDeliveryHistoryRecord({ id: "cancelled", delivered_at: "2026-08-22T11:00:00.000Z", status: "cancelled" })).toBeNull();
  });

  it("combines delivery and export collections without collapsing distinct events", () => {
    const delivery = mapCollectionHistoryRecord(mapDeliveryCollectionEvent({
      id: "c-del",
      trailer_number: "FS1",
      status: "collected",
      collected_at: "2026-08-22T09:00:00.000Z",
    }));
    expect(mapDeliveryCollectionEvent({
      id: "pickup",
      trailer_number: "PFC49",
      status: "on_delivery",
      collected_at: "2026-08-22T08:00:00.000Z",
    })).toBeNull();
    expect(mapDeliveryCollectionEvent({
      id: "waiting",
      status: "waiting_collection",
      collected_at: "2026-08-22T08:00:00.000Z",
    })).toBeNull();
    const exported = mapCollectionHistoryRecord(mapExportCollectionEvent({
      id: "c-exp",
      trailer_number: "FS1",
      collected_loaded_at: "2026-08-22T10:00:00.000Z",
    }));
    expect(delivery?.id).toBe("collection:delivery:c-del");
    expect(exported?.id).toBe("collection:export:c-exp");
    expect(delivery?.collectionSource).toBe("delivery");
    expect(exported?.collectionSource).toBe("export");
    expect(mapExportCollectionEvent({
      id: "cancelled",
      collected_loaded_at: "2026-08-22T10:00:00.000Z",
      cancelled_at: "2026-08-22T10:05:00.000Z",
    })).toBeNull();
  });
});

describe("compound history", () => {
  it("maps recorded activity events and does not invent snapshot dates", () => {
    const eventRow = mapCompoundEventHistoryRecord({
      id: "e1",
      occurredAt: "2026-08-20T08:00:00.000Z",
      trailerNumber: "DSV2035",
      eventType: "compound_entered",
      ownershipType: "company",
      previousPosition: null,
      newPosition: "P10",
      sourceModule: "compound",
      description: "Entered compound",
    });
    expect(eventRow.kind).toBe("compound_events");
    expect(eventRow.localDateKey).toBe(toGuernseyDateKey("2026-08-20T08:00:00.000Z"));
    expect(eventRow.sourceModule).toBe("compound");
  });
});

describe("historical filters and totals", () => {
  const rows: HistoricalListRecord[] = [
    record({ id: "a", kind: "arrivals", customer: "Alpha", ownershipType: "company", trailerNumber: "AA1" }),
    record({ id: "b", kind: "arrivals", customer: "Beta", ownershipType: "outsourcing", trailerNumber: "BB1", haulier: "Carrier Z", vesselName: "ISLANDER" }),
    record({ id: "c", kind: "arrivals", customer: "Alpha", ownershipType: "unknown", trailerNumber: "CC1", localDateKey: "2026-07-01", occurredAt: "2026-07-01T10:00:00Z" }),
  ];

  it("supports today, last 7 days, last 30 days, custom, customer, multi-customer, ownership, outsourcing, trailer and combined filters", () => {
    expect(filterHistoricalListRecords(rows, emptyFilters(today))).toHaveLength(2);
    expect(filterHistoricalListRecords(rows, emptyFilters(last7))).toHaveLength(2);
    expect(filterHistoricalListRecords(rows, emptyFilters(last30)).map((row) => row.id).sort()).toEqual(["a", "b"]);
    expect(filterHistoricalListRecords(rows, { ...emptyFilters({ preset: "custom", startDate: "2026-07-01", endDate: "2026-08-22" }), customers: ["Alpha"] }).map((row) => row.id)).toEqual(["a", "c"]);
    expect(filterHistoricalListRecords(rows, { ...emptyFilters(last7), customers: ["Alpha", "Beta"] }).map((row) => row.id).sort()).toEqual(["a", "b"]);
    expect(filterHistoricalListRecords(rows, { ...emptyFilters(last7), ownership: "outsourcing" })).toEqual([rows[1]]);
    expect(filterHistoricalListRecords(rows, { ...emptyFilters(last7), search: "bb1" })).toEqual([rows[1]]);
    expect(filterHistoricalListRecords(rows, { ...emptyFilters(last7), haulier: "Carrier Z", vessel: "islander", ownership: "outsourcing", search: "BB" })).toEqual([rows[1]]);
  });

  it("keeps headline totals equal to filtered rows", () => {
    const filtered = filterHistoricalListRecords(rows, emptyFilters(last7));
    expect(buildHistoricalListTotals(filtered)).toEqual({ records: 2, company: 1, outsourcing: 1, unknown: 0 });
  });

  it("parses report kinds without inventing unknown types", () => {
    expect(parseHistoricalListKind("collections")).toBe("collections");
    expect(parseHistoricalListKind("nope")).toBe("arrivals");
  });
});

describe("historical CSV", () => {
  it("exports the exact filtered rows with stable headers and UTF-8 CSV wrapping", () => {
    const row = record({ id: "arrival:a1", kind: "arrivals", dischargedAt: null, receptionAt: "2026-08-22T04:40:00.000Z" });
    const headers = historicalCsvHeaders("arrivals");
    const csv = buildCsv(headers, [historicalCsvRow(row)]);
    expect(headers).toContain("Discharged At");
    expect(headers).toContain("Reception/Arrival At");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(escapeCsvCell("Discharged At"));
    expect(csv).toContain("—");
    expect(csv).not.toContain("<div");
    expect(historicalCsvFileName("arrivals", "2026-08-22")).toBe("ferryspeed-arrivals-2026-08-22.csv");
  });
});

const emptyFilters = (range: ReturnType<typeof createHistoryDateRange>) => ({
  range,
  customers: [] as string[],
  ownership: "all" as const,
  search: "",
  haulier: "",
  vessel: "",
  collectionSource: "all" as const,
  eventType: "all",
});
