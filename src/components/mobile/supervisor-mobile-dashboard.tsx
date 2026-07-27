"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Bot,
  Clock3,
  ClipboardCheck,
  ExternalLink,
  Home,
  Layers3,
  MenuSquare,
  MoveRight,
  PackageSearch,
  ScanSearch,
  Search,
  ShieldAlert,
  Ship,
  SignalHigh,
  Sparkles,
  Truck,
  Wifi,
  WifiOff,
} from "lucide-react";
import { OperationsAssistantDrawer } from "@/components/ai/operations-assistant-drawer";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { usePwa } from "@/components/pwa/pwa-provider";
import { PwaStatusCard } from "@/components/pwa/pwa-status-card";
import {
  MobileInspectionPanel,
  type MobileInspectionProgress,
} from "@/components/mobile/mobile-inspection-panel";
import { VoiceOperationsPanel } from "@/components/mobile/voice-operations-panel";
import { canAccessModule, canPerformAction } from "@/lib/auth/permissions";
import { toRoleLabel, type RoleKey } from "@/lib/auth/roles";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { calculateCollectionAging } from "@/lib/collection-aging";
import type { Database } from "@/lib/database.types";
import {
  buildActiveExportStatusByTrailerId,
  isExportAllocationActive,
  isTrailerEligibleForCompoundViews,
  isTrailerPresentInCompoundInventory,
  normalizeExportAllocationRecord,
  type ExportAllocationRecord,
} from "@/lib/export-allocation";
import {
  createMobileActionQueueItem,
  classifyActionFailure,
  getMaxRetryCount,
  getRetryBackoffMs,
  loadMobileActionQueue,
  saveMobileActionQueue,
  updateQueuedAction,
} from "@/lib/mobile/mobile-action-queue";
import {
  getMobileActionLabel,
  getMobileActionDedupeKey,
  mobileActionRequestSchema,
  type MobileActionQueueItem,
  type MobileActionRequest,
  type MobileActionType,
} from "@/lib/mobile/mobile-actions";
import { useOperationalRealtime } from "@/lib/realtime/operational-realtime";
import { getTemperatureToleranceSettingsFromStorage, isTemperatureOutOfRange } from "@/lib/temperature-tolerance";
import { getTrailerActivity, type TrailerActivityRow } from "@/lib/trailer-activity";
import { getTrailerCurrentLocationLabel } from "@/lib/trailer-location";
import {
  normalizeTrailerNumber,
  resolveExpectedFrontTemperature,
  resolveExpectedRearTemperature,
} from "@/lib/vessel-operations";
import { supabase } from "@/lib/supabase";
import { type VoiceActionIntentName, type VoiceEntities } from "@/lib/voice/types";
import { getSessionToken } from "@/lib/voice/session";

type TrailerRow = Database["public"]["Tables"]["trailers"]["Row"];
type DeliveryBookingRow = Database["public"]["Tables"]["delivery_bookings"]["Row"];
type VesselTrailerRow = Database["public"]["Tables"]["vessel_operation_trailers"]["Row"];

type MobileTabKey = "home" | "operations" | "compound" | "search" | "more";

type CompoundSortKey = "position" | "trailer_number" | "customer";

type MobileKpis = {
  inCompound: number;
  arrivalsToday: number;
  waitingCollectionOverdue: number;
  pendingInspection: number;
  temperatureAlerts: number;
  damageAlerts: number;
  activeExports: number;
};

type MobileTrailerCard = {
  id: string;
  trailerNumber: string;
  customer: string;
  loadStatus: string;
  operationalStatus: string;
  compoundPosition: string;
  currentLocation: string;
  hasAlerts: boolean;
  isLocal: boolean;
};

type MobileOperationCard = {
  id: string;
  title: string;
  detail: string;
  trailerNumber?: string | null;
  vesselTrailerId?: string | null;
  actionType?: MobileActionType;
  actionPayload?: MobileActionRequest["payload"];
  actionLabel: string;
  severity: "high" | "medium" | "low";
};

type MobileVesselTrailerCard = {
  vesselTrailerId: string;
  vesselOperationId: string;
  trailerId: string | null;
  trailerNumber: string;
  arrivalStatus: string | null;
  status: string | null;
  inspectionStartedAt: string | null;
  inspectionCompletedAt: string | null;
  expectedFrontTemperature: number | null;
  expectedRearTemperature: number | null;
  expectedTemperatureUnit: string | null;
  hasDamage: boolean;
  hasTemperatureAlert: boolean;
};

type MobileSyncLog = {
  id: string;
  label: string;
  resolvedAt: string;
  status: "completed" | "failed" | "conflict" | "cancelled";
  detail: string;
};

const emptyKpis: MobileKpis = {
  inCompound: 0,
  arrivalsToday: 0,
  waitingCollectionOverdue: 0,
  pendingInspection: 0,
  temperatureAlerts: 0,
  damageAlerts: 0,
  activeExports: 0,
};

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const toDateKey = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
};

const todayKey = () => new Date().toISOString().slice(0, 10);

const MOBILE_UI_STATE_KEY = "trailerhub.mobile.ui-state.v1";

type MobileUiState = {
  activeTab?: MobileTabKey;
  searchQuery?: string;
  selectedTrailerId?: string | null;
  compoundFilter?: string;
  compoundSort?: CompoundSortKey;
  scrollByTab?: Partial<Record<MobileTabKey, number>>;
};

const isMobileTabKey = (value: unknown): value is MobileTabKey => {
  return value === "home" || value === "operations" || value === "compound" || value === "search" || value === "more";
};

const isCompoundSortKey = (value: unknown): value is CompoundSortKey => {
  return value === "position" || value === "trailer_number" || value === "customer";
};

const loadMobileUiState = (): MobileUiState => {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.sessionStorage.getItem(MOBILE_UI_STATE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const scrollByTab = parsed.scrollByTab && typeof parsed.scrollByTab === "object"
      ? Object.fromEntries(
          Object.entries(parsed.scrollByTab as Record<string, unknown>).filter(
            (entry): entry is [MobileTabKey, number] => isMobileTabKey(entry[0]) && typeof entry[1] === "number" && Number.isFinite(entry[1]),
          ),
        )
      : undefined;

    return {
      activeTab: isMobileTabKey(parsed.activeTab) ? parsed.activeTab : undefined,
      searchQuery: typeof parsed.searchQuery === "string" ? parsed.searchQuery : undefined,
      selectedTrailerId: typeof parsed.selectedTrailerId === "string" ? parsed.selectedTrailerId : null,
      compoundFilter: typeof parsed.compoundFilter === "string" ? parsed.compoundFilter : undefined,
      compoundSort: isCompoundSortKey(parsed.compoundSort) ? parsed.compoundSort : undefined,
      scrollByTab,
    };
  } catch {
    return {};
  }
};

const saveMobileUiState = (state: MobileUiState) => {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(MOBILE_UI_STATE_KEY, JSON.stringify(state));
};

const initialInspectionProgress: MobileInspectionProgress = {
  frontTemperature: "",
  rearTemperature: "",
  damage: "no",
  damageType: "",
  damageLocation: "",
  damageDescription: "",
  notes: "",
};

const parseTemperatureInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
};

const sanitizeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
const INSPECTION_PHOTO_BUCKET = "vessel-inspection-photos";
const ACCEPTED_PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const normalizePhotoMimeType = (value?: string | null) => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "image/jpg") {
    return "image/jpeg";
  }
  return normalized;
};

const isAcceptedPhotoMimeType = (file: File) => ACCEPTED_PHOTO_MIME_TYPES.has(normalizePhotoMimeType(file.type));

const hasPhotoTrailerColumnCompatibilityError = (errorMessage: string) => {
  const lower = errorMessage.toLowerCase();
  return (
    (lower.includes("vessel_trailer_id") && (lower.includes("column") || lower.includes("schema cache"))) ||
    (lower.includes("vessel_operation_trailer_id") && lower.includes("null value"))
  );
};

const tabConfig: Array<{ key: MobileTabKey; label: string; icon: ReactNode }> = [
  { key: "home", label: "Home", icon: <Home className="h-4 w-4" /> },
  { key: "operations", label: "Ops", icon: <Sparkles className="h-4 w-4" /> },
  { key: "compound", label: "Compound", icon: <Layers3 className="h-4 w-4" /> },
  { key: "search", label: "Search", icon: <ScanSearch className="h-4 w-4" /> },
  { key: "more", label: "More", icon: <MenuSquare className="h-4 w-4" /> },
];

