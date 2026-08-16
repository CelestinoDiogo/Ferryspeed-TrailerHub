"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OperationalActionBar } from "@/components/operations/operational-action-bar";
import { TrailerOperationsPanel } from "@/components/operations/trailer-operations-panel";
import { PrintButton } from "@/components/print/print-button";
import { PrintFilters } from "@/components/print/print-filters";
import { PrintFooter } from "@/components/print/print-footer";
import { PrintHeader } from "@/components/print/print-header";
import { PrintReportLayout } from "@/components/print/print-report-layout";
import { PrintSummary } from "@/components/print/print-summary";
import { PrintTable } from "@/components/print/print-table";
import { supabase } from "@/lib/supabase";
import {
  calculateOperationalReadiness,
  getLocalDateKey,
  getDateKey,
  type ReadinessLevel,
} from "@/lib/operational-readiness";
import {
  EXPORT_ACTIVE_STATUS_QUERY_VALUES,
  buildActiveExportStatusByTrailerId,
  isTrailerEligibleForCompoundViews,
} from "@/lib/export-allocation";
import {
  buildCompoundHeatmap,
  compoundLocationSignalTypes,
  moveCompoundTrailer,
  type CompoundLocationSignal,
  type CompoundMovementRecord,
  type CompoundPositionSnapshot,
} from "@/lib/compound-yard";
import { getTrailerOwnershipBadgeLabel, getTrailerOwnershipType, type TrailerOwnershipType } from "@/lib/trailer-ownership";
import { loadCompoundReportData } from "@/lib/reports/report-data";
import { useOperationalRealtime } from "@/lib/realtime/operational-realtime";
import { createTrailerActivity } from "@/lib/trailer-activity";
import { resolveAuditOperatorName } from "@/lib/trailer-audit-log";
import { TrailerHistoryDrawer } from "@/components/trailers/trailer-history-drawer";

// ============================================================================
// Types
// ============================================================================

type TrailerRecord = {
  id: string;
  trailer_number: string | null;
  load_status?: string | null;
  operational_status?: string | null;
  arrival_date?: string | null;
  customer?: string | null;
  consignee?: string | null;
  container_number?: string | null;
  compound_position?: string | null;
  departure_date?: string | null;
  is_local?: boolean | null;
  trailer_source?: string | null;
  external_company?: string | null;
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
  escort_required: boolean;
  status: string;
  notes?: string | null;
};

type PositionState = {
  position: string;
  trailer: TrailerRecord | null;
  booking: DeliveryBooking | null;
  readiness: ReadinessLevel | null;
  readinessReason: string | null;
  hasDeliveryToday: boolean;
  priorityLevel: string | null;
  vesselName: string | null;
  exportStatus: string | null;
};

type FilterType = "all" | "ready" | "needs_preparation" | "action_required" | "empty" | "waiting_collection" | "today";
type OperationalFilter = "all" | "empty" | "loaded";
type PriorityFilter = "all" | "priority";
type ExportFilter = "all" | "active" | "overdue" | "allocated" | "waiting_loading" | "delivered_empty" | "collected_loaded";
type OwnershipFilter = "all" | "company" | "outsourcing";
type SortOption = "trailer_asc" | "trailer_desc" | "position" | "arrival_desc";

// ============================================================================
// Constants
// ============================================================================

const COMPOUND_POSITIONS = Array.from({ length: 50 }, (_, index) => `P${String(index + 1).padStart(2, "0")}`);
const QUICK_TRAILER_PREFIXES = ["PRO", "PFC", "FS"] as const;
const PREFIX_FILTER_ALL = "all";
const DEFAULT_SORT: SortOption = "trailer_asc";

// ============================================================================
// Helpers
// ============================================================================

const normalizeCompoundPosition = (value?: string | null): string | null => {
  const trimmed = value?.trim().toUpperCase();
  if (!trimmed) return null;
  const match = trimmed.match(/^(P|A)?0*(\d{1,2})$/);
  if (!match) return null;
  const numericValue = Number(match[2]);
  if (numericValue < 1 || numericValue > 50) return null;
  return `P${numericValue.toString().padStart(2, "0")}`;
};

const formatTime = (value?: string | null): string => {
  if (!value) return "";
  try {
    const [h, m] = value.split(":").map(Number);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  } catch {
    return value;
  }
};

const statusLabel = (status: string): string =>
  status.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

const getPrintedDateTime = () =>
  new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const extractTrailerPrefix = (trailerNumber?: string | null): string | null => {
  const normalized = trailerNumber?.trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  const prefixMatch = normalized.match(/^[A-Z]+/);
  return prefixMatch?.[0] ?? null;
};

const normalizeLoadStatus = (value?: string | null) => (value ?? "").trim().toLowerCase();

const parsePrefixFilterValue = (value?: string | null) => {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) {
    return PREFIX_FILTER_ALL;
  }

  return normalized;
};

const parseSortValue = (value?: string | null): SortOption => {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case "trailer_desc":
    case "position":
    case "arrival_desc":
    case "trailer_asc":
      return normalized;
    default:
      return DEFAULT_SORT;
  }
};

const compareTrailerNumber = (left?: string | null, right?: string | null, direction: "asc" | "desc" = "asc") => {
  const leftValue = left?.trim() ?? "";
  const rightValue = right?.trim() ?? "";

  if (!leftValue && !rightValue) {
    return 0;
  }

  if (!leftValue) {
    return 1;
  }

  if (!rightValue) {
    return -1;
  }

  const base = leftValue.localeCompare(rightValue, undefined, {
    numeric: true,
    sensitivity: "base",
  });

  return direction === "asc" ? base : -base;
};

const compareCompoundPosition = (left: string, right: string) => {
  const leftNormalized = normalizeCompoundPosition(left) ?? left;
  const rightNormalized = normalizeCompoundPosition(right) ?? right;
  return leftNormalized.localeCompare(rightNormalized, undefined, { numeric: true, sensitivity: "base" });
};

const compareArrivalMostRecent = (left?: string | null, right?: string | null) => {
  const leftTime = left ? new Date(left).getTime() : Number.NaN;
  const rightTime = right ? new Date(right).getTime() : Number.NaN;

  const leftValid = Number.isFinite(leftTime);
  const rightValid = Number.isFinite(rightTime);

  if (!leftValid && !rightValid) {
    return 0;
  }

  if (!leftValid) {
    return 1;
  }

  if (!rightValid) {
    return -1;
  }

  return rightTime - leftTime;
};

const parseOperationalFilterValue = (value?: string | null): OperationalFilter => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return "all";
  }

  switch (normalized) {
    case "empty":
    case "loaded":
      return normalized;
    default:
      return "all";
  }
};

