import { describe, expect, it } from "vitest";
import { COLLECTION_STATUS_RULES } from "@/lib/collection-aging";
import { createHistoryDateRange } from "@/lib/history-date-range";
import {
  buildOperationalSummary,
  classifyOperationalOwnership,
  eventsForKpi,
  getLast7DaysRange,
  listLocalDateKeysInclusive,
  mapArrivalEvent,
  mapDeliveryCollectionEvent,
  mapDeliveryEvent,
  mapDepartureEvent,
  mapExportCollectionEvent,
  toOperationalLocalDateKey,
  type OperationalSummaryEvent,
} from "@/lib/reports/operational-summary";

const friday = "2026-08-21";
const last7 = getLast7DaysRange(friday);

const event = (overrides: Partial<OperationalSummaryEvent> & Pick<OperationalSummaryEvent, "id" | "movementType" | "occurredAt" | "localDateKey">): OperationalSummaryEvent => ({
  trailerNumber: "FS100",
  customer: "Customer A",
  haulier: null,
  ownershipType: "company",
  sourceOrDestination: null,
  reference: null,
  loadStatus: null,
  notes: null,
  ...overrides,
});

describe("operational summary last 7 days", () => {
  it("uses today plus the previous 6 local calendar dates", () => {
    const keys = listLocalDateKeysInclusive(last7.startDate, last7.endDate);
    expect(last7).toEqual(createHistoryDateRange("last_7_days", friday));
    expect(keys).toEqual([
      "2026-08-15",
      "2026-08-16",
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
    ]);
    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe("2026-08-15");
    expect(keys[6]).toBe(friday);
  });

  it("includes the first and last local days and excludes the day before the window", () => {
    const events = [
      event({ id: "before", movementType: "departure", occurredAt: "2026-08-14T10:00:00", localDateKey: "2026-08-14" }),
      event({ id: "start", movementType: "departure", occurredAt: "2026-08-15T10:00:00", localDateKey: "2026-08-15" }),
      event({ id: "end", movementType: "departure", occurredAt: "2026-08-21T10:00:00", localDateKey: "2026-08-21" }),
      event({ id: "after", movementType: "departure", occurredAt: "2026-08-22T10:00:00", localDateKey: "2026-08-22" }),
    ];
    const summary = buildOperationalSummary(events, {
      range: last7,
      movementType: "all",
      ownership: "all",
      customer: "",
      haulier: "",
      search: "",
    });
    expect(summary.kpis.departures).toBe(2);
    expect(summary.events.map((row) => row.id)).toEqual(["end", "start"]);
  });

  it("excludes cancelled operations from every metric", () => {
    expect(mapArrivalEvent({
      id: "a1",
      arrival_confirmed_at: "2026-08-21T10:00:00.000Z",
      cancelled_at: "2026-08-21T11:00:00.000Z",
    })).toBeNull();
    expect(mapArrivalEvent({
      id: "a2",
      arrived_at: "2026-08-21T10:00:00.000Z",
      no_show_at: "2026-08-21T11:00:00.000Z",
    })).toBeNull();
    expect(mapDepartureEvent({
      id: "d1",
      departure_date: "2026-08-21",
      operational_status: "cancelled",
    })).toBeNull();
    expect(mapDeliveryEvent({
      id: "del1",
      delivered_at: "2026-08-21T10:00:00.000Z",
      status: "cancelled",
    })).toBeNull();
    expect(mapDeliveryCollectionEvent({
      id: "c1",
      collected_at: "2026-08-21T10:00:00.000Z",
      status: "cancelled",
    })).toBeNull();
    expect(mapExportCollectionEvent({
      id: "e1",
      collected_loaded_at: "2026-08-21T10:00:00.000Z",
      cancelled_at: "2026-08-21T11:00:00.000Z",
    })).toBeNull();
  });

  it("makes headline totals equal the daily breakdown sums", () => {
    const events = [
      event({ id: "a", movementType: "arrival", occurredAt: "2026-08-15T10:00:00", localDateKey: "2026-08-15", ownershipType: "outsourcing" }),
      event({ id: "b", movementType: "departure", occurredAt: "2026-08-16T10:00:00", localDateKey: "2026-08-16" }),
      event({ id: "c", movementType: "delivery", occurredAt: "2026-08-17T10:00:00", localDateKey: "2026-08-17" }),
      event({ id: "d", movementType: "collection", occurredAt: "2026-08-18T10:00:00", localDateKey: "2026-08-18" }),
      event({ id: "e", movementType: "arrival", occurredAt: "2026-08-21T10:00:00", localDateKey: "2026-08-21" }),
    ];
    const summary = buildOperationalSummary(events, {
      range: last7,
      movementType: "all",
      ownership: "all",
      customer: "",
      haulier: "",
      search: "",
    });

    expect(summary.dailyRows).toHaveLength(7);
    expect(summary.kpis.arrivals).toBe(summary.dailyTotal.arrivals);
    expect(summary.kpis.departures).toBe(summary.dailyTotal.departures);
    expect(summary.kpis.deliveries).toBe(summary.dailyTotal.deliveries);
    expect(summary.kpis.collections).toBe(summary.dailyTotal.collections);
    expect(summary.kpis.outsourcings).toBe(summary.dailyTotal.outsourcings);
    expect(summary.kpis.totalMovements).toBe(
      summary.kpis.arrivals + summary.kpis.departures + summary.kpis.deliveries + summary.kpis.collections,
    );
    expect(summary.kpis.totalMovements).not.toBe(
      summary.kpis.arrivals + summary.kpis.departures + summary.kpis.deliveries + summary.kpis.collections + summary.kpis.outsourcings,
    );
  });
});