export function SupervisorMobileDashboard() {
  const initialUiState = loadMobileUiState();
  const { roleKey, fullName, email, isLoading } = useCurrentUser();
  const [activeTab, setActiveTab] = useState<MobileTabKey>(initialUiState.activeTab ?? "home");
  const [searchQuery, setSearchQuery] = useState(initialUiState.searchQuery ?? "");
  const [quickCommand, setQuickCommand] = useState("");
  const [selectedTrailerId, setSelectedTrailerId] = useState<string | null>(initialUiState.selectedTrailerId ?? null);
  const [movePosition, setMovePosition] = useState("");
  const [loadStatus, setLoadStatus] = useState<"Loaded" | "Empty">("Loaded");
  const [compoundFilter, setCompoundFilter] = useState(initialUiState.compoundFilter ?? "");
  const [compoundSort, setCompoundSort] = useState<CompoundSortKey>(initialUiState.compoundSort ?? "position");
  const [kpis, setKpis] = useState<MobileKpis>(emptyKpis);
  const [trailers, setTrailers] = useState<MobileTrailerCard[]>([]);
  const [vesselTrailers, setVesselTrailers] = useState<MobileVesselTrailerCard[]>([]);
  const [operations, setOperations] = useState<MobileOperationCard[]>([]);
  const [queueItems, setQueueItems] = useState<MobileActionQueueItem[]>(() => loadMobileActionQueue());
  const [syncLog, setSyncLog] = useState<MobileSyncLog[]>([]);
  const [isOnline, setIsOnline] = useState(() => (typeof window === "undefined" ? true : window.navigator.onLine));
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);
  const [lastSuccessfulSyncAt, setLastSuccessfulSyncAt] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [inspectionPanelOpen, setInspectionPanelOpen] = useState(false);
  const [inspectionProgress, setInspectionProgress] = useState<MobileInspectionProgress>(initialInspectionProgress);
  const [inspectionActivityRows, setInspectionActivityRows] = useState<TrailerActivityRow[]>([]);
  const [inspectionActivityLoading, setInspectionActivityLoading] = useState(false);
  const [isExecutingInspectionAction, setIsExecutingInspectionAction] = useState(false);
  const { showInstallAction, showIosInstallGuide, isInstalled, updateAvailable, promptInstall, dismissInstall, applyUpdate, setOperationallyBusy } = usePwa();
  const queueItemsRef = useRef(queueItems);
  const isSyncingQueueRef = useRef(false);
  const scrollByTabRef = useRef<Partial<Record<MobileTabKey, number>>>(initialUiState.scrollByTab ?? {});

  useEffect(() => {
    queueItemsRef.current = queueItems;
  }, [queueItems]);

  useEffect(() => {
    setOperationallyBusy(isSyncingQueue || isExecutingInspectionAction || queueItems.some((item) => item.state === "pending" || item.state === "syncing"));
  }, [isExecutingInspectionAction, isSyncingQueue, queueItems, setOperationallyBusy]);

  useEffect(() => {
    saveMobileUiState({
      activeTab,
      searchQuery,
      selectedTrailerId,
      compoundFilter,
      compoundSort,
      scrollByTab: scrollByTabRef.current,
    });
  }, [activeTab, compoundFilter, compoundSort, searchQuery, selectedTrailerId]);

  const selectedTrailer = useMemo(
    () => trailers.find((trailer) => trailer.id === selectedTrailerId) ?? null,
    [selectedTrailerId, trailers],
  );

  const selectedTrailerNumber = selectedTrailer?.trailerNumber ?? null;

  const selectedVesselTrailer = useMemo(() => {
    if (!selectedTrailerNumber) {
      return null;
    }

    const normalized = normalizeTrailerNumber(selectedTrailerNumber);
    return vesselTrailers.find((row) => normalizeTrailerNumber(row.trailerNumber) === normalized) ?? null;
  }, [selectedTrailerNumber, vesselTrailers]);

  const loadData = useCallback(async () => {
    setIsDataLoading(true);
    setError(null);

    try {
      const [trailersResult, exportsResult, deliveryResult, vesselTrailerResult] = await Promise.all([
        supabase
          .from("trailers")
          .select("id, trailer_number, customer, load_status, operational_status, compound_position, is_local, arrival_date, departure_date")
          .is("departure_date", null)
          .order("arrival_date", { ascending: false })
          .limit(320),
        supabase
          .from("export_allocations")
          .select("id, trailer_id, trailer_number, customer, booking_reference, status, updated_at")
          .in("status", ["allocated", "delivered_empty", "waiting_loading", "collected_loaded"])
          .order("updated_at", { ascending: false })
          .limit(360),
        supabase
          .from("delivery_bookings")
          .select("id, trailer_id, delivery_date, delivered_at, waiting_collection_since, collection_due_date, status, customer, consignee, delivery_location, booking_reference, escort_required, notes, trailers(trailer_number)")
          .eq("status", "waiting_collection")
          .limit(260),
        supabase
          .from("vessel_operation_trailers")
          .select("id, vessel_operation_id, trailer_id, trailer_number, arrival_status, status, inspection_started_at, inspection_completed_at, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, has_temperature_alert, has_damage")
          .limit(420),
      ]);

      if (trailersResult.error) throw trailersResult.error;
      if (exportsResult.error) throw exportsResult.error;
      if (deliveryResult.error) throw deliveryResult.error;
      if (vesselTrailerResult.error) throw vesselTrailerResult.error;

      const trailerRows = (trailersResult.data ?? []) as TrailerRow[];
      const exportRows = ((exportsResult.data ?? []) as ExportAllocationRecord[]).map((row) => normalizeExportAllocationRecord(row));
      const activeExportAllocations = exportRows.filter((row) => isExportAllocationActive(row.status));
      const activeExportByTrailer = buildActiveExportStatusByTrailerId(activeExportAllocations);
      const deliveryRows = (deliveryResult.data ?? []) as unknown as DeliveryBookingRow[];
      const vesselRows = (vesselTrailerResult.data ?? []) as VesselTrailerRow[];

      const vesselCards: MobileVesselTrailerCard[] = vesselRows
        .filter((row) => Boolean(row.id) && Boolean(row.vessel_operation_id))
        .map((row) => ({
          vesselTrailerId: row.id,
          vesselOperationId: row.vessel_operation_id,
          trailerId: row.trailer_id ?? null,
          trailerNumber: row.trailer_number ?? "Unknown",
          arrivalStatus: row.arrival_status ?? null,
          status: row.status ?? null,
          inspectionStartedAt: row.inspection_started_at ?? null,
          inspectionCompletedAt: row.inspection_completed_at ?? null,
          expectedFrontTemperature: row.expected_front_temperature ?? null,
          expectedRearTemperature: row.expected_rear_temperature ?? null,
          expectedTemperatureUnit: row.expected_temperature_unit ?? null,
          hasDamage: row.has_damage === true,
          hasTemperatureAlert: row.has_temperature_alert === true,
        }));

      const visibleTrailers = trailerRows.filter((row) => isTrailerEligibleForCompoundViews(row, activeExportByTrailer.get(row.id)));
      const compoundTrailers = visibleTrailers.filter((row) => row.is_local !== true && isTrailerPresentInCompoundInventory(row, activeExportByTrailer.get(row.id)));

      const overdueWaiting = deliveryRows.filter((row) => {
        const aging = calculateCollectionAging({
          delivery_date: row.delivery_date,
          delivered_at: row.delivered_at,
          waiting_collection_since: row.waiting_collection_since,
          collection_due_date: row.collection_due_date,
        });

        const waitingSinceMs = row.waiting_collection_since ? new Date(row.waiting_collection_since).getTime() : null;
        const waitingHours = waitingSinceMs ? (Date.now() - waitingSinceMs) / 3_600_000 : 0;

        return aging.isOverdue || waitingHours >= 24;
      }).length;

      const cards: MobileTrailerCard[] = visibleTrailers.slice(0, 240).map((row) => ({
        id: row.id,
        trailerNumber: row.trailer_number ?? "Unknown",
        customer: row.customer ?? "-",
        loadStatus: row.load_status ?? "Unknown",
        operationalStatus: row.operational_status ?? "Unknown",
        compoundPosition: row.compound_position ?? "-",
        hasAlerts:
          Boolean(activeExportByTrailer.get(row.id)) ||
          normalizeText(row.operational_status).includes("hold") ||
          normalizeText(row.operational_status).includes("issue"),
        isLocal: row.is_local === true,
        currentLocation: getTrailerCurrentLocationLabel({
          departureDate: row.departure_date,
          isLocal: row.is_local,
          compoundPosition: row.compound_position,
          waitingForCompound: false,
          exportLocation: null,
          fallbackLocation: null,
        }),
      }));

      setTrailers(cards);
      setVesselTrailers(vesselCards);
      setKpis({
        inCompound: compoundTrailers.length,
        arrivalsToday: trailerRows.filter((row) => toDateKey(row.arrival_date) === todayKey()).length,
        waitingCollectionOverdue: overdueWaiting,
        pendingInspection: vesselRows.filter((row) => normalizeText(row.arrival_status) === "arrived" && !row.inspection_completed_at).length,
        temperatureAlerts: vesselRows.filter((row) => row.has_temperature_alert === true).length,
        damageAlerts: vesselRows.filter((row) => row.has_damage === true).length,
        activeExports: activeExportAllocations.length,
      });

      const operationCards: MobileOperationCard[] = [];

      deliveryRows.slice(0, 4).forEach((row) => {
        const trailerNumber = ((row as Record<string, unknown>).trailers as { trailer_number?: string | null } | null)?.trailer_number ?? null;

        operationCards.push({
          id: `collection-${row.id}`,
          title: `${trailerNumber ?? "Trailer"} waiting collection`,
          detail: "Move the trailer through the collection workflow.",
          trailerNumber,
          actionLabel: "Review",
          severity: "high",
        });
      });

      vesselCards
        .filter((row) => normalizeText(row.arrivalStatus) === "arrived" && !row.inspectionCompletedAt)
        .slice(0, 3)
        .forEach((row) => {
          operationCards.push({
            id: `inspection-${row.vesselTrailerId}`,
            title: `Inspection pending ${row.trailerNumber}`,
            detail: "Boat Check has not been completed yet.",
            trailerNumber: row.trailerNumber,
            vesselTrailerId: row.vesselTrailerId,
            actionType: "START_INSPECTION",
            actionPayload: {
              vesselTrailerId: row.vesselTrailerId,
              trailerNumber: row.trailerNumber,
            },
            actionLabel: "Inspect",
            severity: "high",
          });
        });

      vesselCards
        .filter((row) => row.hasTemperatureAlert || row.hasDamage)
        .slice(0, 3)
        .forEach((row) => {
          operationCards.push({
            id: `alert-${row.vesselTrailerId}`,
            title: `${row.trailerNumber} needs attention`,
            detail: row.hasTemperatureAlert ? "Temperature alert is active." : "Damage alert is active.",
            trailerNumber: row.trailerNumber,
            vesselTrailerId: row.vesselTrailerId,
            actionType: "SAVE_INSPECTION_PROGRESS",
            actionPayload: {
              vesselTrailerId: row.vesselTrailerId,
              trailerNumber: row.trailerNumber,
              frontTemperature: null,
              rearTemperature: null,
              unit: row.expectedTemperatureUnit ?? "C",
              notes: "",
              damage: {
                hasDamage: row.hasDamage,
                damageDescription: row.hasDamage ? "Review required from mobile." : null,
              },
            },
            actionLabel: "Review",
            severity: "medium",
          });
        });

      vesselCards
        .filter((row) => normalizeText(row.arrivalStatus) === "available_for_arrival" || normalizeText(row.arrivalStatus) === "expected")
        .slice(0, 2)
        .forEach((row) => {
          operationCards.push({
            id: `arrive-${row.vesselTrailerId}`,
            title: row.trailerNumber,
            detail: "Available to confirm arrival from vessel list.",
            trailerNumber: row.trailerNumber,
            vesselTrailerId: row.vesselTrailerId,
            actionType: "MARK_ARRIVED",
            actionPayload: {
              vesselTrailerId: row.vesselTrailerId,
              trailerNumber: row.trailerNumber,
              operationId: row.vesselOperationId,
            },
            actionLabel: "Arrived",
            severity: "high",
          });
        });

      setOperations(operationCards.slice(0, 8));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load mobile dashboard.");
    } finally {
      setIsDataLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadData]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    saveMobileActionQueue(queueItems);
  }, [queueItems]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setToastMessage(null);
    }, 2600);

    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  useOperationalRealtime(["dashboard"], () => {
    void loadData();
  }, { debounceMs: 900 });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const restoreId = window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollByTabRef.current[activeTab] ?? 0, behavior: "auto" });
    });

    const handleScroll = () => {
      scrollByTabRef.current[activeTab] = window.scrollY;
      saveMobileUiState({
        activeTab,
        searchQuery,
        selectedTrailerId,
        compoundFilter,
        compoundSort,
        scrollByTab: scrollByTabRef.current,
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.cancelAnimationFrame(restoreId);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [activeTab, compoundFilter, compoundSort, searchQuery, selectedTrailerId]);

  const applyServerUpdates = useCallback((payload: {
    updatedTrailer?: {
      trailerId: string | null;
      trailerNumber: string | null;
      loadStatus: string | null;
      compoundPosition: string | null;
      operationalStatus: string | null;
    } | null;
    updatedVesselTrailer?: {
      vesselTrailerId: string;
      trailerNumber: string | null;
      arrivalStatus: string | null;
      status: string | null;
      inspectionStartedAt: string | null;
      inspectionCompletedAt: string | null;
      hasDamage: boolean | null;
      hasTemperatureAlert: boolean | null;
    } | null;
  }) => {
    if (payload.updatedTrailer) {
      setTrailers((current) =>
        current.map((row) => {
          const sameId = payload.updatedTrailer?.trailerId && row.id === payload.updatedTrailer.trailerId;
          const sameNumber =
            payload.updatedTrailer?.trailerNumber &&
            normalizeTrailerNumber(row.trailerNumber) === normalizeTrailerNumber(payload.updatedTrailer.trailerNumber);

          if (!sameId && !sameNumber) {
            return row;
          }

          return {
            ...row,
            loadStatus: payload.updatedTrailer?.loadStatus ?? row.loadStatus,
            compoundPosition: payload.updatedTrailer?.compoundPosition ?? row.compoundPosition,
            operationalStatus: payload.updatedTrailer?.operationalStatus ?? row.operationalStatus,
          };
        }),
      );
    }

    if (payload.updatedVesselTrailer) {
      const updatedVesselTrailer = payload.updatedVesselTrailer;

      setVesselTrailers((current) =>
        current.map((row) =>
          row.vesselTrailerId === updatedVesselTrailer.vesselTrailerId
            ? {
                ...row,
                arrivalStatus: updatedVesselTrailer.arrivalStatus,
                status: updatedVesselTrailer.status,
                inspectionStartedAt: updatedVesselTrailer.inspectionStartedAt,
                inspectionCompletedAt: updatedVesselTrailer.inspectionCompletedAt,
                hasDamage: updatedVesselTrailer.hasDamage === true,
                hasTemperatureAlert: updatedVesselTrailer.hasTemperatureAlert === true,
              }
            : row,
        ),
      );

      setOperations((current) =>
        current.filter((row) => {
          if (row.vesselTrailerId !== updatedVesselTrailer.vesselTrailerId) {
            return true;
          }

          if (row.actionType === "MARK_ARRIVED" && updatedVesselTrailer.arrivalStatus === "arrived") {
            return false;
          }

          if ((row.actionType === "START_INSPECTION" || row.actionType === "SAVE_INSPECTION_PROGRESS") && updatedVesselTrailer.inspectionCompletedAt) {
            return false;
          }

          return true;
        }),
      );
    }
  }, []);

  const syncQueuedActions = useCallback(
    async (itemsToSync?: MobileActionQueueItem[]) => {
      const nowMs = Date.now();
      const pendingItems = (itemsToSync ?? queueItemsRef.current).filter((item) => {
        if (item.state !== "pending" && item.state !== "failed") {
          return false;
        }

        if (!item.nextRetryAt) {
          return true;
        }

        return new Date(item.nextRetryAt).getTime() <= nowMs;
      });

      if (pendingItems.length === 0 || isSyncingQueueRef.current || !isOnline) {
        return;
      }

      isSyncingQueueRef.current = true;
      setIsSyncingQueue(true);
      setQueueError(null);

      try {
        const token = await getSessionToken();

        for (const item of pendingItems.sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
          const nextRetryCount = item.retryCount + 1;
          setQueueItems((current) =>
            updateQueuedAction(current, item.id, {
              state: "syncing",
              retryCount: nextRetryCount,
              lastError: null,
              conflict: null,
              nextRetryAt: null,
            }),
          );

          try {
            const response = await fetch("/api/mobile-actions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                actionId: item.id,
                action: {
                  actionType: item.actionType,
                  payload: item.payload,
                },
              }),
            });

            const payload = (await response.json()) as {
              error?: string;
              message?: string;
              status?: "success" | "failed" | "conflict";
              retryable?: boolean;
              conflict?: { code: string; message: string; serverState?: Record<string, unknown> | null } | null;
              updatedTrailer?: {
                trailerId: string | null;
                trailerNumber: string | null;
                loadStatus: string | null;
                compoundPosition: string | null;
                operationalStatus: string | null;
              } | null;
              updatedVesselTrailer?: {
                vesselTrailerId: string;
                trailerNumber: string | null;
                arrivalStatus: string | null;
                status: string | null;
                inspectionStartedAt: string | null;
                inspectionCompletedAt: string | null;
                hasDamage: boolean | null;
                hasTemperatureAlert: boolean | null;
              } | null;
            };

            if (response.status === 401) {
              throw new Error("Your session has expired. Please sign in again.");
            }

            if (!response.ok || payload.status === "failed") {
              const failureMessage = payload.error ?? payload.message ?? "Action rejected by the server.";
              const classified = classifyActionFailure(new Error(failureMessage));
              const isPermanentFailure = payload.retryable === false || !classified.retryable;
              const reachedRetryLimit = nextRetryCount >= getMaxRetryCount();

              setQueueItems((current) =>
                updateQueuedAction(current, item.id, {
                  state: "failed",
                  retryCount: nextRetryCount,
                  lastError: failureMessage,
                  nextRetryAt: !isPermanentFailure && !reachedRetryLimit
                    ? new Date(Date.now() + getRetryBackoffMs(nextRetryCount)).toISOString()
                    : null,
                }),
              );

              const failedEntry: MobileSyncLog = {
                id: item.id,
                label: getMobileActionLabel(item),
                resolvedAt: new Date().toISOString(),
                status: "failed",
                detail: failureMessage,
              };

              setSyncLog((current) => [failedEntry, ...current].slice(0, 12));
              continue;
            }

            if (payload.status === "conflict") {
              setQueueItems((current) =>
                updateQueuedAction(current, item.id, {
                  state: "conflict",
                  retryCount: nextRetryCount,
                  lastError: payload.message ?? payload.conflict?.message ?? "Conflict detected.",
                  conflict: payload.conflict ?? null,
                  nextRetryAt: null,
                }),
              );

              const conflictEntry: MobileSyncLog = {
                id: item.id,
                label: getMobileActionLabel(item),
                resolvedAt: new Date().toISOString(),
                status: "conflict",
                detail: payload.message ?? payload.conflict?.message ?? "Conflict detected.",
              };

              setSyncLog((current) => [conflictEntry, ...current].slice(0, 12));
              continue;
            }

            setQueueItems((current) =>
              updateQueuedAction(current, item.id, {
                state: "completed",
                retryCount: nextRetryCount,
                lastError: null,
                conflict: null,
                nextRetryAt: null,
              }),
            );

            applyServerUpdates({
              updatedTrailer: payload.updatedTrailer ?? null,
              updatedVesselTrailer: payload.updatedVesselTrailer ?? null,
            });

            setLastSuccessfulSyncAt(new Date().toISOString());
            const syncEntry: MobileSyncLog = {
              id: item.id,
              label: getMobileActionLabel(item),
              resolvedAt: new Date().toISOString(),
              status: "completed",
              detail: payload.message ?? "Synced successfully.",
            };
            setSyncLog((current) => [
              syncEntry,
              ...current,
            ].slice(0, 12));
            setToastMessage(payload.message ?? "Action synced.");
          } catch (syncError) {
            const classified = classifyActionFailure(syncError);
            const reachedRetryLimit = nextRetryCount >= getMaxRetryCount();

            setQueueItems((current) =>
              updateQueuedAction(current, item.id, {
                state: classified.state,
                retryCount: nextRetryCount,
                lastError: classified.message,
                nextRetryAt: classified.retryable && !reachedRetryLimit
                  ? new Date(Date.now() + getRetryBackoffMs(nextRetryCount)).toISOString()
                  : null,
              }),
            );
            setSyncLog((current) => [
              {
                id: item.id,
                label: getMobileActionLabel(item),
                resolvedAt: new Date().toISOString(),
                status: classified.state as MobileSyncLog["status"],
                detail: classified.message,
              },
              ...current,
            ].slice(0, 12));
          }
        }
      } catch (syncError) {
        setQueueError(syncError instanceof Error ? syncError.message : "Unable to sync queued actions.");
      } finally {
        isSyncingQueueRef.current = false;
        setIsSyncingQueue(false);
      }
    },
    [applyServerUpdates, isOnline],
  );

  useEffect(() => {
    if (!isOnline || !queueItems.some((item) => item.state === "pending" || item.state === "failed")) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void syncQueuedActions();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [isOnline, queueItems, syncQueuedActions]);

  const filteredTrailers = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) {
      return trailers.slice(0, 40);
    }

    return trailers
      .filter((row) => {
        return (
          row.trailerNumber.toLowerCase().includes(normalized) ||
          row.compoundPosition.toLowerCase().includes(normalized) ||
          row.customer.toLowerCase().includes(normalized)
        );
      })
      .slice(0, 40);
  }, [searchQuery, trailers]);

  const compoundTrailers = useMemo(() => {
    const normalizedFilter = compoundFilter.trim().toLowerCase();
    const filteredRows = trailers.filter((trailer) => {
      if (trailer.isLocal) {
        return false;
      }

      if (!normalizedFilter) {
        return true;
      }

      return (
        trailer.trailerNumber.toLowerCase().includes(normalizedFilter) ||
        trailer.compoundPosition.toLowerCase().includes(normalizedFilter) ||
        trailer.customer.toLowerCase().includes(normalizedFilter)
      );
    });

    const sortedRows = [...filteredRows].sort((left, right) => {
      if (compoundSort === "trailer_number") {
        return left.trailerNumber.localeCompare(right.trailerNumber, "en-GB", { numeric: true });
      }

      if (compoundSort === "customer") {
        return left.customer.localeCompare(right.customer, "en-GB", { numeric: true });
      }

      return left.compoundPosition.localeCompare(right.compoundPosition, "en-GB", { numeric: true });
    });

    return sortedRows.slice(0, 24);
  }, [compoundFilter, compoundSort, trailers]);

  const pendingQueueCount = queueItems.filter((item) => item.state === "pending").length;
  const syncingQueueCount = queueItems.filter((item) => item.state === "syncing").length;
  const failedQueueCount = queueItems.filter((item) => item.state === "failed").length;
  const conflictQueueCount = queueItems.filter((item) => item.state === "conflict").length;
  const connectionLabel = isOnline ? "Live" : "Offline";

  const mobileRoleKey = roleKey as RoleKey | null;
  const userLabel = fullName ?? email ?? "Authenticated User";
  const roleLabel = toRoleLabel(mobileRoleKey);
  const isSupervisorMobileRole = mobileRoleKey === "supervisor" || mobileRoleKey === "administrator";

  const canAccessAi = mobileRoleKey ? canAccessModule(mobileRoleKey, "ai_assistant") : false;
  const canArrive = mobileRoleKey ? canPerformAction(mobileRoleKey, "arrivals", "create") : false;
  const canInspect = mobileRoleKey ? canPerformAction(mobileRoleKey, "vessel_operations", "edit") : false;
  const canChangeLoad = mobileRoleKey ? canPerformAction(mobileRoleKey, "compound", "edit") : false;
  const canTimeline = mobileRoleKey ? canAccessModule(mobileRoleKey, "timeline") : false;
  const activeActionKeys = useMemo(
    () => new Set(queueItems.filter((item) => item.state === "pending" || item.state === "syncing").map((item) => item.dedupeKey)),
    [queueItems],
  );

  const isActionPending = useCallback(
    (input: { actionType: MobileActionType; payload: MobileActionRequest["payload"]; trailerNumber?: string | null }) => {
      return activeActionKeys.has(getMobileActionDedupeKey(input));
    },
    [activeActionKeys],
  );

  const isOperationPending = useCallback(
    (operation: MobileOperationCard) => {
      if (!operation.actionType || !operation.actionPayload) {
        return false;
      }

      return isActionPending({
        actionType: operation.actionType,
        payload: operation.actionPayload,
        trailerNumber: operation.trailerNumber ?? null,
      });
    },
    [isActionPending],
  );

  const enqueueTypedAction = useCallback(
    (input: {
      actionType: MobileActionType;
      payload: MobileActionRequest["payload"];
      trailerNumber?: string | null;
    }) => {
      const parsed = mobileActionRequestSchema.safeParse({
        actionType: input.actionType,
        payload: input.payload,
      });

      if (!parsed.success) {
        setQueueError("Invalid action payload.");
        return null;
      }

      const nextItem = createMobileActionQueueItem({
        actionType: parsed.data.actionType,
        payload: parsed.data.payload,
        trailerNumber: input.trailerNumber ?? null,
        operator: userLabel,
      });
      const currentQueue = queueItemsRef.current;
      const duplicateItem = currentQueue.find(
        (item) =>
          item.dedupeKey === nextItem.dedupeKey &&
          (item.state === "pending" || item.state === "syncing" || item.state === "failed" || item.state === "conflict"),
      ) ?? null;

      if (duplicateItem) {
        setQueueError(`${getMobileActionLabel(duplicateItem)} is already queued or syncing.`);
        setToastMessage(`${getMobileActionLabel(duplicateItem)} already pending.`);
        return duplicateItem;
      }

      const nextQueueSnapshot = [nextItem, ...currentQueue].slice(0, 30);

      queueItemsRef.current = nextQueueSnapshot;
      setQueueItems(nextQueueSnapshot);

      setQueueError(null);
      setToastMessage(`${getMobileActionLabel(nextItem)} queued.`);

      if (isOnline) {
        void syncQueuedActions(nextQueueSnapshot);
      }

      return nextItem;
    },
    [isOnline, syncQueuedActions, userLabel],
  );

  const executeTypedActionNow = useCallback(
    async (input: {
      actionType: MobileActionType;
      payload: MobileActionRequest["payload"];
      trailerNumber?: string | null;
    }) => {
      const queued = enqueueTypedAction(input);
      if (!queued) {
        throw new Error("Unable to queue action.");
      }

      if (!isOnline) {
        return { message: `${getMobileActionLabel(queued)} queued for sync.` };
      }

      await syncQueuedActions([queued]);
      return { message: `${getMobileActionLabel(queued)} queued.` };
    },
    [enqueueTypedAction, isOnline, syncQueuedActions],
  );

  const handleQueueMove = useCallback(() => {
    if (!selectedTrailer || !movePosition.trim()) {
      return;
    }

    enqueueTypedAction({
      actionType: "MOVE_COMPOUND_POSITION",
      payload: {
        trailerId: selectedTrailer.id,
        trailerNumber: selectedTrailer.trailerNumber,
        targetPosition: movePosition.toUpperCase(),
        expectedCurrentPosition: selectedTrailer.compoundPosition,
        reason: "Master Mobile move",
      },
      trailerNumber: selectedTrailer.trailerNumber,
    });
    setMovePosition("");
  }, [enqueueTypedAction, movePosition, selectedTrailer]);

  const handleQueueLoadStatus = useCallback(() => {
    if (!selectedTrailer) {
      return;
    }

    enqueueTypedAction({
      actionType: "CHANGE_LOAD_STATUS",
      payload: {
        trailerId: selectedTrailer.id,
        trailerNumber: selectedTrailer.trailerNumber,
        nextLoadStatus: loadStatus,
        expectedCurrentLoadStatus: selectedTrailer.loadStatus,
      },
      trailerNumber: selectedTrailer.trailerNumber,
    });
  }, [enqueueTypedAction, loadStatus, selectedTrailer]);

  const handleQueueVoiceCommand = useCallback(() => {
    if (!quickCommand.trim()) {
      return;
    }

    setQueueError("Use voice actions from the Voice Operations panel to create typed actions.");
    setQuickCommand("");
  }, [quickCommand]);

  const handleTabChange = useCallback(
    (nextTab: MobileTabKey) => {
      if (typeof window !== "undefined") {
        scrollByTabRef.current[activeTab] = window.scrollY;
      }

      setActiveTab(nextTab);
    },
    [activeTab],
  );

  const openInspectionPanel = useCallback(async () => {
    if (!selectedVesselTrailer) {
      setQueueError("Select a trailer linked to vessel operations first.");
      return;
    }

    setInspectionPanelOpen(true);
    setInspectionProgress(initialInspectionProgress);
    setInspectionActivityLoading(true);

    try {
      const rows = await getTrailerActivity({
        trailerId: selectedVesselTrailer.trailerId,
        trailerNumber: selectedVesselTrailer.trailerNumber,
        limit: 40,
      });

      setInspectionActivityRows(rows);
    } catch (activityError) {
      setInspectionActivityRows([]);
      setQueueError(activityError instanceof Error ? activityError.message : "Unable to load inspection activity.");
    } finally {
      setInspectionActivityLoading(false);
    }
  }, [selectedVesselTrailer]);

  const toInspectionPayload = useCallback(() => {
    if (!selectedVesselTrailer) {
      return null;
    }

    return {
      vesselTrailerId: selectedVesselTrailer.vesselTrailerId,
      trailerNumber: selectedVesselTrailer.trailerNumber,
      frontTemperature: parseTemperatureInput(inspectionProgress.frontTemperature),
      rearTemperature: parseTemperatureInput(inspectionProgress.rearTemperature),
      unit: selectedVesselTrailer.expectedTemperatureUnit ?? "C",
      notes: inspectionProgress.notes,
      damage: {
        hasDamage: inspectionProgress.damage === "yes",
        damageType: inspectionProgress.damageType,
        damageLocation: inspectionProgress.damageLocation,
        damageDescription: inspectionProgress.damageDescription,
      },
    };
  }, [inspectionProgress, selectedVesselTrailer]);

  const handleStartInspection = useCallback(async () => {
    if (!selectedVesselTrailer) {
      return;
    }

    setIsExecutingInspectionAction(true);
    try {
      await executeTypedActionNow({
        actionType: "START_INSPECTION",
        payload: {
          vesselTrailerId: selectedVesselTrailer.vesselTrailerId,
          trailerNumber: selectedVesselTrailer.trailerNumber,
        },
        trailerNumber: selectedVesselTrailer.trailerNumber,
      });
    } finally {
      setIsExecutingInspectionAction(false);
    }
  }, [executeTypedActionNow, selectedVesselTrailer]);

  const handleSaveInspectionProgress = useCallback(async () => {
    if (!selectedVesselTrailer) {
      return;
    }

    const payload = toInspectionPayload();
    if (!payload) {
      return;
    }

    setIsExecutingInspectionAction(true);
    try {
      await executeTypedActionNow({
        actionType: "SAVE_INSPECTION_PROGRESS",
        payload,
        trailerNumber: selectedVesselTrailer.trailerNumber,
      });
    } finally {
      setIsExecutingInspectionAction(false);
    }
  }, [executeTypedActionNow, selectedVesselTrailer, toInspectionPayload]);

  const handleCompleteInspection = useCallback(async () => {
    if (!selectedVesselTrailer) {
      return;
    }

    const payload = toInspectionPayload();
    if (!payload) {
      return;
    }

    const expectedFront = resolveExpectedFrontTemperature({
      expected_front_temperature: selectedVesselTrailer.expectedFrontTemperature,
      temperature_required: null,
    });
    const expectedRear = resolveExpectedRearTemperature({
      expected_rear_temperature: selectedVesselTrailer.expectedRearTemperature,
    });
    const tolerance = getTemperatureToleranceSettingsFromStorage();
    const frontOut = isTemperatureOutOfRange(payload.frontTemperature, expectedFront, tolerance);
    const rearOut = isTemperatureOutOfRange(payload.rearTemperature, expectedRear, tolerance);

    setInspectionProgress((current) => ({
      ...current,
      notes:
        frontOut || rearOut
          ? `${current.notes}\nTemperature alert detected during completion.`.trim()
          : current.notes,
    }));

    setIsExecutingInspectionAction(true);
    try {
      await executeTypedActionNow({
        actionType: "COMPLETE_INSPECTION",
        payload,
        trailerNumber: selectedVesselTrailer.trailerNumber,
      });
    } finally {
      setIsExecutingInspectionAction(false);
    }
  }, [executeTypedActionNow, selectedVesselTrailer, toInspectionPayload]);

  const handleUploadInspectionPhoto = useCallback(
    async (input: { file: File; category: string; description: string | null }) => {
      if (!selectedVesselTrailer) {
        throw new Error("Select a vessel trailer before uploading a photo.");
      }

      if (!isOnline) {
        throw new Error("Photo upload requires a connection.");
      }

      const nowIso = new Date().toISOString();
      const normalizedTrailerNumber = normalizeTrailerNumber(selectedVesselTrailer.trailerNumber);
      if (!normalizedTrailerNumber) {
        throw new Error("Trailer number is required before uploading photos.");
      }

      if (!isAcceptedPhotoMimeType(input.file)) {
        throw new Error("Only JPEG, PNG, or WebP files are supported.");
      }

      const safeFileName = sanitizeFileName(input.file.name || "photo") || "photo";
      const uniqueToken = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const storagePath = `vessel-operations/${selectedVesselTrailer.vesselOperationId}/${selectedVesselTrailer.vesselTrailerId}/${Date.now()}-${uniqueToken}-${safeFileName}`;

      const { error: uploadError } = await supabase.storage.from(INSPECTION_PHOTO_BUCKET).upload(storagePath, input.file, {
        cacheControl: "3600",
        upsert: false,
        contentType: normalizePhotoMimeType(input.file.type),
      });

      if (uploadError) {
        throw new Error(uploadError.message || "Unable to upload inspection photo.");
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const uploadedBy = session?.user?.email?.trim() || session?.user?.id || null;

      const basePhotoPayload = {
        trailer_id: selectedVesselTrailer.trailerId,
        trailer_number: normalizedTrailerNumber,
        vessel_operation_id: selectedVesselTrailer.vesselOperationId,
        category: input.category,
        storage_path: storagePath,
        file_name: safeFileName,
        description: input.description,
        uploaded_at: nowIso,
        uploaded_by: uploadedBy ?? "TrailerHub User",
      };

      const insertWithColumn = async (columnName: "vessel_trailer_id" | "vessel_operation_trailer_id") => {
        return supabase.from("vessel_inspection_photos").insert({
          ...basePhotoPayload,
          [columnName]: selectedVesselTrailer.vesselTrailerId,
        } as never);
      };

      let { error: photoInsertError } = await insertWithColumn("vessel_trailer_id");

      if (photoInsertError && hasPhotoTrailerColumnCompatibilityError(photoInsertError.message || "")) {
        const retryResult = await insertWithColumn("vessel_operation_trailer_id");
        photoInsertError = retryResult.error;
      }

      if (photoInsertError) {
        await supabase.storage.from(INSPECTION_PHOTO_BUCKET).remove([storagePath]);
        throw new Error(photoInsertError.message || "Unable to register uploaded photo.");
      }

      const rows = await getTrailerActivity({
        trailerId: selectedVesselTrailer.trailerId,
        trailerNumber: selectedVesselTrailer.trailerNumber,
        limit: 40,
      });
      setInspectionActivityRows(rows);
      setToastMessage("Inspection photo uploaded.");
    },
    [isOnline, selectedVesselTrailer],
  );

  const resolveTouchOperationAction = useCallback(
    async (operation: MobileOperationCard) => {
      if (operation.actionType && operation.actionPayload) {
        await executeTypedActionNow({
          actionType: operation.actionType,
          payload: operation.actionPayload,
          trailerNumber: operation.trailerNumber ?? null,
        });

        if (operation.actionType === "START_INSPECTION" || operation.actionType === "SAVE_INSPECTION_PROGRESS") {
          setSelectedTrailerId(
            trailers.find((row) => normalizeTrailerNumber(row.trailerNumber) === normalizeTrailerNumber(operation.trailerNumber ?? ""))?.id ?? null,
          );
          await openInspectionPanel();
        }
        return;
      }

      if (operation.trailerNumber) {
        const match = trailers.find((row) => normalizeTrailerNumber(row.trailerNumber) === normalizeTrailerNumber(operation.trailerNumber));
        if (match) {
          setSelectedTrailerId(match.id);
        }
      }
    },
    [executeTypedActionNow, openInspectionPanel, trailers],
  );

  const mapVoiceActionToTypedAction = useCallback(
    async (input: {
      intent: VoiceActionIntentName;
      entities: VoiceEntities;
      commandText: string;
    }) => {
      const trailerNumber = normalizeTrailerNumber(input.entities.trailerNumber ?? selectedTrailerNumber ?? "");
      if (!trailerNumber) {
        throw new Error("Please provide the trailer number.");
      }

      const trailerMatch = trailers.find((row) => normalizeTrailerNumber(row.trailerNumber) === trailerNumber) ?? null;
      const vesselMatch = vesselTrailers.find((row) => normalizeTrailerNumber(row.trailerNumber) === trailerNumber) ?? null;

      if (input.intent === "mark_arrived") {
        if (!vesselMatch) {
          throw new Error("Trailer is not available in vessel arrivals.");
        }

        await executeTypedActionNow({
          actionType: "MARK_ARRIVED",
          payload: {
            vesselTrailerId: vesselMatch.vesselTrailerId,
            trailerNumber: vesselMatch.trailerNumber,
            operationId: vesselMatch.vesselOperationId,
          },
          trailerNumber: vesselMatch.trailerNumber,
        });
        return { message: `Queued arrival confirmation for ${vesselMatch.trailerNumber}.` };
      }

      if (input.intent === "change_compound_position") {
        if (!trailerMatch || !input.entities.compoundPosition) {
          throw new Error("Trailer and destination position are required.");
        }

        await executeTypedActionNow({
          actionType: "MOVE_COMPOUND_POSITION",
          payload: {
            trailerId: trailerMatch.id,
            trailerNumber: trailerMatch.trailerNumber,
            targetPosition: input.entities.compoundPosition,
            expectedCurrentPosition: trailerMatch.compoundPosition,
            reason: "Voice command",
          },
          trailerNumber: trailerMatch.trailerNumber,
        });
        return { message: `Queued move for ${trailerMatch.trailerNumber} to ${input.entities.compoundPosition}.` };
      }

      if (input.intent === "change_load_status") {
        if (!trailerMatch || !input.entities.loadStatus) {
          throw new Error("Trailer and load status are required.");
        }

        await executeTypedActionNow({
          actionType: "CHANGE_LOAD_STATUS",
          payload: {
            trailerId: trailerMatch.id,
            trailerNumber: trailerMatch.trailerNumber,
            nextLoadStatus: input.entities.loadStatus,
            expectedCurrentLoadStatus: trailerMatch.loadStatus,
          },
          trailerNumber: trailerMatch.trailerNumber,
        });
        return { message: `Queued load status change for ${trailerMatch.trailerNumber}.` };
      }

      if (input.intent === "start_inspection" || input.intent === "complete_inspection") {
        if (!vesselMatch) {
          throw new Error("Trailer is not available in vessel inspections.");
        }

        await executeTypedActionNow({
          actionType: input.intent === "start_inspection" ? "START_INSPECTION" : "COMPLETE_INSPECTION",
          payload:
            input.intent === "start_inspection"
              ? {
                  vesselTrailerId: vesselMatch.vesselTrailerId,
                  trailerNumber: vesselMatch.trailerNumber,
                }
              : {
                  vesselTrailerId: vesselMatch.vesselTrailerId,
                  trailerNumber: vesselMatch.trailerNumber,
                  frontTemperature: null,
                  rearTemperature: null,
                  unit: vesselMatch.expectedTemperatureUnit ?? "C",
                  notes: "Completed via voice.",
                  damage: {
                    hasDamage: false,
                    damageDescription: null,
                  },
                },
          trailerNumber: vesselMatch.trailerNumber,
        });

        return {
          message:
            input.intent === "start_inspection"
              ? `Queued inspection start for ${vesselMatch.trailerNumber}.`
              : `Queued inspection completion for ${vesselMatch.trailerNumber}.`,
        };
      }

      throw new Error("This voice command is not supported for typed mobile execution.");
    },
    [executeTypedActionNow, selectedTrailerNumber, trailers, vesselTrailers],
  );

  return (
    <PermissionGuard roleKey={mobileRoleKey} moduleKey="dashboard" action="view" allowWhenRoleMissing={false}>
      {!isSupervisorMobileRole ? (
        <section className="min-h-[60vh] px-3 py-6">
          <div className="mx-auto max-w-lg rounded-3xl border border-rose-200 bg-rose-50 p-5 text-rose-800 shadow-sm">
            <h2 className="text-xl font-semibold">Access denied</h2>
            <p className="mt-2 text-sm">You do not have permission to access this area.</p>
          </div>
        </section>
      ) : null}

      {isSupervisorMobileRole ? (
        <main className="mobile-safe-shell min-h-screen bg-[radial-gradient(circle_at_top,_rgba(6,182,212,0.18),_transparent_35%),linear-gradient(180deg,_#07111f_0%,_#f5f7fb_18%,_#eef6ff_100%)] text-slate-900 md:hidden">
          <div className="mx-auto flex max-w-lg flex-col gap-4">
            <header className="overflow-hidden rounded-[1.75rem] border border-cyan-100/80 bg-slate-950 px-4 py-4 text-white shadow-[0_20px_60px_rgba(15,23,42,0.22)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-cyan-300">Master Mobile v1</p>
                  <h1 className="mt-2 text-2xl font-semibold tracking-tight">Core Operations</h1>
                  <p className="mt-1 text-sm text-slate-300">{userLabel} · {roleLabel}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-right text-[11px] text-slate-300">
                  <div className="flex items-center gap-1 font-semibold text-white">
                    {isOnline ? <Wifi className="h-4 w-4 text-cyan-300" /> : <WifiOff className="h-4 w-4 text-amber-300" />}
                    {connectionLabel}
                  </div>
                  <p className="mt-1">Queue: {pendingQueueCount} pending · {syncingQueueCount} syncing</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-200">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Selected</p>
                  <p className="mt-1 font-medium text-white">{selectedTrailerNumber ?? "None"}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Sync</p>
                  <p className="mt-1 font-medium text-white">{isSyncingQueue ? "Processing" : "Ready"}{lastSuccessfulSyncAt ? ` · ${new Date(lastSuccessfulSyncAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}</p>
                </div>
              </div>
            </header>

            <section className="grid grid-cols-2 gap-3">
              <KpiCard label="In Compound" value={kpis.inCompound} icon={<PackageSearch className="h-4 w-4" />} accent="cyan" />
              <KpiCard label="Arrivals Today" value={kpis.arrivalsToday} icon={<Truck className="h-4 w-4" />} accent="blue" />
              <KpiCard label="Collection 24h+" value={kpis.waitingCollectionOverdue} icon={<ClipboardCheck className="h-4 w-4" />} accent="amber" />
              <KpiCard label="Pending Inspection" value={kpis.pendingInspection} icon={<Ship className="h-4 w-4" />} accent="rose" />
              <KpiCard label="Temp Alerts" value={kpis.temperatureAlerts} icon={<ShieldAlert className="h-4 w-4" />} accent="orange" />
              <KpiCard label="Export Active" value={kpis.activeExports} icon={<Clock3 className="h-4 w-4" />} accent="emerald" />
            </section>

            <section className="rounded-[1.75rem] border border-white/70 bg-white/92 p-3 shadow-[0_16px_48px_rgba(15,23,42,0.08)] backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700">Quick Command</p>
                  <p className="mt-1 text-sm text-slate-600">Queue a command now or sync it when the connection returns.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void syncQueuedActions()}
                  disabled={isSyncingQueue || !isOnline || pendingQueueCount === 0}
                  className="rounded-2xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isSyncingQueue ? "Syncing" : "Sync now"}
                </button>
              </div>

              <div className="mt-3 space-y-2">
                <textarea
                  value={quickCommand}
                  onChange={(event) => setQuickCommand(event.target.value)}
                  rows={2}
                  placeholder="Type a command like: mark trailer FS1234 arrived"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none placeholder:text-slate-400"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleQueueVoiceCommand}
                    disabled={!quickCommand.trim()}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-3 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-cyan-300"
                  >
                    <SignalHigh className="h-4 w-4" />
                    Queue command
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickCommand(`where is trailer ${selectedTrailerNumber ?? ""}`.trim());
                    }}
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700"
                  >
                    Suggest
                  </button>
                </div>
              </div>
            </section>

            {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
            {queueError ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{queueError}</div> : null}
            {toastMessage ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{toastMessage}</div> : null}
            {updateAvailable ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">Update available</p>
                    <p className="text-xs text-amber-800">Reload only when no action is pending or syncing.</p>
                  </div>
                  <button
                    type="button"
                    onClick={applyUpdate}
                    disabled={queueItems.some((item) => item.state === "pending" || item.state === "syncing") || isSyncingQueue || isExecutingInspectionAction}
                    className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-amber-300"
                  >
                    Reload
                  </button>
                </div>
              </div>
            ) : null}

            {activeTab === "home" ? (
              <HomeTab
                loading={isLoading || isDataLoading}
                trailerCount={trailers.length}
                operations={operations}
                trailers={trailers.slice(0, 6)}
                selectedTrailer={selectedTrailer}
                onSelectTrailer={setSelectedTrailerId}
                onAction={resolveTouchOperationAction}
                isOperationPending={isOperationPending}
                canAccessAi={canAccessAi}
                onOpenAssistant={() => setAssistantOpen(true)}
              />
            ) : null}

            {activeTab === "operations" ? (
              <OperationsTab
                loading={isLoading || isDataLoading}
                operations={operations}
                trailers={trailers}
                onSelectTrailer={setSelectedTrailerId}
                onAction={resolveTouchOperationAction}
                isOperationPending={isOperationPending}
                canArrive={canArrive}
                canInspect={canInspect}
                canChangeLoad={canChangeLoad}
                canTimeline={canTimeline}
                onOpenInspectionPanel={() => void openInspectionPanel()}
              />
            ) : null}

            {activeTab === "compound" ? (
              <CompoundTab
                loading={isLoading || isDataLoading}
                selectedTrailer={selectedTrailer}
                selectedTrailerNumber={selectedTrailerNumber}
                compoundTrailers={compoundTrailers}
                compoundFilter={compoundFilter}
                compoundSort={compoundSort}
                movePosition={movePosition}
                loadStatus={loadStatus}
                onSelectTrailer={setSelectedTrailerId}
                onCompoundFilterChange={setCompoundFilter}
                onCompoundSortChange={setCompoundSort}
                onMovePositionChange={setMovePosition}
                onLoadStatusChange={setLoadStatus}
                onQueueMove={handleQueueMove}
                onQueueLoadStatus={handleQueueLoadStatus}
                moveDisabled={
                  !selectedTrailer ||
                  movePosition.trim().length === 0 ||
                  isActionPending({
                    actionType: "MOVE_COMPOUND_POSITION",
                    payload: {
                      trailerId: selectedTrailer.id,
                      trailerNumber: selectedTrailer.trailerNumber,
                      targetPosition: movePosition.toUpperCase(),
                      expectedCurrentPosition: selectedTrailer.compoundPosition,
                      reason: "Master Mobile move",
                    },
                    trailerNumber: selectedTrailer.trailerNumber,
                  })
                }
                loadDisabled={
                  !selectedTrailer ||
                  isActionPending({
                    actionType: "CHANGE_LOAD_STATUS",
                    payload: {
                      trailerId: selectedTrailer.id,
                      trailerNumber: selectedTrailer.trailerNumber,
                      nextLoadStatus: loadStatus,
                      expectedCurrentLoadStatus: selectedTrailer.loadStatus,
                    },
                    trailerNumber: selectedTrailer.trailerNumber,
                  })
                }
              />
            ) : null}

            {activeTab === "search" ? (
              <SearchTab
                loading={isLoading || isDataLoading}
                query={searchQuery}
                trailers={filteredTrailers}
                onQueryChange={setSearchQuery}
                onSelectTrailer={setSelectedTrailerId}
                onQueueLocate={(trailerNumber) => {
                  const match = trailers.find((row) => normalizeTrailerNumber(row.trailerNumber) === normalizeTrailerNumber(trailerNumber));
                  if (match) {
                    setSelectedTrailerId(match.id);
                  }
                }}
              />
            ) : null}

            {activeTab === "more" ? (
              <MoreTab
                roleKey={mobileRoleKey}
                roleLabel={roleLabel}
                queueItems={queueItems}
                syncLog={syncLog}
                pendingCount={pendingQueueCount}
                syncingCount={syncingQueueCount}
                failedCount={failedQueueCount}
                conflictCount={conflictQueueCount}
                lastSuccessfulSyncAt={lastSuccessfulSyncAt}
                showInstallAction={showInstallAction}
                showIosInstallGuide={showIosInstallGuide}
                isInstalled={isInstalled}
                updateAvailable={updateAvailable}
                canApplyUpdate={!queueItems.some((item) => item.state === "pending" || item.state === "syncing") && !isSyncingQueue && !isExecutingInspectionAction}
                canAccessAi={canAccessAi}
                onOpenAssistant={() => setAssistantOpen(true)}
                onInstall={promptInstall}
                onDismissInstall={dismissInstall}
                onApplyUpdate={applyUpdate}
                onClearResolved={() => {
                  setQueueItems((current) => current.filter((item) => item.state === "pending" || item.state === "syncing" || item.state === "failed" || item.state === "conflict"));
                  setSyncLog([]);
                }}
                onRetrySync={() => void syncQueuedActions()}
                onCancelPending={(itemId) => {
                  setQueueItems((current) =>
                    updateQueuedAction(current, itemId, {
                      state: "cancelled",
                      lastError: "Cancelled by operator.",
                      nextRetryAt: null,
                    }),
                  );
                }}
                onQueueActionFromVoice={mapVoiceActionToTypedAction}
              />
            ) : null}

            <div className="mobile-safe-nav fixed z-20 mx-auto max-w-lg rounded-[1.4rem] border border-slate-200/80 bg-white/95 px-2 py-2 shadow-[0_12px_40px_rgba(15,23,42,0.16)] backdrop-blur">
              <div className="grid grid-cols-5 gap-1">
                {tabConfig.map((tab) => {
                  const isActive = tab.key === activeTab;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => handleTabChange(tab.key)}
                      className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-semibold transition ${isActive ? "bg-slate-950 text-white shadow-sm" : "text-slate-500"}`}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {canAccessAi ? (
              <button
                type="button"
                onClick={() => setAssistantOpen(true)}
                className="mobile-safe-fab fixed inline-flex h-14 w-14 items-center justify-center rounded-full bg-cyan-600 text-white shadow-lg shadow-cyan-700/30"
                aria-label="Open AI Assistant"
              >
                <Bot className="h-6 w-6" />
              </button>
            ) : null}

            <OperationsAssistantDrawer
              open={assistantOpen}
              onClose={() => setAssistantOpen(false)}
              mobile
              context={{
                pathname: "/dashboard/mobile",
                selectedCompoundFilter: searchQuery || selectedTrailerNumber || undefined,
              }}
            />

            {inspectionPanelOpen ? (
              <MobileInspectionPanel
                open={inspectionPanelOpen}
                trailer={
                  selectedVesselTrailer
                    ? {
                        vesselTrailerId: selectedVesselTrailer.vesselTrailerId,
                        trailerId: selectedVesselTrailer.trailerId,
                        trailerNumber: selectedVesselTrailer.trailerNumber,
                        operationId: selectedVesselTrailer.vesselOperationId,
                        status: selectedVesselTrailer.status,
                        arrivalStatus: selectedVesselTrailer.arrivalStatus,
                        inspectionStartedAt: selectedVesselTrailer.inspectionStartedAt,
                        inspectionCompletedAt: selectedVesselTrailer.inspectionCompletedAt,
                        expectedFrontTemperature: selectedVesselTrailer.expectedFrontTemperature,
                        expectedRearTemperature: selectedVesselTrailer.expectedRearTemperature,
                        expectedTemperatureUnit: selectedVesselTrailer.expectedTemperatureUnit,
                        hasDamage: selectedVesselTrailer.hasDamage,
                        hasTemperatureAlert: selectedVesselTrailer.hasTemperatureAlert,
                      }
                    : null
                }
                progress={inspectionProgress}
                activityRows={inspectionActivityRows}
                activityLoading={inspectionActivityLoading}
                isOnline={isOnline}
                isSubmitting={
                  isExecutingInspectionAction ||
                  (selectedVesselTrailer
                    ? isActionPending({
                        actionType: "START_INSPECTION",
                        payload: {
                          vesselTrailerId: selectedVesselTrailer.vesselTrailerId,
                          trailerNumber: selectedVesselTrailer.trailerNumber,
                        },
                        trailerNumber: selectedVesselTrailer.trailerNumber,
                      }) ||
                      isActionPending({
                        actionType: "SAVE_INSPECTION_PROGRESS",
                        payload: {
                          vesselTrailerId: selectedVesselTrailer.vesselTrailerId,
                          trailerNumber: selectedVesselTrailer.trailerNumber,
                          frontTemperature: parseTemperatureInput(inspectionProgress.frontTemperature),
                          rearTemperature: parseTemperatureInput(inspectionProgress.rearTemperature),
                          unit: selectedVesselTrailer.expectedTemperatureUnit ?? "C",
                          notes: inspectionProgress.notes,
                          damage: {
                            hasDamage: inspectionProgress.damage === "yes",
                            damageType: inspectionProgress.damageType,
                            damageLocation: inspectionProgress.damageLocation,
                            damageDescription: inspectionProgress.damageDescription,
                          },
                        },
                        trailerNumber: selectedVesselTrailer.trailerNumber,
                      }) ||
                      isActionPending({
                        actionType: "COMPLETE_INSPECTION",
                        payload: {
                          vesselTrailerId: selectedVesselTrailer.vesselTrailerId,
                          trailerNumber: selectedVesselTrailer.trailerNumber,
                          frontTemperature: parseTemperatureInput(inspectionProgress.frontTemperature),
                          rearTemperature: parseTemperatureInput(inspectionProgress.rearTemperature),
                          unit: selectedVesselTrailer.expectedTemperatureUnit ?? "C",
                          notes: inspectionProgress.notes,
                          damage: {
                            hasDamage: inspectionProgress.damage === "yes",
                            damageType: inspectionProgress.damageType,
                            damageLocation: inspectionProgress.damageLocation,
                            damageDescription: inspectionProgress.damageDescription,
                          },
                        },
                        trailerNumber: selectedVesselTrailer.trailerNumber,
                      })
                    : false)
                }
                onClose={() => setInspectionPanelOpen(false)}
                onProgressChange={(patch) => setInspectionProgress((current) => ({ ...current, ...patch }))}
                onStartInspection={() => void handleStartInspection()}
                onSaveProgress={() => void handleSaveInspectionProgress()}
                onCompleteInspection={() => void handleCompleteInspection()}
                onUploadPhoto={handleUploadInspectionPhoto}
              />
            ) : null}
          </div>
        </main>
      ) : null}

      {isSupervisorMobileRole ? (
        <section className="hidden min-h-[60vh] items-center justify-center md:flex">
          <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Master Mobile is optimized for phone screens.</p>
            <p className="mt-2 text-sm text-slate-600">Open this page on a mobile viewport to use the dedicated experience.</p>
          </div>
        </section>
      ) : null}
    </PermissionGuard>
  );
}