const parseReadinessFilterValue = (value?: string | null): FilterType => {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case "today":
    case "ready":
    case "needs_preparation":
    case "action_required":
    case "waiting_collection":
    case "empty":
      return normalized;
    default:
      return "all";
  }
};

const parseExportFilterValue = (value?: string | null): ExportFilter => {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case "active":
    case "overdue":
    case "allocated":
    case "waiting_loading":
    case "delivered_empty":
    case "collected_loaded":
      return normalized;
    default:
      return "all";
  }
};

const parseOwnershipFilterValue = (value?: string | null): OwnershipFilter => {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case "company":
    case "outsourcing":
      return normalized;
    default:
      return "all";
  }
};

// ============================================================================
// Colour system (operational-importance based)
// ============================================================================

type CardColours = {
  border: string;
  bg: string;
  headerText: string;
  badge: string;
};

const getPositionColours = (position: PositionState): CardColours => {
  if (!position.trailer) {
    // Empty position: grey
    return {
      border: "border-slate-700/60",
      bg: "bg-slate-800/40",
      headerText: "text-slate-500",
      badge: "bg-slate-700/60 text-slate-400",
    };
  }

  const bookingStatus = position.booking?.status;

  // Blue: on delivery
  if (bookingStatus === "on_delivery") {
    return {
      border: "border-blue-500/50",
      bg: "bg-blue-500/10",
      headerText: "text-blue-300",
      badge: "bg-blue-500/20 text-blue-200",
    };
  }

  // Purple: waiting collection
  if (bookingStatus === "waiting_collection") {
    return {
      border: "border-purple-500/50",
      bg: "bg-purple-500/10",
      headerText: "text-purple-300",
      badge: "bg-purple-500/20 text-purple-200",
    };
  }

  // Readiness-based colours
  switch (position.readiness) {
    case "action_required":
      return {
        border: "border-rose-500/50",
        bg: "bg-rose-500/10",
        headerText: "text-rose-300",
        badge: "bg-rose-500/20 text-rose-200",
      };
    case "needs_preparation":
      return {
        border: "border-amber-500/50",
        bg: "bg-amber-500/10",
        headerText: "text-amber-300",
        badge: "bg-amber-500/20 text-amber-200",
      };
    case "ready":
      return {
        border: "border-emerald-500/50",
        bg: "bg-emerald-500/10",
        headerText: "text-emerald-300",
        badge: "bg-emerald-500/20 text-emerald-200",
      };
    default:
      // Occupied but no booking
      return {
        border: "border-slate-500/50",
        bg: "bg-slate-800/70",
        headerText: "text-slate-300",
        badge: "bg-slate-700/60 text-slate-400",
      };
  }
};

const getReadinessEmoji = (level: ReadinessLevel | null): string => {
  if (!level) return "";
  return { ready: "­ƒƒó", needs_preparation: "­ƒƒí", action_required: "­ƒö┤" }[level];
};

const getReadinessLabel = (level: ReadinessLevel | null): string => {
  if (!level) return "No Booking";
  return { ready: "Ready", needs_preparation: "Needs Preparation", action_required: "Action Required" }[level];
};

