import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { calculateCollectionAging } from "@/lib/collection-aging";
import {
  buildActiveExportStatusByTrailerId,
  isExportAllocationActive,
  isExportAllocationOverdue,
  isTrailerEligibleForCompoundViews,
  isTrailerPresentInCompoundInventory,
  normalizeExportAllocationRecord,
  type ExportAllocationRecord,
} from "@/lib/export-allocation";
import { type HistoryDateRangeValue } from "@/lib/history-date-range";
import { getOperationalAlerts, type OperationalAlertRow } from "@/lib/operational-alerts";
import type {
  ExecutiveDashboardAlertItem,
  ExecutiveDashboardCustomerMetric,
  ExecutiveDashboardReportData,
  ExecutiveDashboardTrendPoint,
  ExecutiveDashboardVesselMetric,
} from "@/lib/reports/types";

type TrailerRow = {
  id: string;
  trailer_number: string | null;
  customer: string | null;
  consignee: string | null;
  load_status: string | null;
  operational_status: string | null;
  compound_position: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  is_local: boolean | null;
  created_at: string | null;
};

type VesselOperationRow = {
  id: string;
  vessel_name: string | null;
  sailing_reference: string | null;
  status: string | null;
};

type VesselTrailerRow = {
  id: string;
  vessel_operation_id: string;
  customer: string | null;
  arrival_status: string | null;
  arrived_at: string | null;
  inspection_completed_at: string | null;
  priority_level: string | null;
  has_damage: boolean | null;
  has_temperature_alert: boolean | null;
};

type DeliveryBookingRow = {
  customer: string | null;
  status: string;
  delivered_at: string | null;
  waiting_collection_since: string | null;
  collection_due_date: string | null;
  delivery_date: string;
};

type StockCheckRow = {
  id: string;
  expected_total: number | null;
  checked_total: number | null;
  present_total: number | null;
  missing_total: number | null;
  unexpected_total: number | null;
  wrong_position_total: number | null;
  wrong_status_total: number | null;
};

type StockCheckItemRow = {
  discrepancy_type: string | null;
};

type ActivityRow = {
  created_at: string | null;
  event_type: string;
};

const COMPOUND_CAPACITY = 50;
const MS_PER_HOUR = 3_600_000;

const normalizeText = (value?: string | null) => (value ?? "").trim().toLowerCase();

const getDateKey = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
};

const hoursBetween = (start: string | null | undefined, end: string | null | undefined) => {
  if (!start) {
    return 0;
  }

  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const diff = endDate.getTime() - startDate.getTime();

  if (!Number.isFinite(diff) || diff < 0) {
    return 0;
  }

  return diff / MS_PER_HOUR;
};

const buildDateSeries = (range: HistoryDateRangeValue) => {
  const result: string[] = [];
  const cursor = new Date(`${range.startDate}T00:00:00`);
  const end = new Date(`${range.endDate}T00:00:00`);

  while (cursor.getTime() <= end.getTime()) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
};

