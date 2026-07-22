"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { HistoryDateRangeFilter } from "@/components/common/history-date-range-filter";
import { PrintButton } from "@/components/print/print-button";
import { PrintFilters } from "@/components/print/print-filters";
import { PrintFooter } from "@/components/print/print-footer";
import { PrintHeader } from "@/components/print/print-header";
import { PrintReportLayout } from "@/components/print/print-report-layout";
import { PrintSummary } from "@/components/print/print-summary";
import { PrintTable } from "@/components/print/print-table";
import { getOperationalStageBadgeClassName } from "@/lib/operations/operational-stages";
import {
  buildTrailerOperationalPositionFromContext,
  getTrailerFleetStatus,
} from "@/lib/operations/trailer-operational-engine";
import { supabase } from "@/lib/supabase";
import { getTrailerCurrentLocationLabel } from "@/lib/trailer-location";
import {
  EXPORT_ACTIVE_STATUS_QUERY_VALUES,
  getExportAllocationStatusLabel,
  normalizeExportAllocationStatus,
  type ExportAllocationStatus,
} from "@/lib/export-allocation";
import {
  createHistoryDateRange,
  getHistoryDateRangeLabel,
  isDateWithinHistoryRange,
  type HistoryDateRangeValue,
} from "@/lib/history-date-range";

type TrailerRecord = {
  id: string;
  trailer_number?: string | null;
  load_status?: string | null;
  customer?: string | null;
  consignee?: string | null;
  container_number?: string | null;
  compound_position?: string | null;
  arrival_date?: string | null;
  departure_date?: string | null;
  trailer_source?: string | null;
  external_company?: string | null;
  external_reference?: string | null;
  is_local?: boolean | null;
  operational_status?: string | null;
  active_export_allocation?: {
    id: string;
    status: ExportAllocationStatus;
    customer?: string | null;
    collection_date?: string | null;
    haulier?: string | null;
    booking_reference?: string | null;
  } | null;
};

type CompanyTrailerRecord = {
  id: string;
  trailer_number?: string | null;
  prefix?: string | null;
  numeric_part?: number | null;
};

type SearchResultGroup = {
  id: string;
  title: string;
  description: string;
  accent: string;
  items: Array<{
    id: string;
    trailer_number?: string | null;
    load_status?: string | null;
    position?: string | null;
    customer?: string | null;
    consignee?: string | null;
    container?: string | null;
    arrival_date?: string | null;
    departure_date?: string | null;
    trailer_source?: string | null;
    external_company?: string | null;
    external_reference?: string | null;
    is_local?: boolean | null;
    active_export_allocation?: {
      id: string;
      status: ExportAllocationStatus;
      customer?: string | null;
      collection_date?: string | null;
      haulier?: string | null;
      booking_reference?: string | null;
    } | null;
    status: string;
    operational_stage?: string | null;
    operational_location?: string | null;
    current_operational_status?: string | null;
    current_location?: string | null;
    trailer_id?: string | null;
    vessel?: string | null;
    issue?: boolean;
    fleet_status?: string | null;
    stage_badge_class_name?: string;
    profile_href?: string | null;
    source: "trailer" | "company";
  }>;
};

type DeliveryBookingRecord = {
  id: string;
  trailer_id: string;
  delivery_date: string;
  delivery_time?: string | null;
  customer?: string | null;
  consignee?: string | null;
  delivery_location?: string | null;
  booking_reference?: string | null;
  escort_required?: boolean | null;
  status: string;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  delivered_at?: string | null;
  waiting_collection_since?: string | null;
  collection_due_date?: string | null;
  collected_at?: string | null;
  demurrage_free_days?: number | null;
  demurrage_daily_rate?: number | null;
  demurrage_currency?: string | null;
  demurrage_notes?: string | null;
};