export default function CompoundPage() {
  const router = useRouter();
  const pathname = usePathname();

  const [trailers, setTrailers] = useState<TrailerRecord[]>([]);
  const [bookings, setBookings] = useState<DeliveryBooking[]>([]);
  const [exportAllocations, setExportAllocations] = useState<Array<{ trailer_id?: string | null; status?: string | null; updated_at?: string | null }>>([]);
  const [vesselOperations, setVesselOperations] = useState<Array<{ id: string; vessel_name: string | null; sailing_reference: string | null; status: string | null }>>([]);
  const [vesselTrailers, setVesselTrailers] = useState<Array<{
    id: string;
    trailer_id: string | null;
    trailer_number: string | null;
    vessel_operation_id: string;
    customer: string | null;
    priority_level: string | null;
    arrival_status: string | null;
    inspection_started_at: string | null;
    inspection_completed_at: string | null;
    status: string | null;
    has_temperature_alert: boolean | null;
    has_damage: boolean | null;
    assigned_position: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>>([]);
  const [compoundActivity, setCompoundActivity] = useState<CompoundMovementRecord[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [prefixFilter, setPrefixFilter] = useState<string>(PREFIX_FILTER_ALL);
  const [operationalFilter, setOperationalFilter] = useState<OperationalFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [customerFilter, setCustomerFilter] = useState<string>("all");
  const [vesselFilter, setVesselFilter] = useState<string>("all");
  const [exportFilter, setExportFilter] = useState<ExportFilter>("all");
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>("all");
  const [tabletMode] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 1280;
  });
  const [sortBy, setSortBy] = useState<SortOption>(DEFAULT_SORT);
  const [hasSyncedFiltersFromUrl, setHasSyncedFiltersFromUrl] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<string | null>(null);
  const [historyTrailer, setHistoryTrailer] = useState<{ trailerId: string | null; trailerNumber: string | null } | null>(null);
  const [panelTrailerId, setPanelTrailerId] = useState<string | null>(null);
  const [draggedTrailerId, setDraggedTrailerId] = useState<string | null>(null);
  const [dragHoverPosition, setDragHoverPosition] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      setSearch(params.get("search")?.trim() ?? params.get("q")?.trim() ?? "");
      setPrefixFilter(parsePrefixFilterValue(params.get("prefix")));
      setOperationalFilter(parseOperationalFilterValue(params.get("status") ?? params.get("loadStatus")));
      setFilter(parseReadinessFilterValue(params.get("filter")));
      setPriorityFilter(params.get("priority")?.trim().toLowerCase() === "priority" ? "priority" : "all");
      setCustomerFilter(params.get("customer")?.trim() ?? "all");
      setVesselFilter(params.get("vessel")?.trim() ?? "all");
      setExportFilter(parseExportFilterValue(params.get("export")));
      setOwnershipFilter(parseOwnershipFilterValue(params.get("ownership")));
      setSortBy(parseSortValue(params.get("sort")));
      setHasSyncedFiltersFromUrl(true);
    };

    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  useEffect(() => {
    if (!hasSyncedFiltersFromUrl) {
      return;
    }

    const params = new URLSearchParams(window.location.search);

    const trimmedSearch = search.trim();
    if (trimmedSearch) {
      params.set("search", trimmedSearch);
      params.delete("q");
    } else {
      params.delete("search");
      params.delete("q");
    }

    if (prefixFilter !== PREFIX_FILTER_ALL) {
      params.set("prefix", prefixFilter);
    } else {
      params.delete("prefix");
    }

    if (operationalFilter !== "all") {
      params.set("status", operationalFilter);
      params.delete("loadStatus");
    } else {
      params.delete("status");
      params.delete("loadStatus");
    }

    if (sortBy !== DEFAULT_SORT) {
      params.set("sort", sortBy);
    } else {
      params.delete("sort");
    }

    if (filter !== "all") {
      params.set("filter", filter);
    } else {
      params.delete("filter");
    }

    if (priorityFilter !== "all") {
      params.set("priority", priorityFilter);
    } else {
      params.delete("priority");
    }

    if (customerFilter !== "all") {
      params.set("customer", customerFilter);
    } else {
      params.delete("customer");
    }

    if (vesselFilter !== "all") {
      params.set("vessel", vesselFilter);
    } else {
      params.delete("vessel");
    }

    if (exportFilter !== "all") {
      params.set("export", exportFilter);
    } else {
      params.delete("export");
    }

    if (ownershipFilter !== "all") {
      params.set("ownership", ownershipFilter);
    } else {
      params.delete("ownership");
    }

    const nextQuery = params.toString();
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    const currentUrl = `${window.location.pathname}${window.location.search}`;

    if (currentUrl !== nextUrl) {
      router.replace(nextUrl, { scroll: false });
    }
  }, [customerFilter, exportFilter, filter, hasSyncedFiltersFromUrl, operationalFilter, ownershipFilter, pathname, prefixFilter, priorityFilter, router, search, sortBy, vesselFilter]);

  // Load trailers and bookings in parallel ÔÇö single round trip
  const loadData = useCallback(async () => {
      setIsLoading(true);
      setError(null);

      try {
        const todayKey = getLocalDateKey();
        const [reportData, vesselTrailerResult, vesselOperationResult, activityResult] = await Promise.all([
          loadCompoundReportData(supabase, todayKey, EXPORT_ACTIVE_STATUS_QUERY_VALUES),
          supabase
            .from("vessel_operation_trailers")
            .select(
              "id, vessel_operation_id, trailer_id, trailer_number, customer, priority_level, arrival_status, inspection_started_at, inspection_completed_at, status, has_temperature_alert, has_damage, assigned_position, created_at, updated_at",
            )
            .order("created_at", { ascending: false })
            .limit(500),
          supabase
            .from("vessel_operations")
            .select("id, vessel_name, sailing_reference, status")
            .order("created_at", { ascending: false })
            .limit(200),
          supabase
            .from("trailer_activity_log")
            .select("id, trailer_id, trailer_number, event_type, previous_compound_position, new_compound_position, created_at")
            .in("event_type", ["compound_position_assigned", "compound_position_changed", "compound_entered", "compound_removed"])
            .order("created_at", { ascending: false })
            .limit(1000),
        ]);

        const { trailersData, bookingsData, exportAllocationsData } = reportData;

        const statusByTrailerId = buildActiveExportStatusByTrailerId(
          ((exportAllocationsData ?? []) as Array<{ trailer_id?: string | null; status?: string | null; updated_at?: string | null }>),
        );

        const visibleTrailers = ((trailersData ?? []) as TrailerRecord[]).filter((trailer) =>
          isTrailerEligibleForCompoundViews(trailer, statusByTrailerId.get(trailer.id)),
        );

        setTrailers(visibleTrailers);
        setExportAllocations(((exportAllocationsData ?? []) as Array<{ trailer_id?: string | null; status?: string | null; updated_at?: string | null }>));
        setVesselTrailers((vesselTrailerResult.data ?? []) as typeof vesselTrailers);
        setVesselOperations((vesselOperationResult.data ?? []) as typeof vesselOperations);
        setCompoundActivity(
          ((activityResult.data ?? []) as Array<{
            id: string;
            trailer_id: string | null;
            trailer_number: string | null;
            event_type: string;
            previous_compound_position: string | null;
            new_compound_position: string | null;
            created_at: string | null;
          }>).map((row) => ({
            trailerId: row.trailer_id,
            trailerNumber: row.trailer_number,
            previousCompoundPosition: row.previous_compound_position,
            newCompoundPosition: row.new_compound_position,
            createdAt: row.created_at,
            eventType: row.event_type,
          })),
        );
        setBookings((bookingsData ?? []) as DeliveryBooking[]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to load compound data.";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  useOperationalRealtime(["compound"], () => {
    void loadData();
  }, { debounceMs: 800 });

  const activeExportByTrailerId = useMemo(
    () => buildActiveExportStatusByTrailerId(exportAllocations),
    [exportAllocations],
  );

  const vesselOperationById = useMemo(
    () => new Map(vesselOperations.map((operation) => [operation.id, operation] as const)),
    [vesselOperations],
  );

  const vesselTrailerByTrailerId = useMemo(() => {
    const map = new Map<string, (typeof vesselTrailers)[number]>();
    vesselTrailers.forEach((row) => {
      if (row.trailer_id) {
        map.set(row.trailer_id, row);
      }
    });
    return map;
  }, [vesselTrailers]);

  const vesselTrailerByTrailerNumber = useMemo(() => {
    const map = new Map<string, (typeof vesselTrailers)[number]>();
    vesselTrailers.forEach((row) => {
      if (row.trailer_number) {
        map.set(row.trailer_number.trim().toUpperCase(), row);
      }
    });
    return map;
  }, [vesselTrailers]);

  const currentPositionSnapshots = useMemo<CompoundPositionSnapshot[]>(() => {
    return COMPOUND_POSITIONS.map((position) => {
      const trailer = trailers.find((item) => normalizeCompoundPosition(item.compound_position) === position) ?? null;
      const exportStatus = trailer ? activeExportByTrailerId.get(trailer.id) ?? null : null;
      const vesselTrailer = trailer?.id
        ? vesselTrailerByTrailerId.get(trailer.id) ?? null
        : trailer?.trailer_number
          ? vesselTrailerByTrailerNumber.get(trailer.trailer_number.trim().toUpperCase()) ?? null
          : null;
      const vesselOperation = vesselTrailer ? vesselOperationById.get(vesselTrailer.vessel_operation_id) ?? null : null;

      return {
        position,
        trailerId: trailer?.id ?? null,
        trailerNumber: trailer?.trailer_number ?? null,
        customer: trailer?.customer ?? vesselTrailer?.customer ?? null,
        loadStatus: trailer?.load_status ?? null,
        operationalStatus: trailer?.operational_status ?? null,
        compoundPosition: trailer?.compound_position ?? position,
        priorityLevel: vesselTrailer?.priority_level ?? null,
        vesselName: vesselOperation?.vessel_name ?? null,
        exportStatus,
        updatedAt: trailer?.departure_date ?? trailer?.arrival_date ?? trailer?.trailer_source ?? null,
        isOccupied: Boolean(trailer),
      };
    });
  }, [activeExportByTrailerId, trailers, vesselOperationById, vesselTrailerByTrailerId, vesselTrailerByTrailerNumber]);

  const compoundHeatmapRows = useMemo(
    () => buildCompoundHeatmap(currentPositionSnapshots, compoundActivity),
    [compoundActivity, currentPositionSnapshots],
  );

  const locationSignals = useMemo<CompoundLocationSignal[]>(
    () =>
      compoundLocationSignalTypes.map((type) => ({
        type,
        label: type.replace(/_/g, " "),
        enabled: true,
        details: `${compoundHeatmapRows.length} positions tracked`,
        lastSeenAt: compoundActivity[0]?.createdAt ?? null,
      })),
    [compoundActivity, compoundHeatmapRows.length],
  );

  // Build enriched position states ÔÇö no additional queries
  const allPositionStates = useMemo((): PositionState[] => {
    const todayKey = getLocalDateKey();

    // Build lookup: trailer_id -> nearest active booking
    const bookingByTrailer = new Map<string, DeliveryBooking>();
    bookings.forEach((b) => {
      const existing = bookingByTrailer.get(b.trailer_id);
      if (!existing) {
        bookingByTrailer.set(b.trailer_id, b);
      } else {
        // Prefer today's booking, then earlier date
        const existingKey = getDateKey(existing.delivery_date) ?? "";
        const newKey = getDateKey(b.delivery_date) ?? "";
        if (newKey < existingKey) {
          bookingByTrailer.set(b.trailer_id, b);
        }
      }
    });

    const trailerByPosition = new Map<string, TrailerRecord>();
    trailers.forEach((t) => {
      const pos = normalizeCompoundPosition(t.compound_position);
      if (pos && COMPOUND_POSITIONS.includes(pos)) {
        trailerByPosition.set(pos, t);
      }
    });

    return COMPOUND_POSITIONS.map((position) => {
      const trailer = trailerByPosition.get(position) ?? null;

      if (!trailer) {
        return {
          position,
          trailer: null,
          booking: null,
          readiness: null,
          readinessReason: null,
          hasDeliveryToday: false,
          priorityLevel: null,
          vesselName: null,
          exportStatus: null,
        };
      }

      const booking = bookingByTrailer.get(trailer.id) ?? null;
      const deliveryKey = booking ? getDateKey(booking.delivery_date) : null;
      const hasDeliveryToday = deliveryKey === todayKey;
      const vesselTrailer = vesselTrailerByTrailerId.get(trailer.id) ?? null;
      const vesselOperation = vesselTrailer ? vesselOperationById.get(vesselTrailer.vessel_operation_id) ?? null : null;
      const exportStatus = activeExportByTrailerId.get(trailer.id) ?? null;

      let readiness: ReadinessLevel | null = null;
      let readinessReason: string | null = null;

      if (booking) {
        const result = calculateOperationalReadiness(
          {
            id: booking.id,
            trailer_id: booking.trailer_id,
            delivery_date: booking.delivery_date,
            delivery_time: booking.delivery_time,
            customer: booking.customer,
            consignee: booking.consignee,
            delivery_location: booking.delivery_location,
            booking_reference: booking.booking_reference,
            escort_required: booking.escort_required,
            status: booking.status,
            notes: booking.notes,
          },
          {
            id: trailer.id,
            trailer_number: trailer.trailer_number,
            compound_position: trailer.compound_position,
            departure_date: trailer.departure_date,
          },
          todayKey
        );
        readiness = result.level;
        readinessReason = result.reason;
      }

      return {
        position,
        trailer,
        booking,
        readiness,
        readinessReason,
        hasDeliveryToday,
        priorityLevel: vesselTrailer?.priority_level ?? null,
        vesselName: vesselOperation?.vessel_name ?? null,
        exportStatus,
      };
    });
  }, [activeExportByTrailerId, bookings, trailers, vesselOperationById, vesselTrailerByTrailerId]);

  // Unassigned trailers (no valid position)
  const unassignedTrailers = useMemo(() => {
    const positionSet = new Set(COMPOUND_POSITIONS);
    return trailers.filter((t) => {
      const pos = normalizeCompoundPosition(t.compound_position);
      return !pos || !positionSet.has(pos);
    });
  }, [trailers]);

  const observedTrailerPrefixes = useMemo(() => {
    const prefixes = new Set<string>();
    trailers.forEach((trailer) => {
      const prefix = extractTrailerPrefix(trailer.trailer_number);
      if (prefix) {
        prefixes.add(prefix);
      }
    });

    return Array.from(prefixes).sort((left, right) => left.localeCompare(right));
  }, [trailers]);

  const quickPrefixFilters = useMemo(
    () => {
      const combined = new Set<string>([...QUICK_TRAILER_PREFIXES, ...observedTrailerPrefixes]);
      const allPrefixes = Array.from(combined).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

      return [
        { value: PREFIX_FILTER_ALL, label: "All" },
        ...allPrefixes.map((prefix) => ({ value: prefix, label: prefix })),
      ];
    },
    [observedTrailerPrefixes],
  );

  const resolvedPrefixFilter = quickPrefixFilters.some((item) => item.value === prefixFilter)
    ? prefixFilter
    : PREFIX_FILTER_ALL;

  const operationalFilters = useMemo(
    () => [
      { value: "all", label: "All statuses" },
      { value: "empty", label: "Empty" },
      { value: "loaded", label: "Loaded" },
    ] as Array<{ value: OperationalFilter; label: string }>,
    [],
  );

  const sortOptions = useMemo(
    () => [
      { value: "trailer_asc", label: "Trailer number A–Z" },
      { value: "trailer_desc", label: "Trailer number Z–A" },
      { value: "position", label: "Compound position" },
      { value: "arrival_desc", label: "Most recent arrival" },
    ] as Array<{ value: SortOption; label: string }>,
    [],
  );

  const customerOptions = useMemo(() => {
    const customers = new Set<string>();
    allPositionStates.forEach((state) => {
      if (state.trailer?.customer) {
        customers.add(state.trailer.customer.trim());
      }
      if (state.booking?.customer) {
        customers.add(state.booking.customer.trim());
      }
    });
    return ["all", ...Array.from(customers).sort((left, right) => left.localeCompare(right))];
  }, [allPositionStates]);

  const vesselOptions = useMemo(() => {
    const vessels = new Set<string>();
    allPositionStates.forEach((state) => {
      if (state.vesselName) {
        vessels.add(state.vesselName.trim());
      }
    });
    return ["all", ...Array.from(vessels).sort((left, right) => left.localeCompare(right))];
  }, [allPositionStates]);

  const priorityOptions = useMemo(
    () => [
      { value: "all", label: "All trailers" },
      { value: "priority", label: "Priority only" },
    ] as Array<{ value: PriorityFilter; label: string }>,
    [],
  );

  const exportOptions = useMemo(
    () => [
      { value: "all", label: "All export states" },
      { value: "active", label: "Active export" },
      { value: "overdue", label: "Overdue" },
      { value: "allocated", label: "Allocated" },
      { value: "waiting_loading", label: "Waiting loading" },
      { value: "delivered_empty", label: "Delivered empty" },
      { value: "collected_loaded", label: "Collected loaded" },
    ] as Array<{ value: ExportFilter; label: string }>,
    [],
  );

  const ownershipOptions = useMemo(
    () => [
      { value: "all", label: "All ownership" },
      { value: "company", label: "Company" },
      { value: "outsourcing", label: "Outsourcing" },
    ] as Array<{ value: OwnershipFilter; label: string }>,
    [],
  );

  const resolveOwnershipType = useCallback((trailer: TrailerRecord | null): TrailerOwnershipType => {
    if (!trailer) {
      return "unknown";
    }

    return getTrailerOwnershipType({
      trailerSource: trailer.trailer_source,
      externalCompany: trailer.external_company,
      isLocal: trailer.is_local,
      trailerNumber: trailer.trailer_number,
    });
  }, []);

  // Apply filters then sorting with no additional Supabase queries.
  const filteredPositions = useMemo((): PositionState[] => {
    const term = search.trim().toUpperCase();

    const filtered = allPositionStates.filter((state) => {
      // Prefix filter
      if (resolvedPrefixFilter !== PREFIX_FILTER_ALL) {
        const trailerPrefix = extractTrailerPrefix(state.trailer?.trailer_number);
        if (trailerPrefix !== resolvedPrefixFilter) {
          return false;
        }
      }

      // Operational status filter
      if (operationalFilter !== "all") {
        const loadStatus = normalizeLoadStatus(state.trailer?.load_status);
        if (!state.trailer || loadStatus !== operationalFilter) {
          return false;
        }
      }

      // Trailer-number search (case-insensitive, partial)
      if (term) {
        const trailerNumber = state.trailer?.trailer_number?.toUpperCase() ?? "";
        if (!trailerNumber.includes(term)) return false;
      }

      if (priorityFilter === "priority" && !state.priorityLevel) {
        return false;
      }

      if (customerFilter !== "all") {
        const customerName = (state.trailer?.customer ?? "").trim().toLowerCase();
        const bookingCustomer = (state.booking?.customer ?? "").trim().toLowerCase();
        const selectedCustomer = customerFilter.trim().toLowerCase();
        if (customerName !== selectedCustomer && bookingCustomer !== selectedCustomer) {
          return false;
        }
      }

      if (vesselFilter !== "all") {
        const selectedVessel = vesselFilter.trim().toLowerCase();
        if ((state.vesselName ?? "").trim().toLowerCase() !== selectedVessel) {
          return false;
        }
      }

      if (exportFilter !== "all") {
        const exportStatus = (state.exportStatus ?? "").trim().toLowerCase();
        if (exportFilter === "active") {
          if (!exportStatus || exportStatus === "none") return false;
        } else if (exportStatus !== exportFilter) {
          return false;
        }
      }

      if (ownershipFilter !== "all") {
        const ownershipType = resolveOwnershipType(state.trailer);
        if (ownershipType !== ownershipFilter) {
          return false;
        }
      }

      // Existing readiness/queue filter
      switch (filter) {
        case "empty":
          return !state.trailer;
        case "today":
          return state.hasDeliveryToday;
        case "ready":
          return state.readiness === "ready";
        case "needs_preparation":
          return state.readiness === "needs_preparation";
        case "action_required":
          return state.readiness === "action_required";
        case "waiting_collection":
          return state.booking?.status === "waiting_collection";
        default:
          return true;
      }
    });

    const sorted = [...filtered].sort((left, right) => {
      switch (sortBy) {
        case "trailer_desc": {
          const trailerNumberOrder = compareTrailerNumber(left.trailer?.trailer_number, right.trailer?.trailer_number, "desc");
          return trailerNumberOrder !== 0 ? trailerNumberOrder : compareCompoundPosition(left.position, right.position);
        }
        case "position":
          return compareCompoundPosition(left.position, right.position);
        case "arrival_desc": {
          const arrivalOrder = compareArrivalMostRecent(left.trailer?.arrival_date, right.trailer?.arrival_date);
          if (arrivalOrder !== 0) {
            return arrivalOrder;
          }

          const trailerNumberOrder = compareTrailerNumber(left.trailer?.trailer_number, right.trailer?.trailer_number, "asc");
          return trailerNumberOrder !== 0 ? trailerNumberOrder : compareCompoundPosition(left.position, right.position);
        }
        case "trailer_asc":
        default: {
          const trailerNumberOrder = compareTrailerNumber(left.trailer?.trailer_number, right.trailer?.trailer_number, "asc");
          return trailerNumberOrder !== 0 ? trailerNumberOrder : compareCompoundPosition(left.position, right.position);
        }
      }
    });

    return sorted;
  }, [allPositionStates, customerFilter, exportFilter, filter, operationalFilter, ownershipFilter, priorityFilter, resolveOwnershipType, resolvedPrefixFilter, search, sortBy, vesselFilter]);

  const shownTrailerCount = useMemo(
    () => filteredPositions.reduce((total, state) => total + (state.trailer ? 1 : 0), 0),
    [filteredPositions],
  );

  const panelTrailer = useMemo(
    () => trailers.find((item) => item.id === panelTrailerId) ?? null,
    [panelTrailerId, trailers],
  );

  // Summary counts ÔÇö computed from allPositionStates (unfiltered)
  const summary = useMemo(() => {
    const occupied = allPositionStates.filter((s) => s.trailer).length;
    const empty = allPositionStates.filter((s) => !s.trailer).length;
    const deliveriesToday = allPositionStates.filter((s) => s.hasDeliveryToday).length;
    const ready = allPositionStates.filter((s) => s.readiness === "ready").length;
    const needsPrep = allPositionStates.filter((s) => s.readiness === "needs_preparation").length;
    const waitingCollection = allPositionStates.filter((s) => s.booking?.status === "waiting_collection").length;
    return { occupied, empty, deliveriesToday, ready, needsPrep, waitingCollection };
  }, [allPositionStates]);

  const selectedState = selectedPosition
    ? allPositionStates.find((s) => s.position === selectedPosition) ?? null
    : null;
  const printedAt = getPrintedDateTime();

  const FILTERS: { value: FilterType; label: string }[] = [
    { value: "all", label: "All" },
    { value: "today", label: "Today" },
    { value: "ready", label: "Ready" },
    { value: "needs_preparation", label: "Needs Prep" },
    { value: "action_required", label: "Action Required" },
    { value: "waiting_collection", label: "Waiting Collection" },
    { value: "empty", label: "Empty" },
  ];

  const handleClearFilters = useCallback(() => {
    setSearch("");
    setPrefixFilter(PREFIX_FILTER_ALL);
    setOperationalFilter("all");
    setFilter("all");
    setPriorityFilter("all");
    setCustomerFilter("all");
    setVesselFilter("all");
    setExportFilter("all");
    setOwnershipFilter("all");
    setSortBy(DEFAULT_SORT);
  }, []);

  const handleQuickMove = useCallback(
    async (trailerId: string, nextPosition: string) => {
      const current = trailers.find((item) => item.id === trailerId);
      if (!current) {
        throw new Error("Trailer not found.");
      }

      const movedTrailer = await moveCompoundTrailer(supabase, {
        trailerId,
        targetPosition: nextPosition,
        movedBy: await resolveAuditOperatorName(),
        reason: `Compound move to ${nextPosition}`,
      });

      const operatorName = await resolveAuditOperatorName();
      const nowIso = new Date().toISOString();
      await createTrailerActivity({
        trailerId,
        trailerNumber: current.trailer_number ?? trailerId,
        eventType: "compound_position_assigned",
        eventTitle: "Position updated",
        eventDescription: `Compound position changed to ${nextPosition}.`,
        sourceModule: "operations",
        sourceRecordId: trailerId,
        previousStatus: current.load_status ?? null,
        newStatus: current.load_status ?? null,
        previousCompoundPosition: current.compound_position ?? null,
        newCompoundPosition: nextPosition,
        performedBy: operatorName,
        createdAt: nowIso,
      });

      setTrailers((currentRows) =>
        currentRows.map((row) => (row.id === trailerId ? { ...row, compound_position: movedTrailer?.compound_position ?? nextPosition } : row)),
      );
    },
    [trailers],
  );

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">

        {/* Header */}
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Smart Compound</h1>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">
                Live operational map — position, readiness and delivery status at a glance.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/dashboard/compound/waiting"
                className="rounded-2xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20"
              >
                Waiting Queue
              </Link>
              <PrintButton label="Print / Export" disabled={isLoading || filteredPositions.length === 0} />
            </div>
          </div>
        </header>

        {filteredPositions.length > 0 ? (
          <PrintReportLayout orientation="landscape">
            <PrintHeader title="Compound Position Report" printedAt={printedAt} userName="Diogo Ferreira" totalRecords={filteredPositions.length}>
              <PrintFilters
                items={[
                  { label: "View", value: FILTERS.find((item) => item.value === filter)?.label ?? "All" },
                  { label: "Prefix", value: prefixFilter === PREFIX_FILTER_ALL ? "All" : prefixFilter },
                  { label: "Load Status", value: operationalFilters.find((item) => item.value === operationalFilter)?.label ?? "All statuses" },
                  { label: "Ownership", value: ownershipOptions.find((item) => item.value === ownershipFilter)?.label ?? "All ownership" },
                  { label: "Search", value: search.trim() || "Current filtered positions" },
                ]}
              />
            </PrintHeader>
            <PrintSummary
              items={[
                { label: "Occupied", value: summary.occupied },
                { label: "Empty", value: summary.empty },
                { label: "Deliveries Today", value: summary.deliveriesToday },
                { label: "Ready", value: summary.ready },
                { label: "Waiting Collection", value: summary.waitingCollection },
              ]}
            />
            <PrintTable
              rows={filteredPositions}
              columns={[
                { key: "position", header: "Position", render: (state) => state.position },
                { key: "trailer", header: "Trailer", render: (state) => state.trailer?.trailer_number ?? "Available" },
                { key: "ownership", header: "Ownership", render: (state) => state.trailer ? getTrailerOwnershipBadgeLabel(resolveOwnershipType(state.trailer)) : "—" },
                { key: "customer", header: "Customer", render: (state) => state.trailer?.customer ?? "—" },
                { key: "load_status", header: "Load", render: (state) => state.trailer?.load_status ?? "—" },
                { key: "booking_status", header: "Booking Status", render: (state) => state.booking ? statusLabel(state.booking.status) : "No Booking" },
                { key: "readiness", header: "Readiness", render: (state) => getReadinessLabel(state.readiness) },
                { key: "time", header: "Delivery Time", render: (state) => state.booking?.delivery_time ? formatTime(state.booking.delivery_time) : "—" },
              ]}
            />
            <PrintFooter />
          </PrintReportLayout>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400 shadow-lg shadow-black/20 backdrop-blur">
            Loading compound data...
          </div>
        ) : (
          <>
            {/* Summary KPIs */}
            <section className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: "Occupied", value: summary.occupied, colour: "text-white" },
                { label: "Empty", value: summary.empty, colour: "text-slate-400" },
                { label: "Deliveries Today", value: summary.deliveriesToday, colour: "text-cyan-300" },
                { label: "Ready", value: summary.ready, colour: "text-emerald-300" },
                { label: "Needs Preparation", value: summary.needsPrep, colour: "text-amber-300" },
                { label: "Waiting Collection", value: summary.waitingCollection, colour: "text-purple-300" },
              ].map(({ label, value, colour }) => (
                <article
                  key={label}
                  className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur"
                >
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{label}</p>
                  <p className={`mt-2 text-2xl font-bold ${colour}`}>{value}</p>
                </article>
              ))}
            </section>

            <OperationalActionBar
              moduleLabel="Compound"
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search trailer number"
              prefixOptions={quickPrefixFilters}
              prefixValue={resolvedPrefixFilter}
              onPrefixChange={setPrefixFilter}
              statusOptions={operationalFilters}
              statusValue={operationalFilter}
              onStatusChange={(value) => setOperationalFilter(value as OperationalFilter)}
              sortOptions={sortOptions}
              sortValue={sortBy}
              onSortChange={(value) => setSortBy(parseSortValue(value))}
              selectedCount={selectedPosition ? 1 : 0}
              primaryActions={
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                >
                  Clear Filters
                </button>
              }
              secondaryActions={
                <>
                  <div className="flex flex-wrap gap-2">
                    {FILTERS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setFilter(value)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                          filter === value
                            ? "bg-cyan-500 text-slate-950"
                            : "border border-white/10 bg-slate-800 text-slate-300 hover:bg-slate-700"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400">{shownTrailerCount} trailers shown</p>
                </>
              }
            />

            <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-cyan-400">Digital Yard</p>
                    <h2 className="mt-1 text-lg font-semibold text-white">Interactive compound controls</h2>
                  </div>
                  <span className="rounded-full border border-white/10 bg-slate-800 px-3 py-1 text-xs text-slate-300">
                    {tabletMode ? "Tablet mode" : "Desktop mode"}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="space-y-2 text-sm text-slate-300">
                    <span className="block text-xs uppercase tracking-[0.25em] text-slate-500">Priority</span>
                    <select
                      value={priorityFilter}
                      onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                    >
                      {priorityOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2 text-sm text-slate-300">
                    <span className="block text-xs uppercase tracking-[0.25em] text-slate-500">Customer</span>
                    <select
                      value={customerFilter}
                      onChange={(event) => setCustomerFilter(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                    >
                      {customerOptions.map((option) => (
                        <option key={option} value={option}>{option === "all" ? "All customers" : option}</option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2 text-sm text-slate-300">
                    <span className="block text-xs uppercase tracking-[0.25em] text-slate-500">Vessel</span>
                    <select
                      value={vesselFilter}
                      onChange={(event) => setVesselFilter(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                    >
                      {vesselOptions.map((option) => (
                        <option key={option} value={option}>{option === "all" ? "All vessels" : option}</option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2 text-sm text-slate-300">
                    <span className="block text-xs uppercase tracking-[0.25em] text-slate-500">Export</span>
                    <select
                      value={exportFilter}
                      onChange={(event) => setExportFilter(event.target.value as ExportFilter)}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                    >
                      {exportOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2 text-sm text-slate-300">
                    <span className="block text-xs uppercase tracking-[0.25em] text-slate-500">Ownership</span>
                    <select
                      value={ownershipFilter}
                      onChange={(event) => setOwnershipFilter(event.target.value as OwnershipFilter)}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                    >
                      {ownershipOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <aside className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-cyan-400">Signals</p>
                <div className="mt-3 space-y-3">
                  {locationSignals.map((signal) => (
                    <div key={signal.type} className="rounded-2xl border border-white/10 bg-slate-950/80 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-white">{signal.label}</p>
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                          Live
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{signal.details}</p>
                    </div>
                  ))}
                </div>
              </aside>
            </section>

            <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-cyan-400">Historical Yard Heatmap</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">Movement frequency and dwell time</h2>
                </div>
                <p className="text-xs text-slate-400">{compoundHeatmapRows.length} positions</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {compoundHeatmapRows.slice(0, 10).map((row) => (
                  <div key={row.position} className="rounded-2xl border border-white/10 bg-slate-950/80 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-white">{row.position}</p>
                      <span className="text-xs text-cyan-300">{row.movementCount} moves</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">Avg dwell: {row.averageDwellHours.toFixed(1)}h</p>
                    <p className="mt-1 text-xs text-slate-400">Occupancy: {row.currentOccupancy ? "occupied" : "empty"}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Position Grid */}
            <section className={`grid gap-3 ${tabletMode ? "grid-cols-2 md:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8"}`}>
              {filteredPositions.map((state) => {
                const colours = getPositionColours(state);
                const isSelected = selectedPosition === state.position;

                return (
                  <article
                    key={state.position}
                    draggable={Boolean(state.trailer)}
                    onDragStart={() => {
                      if (state.trailer) {
                        setDraggedTrailerId(state.trailer.id);
                      }
                    }}
                    onDragEnd={() => {
                      setDraggedTrailerId(null);
                      setDragHoverPosition(null);
                    }}
                    onDragOver={(event) => {
                      if (!draggedTrailerId) return;
                      event.preventDefault();
                      setDragHoverPosition(state.position);
                    }}
                    onDragLeave={() => {
                      if (dragHoverPosition === state.position) {
                        setDragHoverPosition(null);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggedTrailerId && draggedTrailerId !== state.trailer?.id) {
                        void handleQuickMove(draggedTrailerId, state.position);
                      }
                      setDraggedTrailerId(null);
                      setDragHoverPosition(null);
                    }}
                    onClick={() => {
                      const nextSelected = isSelected ? null : state.position;
                      setSelectedPosition(nextSelected);
                      setPanelTrailerId(nextSelected && state.trailer ? state.trailer.id : null);
                    }}
                    className={`cursor-pointer rounded-2xl border p-3 shadow-md transition hover:ring-1 hover:ring-cyan-400/50 ${colours.border} ${colours.bg} ${isSelected ? "ring-2 ring-cyan-400" : ""} ${dragHoverPosition === state.position ? "ring-2 ring-emerald-400" : ""}`}
                  >
                    {/* Position Header */}
                    <div className="flex items-center justify-between gap-1">
                      <span className={`text-xs font-bold uppercase tracking-[0.25em] ${colours.headerText}`}>
                        {state.position}
                      </span>
                      {state.trailer ? (
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${colours.badge}`}>
                          {state.booking?.status === "on_delivery"
                            ? "On Delivery"
                            : state.booking?.status === "waiting_collection"
                            ? "Waiting"
                            : state.readiness
                            ? getReadinessEmoji(state.readiness)
                            : "In Yard"}
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-700/40 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-500">
                          Empty
                        </span>
                      )}
                    </div>

                    {state.trailer ? (
                      <div className="mt-2 space-y-1">
                        {/* Trailer Number */}
                        <p className="truncate text-sm font-bold text-white">
                          {state.trailer.trailer_number ?? "—"}
                        </p>

                        {/* Customer */}
                        {state.trailer.customer ? (
                          <p className="truncate text-xs text-slate-400">{state.trailer.customer}</p>
                        ) : null}

                        {/* Load Status */}
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">
                          {state.trailer.load_status ?? "Unknown"}
                        </p>

                        <p className="text-[10px] uppercase tracking-wider text-cyan-300">
                          {getTrailerOwnershipBadgeLabel(resolveOwnershipType(state.trailer))}
                        </p>

                        {/* Booking Status */}
                        {state.booking ? (
                          <p className="text-[10px] text-slate-400">{statusLabel(state.booking.status)}</p>
                        ) : null}

                        {/* TODAY badge */}
                        {state.hasDeliveryToday && state.booking ? (
                          <div className="mt-1.5 rounded-lg bg-cyan-500/20 px-2 py-1 text-center">
                            <p className="text-[9px] font-bold uppercase tracking-widest text-cyan-300">Today</p>
                            {state.booking.delivery_time ? (
                              <p className="text-xs font-semibold text-white">{formatTime(state.booking.delivery_time)}</p>
                            ) : null}
                            {state.booking.customer ? (
                              <p className="truncate text-[10px] text-cyan-200">{state.booking.customer}</p>
                            ) : null}
                          </div>
                        ) : null}

                        {/* Smart Badges */}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {state.booking?.escort_required && state.booking.status !== "on_delivery" && state.booking.status !== "delivered" ? (
                            <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-300">
                              Escort
                            </span>
                          ) : null}
                          {state.booking?.status === "waiting_collection" ? (
                            <span className="rounded-full bg-purple-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-purple-300">
                              Waiting
                            </span>
                          ) : null}
                          {state.trailer ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setHistoryTrailer({
                                  trailerId: state.trailer?.id ?? null,
                                  trailerNumber: state.trailer?.trailer_number ?? null,
                                });
                              }}
                              className="rounded-full border border-white/20 bg-slate-900/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-100"
                            >
                              History
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 text-center">
                        <p className="text-xs text-slate-600">Available</p>
                      </div>
                    )}
                  </article>
                );
              })}
            </section>

            {filteredPositions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">
                No positions match the current filter.
              </div>
            ) : null}

            {/* Position Detail Panel */}
            {selectedState?.trailer ? (
              <section className={`rounded-3xl border p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6 ${getPositionColours(selectedState).border} ${getPositionColours(selectedState).bg}`}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <p className={`text-sm font-bold uppercase tracking-[0.3em] ${getPositionColours(selectedState).headerText}`}>
                        {selectedState.position}
                      </p>
                      {selectedState.readiness ? (
                        <span className="text-lg">{getReadinessEmoji(selectedState.readiness)}</span>
                      ) : null}
                      <p className="text-sm text-slate-400">{getReadinessLabel(selectedState.readiness)}</p>
                    </div>

                    <h2 className="mt-2 text-2xl font-bold text-white">
                      {selectedState.trailer.trailer_number ?? "Unnamed trailer"}
                    </h2>

                    {selectedState.readinessReason ? (
                      <p className="mt-1 text-sm text-slate-400">{selectedState.readinessReason}</p>
                    ) : null}

                    {/* Trailer Details */}
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {[
                        { label: "Customer", value: selectedState.trailer.customer },
                        { label: "Ownership", value: getTrailerOwnershipBadgeLabel(resolveOwnershipType(selectedState.trailer)) },
                        { label: "Consignee", value: selectedState.trailer.consignee },
                        { label: "Load Status", value: selectedState.trailer.load_status },
                        { label: "Container", value: selectedState.trailer.container_number },
                      ].map(({ label, value }) => (
                        value ? (
                          <div key={label}>
                            <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500">{label}</p>
                            <p className="mt-1 text-sm font-semibold text-white">{value}</p>
                          </div>
                        ) : null
                      ))}
                    </div>

                    {/* Booking Details */}
                    {selectedState.booking ? (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Active Booking</p>
                        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                          {[
                            { label: "Date", value: selectedState.booking.delivery_date },
                            { label: "Time", value: formatTime(selectedState.booking.delivery_time) },
                            { label: "Customer", value: selectedState.booking.customer },
                            { label: "Location", value: selectedState.booking.delivery_location },
                            { label: "Status", value: statusLabel(selectedState.booking.status) },
                            { label: "Reference", value: selectedState.booking.booking_reference },
                            { label: "Escort", value: selectedState.booking.escort_required ? "Yes" : null },
                          ].map(({ label, value }) => (
                            value ? (
                              <div key={label}>
                                <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500">{label}</p>
                                <p className="mt-1 text-sm font-semibold text-white">{value}</p>
                              </div>
                            ) : null
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-slate-500">No active booking for this trailer.</p>
                    )}
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    href={`/dashboard/trailers/${selectedState.trailer.trailer_number ?? selectedState.trailer.id}`}
                    className="rounded-2xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
                  >
                    View Trailer
                  </Link>
                  <Link
                    href={`/dashboard/edit-trailer?trailerId=${selectedState.trailer.id}`}
                    className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
                  >
                    Edit Trailer
                  </Link>
                  {selectedState.booking ? (
                    <Link
                      href={`/dashboard/deliveries/${selectedState.booking.id}`}
                      className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
                    >
                      Open Booking
                    </Link>
                  ) : null}
                  <button
                    onClick={() => setSelectedPosition(null)}
                    className="ml-auto rounded-2xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-slate-400 hover:bg-slate-800"
                  >
                    Close
                  </button>
                </div>
              </section>
            ) : null}

            {/* Unassigned Trailers */}
            {unassignedTrailers.length > 0 ? (
              <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-white">Unassigned Trailers</h2>
                  <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-sm text-amber-200">
                    {unassignedTrailers.length}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {unassignedTrailers.map((trailer) => (
                    <article key={trailer.id} className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                      <p className="text-sm font-semibold text-white">
                        {trailer.trailer_number ? (
                          <Link
                            href={`/dashboard/trailers/${trailer.trailer_number}`}
                            className="transition hover:text-cyan-300"
                          >
                            {trailer.trailer_number}
                          </Link>
                        ) : (
                          "Unnamed trailer"
                        )}
                      </p>
                      <p className="mt-2 text-xs text-slate-400">Position: {trailer.compound_position ?? "—"}</p>
                      <p className="mt-1 text-xs text-slate-400">Load: {trailer.load_status ?? "Unknown"}</p>
                      <p className="mt-1 text-xs text-slate-400">Customer: {trailer.customer ?? "—"}</p>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <TrailerHistoryDrawer
              isOpen={Boolean(historyTrailer)}
              trailerId={historyTrailer?.trailerId}
              trailerNumber={historyTrailer?.trailerNumber}
              onClose={() => setHistoryTrailer(null)}
            />

            <TrailerOperationsPanel
              isOpen={Boolean(panelTrailer)}
              onClose={() => {
                setPanelTrailerId(null);
                setSelectedPosition(null);
              }}
              moduleLabel="Compound"
              trailer={
                panelTrailer
                  ? {
                      id: panelTrailer.id,
                      trailerId: panelTrailer.id,
                      trailerNumber: panelTrailer.trailer_number ?? null,
                      customer: panelTrailer.customer ?? null,
                      consignee: panelTrailer.consignee ?? null,
                      loadStatus: panelTrailer.load_status ?? null,
                      status: panelTrailer.operational_status ?? null,
                      compoundPosition: panelTrailer.compound_position ?? null,
                      arrivalDate: panelTrailer.arrival_date ?? null,
                    }
                  : null
              }
              inspectionHref={panelTrailer ? `/dashboard/trailers/${panelTrailer.id}` : null}
              photosHref={panelTrailer ? `/dashboard/trailers/${panelTrailer.id}` : null}
              damageHref={panelTrailer ? `/dashboard/trailers/${panelTrailer.id}` : null}
              onOpenHistory={
                panelTrailer
                  ? () => setHistoryTrailer({ trailerId: panelTrailer.id, trailerNumber: panelTrailer.trailer_number ?? null })
                  : undefined
              }
              onMove={panelTrailer ? (nextPosition) => handleQuickMove(panelTrailer.id, nextPosition) : undefined}
              moveLabel="Move Trailer"
            />
          </>
        )}
      </div>
    </main>
  );
}