export async function loadExecutiveDashboardReportData(
  supabase: SupabaseClient<Database>,
  range: HistoryDateRangeValue,
): Promise<ExecutiveDashboardReportData> {
  const startDateTime = `${range.startDate}T00:00:00.000Z`;
  const endDateTime = `${range.endDate}T23:59:59.999Z`;

  const [
    { data: trailersData, error: trailersError },
    { data: exportAllocationsData, error: exportAllocationsError },
    { data: vesselOperationsData, error: vesselOperationsError },
    { data: vesselTrailersData, error: vesselTrailersError },
    { data: deliveryBookingsData, error: deliveryBookingsError },
    { data: stockCheckData, error: stockCheckError },
    operationalAlertsResult,
    { data: activityData, error: activityError },
    { data: settingsData, error: settingsError },
  ] = await Promise.all([
    supabase
      .from("trailers")
      .select("id, trailer_number, customer, consignee, load_status, operational_status, compound_position, arrival_date, departure_date, is_local, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("export_allocations")
      .select("id, trailer_id, trailer_number, customer, collection_date, expected_return_at, priority, status, allocated_at, delivered_empty_at, waiting_loading_at, collected_loaded_at, completed_at, cancelled_at, shipped_at, created_at, updated_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("vessel_operations")
      .select("id, vessel_name, sailing_reference, status")
      .order("created_at", { ascending: false }),
    supabase
      .from("vessel_operation_trailers")
      .select("id, vessel_operation_id, customer, arrival_status, arrived_at, inspection_completed_at, priority_level, has_damage, has_temperature_alert")
      .order("created_at", { ascending: false }),
    supabase
      .from("delivery_bookings")
      .select("customer, status, delivered_at, waiting_collection_since, collection_due_date, delivery_date")
      .order("delivery_date", { ascending: true }),
    supabase
      .from("compound_stock_checks")
      .select("id, expected_total, checked_total, present_total, missing_total, unexpected_total, wrong_position_total, wrong_status_total")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getOperationalAlerts({ includeResolved: false, status: ["active", "acknowledged"], limit: 25 }, supabase),
    supabase
      .from("trailer_activity_log")
      .select("created_at, event_type")
      .gte("created_at", startDateTime)
      .lte("created_at", endDateTime)
      .order("created_at", { ascending: true }),
    supabase
      .from("operational_alert_settings")
      .select("priority_inspection_pending_minutes, export_waiting_collection_hours")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (trailersError) throw new Error(trailersError.message || "Unable to load dashboard trailers.");
  if (exportAllocationsError) throw new Error(exportAllocationsError.message || "Unable to load export allocations.");
  if (vesselOperationsError) throw new Error(vesselOperationsError.message || "Unable to load vessel operations.");
  if (vesselTrailersError) throw new Error(vesselTrailersError.message || "Unable to load vessel trailers.");
  if (deliveryBookingsError) throw new Error(deliveryBookingsError.message || "Unable to load delivery bookings.");
  if (stockCheckError) throw new Error(stockCheckError.message || "Unable to load stock checks.");
  if (activityError) throw new Error(activityError.message || "Unable to load operational activity.");
  if (settingsError) throw new Error(settingsError.message || "Unable to load operational alert settings.");

  const operationalAlerts = operationalAlertsResult.ok ? operationalAlertsResult.data : [];
  if (!operationalAlertsResult.ok) {
    throw new Error(operationalAlertsResult.error);
  }

  const trailers = (trailersData ?? []) as TrailerRow[];
  const exportAllocations = ((exportAllocationsData ?? []) as ExportAllocationRecord[]).map((row) => normalizeExportAllocationRecord(row));
  const vesselOperations = (vesselOperationsData ?? []) as VesselOperationRow[];
  const vesselTrailers = (vesselTrailersData ?? []) as VesselTrailerRow[];
  const deliveryBookings = (deliveryBookingsData ?? []) as DeliveryBookingRow[];
  const activityRows = (activityData ?? []) as ActivityRow[];
  const stockCheck = (stockCheckData ?? null) as StockCheckRow | null;
  const settings = settingsData ?? null;
  const priorityInspectionMinutes = Number(settings?.priority_inspection_pending_minutes ?? 60) || 60;
  const exportWaitingCollectionHours = Number(settings?.export_waiting_collection_hours ?? 24) || 24;

  const activeExportAllocations = exportAllocations.filter((item) => isExportAllocationActive(item.status));
  const activeExportStatusByTrailerId = buildActiveExportStatusByTrailerId(activeExportAllocations);
  const activeTrailers = trailers.filter((trailer) => {
    const hasDeparture = Boolean(trailer.departure_date?.trim());
    return !hasDeparture && (trailer.is_local === true || isTrailerEligibleForCompoundViews(trailer, activeExportStatusByTrailerId.get(trailer.id)));
  });
  const compoundTrailers = activeTrailers.filter((trailer) => trailer.is_local !== true && isTrailerPresentInCompoundInventory(trailer, activeExportStatusByTrailerId.get(trailer.id)));

  const compoundDwellHours = compoundTrailers.map((trailer) => hoursBetween(trailer.arrival_date ?? trailer.created_at, null));
  const averageCompoundDwellHours = compoundDwellHours.length ? compoundDwellHours.reduce((total, value) => total + value, 0) / compoundDwellHours.length : 0;
  const longestCompoundDwellTrailer = compoundTrailers.reduce<{ trailerNumber: string | null; dwellHours: number } | null>((best, trailer) => {
    const dwellHours = hoursBetween(trailer.arrival_date ?? trailer.created_at, null);
    if (!best || dwellHours > best.dwellHours) {
      return { trailerNumber: trailer.trailer_number ?? null, dwellHours };
    }

    return best;
  }, null);

  const dwellBands = compoundTrailers.reduce(
    (bands, trailer) => {
      const dwellHours = hoursBetween(trailer.arrival_date ?? trailer.created_at, null);
      if (dwellHours < 24) {
        bands.under24h += 1;
      } else if (dwellHours < 72) {
        bands.oneToThreeDays += 1;
      } else if (dwellHours < 168) {
        bands.fourToSevenDays += 1;
      } else {
        bands.overSevenDays += 1;
      }
      return bands;
    },
    { under24h: 0, oneToThreeDays: 0, fourToSevenDays: 0, overSevenDays: 0 },
  );

  const dateSeries = buildDateSeries(range);
  const arrivalCounts = new Map<string, number>(dateSeries.map((date) => [date, 0]));
  const departureCounts = new Map<string, number>(dateSeries.map((date) => [date, 0]));
  const inspectionCounts = new Map<string, number>(dateSeries.map((date) => [date, 0]));
  const alertCounts = new Map<string, number>(dateSeries.map((date) => [date, 0]));
  const riskCounts = new Map<string, number>(dateSeries.map((date) => [date, 0]));
  const netChangeByDate = new Map<string, number>(dateSeries.map((date) => [date, 0]));

  activityRows.forEach((row) => {
    const dateKey = getDateKey(row.created_at);
    if (!dateKey || !arrivalCounts.has(dateKey)) {
      return;
    }

    const eventType = normalizeText(row.event_type);
    if (["arrived", "compound_entered", "vessel_arrived"].includes(eventType)) {
      arrivalCounts.set(dateKey, (arrivalCounts.get(dateKey) ?? 0) + 1);
      netChangeByDate.set(dateKey, (netChangeByDate.get(dateKey) ?? 0) + 1);
    }

    if (["departed", "compound_removed"].includes(eventType)) {
      departureCounts.set(dateKey, (departureCounts.get(dateKey) ?? 0) + 1);
      netChangeByDate.set(dateKey, (netChangeByDate.get(dateKey) ?? 0) - 1);
    }

    if (eventType === "inspection_completed") {
      inspectionCounts.set(dateKey, (inspectionCounts.get(dateKey) ?? 0) + 1);
    }

    if (["temperature_recorded", "damage_recorded", "stock_check_confirmed", "stock_check_adjusted"].includes(eventType)) {
      riskCounts.set(dateKey, (riskCounts.get(dateKey) ?? 0) + 1);
    }
  });

  operationalAlerts.forEach((alert) => {
    const dateKey = getDateKey(alert.created_at);
    if (!dateKey || !alertCounts.has(dateKey)) {
      return;
    }

    alertCounts.set(dateKey, (alertCounts.get(dateKey) ?? 0) + 1);
  });

  const totalNetChange = Array.from(netChangeByDate.values()).reduce((total, value) => total + value, 0);
  const startingOccupancy = Math.max(0, compoundTrailers.length - totalNetChange);
  const trends: ExecutiveDashboardTrendPoint[] = [];
  let runningOccupancy = startingOccupancy;

  dateSeries.forEach((date) => {
    runningOccupancy = Math.max(0, runningOccupancy + (netChangeByDate.get(date) ?? 0));
    trends.push({
      date,
      label: new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      arrivals: arrivalCounts.get(date) ?? 0,
      departures: departureCounts.get(date) ?? 0,
      inspections: inspectionCounts.get(date) ?? 0,
      alertsRaised: alertCounts.get(date) ?? 0,
      riskEvents: riskCounts.get(date) ?? 0,
      compoundOccupancy: runningOccupancy,
      netCompoundChange: netChangeByDate.get(date) ?? 0,
    });
  });

  const vesselArrivalTrailers = vesselTrailers.filter((row) => normalizeText(row.arrival_status) === "arrived" || Boolean(row.arrived_at));
  const inspectedTrailers = vesselArrivalTrailers.filter((row) => Boolean(row.inspection_completed_at));
  const inspectionCompletionRate = vesselArrivalTrailers.length ? Math.round((inspectedTrailers.length / vesselArrivalTrailers.length) * 100) : 100;
  const temperatureAlerts = vesselTrailers.filter((row) => row.has_temperature_alert === true).length;

  const priorityTrailers = vesselTrailers.filter((row) => {
    const priority = normalizeText(row.priority_level);
    return priority === "high" || priority === "urgent" || priority === "critical";
  });

  const prioritySlaMet = priorityTrailers.filter((row) => {
    if (!row.arrived_at || !row.inspection_completed_at) {
      return false;
    }

    const inspectionMinutes = (new Date(row.inspection_completed_at).getTime() - new Date(row.arrived_at).getTime()) / 60_000;
    return inspectionMinutes <= priorityInspectionMinutes;
  });

  const waitingCollectionBookings = deliveryBookings.filter((booking) => normalizeText(booking.status) === "waiting_collection" || Boolean(booking.waiting_collection_since));
  const waitingCollectionOverdue = waitingCollectionBookings.filter((booking) => calculateCollectionAging(booking).isOverdue || calculateCollectionAging(booking).waitingDays * 24 >= exportWaitingCollectionHours).length;

  const exportSla = {
    overdue: activeExportAllocations.filter((allocation) => isExportAllocationOverdue(allocation)).length,
    waitingLoading: activeExportAllocations.filter((allocation) => normalizeText(allocation.status) === "waiting_loading").length,
    collectedLoaded: activeExportAllocations.filter((allocation) => normalizeText(allocation.status) === "collected_loaded").length,
    deliveredEmpty: activeExportAllocations.filter((allocation) => normalizeText(allocation.status) === "delivered_empty").length,
  };

  const compoundOccupancyPercent = Math.round((compoundTrailers.length / COMPOUND_CAPACITY) * 100);
  const availableEmptyTrailers = compoundTrailers.filter((trailer) => normalizeText(trailer.load_status) === "empty" && !activeExportAllocations.some((allocation) => allocation.trailer_id === trailer.id)).length;
  const loadedTrailers = compoundTrailers.filter((trailer) => normalizeText(trailer.load_status) === "loaded").length;
  const maintenanceTrailers = compoundTrailers.filter((trailer) => {
    const status = normalizeText(trailer.operational_status);
    return status.includes("maintenance") || status.includes("hold") || status === "blocked";
  }).length;
  const positionUtilisationPercent = compoundTrailers.length ? Math.round((compoundTrailers.filter((trailer) => Boolean(trailer.compound_position?.trim())).length / compoundTrailers.length) * 100) : 0;

  const customerMap = new Map<string, { trailers: number; exportAllocations: number; overdueAllocations: number; priorityTrailers: number; dwellHoursTotal: number; dwellCount: number; temperatureAlerts: number }>();
  const getCustomerMetric = (customerName: string) => {
    const existing = customerMap.get(customerName);
    if (existing) {
      return existing;
    }

    const next = { trailers: 0, exportAllocations: 0, overdueAllocations: 0, priorityTrailers: 0, dwellHoursTotal: 0, dwellCount: 0, temperatureAlerts: 0 };
    customerMap.set(customerName, next);
    return next;
  };

  activeTrailers.forEach((trailer) => {
    const customerName = trailer.customer?.trim() || trailer.consignee?.trim() || "Unassigned";
    const metric = getCustomerMetric(customerName);
    metric.trailers += 1;
    metric.dwellHoursTotal += hoursBetween(trailer.arrival_date ?? trailer.created_at, null);
    metric.dwellCount += 1;
  });

  activeExportAllocations.forEach((allocation) => {
    const customerName = allocation.customer?.trim() || "Unassigned";
    const metric = getCustomerMetric(customerName);
    metric.exportAllocations += 1;
    metric.overdueAllocations += isExportAllocationOverdue(allocation) ? 1 : 0;
  });

  priorityTrailers.forEach((trailer) => {
    const customerName = trailer.customer?.trim() || "Unassigned";
    getCustomerMetric(customerName).priorityTrailers += 1;
  });

  vesselTrailers.forEach((trailer) => {
    const customerName = trailer.customer?.trim();
    if (!customerName) {
      return;
    }

    getCustomerMetric(customerName).temperatureAlerts += trailer.has_temperature_alert === true ? 1 : 0;
  });

  const customers: ExecutiveDashboardCustomerMetric[] = Array.from(customerMap.entries())
    .map(([customer, metric]) => ({
      customer,
      trailers: metric.trailers,
      exportAllocations: metric.exportAllocations,
      overdueAllocations: metric.overdueAllocations,
      priorityTrailers: metric.priorityTrailers,
      averageCompoundDwellHours: metric.dwellCount ? metric.dwellHoursTotal / metric.dwellCount : 0,
      temperatureAlerts: metric.temperatureAlerts,
    }))
    .sort((left, right) => right.trailers + right.exportAllocations - (left.trailers + left.exportAllocations))
    .slice(0, 8);

  const vesselMetricMap = new Map<string, { vesselName: string; sailingReference: string | null; trailers: number; inspectedTrailers: number; temperatureAlerts: number; damageFlags: number }>();
  vesselOperations.forEach((operation) => {
    vesselMetricMap.set(operation.id, {
      vesselName: operation.vessel_name?.trim() || "Unnamed Vessel",
      sailingReference: operation.sailing_reference ?? null,
      trailers: 0,
      inspectedTrailers: 0,
      temperatureAlerts: 0,
      damageFlags: 0,
    });
  });

  vesselTrailers.forEach((trailer) => {
    const vesselMetric = vesselMetricMap.get(trailer.vessel_operation_id);
    if (!vesselMetric) {
      return;
    }

    vesselMetric.trailers += 1;
    vesselMetric.inspectedTrailers += trailer.inspection_completed_at ? 1 : 0;
    vesselMetric.temperatureAlerts += trailer.has_temperature_alert === true ? 1 : 0;
    vesselMetric.damageFlags += trailer.has_damage === true ? 1 : 0;
  });

  const topOperations: ExecutiveDashboardVesselMetric[] = Array.from(vesselMetricMap.values())
    .map((metric) => ({
      vesselName: metric.vesselName,
      sailingReference: metric.sailingReference,
      trailers: metric.trailers,
      inspectedTrailers: metric.inspectedTrailers,
      temperatureAlerts: metric.temperatureAlerts,
      damageFlags: metric.damageFlags,
      completionRate: metric.trailers ? Math.round((metric.inspectedTrailers / metric.trailers) * 100) : 100,
    }))
    .sort((left, right) => right.trailers - left.trailers)
    .slice(0, 6);

  const stockCheckItemsResult = stockCheck?.id
    ? await supabase
        .from("compound_stock_check_items")
        .select("discrepancy_type")
        .eq("stock_check_id", stockCheck.id)
    : { data: [], error: null as null };

  if (stockCheckItemsResult.error) {
    throw new Error(stockCheckItemsResult.error.message || "Unable to load stock check details.");
  }

  const stockCheckItems = (stockCheckItemsResult.data ?? []) as StockCheckItemRow[];
  const missingTotal = stockCheckItems.filter((item) => normalizeText(item.discrepancy_type).includes("missing")).length;
  const unexpectedTotal = stockCheckItems.filter((item) => normalizeText(item.discrepancy_type).includes("unexpected")).length;
  const wrongPositionTotal = stockCheckItems.filter((item) => normalizeText(item.discrepancy_type).includes("position")).length;
  const wrongStatusTotal = stockCheckItems.filter((item) => normalizeText(item.discrepancy_type).includes("status")).length;
  const checkedTotal = stockCheck?.checked_total ?? stockCheckItems.length;
  const expectedTotal = stockCheck?.expected_total ?? checkedTotal;
  const discrepancyTotal = missingTotal + unexpectedTotal + wrongPositionTotal + wrongStatusTotal;
  const stockCheckAccuracyPercent = expectedTotal > 0 ? Math.max(0, Math.round(((expectedTotal - discrepancyTotal) / expectedTotal) * 100)) : 100;

  const activeAlertItems: ExecutiveDashboardAlertItem[] = operationalAlerts.map((alert: OperationalAlertRow) => ({
    id: alert.id,
    title: alert.title,
    severity: alert.severity,
    trailerNumber: alert.trailer_number ?? null,
    sourceModule: alert.source_module,
    createdAt: alert.created_at,
  }));

  const longestCompoundDwellHours = longestCompoundDwellTrailer?.dwellHours ?? 0;
  const todayKey = new Date().toISOString().slice(0, 10);

  return {
    range: { ...range, preset: range.preset, startDate: range.startDate, endDate: range.endDate },
    generatedAt: new Date().toISOString(),
    summary: {
      compoundTrailers: compoundTrailers.length,
      compoundOccupancyPercent,
      activeExportAllocations: activeExportAllocations.length,
      todaysArrivals: trailers.filter((trailer) => getDateKey(trailer.arrival_date) === todayKey).length,
      todaysDepartures: trailers.filter((trailer) => getDateKey(trailer.departure_date) === todayKey).length,
      inspectionCompletionRate,
      averageCompoundDwellHours,
      longestCompoundDwellHours,
      longestCompoundDwellTrailer: longestCompoundDwellTrailer?.trailerNumber ?? null,
      prioritySlaPercent: priorityTrailers.length ? Math.round((prioritySlaMet.length / priorityTrailers.length) * 100) : 100,
      temperatureAlerts,
      stockCheckAccuracyPercent,
      waitingCollectionOverdue,
      activeAlerts: activeAlertItems.length,
    },
    compound: {
      availableEmptyTrailers,
      loadedTrailers,
      maintenanceTrailers,
      positionUtilisationPercent,
      dwellBands,
      topDwellTrailers: compoundTrailers
        .map((trailer) => ({
          trailerNumber: trailer.trailer_number ?? "Unknown",
          customer: trailer.customer ?? trailer.consignee ?? null,
          compoundPosition: trailer.compound_position ?? null,
          loadStatus: trailer.load_status ?? null,
          dwellHours: hoursBetween(trailer.arrival_date ?? trailer.created_at, null),
        }))
        .sort((left, right) => right.dwellHours - left.dwellHours)
        .slice(0, 8),
    },
    vessel: {
      totalOperations: vesselOperations.length,
      activeOperations: vesselOperations.filter((operation) => !["completed", "cancelled"].includes(normalizeText(operation.status))).length,
      completedOperations: vesselOperations.filter((operation) => normalizeText(operation.status) === "completed").length,
      inspectionPending: vesselTrailers.filter((row) => normalizeText(row.arrival_status) === "arrived" && !row.inspection_completed_at).length,
      topOperations,
    },
    customers,
    trends: trendsFromSeries(dateSeries, arrivalCounts, departureCounts, inspectionCounts, alertCounts, riskCounts, netChangeByDate, compoundTrailers.length),
    alerts: activeAlertItems,
    exportSla,
    stockCheck: {
      latestCheckId: stockCheck?.id ?? null,
      expectedTotal,
      checkedTotal,
      discrepancyTotal,
      missingTotal,
      unexpectedTotal,
      wrongPositionTotal,
      wrongStatusTotal,
    },
  } satisfies ExecutiveDashboardReportData;
}

const trendsFromSeries = (
  dates: string[],
  arrivals: Map<string, number>,
  departures: Map<string, number>,
  inspections: Map<string, number>,
  alerts: Map<string, number>,
  risks: Map<string, number>,
  netChange: Map<string, number>,
  currentOccupancy: number,
) => {
  const totalNetChange = Array.from(netChange.values()).reduce((total, value) => total + value, 0);
  let runningOccupancy = Math.max(0, currentOccupancy - totalNetChange);

  return dates.map((date): ExecutiveDashboardTrendPoint => {
    runningOccupancy = Math.max(0, runningOccupancy + (netChange.get(date) ?? 0));

    return {
      date,
      label: new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      arrivals: arrivals.get(date) ?? 0,
      departures: departures.get(date) ?? 0,
      inspections: inspections.get(date) ?? 0,
      alertsRaised: alerts.get(date) ?? 0,
      riskEvents: risks.get(date) ?? 0,
      compoundOccupancy: runningOccupancy,
      netCompoundChange: netChange.get(date) ?? 0,
    };
  });
};