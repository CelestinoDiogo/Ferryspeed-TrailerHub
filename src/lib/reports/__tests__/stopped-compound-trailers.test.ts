import { describe, expect, it } from "vitest";
import { COLLECTION_STATUS_RULES } from "@/lib/collection-aging";
import { isDashboardSafetyAlert } from "@/lib/dashboard-safety-alerts";
import {
  buildStoppedCompoundTrailers,
  filterStoppedCompoundTrailers,
  getStoppedCompoundAgeBand,
  getStoppedCompoundDays,
  isStoppedMoreThanThreeDays,
  resolveStoppedCompoundEntryTimestamp,
  STOPPED_COMPOUND_DAY_MS,
} from "@/lib/reports/stopped-compound-trailers";
import type { OperationalAlertRow } from "@/lib/operational-alerts";

const now = "2026-08-21T12:00:00.000Z";

const trailer = (overrides: Partial<Parameters<typeof buildStoppedCompoundTrailers>[0][number]> = {}) => ({
  id: overrides.id ?? "t1",
  trailer_number: overrides.trailer_number ?? "FS100",
  compound_position: overrides.compound_position ?? "P01",
  load_status: overrides.load_status ?? "loaded",
  customer: overrides.customer ?? "Customer A",
  trailer_source: overrides.trailer_source ?? "company",
  external_company: overrides.external_company ?? null,
  is_local: overrides.is_local ?? false,
  arrival_date: overrides.arrival_date ?? "2026-08-17T12:00:00.000Z",
  created_at: overrides.created_at ?? "2026-08-17T12:00:00.000Z",
  departure_date: overrides.departure_date ?? null,
  operational_status: overrides.operational_status ?? "available",
  ...overrides,
});

