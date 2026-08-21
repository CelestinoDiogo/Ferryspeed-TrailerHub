"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OperationsAssistantDrawer } from "@/components/ai/operations-assistant-drawer";
import { SuccessToast } from "@/components/common/success-toast";
import { TrailerOperationsPanel } from "@/components/operations/trailer-operations-panel";
import { TrailerHistoryDrawer } from "@/components/trailers/trailer-history-drawer";
import {
  getAdvanceStatusActionLabel,
  isTrailerPresentInCompoundInventory,
  normalizeExportAllocationRecord,
  type ExportAllocationRecord,
} from "@/lib/export-allocation";
import { advanceExportAllocationStatus } from "@/lib/operations/export-lifecycle";
import { markVesselTrailerDischarged } from "@/lib/operations/mark-vessel-trailer-discharged";
import { runOperationalAlertDetection, type OperationalAlertRow } from "@/lib/operational-alerts";
import {
  buildTrailerOperationalPositionFromContext,
  type TrailerOperationalPosition,
} from "@/lib/operations/trailer-operational-engine";
import { getOperationalStageBadgeClassName } from "@/lib/operations/operational-stages";
import { useOperationalRealtime } from "@/lib/realtime/operational-realtime";
import {
  loadOperationsCommandCentreData,
  type OperationsCommandCentreTrailerRow,
  type OperationsCommandCentreVesselOperationRow,
  type OperationsCommandCentreVesselTrailerRow,
} from "@/lib/reports/report-data";
import { supabase } from "@/lib/supabase";
import { createTrailerActivity } from "@/lib/trailer-activity";
import {
  getVesselInspectionProgressLabel,
  getVesselInspectionProgressState,
} from "@/lib/vessel-operations";

type SectionKey =
  | "expected"
  | "waiting_inspection"
  | "inspection_in_progress"
  | "inspection_complete"
  | "compound"
  | "waiting_collection"
  | "todays_departures"
  | "exceptions";

type KpiKey = "all" | SectionKey | "arrived";

type CardAction =
  | "arrived"
  | "start_inspection"
  | "continue"
  | "move"
  | "delivered_empty"
  | "view";

type CommandCentreCard = {
  id: string;
  trailerId: string | null;
  trailerNumber: string;
  customer: string | null;
  loadStatus: string | null;
  operationalStatus: string;
  compoundPosition: string | null;
  priority: string | null;
  inspectionState: string;
  vesselName: string | null;
  bookingReference: string | null;
  containerNumber: string | null;
  section: SectionKey;
  action: CardAction;
  actionLabel: string;
  vesselOperationId?: string | null;
  vesselTrailerId?: string | null;
  exportAllocationId?: string | null;
  exceptionHref?: string | null;
};

type PanelSelection = {
  trailerId: string | null;
  trailerNumber: string;
  customer: string | null;
  loadStatus: string | null;
  operationalStatus: string;
  compoundPosition: string | null;
  vesselOperationId?: string | null;
  vesselTrailerId?: string | null;
  exportAllocationId?: string | null;
};

type SectionConfig = {
  key: SectionKey;
  title: string;
  description: string;
};

const SECTION_CONFIG: SectionConfig[] = [
  { key: "expected", title: "Expected", description: "Confirmed vessel trailers not yet arrived." },
  { key: "waiting_inspection", title: "Waiting Inspection", description: "Arrived trailers waiting to start inspection." },
  { key: "inspection_in_progress", title: "Inspection In Progress", description: "Boat check started but not completed." },
  { key: "inspection_complete", title: "Inspection Complete", description: "Inspection completed and ready for next movement." },
  { key: "compound", title: "Compound", description: "Trailers currently present in the compound." },
  { key: "waiting_collection", title: "Waiting Collection", description: "Export allocations awaiting delivered empty confirmation." },
  { key: "todays_departures", title: "Today's Departures", description: "Trailers departed today." },
  { key: "exceptions", title: "Exceptions", description: "Active operational alerts requiring attention." },
];

const KPI_CARDS: Array<{ key: KpiKey; label: string }> = [
  { key: "expected", label: "Expected" },
  { key: "arrived", label: "Arrived" },
  { key: "waiting_inspection", label: "Waiting Inspection" },
  { key: "inspection_in_progress", label: "Inspection In Progress" },
  { key: "inspection_complete", label: "Inspection Completed" },
  { key: "compound", label: "Compound" },
  { key: "waiting_collection", label: "Waiting Collection" },
  { key: "todays_departures", label: "Today's Departures" },
  { key: "exceptions", label: "Exceptions" },
];

const normalizeText = (value?: string | null) => (value ?? "").trim().toLowerCase();
const normalizeNumber = (value?: string | null) => (value ?? "").trim().toUpperCase();

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

const getTodayDateKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const titleCase = (value?: string | null) => {
  const text = (value ?? "").trim();
  if (!text) {
    return "-";
  }

  return text
    .split("_")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
};

const isExpectedVesselTrailer = (row: OperationsCommandCentreVesselTrailerRow) => {
  const arrivalStatus = normalizeText(row.arrival_status);
  const status = normalizeText(row.status);
  return (
    arrivalStatus === "expected" ||
    arrivalStatus === "available_for_arrival" ||
    status === "expected" ||
    status === "available_for_arrival"
  );
};

const isCancelledOrNotDischarged = (row: OperationsCommandCentreVesselTrailerRow) => {
  const arrivalStatus = normalizeText(row.arrival_status);
  const status = normalizeText(row.status);
  return (
    arrivalStatus === "cancelled" ||
    arrivalStatus === "not_discharged" ||
    status === "cancelled" ||
    status === "not_discharged"
  );
};

