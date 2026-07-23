"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Anchor, ChevronRight, ClipboardList, Package, PlusCircle, ScanSearch, Ship, Truck, Wrench } from "lucide-react";
import { PrintButton } from "@/components/print/print-button";
import { PrintFilters } from "@/components/print/print-filters";
import { PrintFooter } from "@/components/print/print-footer";
import { PrintHeader } from "@/components/print/print-header";
import { PrintReportLayout } from "@/components/print/print-report-layout";
import { PrintSummary } from "@/components/print/print-summary";
import { PrintTable } from "@/components/print/print-table";
import { OperationalAlertsSection } from "@/components/dashboard/operational-alerts-section";
import { COMPOUND_REFRESH_STORAGE_KEY } from "@/lib/export-allocation";
import { supabase } from "@/lib/supabase";
import {
  calculateCollectionAging,
} from "@/lib/collection-aging";
import {
  buildActiveExportStatusByTrailerId,
  isExportAllocationActive,
  isExportAllocationOverdue,
  isTrailerEligibleForCompoundViews,
  isTrailerPresentInCompoundInventory,
  normalizeExportAllocationRecord,
  type ExportAllocationRecord,
} from "@/lib/export-allocation";
import {
  acknowledgeOperationalAlert,
  dismissOperationalAlert,
  getOperationalAlerts,
  resolveOperationalAlert,
  runOperationalAlertDetection,
  type OperationalAlertRow,
  type OperationalAlertSummary,
} from "@/lib/operational-alerts";
import { useOperationalRealtime } from "@/lib/realtime/operational-realtime";

type DashboardStats = {
  totalTrailers: number;
  availableEmptyTrailers: number;
  loadedTrailers: number;
  localTrailers: number;
  allocatedTrailers: number;
  atCustomerTrailers: number;
  occupancy: number;
};

type TrailerRecord = {
  id: string;
  trailer_number?: string | null;
  load_status?: string | null;
  operational_status?: string | null;
  arrival_date?: string | null;
  departure_date?: string | null;
  compound_position?: string | null;
  customer?: string | null;
  load_description?: string | null;
  trailer_source?: string | null;
  external_company?: string | null;
  external_reference?: string | null;
  is_local?: boolean | null;
};

type TrailerEvent = {
  id: string;
  trailer_number: string;
  event_type: string;
  event_description?: string | null;
  created_at?: string | null;
};

type DeliveryBooking = {
  id: string;
  trailer_id: string;
  delivery_date: string;
  delivery_time?: string | null;
  customer?: string | null;
  consignee?: string | null;
  delivery_location?: string | null;
  booking_reference?: string | null;
  status: string;
  trailer_number?: string | null;
};

type WaitingCollectionItem = {
  id: string;
  delivery_date: string;
  delivered_at?: string | null;
  waiting_collection_since?: string | null;
  collection_due_date?: string | null;
  trailer_number?: string | null;
};

type WaitingCollectionSummary = {
  count: number;
  attentionRequiredCount: number;
  oldestTrailer: string | null;
  oldestDays: number;
};

type ExportSummary = {
  allocated: number;
  atCustomer: number;
  collectedLoaded: number;
  overdue: number;
};

type AlertStatusView = "active" | "resolved";

type StockCheckHeadline = {
  id: string;
  started_at: string | null;
  status: string;
};

type StockCheckDiscrepancyRow = {
  id: string;
  trailer_number: string | null;
  discrepancy_type: string | null;
  resolution_status: string | null;
};

type VesselTrailerAlertRow = {
  id: string;
  has_temperature_alert: boolean | null;
  has_damage: boolean | null;
  inspection_completed_at: string | null;
  arrival_status: string;
  status: string | null;
};

type VesselOperationCard = {
  id: string;
  vessel_name?: string | null;
  sailing_reference?: string | null;
  expected_arrival_at?: string | null;
  actual_arrival_at?: string | null;
  status?: string | null;
  created_at?: string | null;
};

const defaultStats: DashboardStats = {
  totalTrailers: 0,
  availableEmptyTrailers: 0,
  loadedTrailers: 0,
  localTrailers: 0,
  allocatedTrailers: 0,
  atCustomerTrailers: 0,
  occupancy: 0,
};

const defaultExportSummary: ExportSummary = {
  allocated: 0,
  atCustomer: 0,
  collectedLoaded: 0,
  overdue: 0,
};