describe("stopped compound trailers >3 days", () => {
  it("does not alert at 2d23h59m or at exactly 3 days, and alerts after more than 3 days", () => {
    const justUnder = getStoppedCompoundDays("2026-08-18T12:00:01.000Z", now);
    const exact = getStoppedCompoundDays("2026-08-18T12:00:00.000Z", now);
    const justOver = getStoppedCompoundDays("2026-08-18T11:59:59.000Z", now);

    expect(justUnder).toBeLessThan(3);
    expect(isStoppedMoreThanThreeDays(justUnder)).toBe(false);
    expect(exact).toBe(3);
    expect(isStoppedMoreThanThreeDays(exact)).toBe(false);
    expect(justOver).toBeGreaterThan(3);
    expect(isStoppedMoreThanThreeDays(justOver)).toBe(true);
    expect(getStoppedCompoundAgeBand(justUnder)).toBeNull();
    expect(getStoppedCompoundAgeBand(exact)).toBeNull();
    expect(getStoppedCompoundAgeBand(3 + 1 / STOPPED_COMPOUND_DAY_MS)).toBe("attention");
    expect(getStoppedCompoundAgeBand(5)).toBe("attention");
    expect(getStoppedCompoundAgeBand(5.01)).toBe("warning");
    expect(getStoppedCompoundAgeBand(7)).toBe("warning");
    expect(getStoppedCompoundAgeBand(7.01)).toBe("critical");
  });

  it("uses arrival_date as the canonical compound-entry timestamp before activity or created_at", () => {
    expect(resolveStoppedCompoundEntryTimestamp(
      { arrival_date: "2026-08-10T08:00:00.000Z", created_at: "2026-08-01T08:00:00.000Z" },
      [{ event_type: "compound_entered", created_at: "2026-08-11T08:00:00.000Z" }],
    )).toBe("2026-08-10T08:00:00.000Z");
    expect(resolveStoppedCompoundEntryTimestamp(
      { arrival_date: null, created_at: "2026-08-01T08:00:00.000Z" },
      [
        { event_type: "note", created_at: "2026-08-02T08:00:00.000Z" },
        { event_type: "compound_entered", created_at: "2026-08-05T08:00:00.000Z" },
        { event_type: "arrived", created_at: "2026-08-04T08:00:00.000Z" },
      ],
    )).toBe("2026-08-04T08:00:00.000Z");
    expect(resolveStoppedCompoundEntryTimestamp({ arrival_date: null, created_at: "2026-08-01T08:00:00.000Z" }, [])).toBe("2026-08-01T08:00:00.000Z");
  });

  it("excludes departed and off-compound trailers", () => {
    const records = buildStoppedCompoundTrailers([
      trailer({ id: "present", arrival_date: "2026-08-10T12:00:00.000Z" }),
      trailer({ id: "departed", departure_date: "2026-08-20", arrival_date: "2026-08-10T12:00:00.000Z" }),
      trailer({ id: "local", is_local: true, arrival_date: "2026-08-10T12:00:00.000Z" }),
      trailer({ id: "no-position", compound_position: null, arrival_date: "2026-08-10T12:00:00.000Z" }),
      trailer({ id: "invalid-position", compound_position: "YARD", arrival_date: "2026-08-10T12:00:00.000Z" }),
    ], {
      now,
      exportStatusByTrailerId: new Map([["present", "allocated"]]),
    });

    expect(records.map((row) => row.id)).toEqual(["present"]);
  });

  it("excludes trailers that are off compound because of an active export allocation", () => {
    const records = buildStoppedCompoundTrailers([
      trailer({ id: "at-customer", arrival_date: "2026-08-10T12:00:00.000Z" }),
    ], {
      now,
      exportStatusByTrailerId: new Map([["at-customer", "delivered_empty"]]),
    });
    expect(records).toEqual([]);
  });

  it("sorts oldest first and applies ownership and load filters", () => {
    const records = buildStoppedCompoundTrailers([
      trailer({ id: "newer", trailer_number: "FS200", arrival_date: "2026-08-16T12:00:00.000Z", load_status: "empty", trailer_source: "outsourced", external_company: "Carrier Z" }),
      trailer({ id: "older", trailer_number: "FS100", arrival_date: "2026-08-10T12:00:00.000Z", load_status: "loaded", trailer_source: "company" }),
    ], { now });

    expect(records.map((row) => row.id)).toEqual(["older", "newer"]);
    expect(filterStoppedCompoundTrailers(records, {
      ownership: "outsourcing",
      load: "empty",
      ageBand: "all",
      customer: "",
      search: "",
    }).map((row) => row.id)).toEqual(["newer"]);
    expect(filterStoppedCompoundTrailers(records, {
      ownership: "company",
      load: "loaded",
      ageBand: "critical",
      customer: "",
      search: "FS100",
    }).map((row) => row.id)).toEqual(["older"]);
  });
});

describe("stopped trailer alert isolation", () => {
  it("keeps Mandatory Collection colours unchanged", () => {
    expect(COLLECTION_STATUS_RULES.green.maxHours).toBe(24);
    expect(COLLECTION_STATUS_RULES.orange.maxHours).toBe(48);
    expect(COLLECTION_STATUS_RULES.red.minHours).toBe(48);
  });

  it("does not treat compound ageing as a dashboard damage/temperature alert", () => {
    const alert = {
      id: "ageing",
      alert_key: "compound:age",
      alert_type: "compound_age",
      severity: "warning",
      status: "active",
      title: "Trailers stopped >3 days",
      description: "Ageing stock",
      trailer_id: null,
      trailer_number: "FS100",
      source_module: "compound",
      source_record_id: null,
      metadata: {},
      acknowledged_at: null,
      acknowledged_by: null,
      resolved_at: null,
      resolved_by: null,
      resolution_note: null,
      dismissed_at: null,
      dismissed_by: null,
      created_at: now,
      updated_at: now,
    } as OperationalAlertRow;
    expect(isDashboardSafetyAlert(alert)).toBe(false);
  });
});