export default function OperationsCommandCentrePage() {
  const [trailers, setTrailers] = useState<OperationsCommandCentreTrailerRow[]>([]);
  const [vesselOperations, setVesselOperations] = useState<OperationsCommandCentreVesselOperationRow[]>([]);
  const [vesselTrailers, setVesselTrailers] = useState<OperationsCommandCentreVesselTrailerRow[]>([]);
  const [exportAllocations, setExportAllocations] = useState<ExportAllocationRecord[]>([]);
  const [alerts, setAlerts] = useState<OperationalAlertRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeKpi, setActiveKpi] = useState<KpiKey>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [panelSelection, setPanelSelection] = useState<PanelSelection | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{ trailerId: string | null; trailerNumber: string | null } | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<SectionKey, boolean>>({
    expected: false,
    waiting_inspection: false,
    inspection_in_progress: false,
    inspection_complete: false,
    compound: false,
    waiting_collection: false,
    todays_departures: false,
    exceptions: false,
  });

  const todayKey = useMemo(() => getTodayDateKey(), []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [centreData, detection] = await Promise.all([
        loadOperationsCommandCentreData(supabase),
        runOperationalAlertDetection(supabase),
      ]);

      setTrailers(centreData.trailers);
      setVesselOperations(centreData.vesselOperations);
      setVesselTrailers(centreData.vesselTrailers);
      setExportAllocations(centreData.exportAllocations.map((row) => normalizeExportAllocationRecord(row)));

      if (detection.ok) {
        setAlerts(detection.data.alerts);
      } else {
        setAlerts([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load command centre data.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useOperationalRealtime(["dashboard"], () => {
    void loadData();
  });

  useEffect(() => {
    if (!success) {
      return;
    }

    const timer = window.setTimeout(() => setSuccess(null), 2500);
    return () => window.clearTimeout(timer);
  }, [success]);

  const trailerById = useMemo(() => {
    const map = new Map<string, OperationsCommandCentreTrailerRow>();
    trailers.forEach((row) => {
      map.set(row.id, row);
    });
    return map;
  }, [trailers]);

  const trailerByNumber = useMemo(() => {
    const map = new Map<string, OperationsCommandCentreTrailerRow>();
    trailers.forEach((row) => {
      const key = normalizeNumber(row.trailer_number);
      if (!key || map.has(key)) {
        return;
      }

      map.set(key, row);
    });
    return map;
  }, [trailers]);

  const vesselOperationById = useMemo(() => {
    const map = new Map<string, OperationsCommandCentreVesselOperationRow>();
    vesselOperations.forEach((row) => map.set(row.id, row));
    return map;
  }, [vesselOperations]);

  const activeExportByTrailerId = useMemo(() => {
    const map = new Map<string, ExportAllocationRecord>();

    exportAllocations.forEach((row) => {
      if (!row.trailer_id) {
        return;
      }

      if (row.status === "completed" || row.status === "cancelled") {
        return;
      }

      const current = map.get(row.trailer_id);
      const currentTs = current ? new Date(current.updated_at ?? current.created_at ?? 0).getTime() : -1;
      const nextTs = new Date(row.updated_at ?? row.created_at ?? 0).getTime();

      if (!current || nextTs >= currentTs) {
        map.set(row.trailer_id, row);
      }
    });

    return map;
  }, [exportAllocations]);

  const operationalPositionsByVesselTrailerId = useMemo(() => {
    const profileMap = new Map<string, TrailerOperationalPosition>();

    vesselTrailers.forEach((vesselTrailer) => {
      const trailer = vesselTrailer.trailer_id ? trailerById.get(vesselTrailer.trailer_id) ?? null : trailerByNumber.get(normalizeNumber(vesselTrailer.trailer_number)) ?? null;
      const trailerNumber = normalizeNumber(vesselTrailer.trailer_number) || normalizeNumber(trailer?.trailer_number) || vesselTrailer.id;

      const contextPosition = buildTrailerOperationalPositionFromContext({
        trailerNumber,
        trailer: trailer as never,
        companyTrailer: null,
        trailerEvents: [],
        vesselOperationTrailers: [vesselTrailer as never],
        vesselOperations: vesselTrailer.vessel_operation_id
          ? [
              {
                ...(vesselOperationById.get(vesselTrailer.vessel_operation_id) ?? { id: vesselTrailer.vessel_operation_id }),
              } as never,
            ]
          : [],
        deliveryBookings: [],
        exportAllocations: trailer?.id ? ((activeExportByTrailerId.get(trailer.id) ? [activeExportByTrailerId.get(trailer.id)] : []) as never[]) : [],
        damages: [],
        temperatures: [],
      });

      profileMap.set(vesselTrailer.id, contextPosition);
    });

    return profileMap;
  }, [activeExportByTrailerId, trailerById, trailerByNumber, vesselOperationById, vesselTrailers]);

  const expectedCards = useMemo<CommandCentreCard[]>(() => {
    return vesselTrailers
      .filter((row) => !isCancelledOrNotDischarged(row) && isExpectedVesselTrailer(row))
      .map((row) => {
        const trailer = row.trailer_id ? trailerById.get(row.trailer_id) ?? null : trailerByNumber.get(normalizeNumber(row.trailer_number)) ?? null;
        const vessel = vesselOperationById.get(row.vessel_operation_id);
        const position = operationalPositionsByVesselTrailerId.get(row.id);

        return {
          id: `expected-${row.id}`,
          trailerId: row.trailer_id ?? trailer?.id ?? null,
          trailerNumber: row.trailer_number ?? trailer?.trailer_number ?? row.id,
          customer: row.customer ?? trailer?.customer ?? null,
          loadStatus: row.load_status ?? trailer?.load_status ?? null,
          operationalStatus: position?.stageLabel ?? "Expected",
          compoundPosition: trailer?.compound_position ?? row.assigned_position ?? null,
          priority: row.priority_level ?? null,
          inspectionState: getVesselInspectionProgressLabel(getVesselInspectionProgressState(row as never)),
          vesselName: vessel?.vessel_name ?? null,
          bookingReference: row.booking_reference ?? null,
          containerNumber: trailer?.container_number ?? null,
          section: "expected",
          action: "arrived",
          actionLabel: "Arrived",
          vesselOperationId: row.vessel_operation_id,
          vesselTrailerId: row.id,
        };
      });
  }, [operationalPositionsByVesselTrailerId, trailerById, trailerByNumber, vesselOperationById, vesselTrailers]);

  const waitingInspectionCards = useMemo<CommandCentreCard[]>(() => {
    return vesselTrailers
      .filter((row) => {
        if (isCancelledOrNotDischarged(row)) {
          return false;
        }

        const arrivalStatus = normalizeText(row.arrival_status);
        const arrived = arrivalStatus === "arrived" || normalizeText(row.status) === "arrived";
        return arrived && !row.inspection_started_at && !row.inspection_completed_at;
      })
      .map((row) => {
        const trailer = row.trailer_id ? trailerById.get(row.trailer_id) ?? null : trailerByNumber.get(normalizeNumber(row.trailer_number)) ?? null;
        const vessel = vesselOperationById.get(row.vessel_operation_id);
        const position = operationalPositionsByVesselTrailerId.get(row.id);

        return {
          id: `waiting-inspection-${row.id}`,
          trailerId: row.trailer_id ?? trailer?.id ?? null,
          trailerNumber: row.trailer_number ?? trailer?.trailer_number ?? row.id,
          customer: row.customer ?? trailer?.customer ?? null,
          loadStatus: row.load_status ?? trailer?.load_status ?? null,
          operationalStatus: position?.stageLabel ?? "Arrived",
          compoundPosition: trailer?.compound_position ?? row.assigned_position ?? null,
          priority: row.priority_level ?? null,
          inspectionState: "Not Started",
          vesselName: vessel?.vessel_name ?? null,
          bookingReference: row.booking_reference ?? null,
          containerNumber: trailer?.container_number ?? null,
          section: "waiting_inspection",
          action: "start_inspection",
          actionLabel: "Start Inspection",
          vesselOperationId: row.vessel_operation_id,
          vesselTrailerId: row.id,
        };
      });
  }, [operationalPositionsByVesselTrailerId, trailerById, trailerByNumber, vesselOperationById, vesselTrailers]);

  const inspectionInProgressCards = useMemo<CommandCentreCard[]>(() => {
    return vesselTrailers
      .filter((row) => {
        if (isCancelledOrNotDischarged(row)) {
          return false;
        }

        return Boolean(row.inspection_started_at) && !row.inspection_completed_at;
      })
      .map((row) => {
        const trailer = row.trailer_id ? trailerById.get(row.trailer_id) ?? null : trailerByNumber.get(normalizeNumber(row.trailer_number)) ?? null;
        const vessel = vesselOperationById.get(row.vessel_operation_id);
        const position = operationalPositionsByVesselTrailerId.get(row.id);

        return {
          id: `inspection-progress-${row.id}`,
          trailerId: row.trailer_id ?? trailer?.id ?? null,
          trailerNumber: row.trailer_number ?? trailer?.trailer_number ?? row.id,
          customer: row.customer ?? trailer?.customer ?? null,
          loadStatus: row.load_status ?? trailer?.load_status ?? null,
          operationalStatus: position?.stageLabel ?? "Inspection",
          compoundPosition: trailer?.compound_position ?? row.assigned_position ?? null,
          priority: row.priority_level ?? null,
          inspectionState: "In Progress",
          vesselName: vessel?.vessel_name ?? null,
          bookingReference: row.booking_reference ?? null,
          containerNumber: trailer?.container_number ?? null,
          section: "inspection_in_progress",
          action: "continue",
          actionLabel: "Continue",
          vesselOperationId: row.vessel_operation_id,
          vesselTrailerId: row.id,
        };
      });
  }, [operationalPositionsByVesselTrailerId, trailerById, trailerByNumber, vesselOperationById, vesselTrailers]);

  const inspectionCompleteCards = useMemo<CommandCentreCard[]>(() => {
    return vesselTrailers
      .filter((row) => {
        if (isCancelledOrNotDischarged(row)) {
          return false;
        }

        return Boolean(row.inspection_completed_at) || normalizeText(row.status) === "inspected";
      })
      .map((row) => {
        const trailer = row.trailer_id ? trailerById.get(row.trailer_id) ?? null : trailerByNumber.get(normalizeNumber(row.trailer_number)) ?? null;
        const vessel = vesselOperationById.get(row.vessel_operation_id);
        const position = operationalPositionsByVesselTrailerId.get(row.id);

        return {
          id: `inspection-complete-${row.id}`,
          trailerId: row.trailer_id ?? trailer?.id ?? null,
          trailerNumber: row.trailer_number ?? trailer?.trailer_number ?? row.id,
          customer: row.customer ?? trailer?.customer ?? null,
          loadStatus: row.load_status ?? trailer?.load_status ?? null,
          operationalStatus: position?.stageLabel ?? "Inspection Completed",
          compoundPosition: trailer?.compound_position ?? row.assigned_position ?? null,
          priority: row.priority_level ?? null,
          inspectionState: "Completed",
          vesselName: vessel?.vessel_name ?? null,
          bookingReference: row.booking_reference ?? null,
          containerNumber: trailer?.container_number ?? null,
          section: "inspection_complete",
          action: "view",
          actionLabel: "View",
          vesselOperationId: row.vessel_operation_id,
          vesselTrailerId: row.id,
        };
      });
  }, [operationalPositionsByVesselTrailerId, trailerById, trailerByNumber, vesselOperationById, vesselTrailers]);

  const compoundCards = useMemo<CommandCentreCard[]>(() => {
    return trailers
      .filter((row) => {
        const activeExportStatus = row.id ? activeExportByTrailerId.get(row.id)?.status : undefined;
        return isTrailerPresentInCompoundInventory(row as never, activeExportStatus);
      })
      .map((row) => {
        const linkedVesselTrailer = vesselTrailers.find((item) => item.trailer_id === row.id);
        const position = linkedVesselTrailer ? operationalPositionsByVesselTrailerId.get(linkedVesselTrailer.id) : null;

        return {
          id: `compound-${row.id}`,
          trailerId: row.id,
          trailerNumber: row.trailer_number ?? row.id,
          customer: row.customer ?? null,
          loadStatus: row.load_status ?? null,
          operationalStatus: position?.stageLabel ?? titleCase(row.operational_status),
          compoundPosition: row.compound_position ?? null,
          priority: linkedVesselTrailer?.priority_level ?? null,
          inspectionState: linkedVesselTrailer ? getVesselInspectionProgressLabel(getVesselInspectionProgressState(linkedVesselTrailer as never)) : "-",
          vesselName: linkedVesselTrailer ? vesselOperationById.get(linkedVesselTrailer.vessel_operation_id)?.vessel_name ?? null : null,
          bookingReference: linkedVesselTrailer?.booking_reference ?? null,
          containerNumber: row.container_number ?? null,
          section: "compound",
          action: "move",
          actionLabel: "Move",
          vesselOperationId: linkedVesselTrailer?.vessel_operation_id ?? null,
          vesselTrailerId: linkedVesselTrailer?.id ?? null,
        };
      });
  }, [activeExportByTrailerId, operationalPositionsByVesselTrailerId, trailers, vesselOperationById, vesselTrailers]);

  const waitingCollectionCards = useMemo<CommandCentreCard[]>(() => {
    return exportAllocations
      .filter((row) => row.status === "allocated")
      .map((row) => {
        const trailer = row.trailer_id ? trailerById.get(row.trailer_id) ?? null : trailerByNumber.get(normalizeNumber(row.trailer_number)) ?? null;
        const linkedVesselTrailer = trailer?.id ? vesselTrailers.find((item) => item.trailer_id === trailer.id) : null;

        return {
          id: `waiting-collection-${row.id}`,
          trailerId: row.trailer_id ?? trailer?.id ?? null,
          trailerNumber: row.trailer_number ?? trailer?.trailer_number ?? row.id,
          customer: row.customer ?? trailer?.customer ?? null,
          loadStatus: trailer?.load_status ?? row.load_type ?? null,
          operationalStatus: titleCase(row.status),
          compoundPosition: trailer?.compound_position ?? null,
          priority: row.priority,
          inspectionState: linkedVesselTrailer ? getVesselInspectionProgressLabel(getVesselInspectionProgressState(linkedVesselTrailer as never)) : "-",
          vesselName: linkedVesselTrailer ? vesselOperationById.get(linkedVesselTrailer.vessel_operation_id)?.vessel_name ?? null : null,
          bookingReference: row.booking_reference ?? null,
          containerNumber: trailer?.container_number ?? null,
          section: "waiting_collection",
          action: "delivered_empty",
          actionLabel: "Delivered Empty",
          exportAllocationId: row.id,
          vesselOperationId: linkedVesselTrailer?.vessel_operation_id ?? null,
          vesselTrailerId: linkedVesselTrailer?.id ?? null,
        };
      });
  }, [exportAllocations, trailerById, trailerByNumber, vesselOperationById, vesselTrailers]);

  const departureCards = useMemo<CommandCentreCard[]>(() => {
    return trailers
      .filter((row) => getDateKey(row.departure_date) === todayKey)
      .map((row) => {
        const linkedVesselTrailer = vesselTrailers.find((item) => item.trailer_id === row.id);
        return {
          id: `departure-${row.id}`,
          trailerId: row.id,
          trailerNumber: row.trailer_number ?? row.id,
          customer: row.customer ?? null,
          loadStatus: row.load_status ?? null,
          operationalStatus: "Departed",
          compoundPosition: row.compound_position ?? null,
          priority: linkedVesselTrailer?.priority_level ?? null,
          inspectionState: linkedVesselTrailer ? getVesselInspectionProgressLabel(getVesselInspectionProgressState(linkedVesselTrailer as never)) : "-",
          vesselName: linkedVesselTrailer ? vesselOperationById.get(linkedVesselTrailer.vessel_operation_id)?.vessel_name ?? null : null,
          bookingReference: linkedVesselTrailer?.booking_reference ?? null,
          containerNumber: row.container_number ?? null,
          section: "todays_departures",
          action: "view",
          actionLabel: "View",
          vesselOperationId: linkedVesselTrailer?.vessel_operation_id ?? null,
          vesselTrailerId: linkedVesselTrailer?.id ?? null,
        };
      });
  }, [todayKey, trailers, vesselOperationById, vesselTrailers]);

  const exceptionCards = useMemo<CommandCentreCard[]>(() => {
    return alerts.map((alert) => {
      const trailer = alert.trailer_id ? trailerById.get(alert.trailer_id) ?? null : trailerByNumber.get(normalizeNumber(alert.trailer_number)) ?? null;
      const linkedVesselTrailer = trailer?.id ? vesselTrailers.find((item) => item.trailer_id === trailer.id) : null;
      const severity = titleCase(alert.severity);
      const metadata = alert.metadata && typeof alert.metadata === "object" && !Array.isArray(alert.metadata)
        ? (alert.metadata as Record<string, unknown>)
        : null;
      const stockCheckId = typeof metadata?.stock_check_id === "string" ? metadata.stock_check_id : null;
      const exceptionHref = alert.source_module === "stock_check"
        ? `/dashboard/compound/review-discrepancies${stockCheckId ? `?stockCheckId=${stockCheckId}` : ""}`
        : null;

      return {
        id: `exception-${alert.id}`,
        trailerId: alert.trailer_id ?? trailer?.id ?? null,
        trailerNumber: alert.trailer_number ?? trailer?.trailer_number ?? "Unlinked trailer",
        customer: trailer?.customer ?? null,
        loadStatus: trailer?.load_status ?? null,
        operationalStatus: `${severity}: ${alert.title}`,
        compoundPosition: trailer?.compound_position ?? null,
        priority: linkedVesselTrailer?.priority_level ?? null,
        inspectionState: linkedVesselTrailer ? getVesselInspectionProgressLabel(getVesselInspectionProgressState(linkedVesselTrailer as never)) : "-",
        vesselName: linkedVesselTrailer ? vesselOperationById.get(linkedVesselTrailer.vessel_operation_id)?.vessel_name ?? null : null,
        bookingReference: linkedVesselTrailer?.booking_reference ?? null,
        containerNumber: trailer?.container_number ?? null,
        section: "exceptions",
        action: "view",
        actionLabel: "Open",
        vesselOperationId: linkedVesselTrailer?.vessel_operation_id ?? null,
        vesselTrailerId: linkedVesselTrailer?.id ?? null,
          exceptionHref,
      };
    });
  }, [alerts, trailerById, trailerByNumber, vesselOperationById, vesselTrailers]);

  const sectionCards = useMemo<Record<SectionKey, CommandCentreCard[]>>(
    () => ({
      expected: expectedCards,
      waiting_inspection: waitingInspectionCards,
      inspection_in_progress: inspectionInProgressCards,
      inspection_complete: inspectionCompleteCards,
      compound: compoundCards,
      waiting_collection: waitingCollectionCards,
      todays_departures: departureCards,
      exceptions: exceptionCards,
    }),
    [
      compoundCards,
      departureCards,
      exceptionCards,
      expectedCards,
      inspectionCompleteCards,
      inspectionInProgressCards,
      waitingCollectionCards,
      waitingInspectionCards,
    ],
  );

  const kpiCounts = useMemo<Record<KpiKey, number>>(
    () => ({
      all:
        expectedCards.length +
        waitingInspectionCards.length +
        inspectionInProgressCards.length +
        inspectionCompleteCards.length +
        compoundCards.length +
        waitingCollectionCards.length +
        departureCards.length +
        exceptionCards.length,
      expected: expectedCards.length,
      arrived: waitingInspectionCards.length + inspectionInProgressCards.length + inspectionCompleteCards.length,
      waiting_inspection: waitingInspectionCards.length,
      inspection_in_progress: inspectionInProgressCards.length,
      inspection_complete: inspectionCompleteCards.length,
      compound: compoundCards.length,
      waiting_collection: waitingCollectionCards.length,
      todays_departures: departureCards.length,
      exceptions: exceptionCards.length,
    }),
    [
      compoundCards.length,
      departureCards.length,
      exceptionCards.length,
      expectedCards.length,
      inspectionCompleteCards.length,
      inspectionInProgressCards.length,
      waitingCollectionCards.length,
      waitingInspectionCards.length,
    ],
  );

  const matchesSearch = useCallback(
    (card: CommandCentreCard) => {
      const term = normalizeText(searchTerm);
      if (!term) {
        return true;
      }

      const fields = [
        card.trailerNumber,
        card.customer,
        card.bookingReference,
        card.containerNumber,
        card.vesselName,
        card.compoundPosition,
      ]
        .filter(Boolean)
        .map((value) => normalizeText(value));

      return fields.some((value) => value.includes(term));
    },
    [searchTerm],
  );

  const visibleSectionKeys = useMemo(() => {
    if (activeKpi === "all") {
      return SECTION_CONFIG.map((item) => item.key);
    }

    if (activeKpi === "arrived") {
      return ["waiting_inspection", "inspection_in_progress", "inspection_complete"] as SectionKey[];
    }

    return [activeKpi as SectionKey];
  }, [activeKpi]);

  const filteredSectionCards = useMemo(() => {
    const result: Record<SectionKey, CommandCentreCard[]> = {
      expected: [],
      waiting_inspection: [],
      inspection_in_progress: [],
      inspection_complete: [],
      compound: [],
      waiting_collection: [],
      todays_departures: [],
      exceptions: [],
    };

    SECTION_CONFIG.forEach((section) => {
      if (!visibleSectionKeys.includes(section.key)) {
        result[section.key] = [];
        return;
      }

      result[section.key] = sectionCards[section.key].filter(matchesSearch);
    });

    return result;
  }, [matchesSearch, sectionCards, visibleSectionKeys]);

  const searchResults = useMemo(() => {
    const term = normalizeText(searchTerm);
    if (!term) {
      return [] as CommandCentreCard[];
    }

    const source = [
      ...expectedCards,
      ...waitingInspectionCards,
      ...inspectionInProgressCards,
      ...inspectionCompleteCards,
      ...compoundCards,
      ...waitingCollectionCards,
      ...departureCards,
      ...exceptionCards,
    ];

    const dedupe = new Map<string, CommandCentreCard>();
    source.forEach((card) => {
      if (!matchesSearch(card)) {
        return;
      }

      const key = `${card.trailerId ?? "no-id"}-${normalizeNumber(card.trailerNumber)}`;
      if (!dedupe.has(key)) {
        dedupe.set(key, card);
      }
    });

    return Array.from(dedupe.values()).slice(0, 12);
  }, [
    compoundCards,
    departureCards,
    exceptionCards,
    expectedCards,
    inspectionCompleteCards,
    inspectionInProgressCards,
    matchesSearch,
    searchTerm,
    waitingCollectionCards,
    waitingInspectionCards,
  ]);

  const toggleSection = (key: SectionKey) => {
    setCollapsedSections((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const openPanelForCard = useCallback((card: CommandCentreCard) => {
    setPanelSelection({
      trailerId: card.trailerId,
      trailerNumber: card.trailerNumber,
      customer: card.customer,
      loadStatus: card.loadStatus,
      operationalStatus: card.operationalStatus,
      compoundPosition: card.compoundPosition,
      vesselOperationId: card.vesselOperationId ?? null,
      vesselTrailerId: card.vesselTrailerId ?? null,
      exportAllocationId: card.exportAllocationId ?? null,
    });
  }, []);

  const markArrived = useCallback(
    async (card: CommandCentreCard) => {
      if (!card.vesselTrailerId) {
        openPanelForCard(card);
        return;
      }

      setBusyId(card.id);
      setError(null);

      try {
        const nowIso = new Date().toISOString();
        const discharged = await markVesselTrailerDischarged({
          supabase,
          vesselTrailerId: card.vesselTrailerId,
          operatorName: "TrailerHub User",
          dischargedAt: nowIso,
          sourceModule: "operations",
          eventDescription: "Trailer discharged from vessel from Operations Command Centre.",
        });

        if (discharged.alreadyDischarged) {
          throw new Error("Arrival is no longer available for this trailer.");
        }

        const dischargedAt = discharged.dischargedAt ?? nowIso;

        setVesselTrailers((rows) =>
          rows.map((row) =>
            row.id === card.vesselTrailerId
              ? {
                  ...row,
                  status: "arrived",
                  arrival_status: "arrived",
                  discharged_at: dischargedAt,
                  arrived_at: row.arrived_at ?? dischargedAt,
                  arrival_confirmed_at: row.arrival_confirmed_at ?? dischargedAt,
                  updated_at: nowIso,
                }
              : row,
          ),
        );
        setSuccess(`${card.trailerNumber} marked as arrived.`);
      } catch (markError) {
        setError(markError instanceof Error ? markError.message : "Unable to mark trailer as arrived.");
      } finally {
        setBusyId(null);
      }
    },
    [openPanelForCard],
  );

  const setDeliveredEmpty = useCallback(async (card: CommandCentreCard) => {
    if (!card.exportAllocationId) {
      openPanelForCard(card);
      return;
    }

    const allocation = exportAllocations.find((row) => row.id === card.exportAllocationId);
    if (!allocation) {
      setError("Allocation not found.");
      return;
    }

    if (allocation.status !== "allocated") {
      openPanelForCard(card);
      return;
    }

    setBusyId(card.id);
    setError(null);

    try {
      const result = await advanceExportAllocationStatus(supabase, {
        allocation,
        sourceModule: "operations",
      });

      if (result.nextStatus !== "delivered_empty") {
        throw new Error("Unable to set allocation to delivered empty.");
      }

      setExportAllocations((rows) =>
        rows.map((row) =>
          row.id === allocation.id
            ? {
                ...row,
                status: "delivered_empty",
                delivered_empty_at: result.occurredAt,
                updated_at: result.occurredAt,
              }
            : row,
        ),
      );

      setSuccess(`${card.trailerNumber} marked as Delivered Empty.`);
    } catch (advanceError) {
      setError(advanceError instanceof Error ? advanceError.message : "Unable to advance export status.");
    } finally {
      setBusyId(null);
    }
  }, [exportAllocations, openPanelForCard]);

  const moveTrailer = useCallback(
    async (trailerId: string, trailerNumber: string, nextPosition: string) => {
      const current = trailerById.get(trailerId);
      if (!current) {
        throw new Error("Trailer not found.");
      }

      const { error: updateError } = await supabase
        .from("trailers")
        .update({ compound_position: nextPosition })
        .eq("id", trailerId)
        .select("id")
        .single();

      if (updateError) {
        throw new Error(updateError.message || "Unable to move trailer.");
      }

      const nowIso = new Date().toISOString();
      await createTrailerActivity({
        trailerId,
        trailerNumber,
        eventType: "compound_position_changed",
        eventTitle: "Position updated",
        eventDescription: `Compound position changed to ${nextPosition}.`,
        sourceModule: "operations",
        sourceRecordId: trailerId,
        previousStatus: current.operational_status ?? null,
        newStatus: current.operational_status ?? null,
        previousCompoundPosition: current.compound_position,
        newCompoundPosition: nextPosition,
        createdAt: nowIso,
      });

      setTrailers((rows) => rows.map((row) => (row.id === trailerId ? { ...row, compound_position: nextPosition } : row)));
      setSuccess(`${trailerNumber} moved to ${nextPosition}.`);
    },
    [trailerById],
  );

  const togglePriority = useCallback(async () => {
    if (!panelSelection?.vesselTrailerId) {
      return;
    }

    const vesselTrailer = vesselTrailers.find((row) => row.id === panelSelection.vesselTrailerId);
    if (!vesselTrailer) {
      return;
    }

    const nextPriority = vesselTrailer.priority_level === "priority" ? "normal" : "priority";

    setBusyId(panelSelection.vesselTrailerId);
    setError(null);

    try {
      const { error: updateError } = await supabase
        .from("vessel_operation_trailers")
        .update({ priority_level: nextPriority })
        .eq("id", vesselTrailer.id)
        .select("id")
        .single();

      if (updateError) {
        throw new Error(updateError.message || "Unable to update priority.");
      }

      setVesselTrailers((rows) => rows.map((row) => (row.id === vesselTrailer.id ? { ...row, priority_level: nextPriority } : row)));
      setSuccess(`${panelSelection.trailerNumber} priority updated.`);
    } catch (priorityError) {
      setError(priorityError instanceof Error ? priorityError.message : "Unable to update priority.");
    } finally {
      setBusyId(null);
    }
  }, [panelSelection, vesselTrailers]);

  const onPrimaryAction = (card: CommandCentreCard) => {
    switch (card.action) {
      case "arrived":
        void markArrived(card);
        return;
      case "delivered_empty":
        void setDeliveredEmpty(card);
        return;
      case "move":
      case "start_inspection":
      case "continue":
      case "view":
      default:
        openPanelForCard(card);
        return;
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(34,211,238,0.17),_transparent_35%),linear-gradient(160deg,_#020617_0%,_#0f172a_52%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="rounded-3xl border border-white/10 bg-slate-900/75 p-5 shadow-2xl shadow-black/25 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Operations Command Centre</h1>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">Unified screen for vessel, yard, export, departures, and exceptions.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAssistantOpen(true)}
                className="rounded-2xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/25"
              >
                AI Assistant
              </button>
              <Link href="/dashboard/operations" className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Operations Board</Link>
              <Link href="/dashboard/vessel-operations" className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Vessel Operations</Link>
              <Link href="/dashboard/export-operations" className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Export Operations</Link>
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {KPI_CARDS.map((kpi) => {
            const active = activeKpi === kpi.key;
            return (
              <button
                key={kpi.key}
                type="button"
                onClick={() => setActiveKpi((current) => (current === kpi.key ? "all" : kpi.key))}
                className={`rounded-2xl border p-4 text-left shadow-lg transition ${
                  active
                    ? "border-cyan-400/70 bg-cyan-500/20"
                    : "border-white/10 bg-slate-900/70 hover:border-cyan-400/40"
                }`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.23em] text-slate-400">{kpi.label}</p>
                <p className="mt-2 text-3xl font-bold text-white">{kpiCounts[kpi.key]}</p>
              </button>
            );
          })}
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/75 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
          <label className="block text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Global Search</label>
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Trailer, customer, booking reference, container, vessel, position"
            className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-slate-950/85 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400/50"
          />

          {searchTerm.trim() ? (
            <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/65 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Search Results</p>
              {searchResults.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">No matching trailers found.</p>
              ) : (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {searchResults.map((result) => (
                    <button
                      key={`search-${result.id}`}
                      type="button"
                      onClick={() => openPanelForCard(result)}
                      className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                    >
                      <p className="font-semibold text-white">{result.trailerNumber}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {result.customer ?? "No customer"} | {result.vesselName ?? "No vessel"} | {result.compoundPosition ?? "No position"}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </section>

        {isLoading ? (
          <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-center text-slate-400">Loading command centre data...</section>
        ) : (
          <div className="space-y-4">
            {SECTION_CONFIG.map((section) => {
              const cards = filteredSectionCards[section.key];
              if (!visibleSectionKeys.includes(section.key)) {
                return null;
              }

              const collapsed = collapsedSections[section.key];

              return (
                <section key={section.key} className="rounded-3xl border border-white/10 bg-slate-900/72 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-white">{section.title}</h2>
                      <p className="mt-1 text-sm text-slate-400">{section.description}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-1 text-xs font-semibold text-slate-300">{cards.length}</span>
                      <button
                        type="button"
                        onClick={() => toggleSection(section.key)}
                        className="rounded-xl border border-white/10 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                      >
                        {collapsed ? "Expand" : "Collapse"}
                      </button>
                    </div>
                  </div>

                  {!collapsed ? (
                    cards.length === 0 ? (
                      <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-sm text-slate-400">No trailers in this section.</div>
                    ) : (
                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {cards.map((card) => {
                          const stageClass = card.section === "exceptions"
                            ? "border-rose-500/35 bg-rose-500/12 text-rose-100"
                            : getOperationalStageBadgeClassName(normalizeText(card.operationalStatus).replace(/\s+/g, "_") as never);

                          return (
                            <article key={card.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                              <button type="button" onClick={() => openPanelForCard(card)} className="w-full text-left">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-lg font-semibold text-white">{card.trailerNumber}</p>
                                    <p className="mt-1 text-sm text-slate-400">{card.customer ?? "No customer"}</p>
                                  </div>
                                  <span className="rounded-full border border-white/10 bg-slate-900/70 px-2.5 py-1 text-[11px] font-semibold text-slate-200">{card.priority ?? "normal"}</span>
                                </div>
                              </button>

                              <div className="mt-3 space-y-1 text-xs text-slate-400">
                                <p>Load: {card.loadStatus ?? "-"}</p>
                                <p>Status: {card.operationalStatus}</p>
                                <p>Position: {card.compoundPosition ?? "-"}</p>
                                <p>Inspection: {card.inspectionState}</p>
                                <p>Vessel: {card.vesselName ?? "-"}</p>
                                <p>Booking: {card.bookingReference ?? "-"}</p>
                              </div>

                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => onPrimaryAction(card)}
                                  disabled={busyId === card.id}
                                  className="rounded-xl bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                                >
                                  {busyId === card.id ? "Working..." : card.actionLabel}
                                </button>

                                <details className="rounded-xl border border-white/10 bg-slate-900/80">
                                  <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-white marker:content-none">More</summary>
                                  <div className="flex flex-col gap-2 border-t border-white/10 p-2">
                                    <button
                                      type="button"
                                      onClick={() => openPanelForCard(card)}
                                      className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-left text-xs font-semibold text-white hover:bg-slate-700"
                                    >
                                      Open Workspace
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setHistoryTarget({
                                          trailerId: card.trailerId,
                                          trailerNumber: card.trailerNumber,
                                        })
                                      }
                                      className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-left text-xs font-semibold text-white hover:bg-slate-700"
                                    >
                                      History
                                    </button>
                                    {card.exportAllocationId ? (
                                      <Link
                                        href={`/dashboard/export-operations/${card.exportAllocationId}`}
                                        className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-left text-xs font-semibold text-white hover:bg-slate-700"
                                      >
                                        View Allocation
                                      </Link>
                                    ) : null}
                                    {card.exceptionHref ? (
                                      <Link
                                        href={card.exceptionHref}
                                        className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-left text-xs font-semibold text-white hover:bg-slate-700"
                                      >
                                        Open Reconciliation
                                      </Link>
                                    ) : null}
                                    {card.vesselOperationId && card.vesselTrailerId ? (
                                      <Link
                                        href={`/dashboard/vessel-operations/${card.vesselOperationId}/boat-check/${card.vesselTrailerId}`}
                                        className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-left text-xs font-semibold text-white hover:bg-slate-700"
                                      >
                                        Open Inspection
                                      </Link>
                                    ) : null}
                                  </div>
                                </details>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {success ? <SuccessToast message={success} onClose={() => setSuccess(null)} /> : null}

      <TrailerHistoryDrawer
        isOpen={Boolean(historyTarget)}
        trailerId={historyTarget?.trailerId}
        trailerNumber={historyTarget?.trailerNumber}
        onClose={() => setHistoryTarget(null)}
      />

      {panelSelection?.vesselOperationId ? (
        <div className="fixed bottom-5 left-5 z-[72] flex flex-col gap-2 rounded-3xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Selected Vessel Operation</p>
          <p className="text-sm font-semibold text-slate-950">{panelSelection.vesselOperationId}</p>
          <Link
            href={`/dashboard/vessel-operations/${panelSelection.vesselOperationId}/summary`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-2xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-500/25"
          >
            Generate AI Report
          </Link>
        </div>
      ) : null}

      <TrailerOperationsPanel
        isOpen={Boolean(panelSelection)}
        onClose={() => setPanelSelection(null)}
        moduleLabel="Operations Command Centre"
        trailer={
          panelSelection
            ? {
                id: panelSelection.trailerId ?? panelSelection.trailerNumber,
                trailerId: panelSelection.trailerId,
                trailerNumber: panelSelection.trailerNumber,
                customer: panelSelection.customer,
                loadStatus: panelSelection.loadStatus,
                status: panelSelection.operationalStatus,
                compoundPosition: panelSelection.compoundPosition,
              }
            : null
        }
        inspectionHref={
          panelSelection?.vesselOperationId && panelSelection.vesselTrailerId
            ? `/dashboard/vessel-operations/${panelSelection.vesselOperationId}/boat-check/${panelSelection.vesselTrailerId}`
            : panelSelection?.trailerId
              ? `/dashboard/trailers/${panelSelection.trailerId}`
              : null
        }
        photosHref={panelSelection?.trailerId ? `/dashboard/trailers/${panelSelection.trailerId}` : null}
        damageHref={panelSelection?.trailerId ? `/dashboard/trailers/${panelSelection.trailerId}` : null}
        onArrived={
          panelSelection?.vesselTrailerId
            ? async () => {
                const card = expectedCards.find((item) => item.vesselTrailerId === panelSelection.vesselTrailerId);
                if (card) {
                  await markArrived(card);
                }
              }
            : undefined
        }
        onDeliveredEmpty={
          panelSelection?.exportAllocationId
            ? async () => {
                const card = waitingCollectionCards.find((item) => item.exportAllocationId === panelSelection.exportAllocationId);
                if (card) {
                  await setDeliveredEmpty(card);
                }
              }
            : undefined
        }
        onTogglePriority={panelSelection?.vesselTrailerId ? () => void togglePriority() : undefined}
        onOpenHistory={
          panelSelection
            ? () =>
                setHistoryTarget({
                  trailerId: panelSelection.trailerId,
                  trailerNumber: panelSelection.trailerNumber,
                })
            : undefined
        }
        onMove={
          panelSelection?.trailerId
            ? (nextPosition) => moveTrailer(panelSelection.trailerId as string, panelSelection.trailerNumber, nextPosition)
            : undefined
        }
        moveLabel="Move"
        isBusy={Boolean(busyId)}
      />

      <OperationsAssistantDrawer
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        context={{
          pathname: "/dashboard/operations-command-centre",
          selectedCompoundFilter: activeKpi,
          openedTrailerId: panelSelection?.trailerId ?? undefined,
          openedTrailerNumber: panelSelection?.trailerNumber,
        }}
      />
    </main>
  );
}