type KpiCardProps = {
  label: string;
  value: number;
  icon: ReactNode;
  accent: "cyan" | "blue" | "amber" | "rose" | "orange" | "emerald";
};

function KpiCard({ label, value, icon, accent }: KpiCardProps) {
  const accentClassName: Record<KpiCardProps["accent"], string> = {
    cyan: "text-cyan-700",
    blue: "text-blue-700",
    amber: "text-amber-700",
    rose: "text-rose-700",
    orange: "text-orange-700",
    emerald: "text-emerald-700",
  };

  return (
    <article className="rounded-[1.35rem] border border-white/70 bg-white/92 p-3 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
      <div className="flex items-center justify-between gap-2 text-slate-500">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] leading-tight">{label}</p>
        <span className={`rounded-full border border-slate-100 bg-slate-50 p-2 ${accentClassName[accent]}`}>{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </article>
  );
}

type InfoRowProps = {
  label: string;
  value: string;
};

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-xs font-medium text-slate-800">{value || "-"}</dd>
    </div>
  );
}

type QuickActionButtonProps = {
  label: string;
  href: string;
  enabled: boolean;
};

function QuickActionButton({ label, href, enabled }: QuickActionButtonProps) {
  if (!enabled) {
    return (
      <span className="rounded-2xl border border-slate-200 bg-slate-100 px-2 py-3 text-center text-[11px] font-semibold text-slate-400">
        {label}
      </span>
    );
  }

  return (
    <Link href={href} className="inline-flex items-center justify-center gap-1 rounded-2xl border border-cyan-200 bg-cyan-50 px-2 py-3 text-center text-[11px] font-semibold text-cyan-800">
      {label}
    </Link>
  );
}