const defaultOperationalAlertSummary: OperationalAlertSummary = {
  totalActiveAlerts: 0,
  criticalCount: 0,
  highCount: 0,
  warningCount: 0,
  infoCount: 0,
  latestAlertAt: null,
  raw: null,
};

const COMPOUND_POSITIONS = 50;

const getDateKey = (value?: string | null) => {
  if (!value) return null;

  try {
    return new Date(value).toISOString().split("T")[0];
  } catch {
    return null;
  }
};

const getPrintedDateTime = () =>
  new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const normalizeLoadStatus = (value?: string | null) => value?.trim().toLowerCase() ?? "";
const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const hasMissingDiscrepancy = (value?: string | null) => normalizeText(value).includes("missing");
const hasUnexpectedDiscrepancy = (value?: string | null) => normalizeText(value).includes("unexpected");

export function TrailerDashboard() {
  const searchParams = useSearchParams();
  const [stats, setStats] = useState<DashboardStats>(defaultStats);
  const [trailers, setTrailers] = useState<TrailerRecord[]>([]);
  const [events, setEvents] = useState<TrailerEvent[]>([]);
  const [operationalAlerts, setOperationalAlerts] = useState<OperationalAlertRow[]>([]);
  const [resolvedOperationalAlerts, setResolvedOperationalAlerts] = useState<OperationalAlertRow[]>([]);
  const [resolvedAlertsLoaded, setResolvedAlertsLoaded] = useState(false);
  const [resolvedAlertsLoading, setResolvedAlertsLoading] = useState(false);
  const [alertStatusView, setAlertStatusView] = useState<AlertStatusView>("active");
  const [operationalAlertSummary, setOperationalAlertSummary] = useState<OperationalAlertSummary>(defaultOperationalAlertSummary);
  const [operationalAlertError, setOperationalAlertError] = useState<string | null>(null);
  const [isAlertsRefreshing, setIsAlertsRefreshing] = useState(false);
  const [todayDeliveries, setTodayDeliveries] = useState<DeliveryBooking[]>([]);
  const [waitingCollections, setWaitingCollections] = useState<WaitingCollectionItem[]>([]);
  const [waitingCollectionSummary, setWaitingCollectionSummary] = useState<WaitingCollectionSummary>({ count: 0, attentionRequiredCount: 0, oldestTrailer: null, oldestDays: 0 });
  const [exportSummary, setExportSummary] = useState<ExportSummary>(defaultExportSummary);
  const [vesselOperations, setVesselOperations] = useState<VesselOperationCard[]>([]);
  const [arrivalsTodayCount, setArrivalsTodayCount] = useState(0);
  const [departuresTodayCount, setDeparturesTodayCount] = useState(0);
  const [vesselOpsTodayCount, setVesselOpsTodayCount] = useState(0);
  const [latestStockCheckId, setLatestStockCheckId] = useState<string | null>(null);
  const [awaitingInspectionCount, setAwaitingInspectionCount] = useState(0);
  const [activeExportAllocationsCount, setActiveExportAllocationsCount] = useState(0);
  const [missingTrailersCount, setMissingTrailersCount] = useState(0);
  const [unexpectedTrailersCount, setUnexpectedTrailersCount] = useState(0);
  const [operationalStatusIssuesCount, setOperationalStatusIssuesCount] = useState(0);
  const [allocatedInCompoundCount, setAllocatedInCompoundCount] = useState(0);
  const [waitingCollection24hCount, setWaitingCollection24hCount] = useState(0);
  const [temperatureAlertsCount, setTemperatureAlertsCount] = useState(0);
  const [damagePendingReviewCount, setDamagePendingReviewCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const saved = searchParams.get("saved");
  const notice = saved === "1" ? "Operation saved successfully. Dashboard refreshed." : null;

  const loadStats = useCallback(async () => {
      setIsLoading(true);
      setError(null);
      setOperationalAlertError(null);

      try {
        const todayKey = getDateKey(new Date().toISOString());

        const [
          { data, error: supabaseError },
          { data: eventsData, error: eventsError },
          { data: deliveriesData, error: deliveriesError },
          { data: waitingData },
          { data: exportAllocationsData, error: exportAllocationsError },
          { data: vesselData, error: vesselError },
          { data: vesselTrailerData, error: vesselTrailerError },
          { data: latestStockCheckData, error: latestStockCheckError },
        ] =
          await Promise.all([
            supabase.from("trailers").select("id, trailer_number, load_status, operational_status, arrival_date, departure_date, compound_position, customer, load_description, trailer_source, external_company, external_reference, is_local"),
            supabase
              .from("trailer_events")
              .select("id, trailer_number, event_type, event_description, created_at")
              .order("created_at", { ascending: false })
              .limit(10),
            supabase
              .from("delivery_bookings")
              .select(
                `id, trailer_id, delivery_date, delivery_time, customer, consignee,
                 delivery_location, booking_reference, status,
                 trailers(trailer_number)`
              )
              .eq("delivery_date", todayKey!)
              .order("delivery_time", { ascending: true })
              .limit(5),
            supabase
              .from("delivery_bookings")
              .select("id, trailer_id, delivery_date, delivered_at, waiting_collection_since, collection_due_date, trailers(trailer_number)")
              .eq("status", "waiting_collection"),
            supabase
              .from("export_allocations")
              .select("id, trailer_id, status, expected_return_at, shipped_at, updated_at"),
            supabase
              .from("vessel_operations")
              .select("id, vessel_name, sailing_reference, expected_arrival_at, actual_arrival_at, status, created_at")
              .order("expected_arrival_at", { ascending: true }),
            supabase
              .from("vessel_operation_trailers")
              .select("id, has_temperature_alert, has_damage, inspection_completed_at, arrival_status, status"),
            supabase
              .from("compound_stock_checks")
              .select("id, started_at, status")
              .order("started_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);

        if (supabaseError) throw supabaseError;
        if (eventsError) throw eventsError;
        if (deliveriesError) throw deliveriesError;
        if (exportAllocationsError) throw exportAllocationsError;
        if (vesselError) throw vesselError;
        if (vesselTrailerError) throw vesselTrailerError;
        if (latestStockCheckError) throw latestStockCheckError;

        const trailers = (data ?? []) as TrailerRecord[];
        setArrivalsTodayCount(
          trailers.filter((item) => getDateKey(item.arrival_date) === todayKey).length,
        );
        setDeparturesTodayCount(
          trailers.filter((item) => getDateKey(item.departure_date) === todayKey).length,
        );

        const allVesselOperations = (vesselData ?? []) as VesselOperationCard[];
        setVesselOpsTodayCount(
          allVesselOperations.filter((operation) => {
            const operationDate =
              getDateKey(operation.actual_arrival_at) ??
              getDateKey(operation.expected_arrival_at);

            return operationDate === todayKey;
          }).length,
        );

        const exportAllocations = ((exportAllocationsData ?? []) as ExportAllocationRecord[]).map((row) =>
          normalizeExportAllocationRecord(row),
        );
        const activeExportAllocations = exportAllocations.filter((item) => isExportAllocationActive(item.status));
        setActiveExportAllocationsCount(activeExportAllocations.length);
        const activeExportStatusByTrailerId = buildActiveExportStatusByTrailerId(activeExportAllocations);
        const visibleTrailers = trailers.filter((trailer) =>
          trailer.is_local === true || isTrailerEligibleForCompoundViews(trailer, activeExportStatusByTrailerId.get(trailer.id)),
        );
        setVesselOperations(allVesselOperations.slice(0, 4));
        setTrailers(visibleTrailers);

        const activeTrailers = visibleTrailers.filter((item) => {
          const departureDate = item.departure_date;
          return departureDate === null || departureDate === undefined || departureDate === "";
        });

        const localTrailers = activeTrailers.filter((item) => item.is_local === true);
        const compoundTrailers = activeTrailers.filter((item) => item.is_local !== true);
        const compoundInventoryTrailers = compoundTrailers.filter((item) =>
          isTrailerPresentInCompoundInventory(item, activeExportStatusByTrailerId.get(item.id)),
        );

        const trailersWithActiveExportAllocation = new Set<string>(
          activeExportAllocations
            .map((item) => item.trailer_id)
            .filter((value): value is string => Boolean(value)),
        );

        const availableEmptyTrailers = compoundInventoryTrailers.filter(
          (item) => normalizeLoadStatus(item.load_status) === "empty" && !trailersWithActiveExportAllocation.has(item.id)
        ).length;

        const loadedTrailers = compoundInventoryTrailers.filter(
          (item) => normalizeLoadStatus(item.load_status) === "loaded"
        ).length;

        const activeCount = compoundInventoryTrailers.length;
        const occupancy = Math.min(
          100,
          Math.round((activeCount / COMPOUND_POSITIONS) * 100)
        );

        setStats({
          totalTrailers: activeCount,
          availableEmptyTrailers,
          loadedTrailers,
          localTrailers: localTrailers.length,
          allocatedTrailers: activeExportAllocations.filter((item) => item.status === "allocated").length,
          atCustomerTrailers: activeExportAllocations.filter((item) => item.status === "delivered_empty" || item.status === "waiting_loading").length,
          occupancy,
        });

        const overdueExportAllocations = activeExportAllocations.filter((item) => isExportAllocationOverdue(item));
        setExportSummary({
          allocated: activeExportAllocations.filter((item) => item.status === "allocated").length,
          atCustomer: activeExportAllocations.filter((item) => item.status === "delivered_empty" || item.status === "waiting_loading").length,
          collectedLoaded: activeExportAllocations.filter((item) => item.status === "collected_loaded").length,
          overdue: overdueExportAllocations.length,
        });

        setEvents((eventsData ?? []) as TrailerEvent[]);

        // Enrich deliveries with trailer numbers
        const enrichedDeliveries = ((deliveriesData ?? []) as Array<Record<string, unknown>>).map((booking) => {
          const joinedTrailer = booking["trailers"] as Record<string, unknown> | null;
          return {
            ...booking,
            trailer_number: (joinedTrailer?.["trailer_number"] as string | null) ?? "—",
          };
        });
        setTodayDeliveries(enrichedDeliveries as DeliveryBooking[]);

        // Waiting collection summary
        const waitingList = (waitingData ?? []) as Array<Record<string, unknown>>;
        const waitingRows: WaitingCollectionItem[] = waitingList.map((b) => ({
          id: b["id"] as string,
          delivery_date: b["delivery_date"] as string,
          delivered_at: (b["delivered_at"] as string | null) ?? null,
          waiting_collection_since: (b["waiting_collection_since"] as string | null) ?? null,
          collection_due_date: (b["collection_due_date"] as string | null) ?? null,
          trailer_number: ((b["trailers"] as Record<string, unknown> | null)?.["trailer_number"] as string | null) ?? null,
        }));
        setWaitingCollections(waitingRows);
        let attentionRequiredCount = 0;
        let oldestDays = 0;
        let oldestTrailer: string | null = null;
        let waitingOver24h = 0;
        waitingList.forEach((b) => {
          const aging = calculateCollectionAging({
            delivery_date: b["delivery_date"] as string,
            delivered_at: b["delivered_at"] as string | null,
            waiting_collection_since: b["waiting_collection_since"] as string | null,
            collection_due_date: b["collection_due_date"] as string | null,
          });
          if (aging.agingLevel === "red") attentionRequiredCount++;
          if (aging.waitingDays >= 1) waitingOver24h++;
          if (aging.waitingDays > oldestDays) {
            oldestDays = aging.waitingDays;
            oldestTrailer = ((b["trailers"] as Record<string, unknown> | null)?.["trailer_number"] as string | null) ?? null;
          }
        });
        setWaitingCollection24hCount(waitingOver24h);
        setWaitingCollectionSummary({ count: waitingList.length, attentionRequiredCount, oldestTrailer, oldestDays });

        const vesselTrailerRows = (vesselTrailerData ?? []) as VesselTrailerAlertRow[];
        const awaitingInspection = vesselTrailerRows.filter(
          (row) => normalizeText(row.arrival_status) === "arrived" && !row.inspection_completed_at,
        ).length;
        const temperatureAlerts = vesselTrailerRows.filter((row) => row.has_temperature_alert === true).length;
        const damagePendingReview = vesselTrailerRows.filter(
          (row) => row.has_damage === true && !row.inspection_completed_at,
        ).length;
        setAwaitingInspectionCount(awaitingInspection);
        setTemperatureAlertsCount(temperatureAlerts);
        setDamagePendingReviewCount(damagePendingReview);

        const issueStatuses = new Set(["hold", "maintenance", "not_discharged"]);
        const operationalIssues = activeTrailers.filter((item) => issueStatuses.has(normalizeText(item.operational_status))).length;
        setOperationalStatusIssuesCount(operationalIssues);

        const allocatedInCompound = activeExportAllocations.filter((allocation) => {
          if (allocation.status !== "allocated" || !allocation.trailer_id) {
            return false;
          }

          const linkedTrailer = activeTrailers.find((trailer) => trailer.id === allocation.trailer_id);
          return Boolean(linkedTrailer && normalizeText(linkedTrailer.compound_position));
        }).length;
        setAllocatedInCompoundCount(allocatedInCompound);

        const latestStockCheck = (latestStockCheckData ?? null) as StockCheckHeadline | null;
        setLatestStockCheckId(latestStockCheck?.id ?? null);

        let latestMissing = 0;
        let latestUnexpected = 0;

        if (latestStockCheck?.id) {
          const { data: latestCheckItems, error: latestItemsError } = await supabase
            .from("compound_stock_check_items")
            .select("id, trailer_number, discrepancy_type, resolution_status")
            .eq("stock_check_id", latestStockCheck.id);

          if (latestItemsError) {
            throw latestItemsError;
          }

          const discrepancyRows = (latestCheckItems ?? []) as StockCheckDiscrepancyRow[];
          latestMissing = discrepancyRows.filter((row) => hasMissingDiscrepancy(row.discrepancy_type)).length;
          latestUnexpected = discrepancyRows.filter((row) => hasUnexpectedDiscrepancy(row.discrepancy_type)).length;
        }

        setMissingTrailersCount(latestMissing);
        setUnexpectedTrailersCount(latestUnexpected);

        const alertDetectionResult = await runOperationalAlertDetection(supabase);
        if (alertDetectionResult.ok) {
          setOperationalAlerts(alertDetectionResult.data.alerts);
          setOperationalAlertSummary(alertDetectionResult.data.summary ?? defaultOperationalAlertSummary);
        } else {
          setOperationalAlerts([]);
          setOperationalAlertSummary(defaultOperationalAlertSummary);
          setOperationalAlertError(alertDetectionResult.error);
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : JSON.stringify(err);
        setError(message);
        setStats(defaultStats);
        setEvents([]);
        setOperationalAlerts([]);
        setOperationalAlertSummary(defaultOperationalAlertSummary);
        setOperationalAlertError(message);
        setTrailers([]);
        setTodayDeliveries([]);
        setWaitingCollections([]);
        setWaitingCollectionSummary({ count: 0, attentionRequiredCount: 0, oldestTrailer: null, oldestDays: 0 });
        setExportSummary(defaultExportSummary);
        setArrivalsTodayCount(0);
        setDeparturesTodayCount(0);
        setVesselOpsTodayCount(0);
        setLatestStockCheckId(null);
        setAwaitingInspectionCount(0);
        setActiveExportAllocationsCount(0);
        setMissingTrailersCount(0);
        setUnexpectedTrailersCount(0);
        setOperationalStatusIssuesCount(0);
        setAllocatedInCompoundCount(0);
        setWaitingCollection24hCount(0);
        setTemperatureAlertsCount(0);
        setDamagePendingReviewCount(0);
      } finally {
        setIsLoading(false);
      }
    }, [saved]);

  const refreshOperationalAlerts = useCallback(async () => {
    setIsAlertsRefreshing(true);
    setOperationalAlertError(null);

    try {
      const alertDetectionResult = await runOperationalAlertDetection(supabase);
      if (alertDetectionResult.ok) {
        setOperationalAlerts(alertDetectionResult.data.alerts);
        setOperationalAlertSummary(alertDetectionResult.data.summary ?? defaultOperationalAlertSummary);
      } else {
        setOperationalAlertError(alertDetectionResult.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to refresh operational alerts.";
      setOperationalAlertError(message);
    } finally {
      setIsAlertsRefreshing(false);
    }
  }, []);

  const loadResolvedAlerts = useCallback(async () => {
    setResolvedAlertsLoading(true);

    try {
      const result = await getOperationalAlerts({ includeResolved: true, status: ["resolved"], limit: 250 }, supabase);
      if (result.ok) {
        setResolvedOperationalAlerts(result.data);
        setResolvedAlertsLoaded(true);
      } else {
        setOperationalAlertError(result.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load resolved alerts.";
      setOperationalAlertError(message);
    } finally {
      setResolvedAlertsLoading(false);
    }
  }, []);

  const handleAlertStatusViewChange = useCallback(
    (view: AlertStatusView) => {
      setAlertStatusView(view);
      if (view === "resolved" && !resolvedAlertsLoaded && !resolvedAlertsLoading) {
        void loadResolvedAlerts();
      }
    },
    [loadResolvedAlerts, resolvedAlertsLoaded, resolvedAlertsLoading],
  );

  const handleAlertsRefresh = useCallback(async () => {
    await refreshOperationalAlerts();
    if (resolvedAlertsLoaded) {
      await loadResolvedAlerts();
    }
  }, [loadResolvedAlerts, refreshOperationalAlerts, resolvedAlertsLoaded]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    const handleFocus = () => {
      void handleAlertsRefresh();
    };

    const intervalId = window.setInterval(() => {
      void handleAlertsRefresh();
    }, 60_000);

    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.clearInterval(intervalId);
    };
  }, [handleAlertsRefresh]);

  useOperationalRealtime(["dashboard"], () => {
    void loadStats();
    if (resolvedAlertsLoaded) {
      void loadResolvedAlerts();
    }
  }, { debounceMs: 900 });

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === COMPOUND_REFRESH_STORAGE_KEY) {
        window.location.reload();
      }
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const deliveriesTodayCount = todayDeliveries.length;
  const collectionsTodayCount = waitingCollectionSummary.count;

  const activeCompoundTrailers = trailers.filter((item) => {
    const departureDate = item.departure_date;
    const active = departureDate === null || departureDate === undefined || departureDate === "";
    return active && item.is_local !== true;
  });

  const awaitingPositionCount = activeCompoundTrailers.filter(
    (item) => !item.compound_position || item.compound_position.trim() === "",
  ).length;
  const maintenanceCount = activeCompoundTrailers.filter((item) => {
    const status = normalizeLoadStatus(item.load_status);
    return status !== "" && status !== "empty" && status !== "loaded";
  }).length;

  const programmeCards = [
    { label: "Arrivals", subtitle: "Today", value: arrivalsTodayCount, href: "/dashboard/search?filter=arrivals_today", icon: <Ship className="h-6 w-6" /> },
    { label: "Departures", subtitle: "Today", value: departuresTodayCount, href: "/dashboard/search?filter=departures_today", icon: <Package className="h-6 w-6" /> },
    { label: "Deliveries", subtitle: "Today", value: deliveriesTodayCount, href: "/dashboard/deliveries", icon: <Truck className="h-6 w-6" /> },
    { label: "Collections", subtitle: "Today", value: collectionsTodayCount, href: "/dashboard/deliveries?filter=waiting", icon: <ClipboardList className="h-6 w-6" /> },
    { label: "Vessel Operations", subtitle: "Today", value: vesselOpsTodayCount, href: "/dashboard/vessel-operations?filter=today", icon: <Anchor className="h-6 w-6" /> },
  ];

  const intelligentKpis: Array<{ label: string; value: number; href: string }> = [
    { label: "Awaiting Inspection", value: awaitingInspectionCount, href: "/dashboard/vessel-operations?filter=today" },
    { label: "Active Export Allocations", value: activeExportAllocationsCount, href: "/dashboard/export-operations?status=all" },
    {
      label: "Missing Trailers",
      value: missingTrailersCount,
      href: latestStockCheckId
        ? `/dashboard/compound/review-discrepancies?stockCheckId=${latestStockCheckId}&filter=missing`
        : "/dashboard/compound/review-discrepancies?filter=missing",
    },
    {
      label: "Unexpected Trailers",
      value: unexpectedTrailersCount,
      href: latestStockCheckId
        ? `/dashboard/compound/review-discrepancies?stockCheckId=${latestStockCheckId}&filter=unexpected`
        : "/dashboard/compound/review-discrepancies?filter=unexpected",
    },
    { label: "Operational Status Issues", value: operationalStatusIssuesCount, href: "/dashboard/maintenance" },
  ];

  const operationalHealthPenalty =
    allocatedInCompoundCount +
    missingTrailersCount +
    waitingCollection24hCount +
    temperatureAlertsCount +
    damagePendingReviewCount +
    awaitingInspectionCount +
    operationalStatusIssuesCount;
  const operationalHealthScore = Math.max(0, 100 - operationalHealthPenalty * 4 - Math.max(0, stats.occupancy - 85));
  const healthLabel = operationalHealthScore >= 85 ? "Healthy" : operationalHealthScore >= 65 ? "Monitor" : "At Risk";

  const quickActions: Array<{ label: string; href: string; icon: ReactNode }> = [
    { label: "New Arrival", href: "/dashboard/new-arrival", icon: <PlusCircle className="h-4 w-4" /> },
    { label: "New Allocation", href: "/dashboard/export-operations/new", icon: <Package className="h-4 w-4" /> },
    { label: "Start Stock Check", href: "/dashboard/compound/stock-check", icon: <ScanSearch className="h-4 w-4" /> },
    { label: "Create Vessel Operation", href: "/dashboard/vessel-operations/new", icon: <Ship className="h-4 w-4" /> },
    { label: "Print Reports", href: "/dashboard/vessel-operations?report=print", icon: <ClipboardList className="h-4 w-4" /> },
  ];

  const printedAt = getPrintedDateTime();

  return (
    <div className="flex flex-col gap-6 bg-[#F8FAFC] pb-2">
      <section className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">OPERATIONS CONTROL CENTRE</p>
          <p className="mt-1 text-sm text-slate-500">Welcome to Ferryspeed TrailerHub</p>
        </div>
        <PrintButton label="Print / Export Summary" disabled={isLoading} />
      </section>

      <PrintReportLayout orientation="portrait">
        <PrintHeader title="Operational Dashboard Summary" printedAt={printedAt} userName="Diogo Ferreira" totalRecords={stats.totalTrailers}>
          <PrintFilters
            items={[
              { label: "View", value: "Dashboard management summary" },
              { label: "Saved Notice", value: notice ?? "Current live data" },
            ]}
          />
        </PrintHeader>

        <PrintSummary
          items={[
            { label: "Trailers In Compound", value: stats.totalTrailers },
            { label: "Available Empty", value: stats.availableEmptyTrailers },
            { label: "Loaded", value: stats.loadedTrailers },
            { label: "Waiting Collection", value: waitingCollectionSummary.count },
            { label: "Occupancy", value: `${stats.occupancy}%` },
          ]}
        />

        <PrintTable
          rows={operationalAlerts.slice(0, 8)}
          columns={[
            { key: "title", header: "Urgent / Exception", render: (alert) => alert.title },
            { key: "severity", header: "Severity", render: (alert) => alert.severity },
            { key: "description", header: "Description", render: (alert) => alert.description },
            { key: "trailer", header: "Trailer", render: (alert) => alert.trailer_number ?? "—" },
          ]}
        />

        <div className="avoid-page-break mt-4">
          <PrintTable
            rows={todayDeliveries}
            columns={[
              { key: "delivery_time", header: "Today's Deliveries", render: (booking) => booking.delivery_time?.substring(0, 5) ?? "—" },
              { key: "trailer_number", header: "Trailer", render: (booking) => booking.trailer_number ?? "—" },
              { key: "customer", header: "Customer / Destination", render: (booking) => booking.customer || booking.consignee || booking.delivery_location || "—" },
              { key: "status", header: "Status", render: (booking) => booking.status.replace(/_/g, " ") },
            ]}
          />
        </div>

        <div className="avoid-page-break mt-4">
          <PrintTable
            rows={waitingCollections.slice(0, 8)}
            columns={[
              { key: "trailer_number", header: "Waiting Collection", render: (item) => item.trailer_number ?? "—" },
              { key: "delivery_date", header: "Delivery Date", render: (item) => item.delivery_date ? new Date(item.delivery_date).toLocaleDateString("en-GB") : "—" },
              { key: "collection_due_date", header: "Due Date", render: (item) => item.collection_due_date ? new Date(item.collection_due_date).toLocaleDateString("en-GB") : "—" },
            ]}
          />
        </div>

        <PrintFooter />
      </PrintReportLayout>

      {notice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {operationalAlertError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {operationalAlertError}
        </div>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[1.1fr_1.6fr_1fr]">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Today&apos;s Programme</p>
          <div className="space-y-3">
            {programmeCards.map((card) => (
              <Link
                key={card.label}
                href={card.href}
                className="group flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-slate-300"
              >
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-emerald-700">
                    {card.icon}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{card.label}</p>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{card.subtitle}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-3xl font-semibold tracking-tight text-slate-950">{isLoading ? "..." : card.value}</p>
                  <ChevronRight className="h-5 w-5 text-slate-400" />
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="relative flex min-h-[620px] flex-col items-center justify-center overflow-hidden">
          <div className="mb-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-500">FERRYSPEED</p>
            <p className="mt-1 text-lg font-semibold uppercase tracking-[0.24em] text-slate-900">GUERNSEY</p>
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">Enterprise Operations Control Centre</p>
          </div>
          <div className="relative h-[70%] min-h-[420px] w-full">
            <Image
              src="/branding/ferryspeed map.png"
              alt="Ferryspeed Guernsey map"
              fill
              priority
              sizes="(max-width: 1280px) 100vw, 60vw"
              className="object-contain"
            />
          </div>
        </div>

        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Yard Status</p>
            <div className="mt-3 space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-100 py-2">
                <span className="text-sm text-slate-600">Compound Occupancy</span>
                <span className="text-xl font-semibold text-slate-950">{isLoading ? "..." : `${stats.occupancy}%`}</span>
              </div>
              <div className="flex items-center justify-between border-b border-slate-100 py-2">
                <span className="text-sm text-slate-600">Awaiting Position</span>
                <span className="text-xl font-semibold text-slate-950">{isLoading ? "..." : awaitingPositionCount}</span>
              </div>
              <div className="flex items-center justify-between border-b border-slate-100 py-2">
                <span className="text-sm text-slate-600">Empty Trailers</span>
                <span className="text-xl font-semibold text-slate-950">{isLoading ? "..." : stats.availableEmptyTrailers}</span>
              </div>
              <div className="flex items-center justify-between border-b border-slate-100 py-2">
                <span className="text-sm text-slate-600">Loaded Trailers</span>
                <span className="text-xl font-semibold text-slate-950">{isLoading ? "..." : stats.loadedTrailers}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-slate-600">Maintenance</span>
                <span className="text-xl font-semibold text-slate-950">{isLoading ? "..." : maintenanceCount}</span>
              </div>
            </div>
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                <span>Occupancy</span>
                <span>{stats.occupancy}%</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-r from-[#17A34A] via-[#1D4ED8] to-[#DC2626]" style={{ width: `${Math.max(0, Math.min(100, stats.occupancy))}%` }} />
              </div>
            </div>
          </section>

          <OperationalAlertsSection
            summary={operationalAlertSummary}
            activeAlerts={operationalAlerts}
            resolvedAlerts={resolvedOperationalAlerts}
            resolvedAlertsLoaded={resolvedAlertsLoaded}
            resolvedAlertsLoading={resolvedAlertsLoading}
            statusView={alertStatusView}
            isLoading={isLoading}
            isRefreshing={isAlertsRefreshing}
            error={operationalAlertError}
            onStatusViewChange={handleAlertStatusViewChange}
            onRefresh={() => { void handleAlertsRefresh(); }}
            onAcknowledge={async (alert) => {
              const result = await acknowledgeOperationalAlert({ operationalAlertId: alert.id });
              if (!result.ok) throw new Error(result.error);
            }}
            onResolve={async (alert, resolutionNote) => {
              const result = await resolveOperationalAlert({ operationalAlertId: alert.id, reason: resolutionNote ?? undefined });
              if (!result.ok) throw new Error(result.error);
            }}
            onDismiss={async (alert) => {
              const result = await dismissOperationalAlert({ operationalAlertId: alert.id });
              if (!result.ok) throw new Error(result.error);
            }}
          />

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Operational Health Score</p>
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Current Score</span>
                <span className="text-2xl font-semibold text-slate-950">{isLoading ? "..." : `${operationalHealthScore}%`}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-500 to-emerald-500"
                  style={{ width: `${Math.max(0, Math.min(100, operationalHealthScore))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.16em] text-slate-500">
                <span>State</span>
                <span>{healthLabel}</span>
              </div>
            </div>
          </section>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Intelligent KPIs</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {intelligentKpis.map((kpi) => (
            <Link
              key={kpi.label}
              href={kpi.href}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 transition hover:bg-slate-100"
            >
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{kpi.label}</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{isLoading ? "..." : kpi.value}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Quick Actions</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {quickActions.map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              {action.icon}
              {action.label}
            </Link>
          ))}
        </div>
      </section>

      <div className="sr-only" aria-hidden="true">
        <p>{events.length}</p>
        <p>{exportSummary.allocated + exportSummary.atCustomer + exportSummary.collectedLoaded + exportSummary.overdue}</p>
      </div>
    </div>
  );
}