describe("operational summary canonical timestamps", () => {
  it("uses arrival_confirmed_at then arrived_at for arrivals", () => {
    const confirmed = mapArrivalEvent({
      id: "a1",
      arrival_confirmed_at: "2026-08-21T09:15:00.000Z",
      arrived_at: "2026-08-21T08:00:00.000Z",
      trailer_number: "FS1",
    });
    const arrivedOnly = mapArrivalEvent({
      id: "a2",
      arrived_at: "2026-08-21T08:00:00.000Z",
      trailer_number: "FS2",
    });
    const createdOnly = mapArrivalEvent({
      id: "a3",
      trailer_number: "FS3",
    });

    expect(confirmed?.occurredAt).toBe("2026-08-21T09:15:00.000Z");
    expect(arrivedOnly?.occurredAt).toBe("2026-08-21T08:00:00.000Z");
    expect(createdOnly).toBeNull();
  });

  it("uses departure_date and departure_time for actual departures", () => {
    const mapped = mapDepartureEvent({
      id: "d1",
      departure_date: "2026-08-21",
      departure_time: "14:30",
      trailer_number: "FS9",
    });
    expect(mapped?.occurredAt).toBe("2026-08-21T14:30:00");
    expect(mapped?.localDateKey).toBe("2026-08-21");
  });

  it("uses delivered_at for completed deliveries and collected_at for collections", () => {
    expect(mapDeliveryEvent({ id: "del", status: "delivered" })).toBeNull();
    const delivery = mapDeliveryEvent({ id: "del2", delivered_at: "2026-08-21T11:00:00.000Z", status: "waiting_collection" });
    const collection = mapDeliveryCollectionEvent({ id: "col", collected_at: "2026-08-21T16:00:00.000Z", status: "collected" });
    const exportCollection = mapExportCollectionEvent({ id: "exp", collected_loaded_at: "2026-08-21T17:00:00.000Z", status: "collected_loaded", haulier: "Haulier A" });

    expect(delivery?.occurredAt).toBe("2026-08-21T11:00:00.000Z");
    expect(collection?.occurredAt).toBe("2026-08-21T16:00:00.000Z");
    expect(exportCollection?.occurredAt).toBe("2026-08-21T17:00:00.000Z");
    expect(exportCollection?.collectionSource).toBe("export");
    expect(exportCollection?.haulier).toBe("Haulier A");
    expect(mapDeliveryCollectionEvent({
      id: "pickup",
      collected_at: "2026-08-21T16:00:00.000Z",
      status: "on_delivery",
    })).toBeNull();
    expect(mapDeliveryCollectionEvent({
      id: "waiting",
      collected_at: "2026-08-21T16:00:00.000Z",
      status: "waiting_collection",
    })).toBeNull();
  });

  it("classifies outsourcing from canonical ownership fields and not trailer-number prefixes", () => {
    expect(classifyOperationalOwnership({ trailerSource: "outsourced", externalCompany: "Carrier Z" })).toBe("outsourcing");
    expect(classifyOperationalOwnership({ trailerSource: "company" })).toBe("company");
    expect(classifyOperationalOwnership({ isLocal: true })).toBe("company");
    expect(mapArrivalEvent({
      id: "prefix",
      arrival_confirmed_at: "2026-08-21T10:00:00.000Z",
      trailer_number: "PFC999",
    })?.ownershipType).toBe("unknown");
    expect(mapArrivalEvent({
      id: "own",
      arrival_confirmed_at: "2026-08-21T10:00:00.000Z",
      trailer_number: "PFC999",
      ownership_type: "outsourcing",
      external_company: "Carrier Z",
    })?.ownershipType).toBe("outsourcing");
  });

  it("keeps KPI drill-down records equal to the headline number", () => {
    const events = [
      event({ id: "a1", movementType: "arrival", occurredAt: "2026-08-21T08:00:00", localDateKey: "2026-08-21", ownershipType: "outsourcing" }),
      event({ id: "a2", movementType: "arrival", occurredAt: "2026-08-21T09:00:00", localDateKey: "2026-08-21" }),
      event({ id: "d1", movementType: "departure", occurredAt: "2026-08-21T10:00:00", localDateKey: "2026-08-21", ownershipType: "outsourcing" }),
    ];
    const summary = buildOperationalSummary(events, {
      range: last7,
      movementType: "all",
      ownership: "all",
      customer: "",
      haulier: "",
      search: "",
    });
    expect(eventsForKpi(summary.events, "arrivals")).toHaveLength(summary.kpis.arrivals);
    expect(eventsForKpi(summary.events, "departures")).toHaveLength(summary.kpis.departures);
    expect(eventsForKpi(summary.events, "outsourcings")).toHaveLength(summary.kpis.outsourcings);
    expect(summary.kpis.outsourcings).toBe(2);
  });

  it("treats date-only values as local calendar dates", () => {
    expect(toOperationalLocalDateKey("2026-08-21")).toBe("2026-08-21");
  });
});

describe("operational summary regressions", () => {
  it("does not change Mandatory Collection ageing bands", () => {
    expect(COLLECTION_STATUS_RULES.green).toEqual({ minHours: 0, maxHours: 24, label: "Green" });
    expect(COLLECTION_STATUS_RULES.orange).toEqual({ minHours: 24, maxHours: 48, label: "Orange" });
    expect(COLLECTION_STATUS_RULES.red.minHours).toBe(48);
  });
});