type HomeTabProps = {
  loading: boolean;
  trailerCount: number;
  operations: MobileOperationCard[];
  trailers: MobileTrailerCard[];
  selectedTrailer: MobileTrailerCard | null;
  onSelectTrailer: (trailerId: string) => void;
  onAction: (operation: MobileOperationCard) => Promise<void>;
  isOperationPending: (operation: MobileOperationCard) => boolean;
  canAccessAi: boolean;
  onOpenAssistant: () => void;
};

function HomeTab({ loading, trailerCount, operations, trailers, selectedTrailer, onSelectTrailer, onAction, isOperationPending, canAccessAi, onOpenAssistant }: HomeTabProps) {
  return (
    <section className="space-y-3 pb-24">
      <CardShell title="Today at a glance" subtitle={`${trailerCount} trailers currently visible in the mobile fleet view`}>
        {loading ? (
          <p className="text-sm text-slate-500">Loading live operations...</p>
        ) : (
          <div className="space-y-2">
            {operations.slice(0, 3).map((operation) => (
              <MobileActionRow
                key={operation.id}
                title={operation.title}
                detail={operation.detail}
                severity={operation.severity}
                actionLabel={operation.actionLabel}
                disabled={isOperationPending(operation)}
                onAction={() => {
                  void onAction(operation);
                }}
              />
            ))}
          </div>
        )}
      </CardShell>

      <CardShell title="Quick access" subtitle="One-handed actions for the closest trailer">
        {selectedTrailer ? (
          <div className="rounded-3xl border border-cyan-100 bg-cyan-50/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Selected trailer</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{selectedTrailer.trailerNumber}</p>
            <p className="text-sm text-slate-600">{selectedTrailer.currentLocation} · {selectedTrailer.compoundPosition}</p>
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-2">
          {trailers.map((trailer) => (
            <button
              key={trailer.id}
              type="button"
              onClick={() => onSelectTrailer(trailer.id)}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-left"
            >
              <p className="text-sm font-semibold text-slate-900">{trailer.trailerNumber}</p>
              <p className="text-xs text-slate-500">{trailer.compoundPosition}</p>
            </button>
          ))}
        </div>

        {canAccessAi ? (
          <button type="button" onClick={onOpenAssistant} className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white">
            <Bot className="h-4 w-4" />
            Open assistant
          </button>
        ) : null}
      </CardShell>
    </section>
  );
}

type OperationsTabProps = {
  loading: boolean;
  operations: MobileOperationCard[];
  trailers: MobileTrailerCard[];
  onSelectTrailer: (trailerId: string) => void;
  onAction: (operation: MobileOperationCard) => Promise<void>;
  isOperationPending: (operation: MobileOperationCard) => boolean;
  canArrive: boolean;
  canInspect: boolean;
  canChangeLoad: boolean;
  canTimeline: boolean;
  onOpenInspectionPanel: () => void;
};

function OperationsTab({ loading, operations, trailers, onSelectTrailer, onAction, isOperationPending, canArrive, canInspect, canChangeLoad, canTimeline, onOpenInspectionPanel }: OperationsTabProps) {
  return (
    <section className="space-y-3 pb-24">
      <CardShell title="Operational queue" subtitle="High-priority work items from the live yard state">
        {loading ? (
          <p className="text-sm text-slate-500">Loading operations...</p>
        ) : operations.length === 0 ? (
          <p className="text-sm text-slate-500">No urgent actions right now.</p>
        ) : (
          <div className="space-y-2">
            {operations.map((operation) => (
              <MobileActionRow
                key={operation.id}
                title={operation.title}
                detail={operation.detail}
                severity={operation.severity}
                actionLabel={operation.actionLabel}
                disabled={isOperationPending(operation)}
                onAction={() => {
                  void onAction(operation);
                }}
              />
            ))}
          </div>
        )}
      </CardShell>

      <CardShell title="One-tap workflows" subtitle="Jump straight into existing operational modules">
        <div className="grid grid-cols-2 gap-2">
          <QuickActionButton label="Arrived" href="/dashboard/new-arrival" enabled={canArrive} />
          <QuickActionButton label="Inspection" href="/dashboard/vessel-operations" enabled={canInspect} />
          <QuickActionButton label="Change Load" href="/dashboard/load-trailer" enabled={canChangeLoad} />
          <QuickActionButton label="Timeline" href="/dashboard/trailer-timeline" enabled={canTimeline} />
        </div>
        <button
          type="button"
          onClick={onOpenInspectionPanel}
          className="mt-2 w-full rounded-2xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-800"
        >
          Open Mobile Inspection Panel
        </button>
      </CardShell>

      <CardShell title="Recent trailers" subtitle="Tap a trailer to reuse it in other tabs">
        <div className="grid grid-cols-2 gap-2">
          {trailers.slice(0, 6).map((trailer) => (
            <button
              key={trailer.id}
              type="button"
              onClick={() => onSelectTrailer(trailer.id)}
              className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left"
            >
              <p className="text-sm font-semibold text-slate-900">{trailer.trailerNumber}</p>
              <p className="text-xs text-slate-500">{trailer.currentLocation}</p>
            </button>
          ))}
        </div>
      </CardShell>
    </section>
  );
}

type CompoundTabProps = {
  loading: boolean;
  selectedTrailer: MobileTrailerCard | null;
  selectedTrailerNumber: string | null;
  compoundTrailers: MobileTrailerCard[];
  compoundFilter: string;
  compoundSort: CompoundSortKey;
  movePosition: string;
  loadStatus: "Loaded" | "Empty";
  onSelectTrailer: (trailerId: string) => void;
  onCompoundFilterChange: (value: string) => void;
  onCompoundSortChange: (value: CompoundSortKey) => void;
  onMovePositionChange: (value: string) => void;
  onLoadStatusChange: (value: "Loaded" | "Empty") => void;
  onQueueMove: () => void;
  onQueueLoadStatus: () => void;
  moveDisabled: boolean;
  loadDisabled: boolean;
};

function CompoundTab({ loading, selectedTrailer, selectedTrailerNumber, compoundTrailers, compoundFilter, compoundSort, movePosition, loadStatus, onSelectTrailer, onCompoundFilterChange, onCompoundSortChange, onMovePositionChange, onLoadStatusChange, onQueueMove, onQueueLoadStatus, moveDisabled, loadDisabled }: CompoundTabProps) {
  return (
    <section className="space-y-3 pb-24">
      <CardShell title="Compound tools" subtitle="Move, locate and update the selected trailer">
        {selectedTrailer ? (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Selected trailer</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{selectedTrailer.trailerNumber}</p>
            <p className="text-sm text-slate-600">{selectedTrailer.currentLocation} · {selectedTrailer.compoundPosition}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Pick a trailer below to enable the compound tools.</p>
        )}

        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <input
            value={movePosition}
            onChange={(event) => onMovePositionChange(event.target.value)}
            placeholder="Move to position P12"
            className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none"
          />
          <button type="button" onClick={onQueueMove} disabled={moveDisabled} className="rounded-2xl bg-cyan-600 px-3 py-3 text-sm font-semibold text-white disabled:bg-cyan-300">
            {moveDisabled && selectedTrailerNumber ? "Pending" : "Move"}
          </button>
        </div>

        <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
          <select value={loadStatus} onChange={(event) => onLoadStatusChange(event.target.value as "Loaded" | "Empty")} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none">
            <option value="Loaded">Loaded</option>
            <option value="Empty">Empty</option>
          </select>
          <button type="button" onClick={onQueueLoadStatus} disabled={loadDisabled} className="rounded-2xl bg-slate-950 px-3 py-3 text-sm font-semibold text-white disabled:bg-slate-300">
            {loadDisabled && selectedTrailerNumber ? "Pending" : "Set load"}
          </button>
        </div>
      </CardShell>

      <CardShell title="Compound trailers" subtitle={loading ? "Refreshing live positions" : "Tap to select a trailer for the tools above"}>
        <div className="mb-3 grid grid-cols-[1fr_auto] gap-2">
          <input
            value={compoundFilter}
            onChange={(event) => onCompoundFilterChange(event.target.value)}
            placeholder="Filter by trailer, position or customer"
            className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none"
          />
          <select value={compoundSort} onChange={(event) => onCompoundSortChange(event.target.value as CompoundSortKey)} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none">
            <option value="position">Sort: Position</option>
            <option value="trailer_number">Sort: Trailer</option>
            <option value="customer">Sort: Customer</option>
          </select>
        </div>
        <div className="space-y-2">
          {compoundTrailers.map((trailer) => (
            <button key={trailer.id} type="button" onClick={() => onSelectTrailer(trailer.id)} className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left">
              <div>
                <p className="text-sm font-semibold text-slate-900">{trailer.trailerNumber}</p>
                <p className="text-xs text-slate-500">{trailer.compoundPosition} · {trailer.currentLocation}</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${trailer.hasAlerts ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                {trailer.hasAlerts ? "Alert" : "OK"}
              </span>
            </button>
          ))}
        </div>
      </CardShell>
    </section>
  );
}

type SearchTabProps = {
  loading: boolean;
  query: string;
  trailers: MobileTrailerCard[];
  onQueryChange: (query: string) => void;
  onSelectTrailer: (trailerId: string) => void;
  onQueueLocate: (trailerNumber: string) => void;
};

function SearchTab({ loading, query, trailers, onQueryChange, onSelectTrailer, onQueueLocate }: SearchTabProps) {
  return (
    <section className="space-y-3 pb-24">
      <CardShell title="Search" subtitle="Find a trailer, then run a command from the result card">
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
          <Search className="h-4 w-4 text-slate-500" />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Trailer, position or customer" className="w-full bg-transparent text-sm outline-none" />
        </div>
      </CardShell>

      <div className="space-y-2">
        {loading ? (
          <CardShell title="Results" subtitle="Loading live search results">
            <p className="text-sm text-slate-500">Refreshing data...</p>
          </CardShell>
        ) : trailers.length === 0 ? (
          <CardShell title="Results" subtitle="No matches yet">
            <p className="text-sm text-slate-500">No trailers match the current search.</p>
          </CardShell>
        ) : (
          trailers.map((trailer) => (
            <article key={trailer.id} className="rounded-[1.6rem] border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-slate-900">{trailer.trailerNumber}</p>
                  <p className="text-xs text-slate-500">{trailer.customer}</p>
                </div>
                <button type="button" onClick={() => onSelectTrailer(trailer.id)} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                  Select
                </button>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <InfoRow label="Position" value={trailer.compoundPosition} />
                <InfoRow label="Load" value={trailer.loadStatus} />
                <InfoRow label="Status" value={trailer.operationalStatus} />
                <InfoRow label="Location" value={trailer.currentLocation} />
              </dl>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => onQueueLocate(trailer.trailerNumber)} className="rounded-2xl bg-cyan-600 px-3 py-2 text-xs font-semibold text-white">
                  Locate
                </button>
                <Link href={`/dashboard/trailers/${trailer.id}`} className="inline-flex items-center justify-center gap-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                  Open <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

type MoreTabProps = {
  roleKey: RoleKey | null;
  roleLabel: string;
  queueItems: MobileActionQueueItem[];
  syncLog: MobileSyncLog[];
  pendingCount: number;
  syncingCount: number;
  failedCount: number;
  conflictCount: number;
  lastSuccessfulSyncAt: string | null;
  showInstallAction: boolean;
  showIosInstallGuide: boolean;
  isInstalled: boolean;
  updateAvailable: boolean;
  canApplyUpdate: boolean;
  canAccessAi: boolean;
  onOpenAssistant: () => void;
  onInstall: () => Promise<void>;
  onDismissInstall: () => void;
  onApplyUpdate: () => void;
  onClearResolved: () => void;
  onRetrySync: () => void;
  onCancelPending: (itemId: string) => void;
  onQueueActionFromVoice: (input: { intent: VoiceActionIntentName; entities: VoiceEntities; commandText: string }) => Promise<{ message: string }>;
};

function MoreTab({ roleKey, roleLabel, queueItems, syncLog, pendingCount, syncingCount, failedCount, conflictCount, lastSuccessfulSyncAt, showInstallAction, showIosInstallGuide, isInstalled, updateAvailable, canApplyUpdate, canAccessAi, onOpenAssistant, onInstall, onDismissInstall, onApplyUpdate, onClearResolved, onRetrySync, onCancelPending, onQueueActionFromVoice }: MoreTabProps) {
  return (
    <section className="space-y-3 pb-24">
      <PwaStatusCard
        showInstallAction={showInstallAction}
        showIosInstallGuide={showIosInstallGuide}
        isInstalled={isInstalled}
        updateAvailable={updateAvailable}
        canApplyUpdate={canApplyUpdate}
        onInstall={() => {
          void onInstall();
        }}
        onDismissInstall={onDismissInstall}
        onApplyUpdate={onApplyUpdate}
      />

      <CardShell title="Voice operations" subtitle={`Current role is ${roleLabel}`}>
        <VoiceOperationsPanel roleKey={roleKey} onQueueAction={onQueueActionFromVoice} />
      </CardShell>

      <CardShell title="Queue status" subtitle="Pending actions are stored locally until they can be replayed">
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
          <p>Pending: {pendingCount}</p>
          <p>Syncing: {syncingCount}</p>
          <p>Failed: {failedCount}</p>
          <p>Conflict: {conflictCount}</p>
          <p className="col-span-2">Last sync: {lastSuccessfulSyncAt ? new Date(lastSuccessfulSyncAt).toLocaleString("en-GB") : "No successful sync yet"}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onRetrySync} className="rounded-2xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white">
            Retry sync
          </button>
          <button type="button" onClick={onClearResolved} className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
            Clear resolved
          </button>
        </div>

        <div className="mt-3 space-y-2">
          {queueItems.length === 0 ? (
            <p className="text-sm text-slate-500">No queued actions waiting to sync.</p>
          ) : (
            queueItems.map((item) => (
              <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{getMobileActionLabel(item)}</p>
                    <p className="text-xs text-slate-500">{item.trailerNumber ?? "No trailer"} · {new Date(item.createdAt).toLocaleString("en-GB")}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${item.state === "conflict" ? "bg-amber-100 text-amber-700" : item.state === "failed" ? "bg-rose-100 text-rose-700" : item.state === "syncing" ? "bg-cyan-100 text-cyan-700" : item.state === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>
                    {item.state}
                  </span>
                </div>
                {item.lastError ? <p className="mt-2 text-xs text-rose-700">{item.lastError}</p> : null}
                {item.conflict?.serverState ? <p className="mt-1 text-xs text-amber-800">Server state: {JSON.stringify(item.conflict.serverState)}</p> : null}
                {(item.state === "pending" || item.state === "failed" || item.state === "conflict") ? (
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => onRetrySync()} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">
                      Retry
                    </button>
                    <button type="button" onClick={() => onCancelPending(item.id)} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700">
                      Cancel
                    </button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        {syncLog.length > 0 ? (
          <div className="mt-3 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Recent syncs</p>
            {syncLog.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">{entry.label}</p>
                    <p className="text-xs text-slate-500">{entry.resolvedAt}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${entry.status === "completed" ? "bg-emerald-100 text-emerald-700" : entry.status === "conflict" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>
                    {entry.status}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-600">{entry.detail}</p>
              </div>
            ))}
          </div>
        ) : null}
      </CardShell>

      {canAccessAi ? (
        <button type="button" onClick={onOpenAssistant} className="inline-flex w-full items-center justify-center gap-2 rounded-[1.4rem] bg-cyan-600 px-4 py-4 text-sm font-semibold text-white">
          <Bot className="h-4 w-4" />
          Open assistant drawer
        </button>
      ) : null}
    </section>
  );
}

type CardShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

function CardShell({ title, subtitle, children }: CardShellProps) {
  return (
    <section className="rounded-[1.75rem] border border-white/75 bg-white/95 p-4 shadow-[0_16px_42px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700">{title}</p>
        {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

type MobileActionRowProps = {
  title: string;
  detail: string;
  severity: "high" | "medium" | "low";
  actionLabel: string;
  disabled?: boolean;
  onAction: () => void;
};

function MobileActionRow({ title, detail, severity, actionLabel, disabled = false, onAction }: MobileActionRowProps) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="mt-1 text-xs text-slate-600">{detail}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${severity === "high" ? "bg-rose-100 text-rose-700" : severity === "medium" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
          {severity}
        </span>
      </div>
      <button type="button" onClick={onAction} disabled={disabled} className="mt-3 inline-flex items-center gap-1 rounded-2xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-400">
        {disabled ? "Pending" : actionLabel}
        <MoveRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}