type VesselOperationTrailerRecord = {
  id: string;
  vessel_operation_id: string;
  trailer_id?: string | null;
  trailer_number?: string | null;
  customer?: string | null;
  booking_reference?: string | null;
  load_status?: string | null;
  load_description?: string | null;
  temperature_required?: string | null;
  expected_front_temperature?: number | null;
  expected_rear_temperature?: number | null;
  expected_temperature_unit?: string | null;
  priority_level?: string | null;
  priority_reason?: string | null;
  planned_destination?: string | null;
  planning_notes?: string | null;
  status?: string | null;
  arrived_at?: string | null;
  arrival_status: string;
  arrival_confirmed_at?: string | null;
  arrival_record_id?: string | null;
  arrival_confirmed_by?: string | null;
  inspection_started_at?: string | null;
  inspection_completed_at?: string | null;
  position_assigned_at?: string | null;
  assigned_position?: string | null;
  has_damage?: boolean | null;
  has_temperature_alert?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type VesselOperationRecord = {
  id: string;
  vessel_name?: string | null;
  sailing_reference?: string | null;
  origin_port?: string | null;
  berth?: string | null;
  expected_arrival_at?: string | null;
  actual_arrival_at?: string | null;
  status: string;
  list_status?: string | null;
  list_confirmed_at?: string | null;
  list_confirmed_by?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type TrailerEventRecord = {
  id: string;
  trailer_id?: string | null;
  trailer_number?: string | null;
  event_type?: string | null;
  event_description?: string | null;
  old_value?: unknown;
  new_value?: unknown;
  created_at?: string | null;
  created_by?: string | null;
};

type OperationalSnapshot = {
  stageLabel: string;
  stage: string | null;
  location: string | null;
  vessel: string | null;
  hasIssues: boolean;
  badgeClassName: string;
  fleetStatus: string;
};

const SEARCH_RESULTS_LIMIT = 500;
const SEARCH_EVENTS_LIMIT = 1200;

const formatDate = (value?: string | null) => {
  if (!value) {
    return "—";
  }

  try {
    return new Date(value).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
};

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";

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

type ActiveFilterKey =
  | "compound"
  | "empty"
  | "loaded"
  | "maintenance"
  | "local"
  | "source_outsourced"
  | "source_company"
  | "arrivals_today"
  | "departures_today";

function DashboardSearchPageContent() {
  const searchParams = useSearchParams();
  const urlStatus = searchParams.get("status");
  const urlFilter = searchParams.get("filter");
  const urlSource = searchParams.get("source");
  const [search, setSearch] = useState("");
  const [trailers, setTrailers] = useState<TrailerRecord[]>([]);
  const [companyTrailers, setCompanyTrailers] = useState<CompanyTrailerRecord[]>([]);
  const [deliveryBookings, setDeliveryBookings] = useState<DeliveryBookingRecord[]>([]);
  const [vesselOperationTrailers, setVesselOperationTrailers] = useState<VesselOperationTrailerRecord[]>([]);
  const [vesselOperations, setVesselOperations] = useState<VesselOperationRecord[]>([]);
  const [trailerEvents, setTrailerEvents] = useState<TrailerEventRecord[]>([]);
  const [historyDateRange, setHistoryDateRange] = useState<HistoryDateRangeValue>(() => createHistoryDateRange("today"));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const todayKey = useMemo(() => getDateKey(new Date().toISOString()), []);

  const activeFilter = useMemo<ActiveFilterKey | null>(() => {
    if (urlFilter === "compound") {
      return "compound";
    }

    if (urlFilter === "arrivals_today") {
      return "arrivals_today";
    }

    if (urlFilter === "departures_today") {
      return "departures_today";
    }

    if (urlFilter === "local") {
      return "local";
    }

    if (urlSource === "outsourced") {
      return "source_outsourced";
    }

    if (urlSource === "company") {
      return "source_company";
    }

    if (urlStatus === "empty") {
      return "empty";
    }

    if (urlStatus === "loaded") {
      return "loaded";
    }

    if (urlStatus === "maintenance") {
      return "maintenance";
    }

    return null;
  }, [urlFilter, urlSource, urlStatus]);

  const activeFilterTitle = useMemo(() => {
    if (activeFilter === "compound") return "Compound Trailers";
    if (activeFilter === "empty") return "Available Empty Trailers";
    if (activeFilter === "loaded") return "Loaded Trailers";
    if (activeFilter === "maintenance") return "Maintenance Trailers";
    if (activeFilter === "local") return "Local Trailers";
    if (activeFilter === "source_outsourced") return "Outsourced Trailers";
    if (activeFilter === "source_company") return "Ferryspeed Fleet Trailers";
    if (activeFilter === "arrivals_today") return "Today's Arrivals";
    if (activeFilter === "departures_today") return "Today's Departures";
    return null;
  }, [activeFilter]);

  const isArrivalOrDepartureFilter = activeFilter === "arrivals_today" || activeFilter === "departures_today";

  useEffect(() => {
    if (!isArrivalOrDepartureFilter) {
      setHistoryDateRange(createHistoryDateRange("today"));
    }
  }, [isArrivalOrDepartureFilter]);

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const activeStatuses = [...EXPORT_ACTIVE_STATUS_QUERY_VALUES];
        const [
          { data: trailerData, error: trailerError },
          { data: companyData, error: companyError },
          { data: exportData, error: exportError },
          { data: deliveryData, error: deliveryError },
          { data: vesselTrailerData, error: vesselTrailerError },
        ] = await Promise.all([
          supabase
            .from("trailers")
            .select("id, trailer_number, load_status, customer, consignee, container_number, compound_position, arrival_date, departure_date, trailer_source, external_company, external_reference, is_local, operational_status")
            .limit(SEARCH_RESULTS_LIMIT)
            .order("arrival_date", { ascending: false }),
          supabase
            .from("company_trailers")
            .select("id, trailer_number, prefix, numeric_part")
            .limit(SEARCH_RESULTS_LIMIT)
            .order("trailer_number", { ascending: true }),
          supabase
            .from("export_allocations")
            .select("id, trailer_id, status, customer, collection_date, haulier, booking_reference, updated_at")
            .in("status", activeStatuses)
            .limit(SEARCH_RESULTS_LIMIT)
            .order("updated_at", { ascending: false }),
          supabase
            .from("delivery_bookings")
            .select("id, trailer_id, delivery_date, delivery_time, customer, consignee, delivery_location, booking_reference, escort_required, status, notes, created_at, updated_at, delivered_at, waiting_collection_since, collection_due_date, collected_at, demurrage_free_days, demurrage_daily_rate, demurrage_currency, demurrage_notes")
            .not("status", "in", '("collected","cancelled")')
            .limit(SEARCH_RESULTS_LIMIT)
            .order("updated_at", { ascending: false }),
          supabase
            .from("vessel_operation_trailers")
            .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, load_description, temperature_required, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, priority_level, priority_reason, planned_destination, planning_notes, status, arrived_at, arrival_status, arrival_confirmed_at, arrival_record_id, arrival_confirmed_by, inspection_started_at, inspection_completed_at, position_assigned_at, assigned_position, has_damage, has_temperature_alert, created_at, updated_at")
            .limit(SEARCH_RESULTS_LIMIT)
            .order("created_at", { ascending: false }),
        ]);

        if (trailerError) {
          throw trailerError;
        }

        if (companyError) {
          throw companyError;
        }

        if (exportError) {
          throw exportError;
        }

        if (deliveryError) {
          throw deliveryError;
        }

        if (vesselTrailerError) {
          throw vesselTrailerError;
        }

        if (!isMounted) {
          return;
        }

        const trailerRows = (trailerData ?? []) as TrailerRecord[];
        const companyRows = (companyData ?? []) as CompanyTrailerRecord[];
        const deliveryRows = (deliveryData ?? []) as DeliveryBookingRecord[];
        const vesselTrailerRows = (vesselTrailerData ?? []) as VesselOperationTrailerRecord[];
        const trailerIds = trailerRows.map((item) => item.id);
        const trailerNumbers = Array.from(new Set([
          ...trailerRows.map((item) => item.trailer_number).filter((value): value is string => Boolean(value?.trim())),
          ...companyRows.map((item) => item.trailer_number).filter((value): value is string => Boolean(value?.trim())),
          ...vesselTrailerRows.map((item) => item.trailer_number).filter((value): value is string => Boolean(value?.trim())),
        ]));
        const vesselOperationIds = Array.from(new Set(vesselTrailerRows.map((item) => item.vessel_operation_id)));

        const [vesselOperationsResult, trailerEventsByIdResult, trailerEventsByNumberResult] = await Promise.all([
          vesselOperationIds.length > 0
            ? supabase
                .from("vessel_operations")
                .select("id, vessel_name, sailing_reference, origin_port, berth, expected_arrival_at, actual_arrival_at, status, list_status, list_confirmed_at, list_confirmed_by, notes, created_at, updated_at")
                .in("id", vesselOperationIds)
            : Promise.resolve({ data: [], error: null }),
          trailerIds.length > 0
            ? supabase
                .from("trailer_events")
                .select("id, trailer_id, trailer_number, event_type, event_description, old_value, new_value, created_at, created_by")
                .in("trailer_id", trailerIds)
                .limit(SEARCH_EVENTS_LIMIT)
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
          trailerNumbers.length > 0
            ? supabase
                .from("trailer_events")
                .select("id, trailer_id, trailer_number, event_type, event_description, old_value, new_value, created_at, created_by")
                .in("trailer_number", trailerNumbers)
                .limit(SEARCH_EVENTS_LIMIT)
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
        ]);

        if (vesselOperationsResult.error) {
          throw vesselOperationsResult.error;
        }

        if (trailerEventsByIdResult.error) {
          throw trailerEventsByIdResult.error;
        }

        if (trailerEventsByNumberResult.error) {
          throw trailerEventsByNumberResult.error;
        }

        const exportByTrailer = new Map<string, TrailerRecord["active_export_allocation"]>();
        (exportData ?? []).forEach((row) => {
          const trailerId = (row as { trailer_id?: string | null }).trailer_id;
          if (!trailerId || exportByTrailer.has(trailerId)) {
            return;
          }

          exportByTrailer.set(trailerId, {
            id: (row as { id: string }).id,
            status: normalizeExportAllocationStatus((row as { status?: string | null }).status),
            customer: (row as { customer?: string | null }).customer ?? null,
            collection_date: (row as { collection_date?: string | null }).collection_date ?? null,
            haulier: (row as { haulier?: string | null }).haulier ?? null,
            booking_reference: (row as { booking_reference?: string | null }).booking_reference ?? null,
          });
        });

        const enrichedTrailers = ((trailerData ?? []) as TrailerRecord[]).map((item) => ({
          ...item,
          active_export_allocation: exportByTrailer.get(item.id) ?? null,
        }));

        setTrailers(enrichedTrailers);
        setCompanyTrailers(companyRows);
        setDeliveryBookings(deliveryRows);
        setVesselOperationTrailers(vesselTrailerRows);
        setVesselOperations((vesselOperationsResult.data ?? []) as VesselOperationRecord[]);
        setTrailerEvents(
          [
            ...((trailerEventsByIdResult.data ?? []) as TrailerEventRecord[]),
            ...((trailerEventsByNumberResult.data ?? []) as TrailerEventRecord[]),
          ].filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index),
        );
      } catch (err) {
        if (!isMounted) {
          return;
        }

        const message = err instanceof Error ? err.message : "Unable to load search data.";
        setError(message);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  const operationalSnapshots = useMemo(() => {
    const snapshots = new Map<string, OperationalSnapshot>();
    const companyByTrailerNumber = new Map(companyTrailers.map((item) => [normalizeText(item.trailer_number), item]));
    const deliveriesByTrailerId = new Map<string, DeliveryBookingRecord[]>();
    const exportsByTrailerId = new Map<string, TrailerRecord["active_export_allocation"][]>();
    const vesselTrailersByTrailerId = new Map<string, VesselOperationTrailerRecord[]>();
    const vesselTrailersByNumber = new Map<string, VesselOperationTrailerRecord[]>();
    const trailerEventsByTrailerId = new Map<string, TrailerEventRecord[]>();
    const trailerEventsByTrailerNumber = new Map<string, TrailerEventRecord[]>();

    deliveryBookings.forEach((item) => {
      const collection = deliveriesByTrailerId.get(item.trailer_id) ?? [];
      collection.push(item);
      deliveriesByTrailerId.set(item.trailer_id, collection);
    });

    trailers.forEach((item) => {
      if (!item.active_export_allocation) {
        return;
      }

      const collection = exportsByTrailerId.get(item.id) ?? [];
      collection.push(item.active_export_allocation);
      exportsByTrailerId.set(item.id, collection);
    });

    vesselOperationTrailers.forEach((item) => {
      if (item.trailer_id) {
        const byId = vesselTrailersByTrailerId.get(item.trailer_id) ?? [];
        byId.push(item);
        vesselTrailersByTrailerId.set(item.trailer_id, byId);
      }

      const normalizedNumber = normalizeText(item.trailer_number);
      if (normalizedNumber) {
        const byNumber = vesselTrailersByNumber.get(normalizedNumber) ?? [];
        byNumber.push(item);
        vesselTrailersByNumber.set(normalizedNumber, byNumber);
      }
    });

    trailerEvents.forEach((item) => {
      if (item.trailer_id) {
        const byId = trailerEventsByTrailerId.get(item.trailer_id) ?? [];
        byId.push(item);
        trailerEventsByTrailerId.set(item.trailer_id, byId);
      }

      const normalizedNumber = normalizeText(item.trailer_number);
      if (normalizedNumber) {
        const byNumber = trailerEventsByTrailerNumber.get(normalizedNumber) ?? [];
        byNumber.push(item);
        trailerEventsByTrailerNumber.set(normalizedNumber, byNumber);
      }
    });

    const buildSnapshot = (input: { key: string; trailer: TrailerRecord | null; companyTrailer: CompanyTrailerRecord | null; trailerNumber: string }) => {
      const normalizedNumber = normalizeText(input.trailerNumber);
      const derived = buildTrailerOperationalPositionFromContext({
        trailerNumber: input.trailerNumber,
        trailer: input.trailer as never,
        companyTrailer: input.companyTrailer as never,
        trailerEvents: [
          ...(input.trailer ? trailerEventsByTrailerId.get(input.trailer.id) ?? [] : []),
          ...(normalizedNumber ? trailerEventsByTrailerNumber.get(normalizedNumber) ?? [] : []),
        ] as never,
        vesselOperationTrailers: [
          ...(input.trailer ? vesselTrailersByTrailerId.get(input.trailer.id) ?? [] : []),
          ...(normalizedNumber ? vesselTrailersByNumber.get(normalizedNumber) ?? [] : []),
        ] as never,
        vesselOperations: vesselOperations as never,
        deliveryBookings: input.trailer ? (deliveriesByTrailerId.get(input.trailer.id) ?? []) as never : [],
        exportAllocations: input.trailer ? ((exportsByTrailerId.get(input.trailer.id) ?? []) as never) : [],
      });

      snapshots.set(input.key, {
        stageLabel: derived.stageLabel,
        stage: derived.operationalStage,
        location: derived.currentLocation,
        vessel: derived.vessel,
        hasIssues: derived.issueIndicator.hasIssues,
        badgeClassName: derived.operationalStage
          ? getOperationalStageBadgeClassName(derived.operationalStage)
          : "border-slate-500/30 bg-slate-500/10 text-slate-200",
        fleetStatus: getTrailerFleetStatus({
          trailer: input.trailer as never,
          companyTrailer: input.companyTrailer as never,
        }),
      });
    };

    trailers.forEach((item) => {
      const trailerNumber = item.trailer_number?.trim() ?? item.id;
      buildSnapshot({
        key: `trailer:${item.id}`,
        trailer: item,
        companyTrailer: companyByTrailerNumber.get(normalizeText(item.trailer_number)) ?? null,
        trailerNumber,
      });
    });

    companyTrailers.forEach((item) => {
      if (!item.trailer_number?.trim()) {
        return;
      }

      const matchingTrailer = trailers.find((trailer) => normalizeText(trailer.trailer_number) === normalizeText(item.trailer_number));
      if (matchingTrailer) {
        return;
      }

      buildSnapshot({
        key: `company:${item.id}`,
        trailer: null,
        companyTrailer: item,
        trailerNumber: item.trailer_number,
      });
    });

    return snapshots;
  }, [companyTrailers, deliveryBookings, trailers, trailerEvents, vesselOperationTrailers, vesselOperations]);

  const searchGroups = useMemo<SearchResultGroup[]>(() => {
    const term = search.trim().toLowerCase();
    const hasSearchTerm = term.length > 0;

    const normalizedLoadStatus = (value?: string | null) => value?.trim().toLowerCase() ?? "";

    const isActiveTrailer = (item: TrailerRecord) =>
      item.departure_date === null || item.departure_date === undefined || item.departure_date === "";

    const matchesTextSearch = (values: Array<string | null | undefined>) => {
      if (!hasSearchTerm) {
        return true;
      }

      const haystack = values
        .filter((value): value is string => Boolean(value))
        .map((value) => normalizeText(value))
        .join(" ");

      return haystack.includes(term);
    };

    const matchesTrailer = (item: TrailerRecord) => {
      return matchesTextSearch([
        item.trailer_number,
        item.container_number,
        item.customer,
        item.consignee,
        item.compound_position,
        item.external_company,
        item.external_reference,
        item.trailer_source,
        item.is_local ? "local" : "compound",
        item.active_export_allocation?.customer,
        item.active_export_allocation?.haulier,
        item.active_export_allocation?.booking_reference,
      ]);
    };

    const matchesCompanyTrailer = (item: CompanyTrailerRecord) => {
      return matchesTextSearch([
        item.trailer_number,
        item.prefix,
        item.numeric_part !== null && item.numeric_part !== undefined ? String(item.numeric_part) : null,
      ]);
    };

    const toTrailerItem = (item: TrailerRecord, status: string) => {
      const snapshot = operationalSnapshots.get(`trailer:${item.id}`);
      const currentLocation = getTrailerCurrentLocationLabel({
        departureDate: item.departure_date,
        isLocal: item.is_local,
        compoundPosition: item.compound_position,
        waitingForCompound: snapshot?.stage === "hold",
        exportLocation: snapshot?.location?.includes("Export") ? snapshot.location : null,
        fallbackLocation: snapshot?.location ?? null,
      });
      return {
      id: item.id,
      trailer_number: item.trailer_number,
      load_status: item.load_status,
      position: item.compound_position,
      customer: item.customer,
      consignee: item.consignee,
      container: item.container_number,
      arrival_date: item.arrival_date,
      departure_date: item.departure_date,
      trailer_source: item.trailer_source,
      external_company: item.external_company,
      external_reference: item.external_reference,
      is_local: item.is_local,
      active_export_allocation: item.active_export_allocation ?? null,
      status,
      operational_stage: snapshot?.stageLabel ?? status,
      current_operational_status: snapshot?.stageLabel ?? status,
      current_location: currentLocation,
      operational_location: currentLocation,
      vessel: snapshot?.vessel ?? null,
      issue: snapshot?.hasIssues ?? false,
      fleet_status: snapshot?.fleetStatus ?? (item.trailer_source === "outsourced" ? "Outsourced" : "Ferryspeed Fleet"),
      stage_badge_class_name: snapshot?.badgeClassName ?? "border-slate-500/30 bg-slate-500/10 text-slate-200",
      profile_href: `/dashboard/trailers/${encodeURIComponent(item.id)}`,
      source: "trailer" as const,
      };
    };

    if (!activeFilter && !hasSearchTerm) {
      return [
        {
          id: "active",
          title: "Active trailers in compound",
          description: "Current trailers still on site",
          accent: "from-cyan-500 to-blue-600",
          items: [],
        },
        {
          id: "historical",
          title: "Historical movements",
          description: "Trailers already departed",
          accent: "from-violet-500 to-fuchsia-600",
          items: [],
        },
        {
          id: "company",
          title: "Company fleet",
          description: "Fleet records from the wider company inventory",
          accent: "from-emerald-500 to-teal-600",
          items: [],
        },
      ];
    }

    if (activeFilter) {
      let filteredTrailers: TrailerRecord[] = [];
      let statusLabel = "In Compound";
      let groupTitle = "Filtered trailers";
      let groupDescription = "Trailer records matching the selected dashboard filter";
      let accent = "from-cyan-500 to-blue-600";

      if (activeFilter === "compound") {
        filteredTrailers = trailers.filter((item) => isActiveTrailer(item));
        groupTitle = "Active trailers in compound";
        groupDescription = "Current trailers still on site";
      } else if (activeFilter === "empty") {
        filteredTrailers = trailers.filter(
          (item) =>
            isActiveTrailer(item) &&
            normalizedLoadStatus(item.load_status) === "empty" &&
            !item.active_export_allocation
        );
        statusLabel = "Empty";
        groupTitle = "Available empty trailers";
        groupDescription = "Active empty trailers with no active export allocation";
        accent = "from-emerald-500 to-teal-600";
      } else if (activeFilter === "loaded") {
        filteredTrailers = trailers.filter(
          (item) => isActiveTrailer(item) && normalizedLoadStatus(item.load_status) === "loaded"
        );
        statusLabel = "Loaded";
        groupTitle = "Loaded trailers";
        groupDescription = "Active trailers ready for departure";
        accent = "from-amber-500 to-orange-600";
      } else if (activeFilter === "maintenance") {
        filteredTrailers = trailers.filter((item) => {
          if (!isActiveTrailer(item)) {
            return false;
          }

          const status = normalizedLoadStatus(item.load_status);
          return status !== "empty" && status !== "loaded";
        });
        statusLabel = "Maintenance";
        groupTitle = "Maintenance trailers";
        groupDescription = "Active trailers requiring operational review";
        accent = "from-rose-500 to-pink-600";
      } else if (activeFilter === "local") {
        filteredTrailers = trailers.filter((item) => isActiveTrailer(item) && item.is_local === true);
        statusLabel = "Local";
        groupTitle = "Local trailers";
        groupDescription = "Active trailers outside compound capacity";
        accent = "from-indigo-500 to-violet-600";
      } else if (activeFilter === "source_outsourced") {
        filteredTrailers = trailers.filter((item) => isActiveTrailer(item) && item.trailer_source === "outsourced");
        statusLabel = "Outsourced";
        groupTitle = "Outsourced trailers";
        groupDescription = "Active trailers from external transport companies";
        accent = "from-amber-500 to-orange-600";
      } else if (activeFilter === "source_company") {
        filteredTrailers = trailers.filter((item) => isActiveTrailer(item) && (item.trailer_source ?? "company") === "company");
        statusLabel = "Ferryspeed Fleet";
        groupTitle = "Ferryspeed fleet trailers";
        groupDescription = "Active trailers from the Ferryspeed fleet";
        accent = "from-cyan-500 to-blue-600";
      } else if (activeFilter === "arrivals_today") {
        filteredTrailers = trailers.filter((item) => isDateWithinHistoryRange(getDateKey(item.arrival_date), historyDateRange));
        statusLabel = "Arrived";
        groupTitle = "Arrivals";
        groupDescription = `Trailers that arrived within ${getHistoryDateRangeLabel(historyDateRange).toLowerCase()}`;
        accent = "from-sky-500 to-cyan-600";
      } else if (activeFilter === "departures_today") {
        filteredTrailers = trailers.filter((item) => isDateWithinHistoryRange(getDateKey(item.departure_date), historyDateRange));
        statusLabel = "Departed";
        groupTitle = "Departures";
        groupDescription = `Trailers that departed within ${getHistoryDateRangeLabel(historyDateRange).toLowerCase()}`;
        accent = "from-violet-500 to-fuchsia-600";
      }

      return [
        {
          id: "filtered_trailers",
          title: groupTitle,
          description: groupDescription,
          accent,
          items: filteredTrailers
            .filter((item) => matchesTrailer(item))
            .map((item) =>
              toTrailerItem(
                item,
                activeFilter === "compound"
                  ? isActiveTrailer(item)
                    ? "In Compound"
                    : "Departed"
                  : statusLabel
              )
            ),
        },
      ];
    }

    const activeItems = trailers
      .filter((item) => isActiveTrailer(item))
      .filter((item) => matchesTrailer(item))
      .map((item) => toTrailerItem(item, "In Compound"));

    const historicalItems = trailers
      .filter((item) => !isActiveTrailer(item))
      .filter((item) => matchesTrailer(item))
      .map((item) => toTrailerItem(item, "Departed"));

    const companyItems = companyTrailers
      .filter((item) => matchesCompanyTrailer(item))
      .map((item) => {
        const matchingTrailer = trailers.find((trailer) => normalizeText(trailer.trailer_number) === normalizeText(item.trailer_number));
        const companySnapshot = operationalSnapshots.get(`company:${item.id}`);
        const currentLocation = getTrailerCurrentLocationLabel({
          departureDate: matchingTrailer?.departure_date,
          isLocal: matchingTrailer?.is_local,
          compoundPosition: matchingTrailer?.compound_position,
          waitingForCompound: companySnapshot?.stage === "hold",
          exportLocation: companySnapshot?.location?.includes("Export") ? companySnapshot.location : null,
          fallbackLocation: companySnapshot?.location ?? null,
        });
        return {
          id: item.id,
          trailer_number: item.trailer_number,
          load_status: "—",
          position: "—",
          customer: "—",
          consignee: "—",
          container: "—",
          arrival_date: null,
          departure_date: null,
          trailer_source: "company",
          external_company: null,
          external_reference: null,
          is_local: false,
          active_export_allocation: null,
          status: matchingTrailer ? (matchingTrailer.operational_status ?? "Trailer Record") : "Fleet Record",
          operational_stage: matchingTrailer ? (matchingTrailer.operational_status ?? operationalSnapshots.get(`company:${item.id}`)?.stageLabel ?? "Trailer Record") : "Fleet Record",
          current_operational_status: matchingTrailer ? (matchingTrailer.operational_status ?? operationalSnapshots.get(`company:${item.id}`)?.stageLabel ?? "Trailer Record") : "Fleet Record",
          current_location: currentLocation,
          operational_location: currentLocation,
          vessel: operationalSnapshots.get(`company:${item.id}`)?.vessel ?? null,
          issue: operationalSnapshots.get(`company:${item.id}`)?.hasIssues ?? false,
          fleet_status: operationalSnapshots.get(`company:${item.id}`)?.fleetStatus ?? "Ferryspeed Fleet",
          stage_badge_class_name: operationalSnapshots.get(`company:${item.id}`)?.badgeClassName ?? "border-slate-500/30 bg-slate-500/10 text-slate-200",
          profile_href: matchingTrailer ? `/dashboard/trailers/${encodeURIComponent(matchingTrailer.id)}` : null,
          source: "company" as const,
        };
      });

    return [
      {
        id: "active",
        title: "Active trailers in compound",
        description: "Current trailers still on site",
        accent: "from-cyan-500 to-blue-600",
        items: activeItems,
      },
      {
        id: "historical",
        title: "Historical movements",
        description: "Trailers already departed",
        accent: "from-violet-500 to-fuchsia-600",
        items: historicalItems,
      },
      {
        id: "company",
        title: "Company fleet",
        description: "Fleet records from the wider company inventory",
        accent: "from-emerald-500 to-teal-600",
        items: companyItems,
      },
    ];
  }, [activeFilter, companyTrailers, historyDateRange, operationalSnapshots, search, todayKey, trailers]);

  const hasAnyResults = searchGroups.some((group) => group.items.length > 0);
  const totalResults = searchGroups.reduce((count, group) => count + group.items.length, 0);
  const hasSearchTerm = Boolean(search.trim());
  const hasFilter = Boolean(activeFilter);
  const printableRows = useMemo(
    () =>
      searchGroups.flatMap((group) =>
        group.items.map((item) => ({
          group: group.title,
          ...item,
        })),
      ),
    [searchGroups],
  );
  const printedAt = getPrintedDateTime();

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Global Search</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300 sm:text-base">
                Search current compound activity and historical movements across trailers and the company fleet.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <PrintButton label="Print / Export" disabled={isLoading || !hasAnyResults} />
              <Link
                href="/dashboard"
                className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition hover:bg-cyan-500/20"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        </header>

        {hasAnyResults ? (
          <PrintReportLayout orientation="landscape">
            <PrintHeader title="Trailer Search Report" printedAt={printedAt} userName="Diogo Ferreira" totalRecords={totalResults}>
              <PrintFilters
                items={[
                  { label: "Search", value: search.trim() || "Current filtered view" },
                  { label: "Dashboard Filter", value: activeFilterTitle ?? "None" },
                  { label: "Period", value: isArrivalOrDepartureFilter ? getHistoryDateRangeLabel(historyDateRange) : "Current day" },
                ]}
              />
            </PrintHeader>

            <PrintSummary
              items={[
                { label: "Total Results", value: totalResults },
                { label: "Groups", value: searchGroups.filter((group) => group.items.length > 0).length },
                { label: "Active Filter", value: activeFilterTitle ?? "General Search" },
                { label: "Search Term", value: search.trim() || "All visible records" },
                { label: "Today", value: todayKey ?? "—" },
              ]}
            />

            <PrintTable
              rows={printableRows}
              columns={[
                { key: "group", header: "Group", render: (row) => row.group },
                { key: "trailer_number", header: "Trailer", render: (row) => row.trailer_number ?? "—" },
                { key: "status", header: "Status", render: (row) => row.status },
                { key: "customer", header: "Customer", render: (row) => row.customer ?? "—" },
                { key: "position", header: "Position", render: (row) => row.position ?? "—" },
                { key: "arrival_date", header: "Arrival", render: (row) => formatDate(row.arrival_date) },
                { key: "departure_date", header: "Departure", render: (row) => formatDate(row.departure_date) },
                { key: "source", header: "Source", render: (row) => row.source === "company" ? "Company fleet" : "Trailer record" },
              ]}
            />

            <PrintFooter />
          </PrintReportLayout>
        ) : null}

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
          <label className="mb-2 block text-sm font-medium text-slate-200" htmlFor="global-search">
            Search trailers and fleet records
          </label>
          <input
            id="global-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by trailer number, container, customer, consignee, position, or prefix"
            className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none ring-0"
          />
          <p className="mt-2 text-sm text-slate-400">
            Matches are checked across the trailers and company fleet tables.
          </p>

          {isArrivalOrDepartureFilter ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-3">
              <HistoryDateRangeFilter
                value={historyDateRange}
                onChange={setHistoryDateRange}
                label={activeFilter === "arrivals_today" ? "Arrivals Period" : "Departures Period"}
              />
            </div>
          ) : null}
        </section>

        {hasFilter && activeFilterTitle ? (
          <section className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-semibold">Filter active: {activeFilterTitle}</p>
              <Link href="/dashboard/search" className="text-cyan-200 underline decoration-cyan-300/70 underline-offset-2 hover:text-cyan-100">
                Clear Filter
              </Link>
            </div>
          </section>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400 shadow-lg shadow-black/20 backdrop-blur">
            Loading search data...
          </div>
        ) : null}

        {!isLoading && !error && !hasFilter && !hasSearchTerm ? (
          <div className="rounded-3xl border border-dashed border-cyan-400/30 bg-slate-900/70 p-6 text-sm text-slate-300 shadow-lg shadow-black/20 backdrop-blur">
            Enter a trailer number, container, customer, consignee, position, or fleet prefix to begin searching.
          </div>
        ) : null}

        {!isLoading && !error && (hasFilter || hasSearchTerm) && !hasAnyResults ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-300 shadow-lg shadow-black/20 backdrop-blur">
            {hasSearchTerm ? `No matches found for “${search.trim()}”.` : "No matches found for the selected filter."} Try a different reference or prefix.
          </div>
        ) : null}

        {!isLoading && !error && hasAnyResults ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
              Showing {totalResults} result{totalResults === 1 ? "" : "s"} across {searchGroups.filter((group) => group.items.length > 0).length} group{searchGroups.filter((group) => group.items.length > 0).length === 1 ? "" : "s"}.
            </div>

            {searchGroups.map((group) => (
              <section key={group.id} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className={`h-1.5 w-20 rounded-full bg-gradient-to-r ${group.accent}`} />
                    <h2 className="mt-3 text-lg font-semibold text-white">{group.title}</h2>
                    <p className="mt-1 text-sm text-slate-400">{group.description}</p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-slate-950/80 px-3 py-1 text-sm text-slate-300">
                    {group.items.length} result{group.items.length === 1 ? "" : "s"}
                  </span>
                </div>

                {group.items.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {group.items.map((item) => (
                      <article key={item.id} className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Trailer number</p>
                            <p className="mt-1 text-lg font-semibold text-white">
                              {item.profile_href ? (
                                <Link href={item.profile_href} className="underline decoration-cyan-400/60 underline-offset-2 hover:text-cyan-200">
                                  {item.trailer_number ?? "—"}
                                </Link>
                              ) : (
                                item.trailer_number ?? "—"
                              )}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className={`rounded-full border px-3 py-1 text-sm ${item.stage_badge_class_name ?? "border-cyan-400/20 bg-cyan-500/10 text-cyan-200"}`}>
                              {item.operational_stage ?? item.status}
                            </span>
                            {item.issue ? <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-sm text-rose-200">Issue</span> : null}
                            {item.active_export_allocation ? (
                              <span className="rounded-full border border-orange-400/30 bg-orange-500/10 px-3 py-1 text-sm text-orange-200">
                                {getExportAllocationStatusLabel(item.active_export_allocation.status)}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <dl className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-4">
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Load status</dt>
                            <dd className="mt-1">{item.load_status ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Current Location</dt>
                            <dd className="mt-1">{item.current_location ?? item.operational_location ?? item.position ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Current Operational Status</dt>
                            <dd className="mt-1">{item.current_operational_status ?? item.status}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Customer</dt>
                            <dd className="mt-1">{item.customer ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Vessel</dt>
                            <dd className="mt-1">{item.vessel ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Consignee</dt>
                            <dd className="mt-1">{item.consignee ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Container</dt>
                            <dd className="mt-1">{item.container ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Arrival date</dt>
                            <dd className="mt-1">{formatDate(item.arrival_date)}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Departure date</dt>
                            <dd className="mt-1">{formatDate(item.departure_date)}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Source</dt>
                            <dd className="mt-1">{item.source === "company" ? (item.profile_href ? "Company fleet linked to trailer record" : "Company fleet") : "Trailer record"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Fleet Status</dt>
                            <dd className="mt-1">{item.fleet_status ?? (item.trailer_source === "outsourced" ? "Outsourced" : "Ferryspeed Fleet")}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">External Company</dt>
                            <dd className="mt-1">{item.trailer_source === "outsourced" ? item.external_company ?? "—" : "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">External Reference</dt>
                            <dd className="mt-1">{item.trailer_source === "outsourced" ? item.external_reference ?? "—" : "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Location Type</dt>
                            <dd className="mt-1">{item.is_local ? "Local" : "Compound"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Allocation Customer</dt>
                            <dd className="mt-1">{item.active_export_allocation?.customer ?? "-"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Collection Date</dt>
                            <dd className="mt-1">{formatDate(item.active_export_allocation?.collection_date)}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Haulier</dt>
                            <dd className="mt-1">{item.active_export_allocation?.haulier ?? "-"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Booking Reference</dt>
                            <dd className="mt-1">{item.active_export_allocation?.booking_reference ?? "-"}</dd>
                          </div>
                        </dl>

                        {item.active_export_allocation ? (
                          <div className="mt-3">
                            <Link
                              href={`/dashboard/export-operations/${item.active_export_allocation.id}`}
                              className="text-sm font-semibold text-cyan-200 underline hover:text-cyan-100"
                            >
                              View Export Allocation
                            </Link>
                          </div>
                        ) : null}

                        {item.source === "trailer" && item.profile_href ? (
                          <div className="mt-3">
                            <Link href={item.profile_href} className="text-sm font-semibold text-slate-700 underline hover:text-slate-900">
                              View Trailer
                            </Link>
                          </div>
                        ) : item.source === "company" ? (
                          item.profile_href ? (
                            <div className="mt-3">
                              <Link href={item.profile_href} className="text-sm font-semibold text-slate-700 underline hover:text-slate-900">
                                View Trailer
                              </Link>
                            </div>
                          ) : (
                            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600">
                              Fleet Record only. No current operational record.
                            </div>
                          )
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-slate-950/60 p-4 text-sm text-slate-400">
                    No matches in this group.
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}

export default function DashboardSearchPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400 shadow-lg shadow-black/20 backdrop-blur">
            Loading search data...
          </div>
        </main>
      }
    >
      <DashboardSearchPageContent />
    </Suspense>
  );
}
