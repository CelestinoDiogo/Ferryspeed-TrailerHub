"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Home, Ship, Layers3, Truck, SquareStack, AlertTriangle, ThermometerSnowflake, Search } from "lucide-react";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { MobileInspectionPanel, type MobileInspectionProgress, type MobileInspectionTrailer } from "@/components/mobile/mobile-inspection-panel";
import { canAccessModule, canPerformAction } from "@/lib/auth/permissions";
import { toRoleLabel, type RoleKey } from "@/lib/auth/roles";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import type { Database } from "@/lib/database.types";
import {
  getAdvanceStatusActionLabel,
  getExportAllocationStatusLabel,
  normalizeExportAllocationRecord,
  type ExportAllocationRecord,
  type ExportAllocationStatus,
} from "@/lib/export-allocation";
import { advanceExportAllocationStatus } from "@/lib/operations/export-lifecycle";
import { useOperationalRealtime } from "@/lib/realtime/operational-realtime";
import { supabase } from "@/lib/supabase";
import { getTrailerActivity, type TrailerActivityRow } from "@/lib/trailer-activity";
import { saveVesselInspectionPhoto } from "@/lib/vessel-inspection-photos";

type MobileTabKey = "home" | "vessel" | "compound" | "departures" | "exports";
type VesselQuickFilter = "all" | "pending_arrival" | "inspection_pending" | "priority" | "temperature_required" | "alerts";

type TrailerRow = Pick<
  Database["public"]["Tables"]["trailers"]["Row"],
  "id" | "trailer_number" | "customer" | "compound_position" | "load_status" | "operational_status" | "departure_date" | "is_local"
>;

type VesselOperationRow = Pick<
  Database["public"]["Tables"]["vessel_operations"]["Row"],
  "id" | "vessel_name" | "sailing_reference" | "expected_arrival_at" | "actual_arrival_at" | "status" | "list_status" | "final_locked_at" | "updated_at"
>;

type VesselTrailerRow = Pick<
  Database["public"]["Tables"]["vessel_operation_trailers"]["Row"],
  | "id"
  | "vessel_operation_id"
  | "trailer_id"
  | "trailer_number"
  | "customer"
  | "arrival_status"
  | "priority_level"
  | "temperature_required"
  | "expected_front_temperature"
  | "expected_rear_temperature"
  | "expected_temperature_unit"
  | "inspection_started_at"
  | "inspection_completed_at"
  | "has_temperature_alert"
  | "has_damage"
>;

type OperationalAlertRow = Pick<
  Database["public"]["Tables"]["operational_alerts"]["Row"],
  "id" | "title" | "severity" | "status" | "trailer_number" | "source_module" | "created_at"
>;

type ExportRow = ExportAllocationRecord & {
  id: string;
  trailer_id: string | null;
  trailer_number: string | null;
  customer: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: ExportAllocationStatus;
};

type MobileSummary = {
  inCompound: number;
  pendingArrivals: number;
  arrivedCount: number;
  priorityTrailers: number;
  temperatureAlerts: number;
  operationalAlerts: number;
};

type VesselQuickCounts = {
  expected: number;
  arrived: number;
  pending: number;
  inspectionPending: number;
  priority: number;
};

const EMPTY_SUMMARY: MobileSummary = {
  inCompound: 0,
  pendingArrivals: 0,
  arrivedCount: 0,
  priorityTrailers: 0,
  temperatureAlerts: 0,
  operationalAlerts: 0,
};

const INITIAL_INSPECTION_PROGRESS: MobileInspectionProgress = {
  frontTemperature: "",
  rearTemperature: "",
  damage: "no",
  damageType: "",
  damageLocation: "",
  damageDescription: "",
  notes: "",
};

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const formatDateTime = (value?: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

const parseNumericInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const isArrivedState = (arrivalStatus?: string | null) => normalizeText(arrivalStatus) === "arrived";

const isPendingArrivalState = (arrivalStatus?: string | null) => {
  const normalized = normalizeText(arrivalStatus);
  return normalized === "expected" || normalized === "available_for_arrival";
};

const isTemperatureRequired = (row: VesselTrailerRow) => {
  if (row.expected_front_temperature !== null || row.expected_rear_temperature !== null) {
    return true;
  }

  return normalizeText(row.temperature_required).length > 0;
};

const tabConfig: Array<{ key: MobileTabKey; label: string; icon: ReactNode }> = [
  { key: "home", label: "Home", icon: <Home className="h-4 w-4" /> },
  { key: "vessel", label: "Vessel", icon: <Ship className="h-4 w-4" /> },
  { key: "compound", label: "Compound", icon: <Layers3 className="h-4 w-4" /> },
  { key: "departures", label: "Departures", icon: <Truck className="h-4 w-4" /> },
  { key: "exports", label: "Exports", icon: <SquareStack className="h-4 w-4" /> },
];

export function SupervisorMobileDashboard() {
  const { roleKey, fullName, email, isLoading } = useCurrentUser();
  const mobileRoleKey = roleKey as RoleKey | null;
  const roleLabel = toRoleLabel(mobileRoleKey);
  const userLabel = fullName ?? email ?? "Authenticated User";
  const isSupervisorMobileRole = mobileRoleKey === "supervisor" || mobileRoleKey === "administrator";

  const canArrive = mobileRoleKey ? canPerformAction(mobileRoleKey, "arrivals", "create") : false;
  const canInspect = mobileRoleKey ? canPerformAction(mobileRoleKey, "vessel_operations", "edit") : false;
  const canCompleteInspection = mobileRoleKey ? canPerformAction(mobileRoleKey, "vessel_operations", "complete") : false;
  const canViewDepartures = mobileRoleKey ? canAccessModule(mobileRoleKey, "departures") : false;
  const canViewExports = mobileRoleKey ? canAccessModule(mobileRoleKey, "export_operations") : false;

  const [activeTab, setActiveTab] = useState<MobileTabKey>("home");
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [summary, setSummary] = useState<MobileSummary>(EMPTY_SUMMARY);
  const [trailers, setTrailers] = useState<TrailerRow[]>([]);
  const [vesselOperations, setVesselOperations] = useState<VesselOperationRow[]>([]);
  const [vesselTrailers, setVesselTrailers] = useState<VesselTrailerRow[]>([]);
  const [alerts, setAlerts] = useState<OperationalAlertRow[]>([]);
  const [exports, setExports] = useState<ExportRow[]>([]);

  const [vesselFilter, setVesselFilter] = useState("");
  const [vesselQuickFilter, setVesselQuickFilter] = useState<VesselQuickFilter>("all");
  const [compoundFilter, setCompoundFilter] = useState("");
  const [departuresFilter, setDeparturesFilter] = useState("");
  const [exportsFilter, setExportsFilter] = useState("");

  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);
  const [actioningKeys, setActioningKeys] = useState<string[]>([]);

  const [inspectionPanelOpen, setInspectionPanelOpen] = useState(false);
  const [inspectionTrailerId, setInspectionTrailerId] = useState<string | null>(null);
  const [inspectionProgressByTrailerId, setInspectionProgressByTrailerId] = useState<Record<string, MobileInspectionProgress>>({});
  const [inspectionActivityRows, setInspectionActivityRows] = useState<TrailerActivityRow[]>([]);
  const [inspectionActivityLoading, setInspectionActivityLoading] = useState(false);

  const scrollByTabRef = useRef<Partial<Record<MobileTabKey, number>>>({});

  const loadData = useCallback(async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading ?? true;
    if (showLoading) {
      setIsLoadingData(true);
    }

    setError(null);

    try {
      const [trailerResult, vesselResult, vesselTrailerResult, alertsResult, exportResult] = await Promise.all([
        supabase
          .from("trailers")
          .select("id, trailer_number, customer, compound_position, load_status, operational_status, departure_date, is_local")
          .is("departure_date", null)
          .order("arrival_date", { ascending: false })
          .limit(400),
        supabase
          .from("vessel_operations")
          .select("id, vessel_name, sailing_reference, expected_arrival_at, actual_arrival_at, status, list_status, final_locked_at, updated_at")
          .order("updated_at", { ascending: false })
          .limit(30),
        supabase
          .from("vessel_operation_trailers")
          .select("id, vessel_operation_id, trailer_id, trailer_number, customer, arrival_status, priority_level, temperature_required, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, inspection_started_at, inspection_completed_at, has_temperature_alert, has_damage")
          .limit(800),
        supabase
          .from("operational_alerts")
          .select("id, title, severity, status, trailer_number, source_module, created_at")
          .in("status", ["active", "open"])
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("export_allocations")
          .select("id, trailer_id, trailer_number, customer, priority, status, updated_at")
          .in("status", ["allocated", "delivered_empty", "waiting_loading", "collected_loaded", "completed"])
          .order("updated_at", { ascending: false })
          .limit(260),
      ]);

      if (trailerResult.error) throw trailerResult.error;
      if (vesselResult.error) throw vesselResult.error;
      if (vesselTrailerResult.error) throw vesselTrailerResult.error;
      if (alertsResult.error) throw alertsResult.error;
      if (exportResult.error) throw exportResult.error;

      const nextTrailers = (trailerResult.data ?? []) as TrailerRow[];
      const nextVessels = (vesselResult.data ?? []) as VesselOperationRow[];
      const nextVesselTrailers = (vesselTrailerResult.data ?? []) as VesselTrailerRow[];
      const nextAlerts = (alertsResult.data ?? []) as OperationalAlertRow[];
      const nextExports = ((exportResult.data ?? []) as ExportRow[]).map((row) => normalizeExportAllocationRecord(row));

      const pendingArrivals = nextVesselTrailers.filter((row) => isPendingArrivalState(row.arrival_status)).length;
      const arrivedCount = nextVesselTrailers.filter((row) => isArrivedState(row.arrival_status)).length;
      const priorityTrailers = nextVesselTrailers.filter((row) => normalizeText(row.priority_level) === "priority").length;
      const temperatureAlerts = nextVesselTrailers.filter((row) => row.has_temperature_alert === true).length;
      const inCompound = nextTrailers.filter((row) => row.is_local !== true && (row.compound_position ?? "").trim().length > 0).length;

      setTrailers(nextTrailers);
      setVesselOperations(nextVessels);
      setVesselTrailers(nextVesselTrailers);
      setAlerts(nextAlerts);
      setExports(nextExports);
      setSummary({
        inCompound,
        pendingArrivals,
        arrivedCount,
        priorityTrailers,
        temperatureAlerts,
        operationalAlerts: nextAlerts.length,
      });

      if (!selectedVesselId && nextVessels.length > 0) {
        const firstActive = nextVessels.find((row) => row.status !== "completed" && !row.final_locked_at) ?? nextVessels[0];
        setSelectedVesselId(firstActive.id);
      }
    } catch (loadErr) {
      setError(loadErr instanceof Error ? loadErr.message : "Unable to load Master Mobile data.");
    } finally {
      if (showLoading) {
        setIsLoadingData(false);
      }
    }
  }, [selectedVesselId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData({ showLoading: true });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadData]);

  useOperationalRealtime(["dashboard"], () => {
    void loadData({ showLoading: false });
  }, { debounceMs: 800 });

  useEffect(() => {
    if (!success) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setSuccess(null);
    }, 2400);

    return () => window.clearTimeout(timeout);
  }, [success]);

  useEffect(() => {
    const restore = window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollByTabRef.current[activeTab] ?? 0, behavior: "auto" });
    });

    const onScroll = () => {
      scrollByTabRef.current[activeTab] = window.scrollY;
    };

    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.cancelAnimationFrame(restore);
      window.removeEventListener("scroll", onScroll);
    };
  }, [activeTab]);

  const handleTabChange = useCallback((nextTab: MobileTabKey) => {
    scrollByTabRef.current[activeTab] = window.scrollY;
    setActiveTab(nextTab);
  }, [activeTab]);

  const activeVessels = useMemo(
    () => vesselOperations.filter((row) => row.status !== "completed" && !row.final_locked_at),
    [vesselOperations],
  );

  const selectedVessel = activeVessels.find((row) => row.id === selectedVesselId) ?? activeVessels[0] ?? null;

  const selectedVesselRows = useMemo(() => {
    if (!selectedVessel) {
      return [];
    }

    return vesselTrailers.filter((row) => row.vessel_operation_id === selectedVessel.id);
  }, [selectedVessel, vesselTrailers]);

  const vesselQuickCounts = useMemo<VesselQuickCounts>(() => {
    const expected = selectedVesselRows.filter((row) => isPendingArrivalState(row.arrival_status)).length;
    const arrived = selectedVesselRows.filter((row) => isArrivedState(row.arrival_status)).length;
    const inspectionPending = selectedVesselRows.filter((row) => isArrivedState(row.arrival_status) && !row.inspection_completed_at).length;
    const priority = selectedVesselRows.filter((row) => normalizeText(row.priority_level) === "priority").length;

    return {
      expected,
      arrived,
      pending: expected,
      inspectionPending,
      priority,
    };
  }, [selectedVesselRows]);

  const filteredVesselRows = useMemo(() => {
    const normalized = vesselFilter.trim().toLowerCase();

    const quickFiltered = selectedVesselRows.filter((row) => {
      if (vesselQuickFilter === "pending_arrival") {
        return isPendingArrivalState(row.arrival_status);
      }

      if (vesselQuickFilter === "inspection_pending") {
        return isArrivedState(row.arrival_status) && !row.inspection_completed_at;
      }

      if (vesselQuickFilter === "priority") {
        return normalizeText(row.priority_level) === "priority";
      }

      if (vesselQuickFilter === "temperature_required") {
        return isTemperatureRequired(row);
      }

      if (vesselQuickFilter === "alerts") {
        return row.has_temperature_alert === true || row.has_damage === true;
      }

      return true;
    });

    if (!normalized) {
      return quickFiltered;
    }

    return quickFiltered.filter((row) => {
      return (
        (row.trailer_number ?? "").toLowerCase().includes(normalized) ||
        (row.customer ?? "").toLowerCase().includes(normalized)
      );
    });
  }, [selectedVesselRows, vesselQuickFilter, vesselFilter]);

  const compoundRows = useMemo(() => {
    const normalized = compoundFilter.trim().toLowerCase();
    const onlyCompound = trailers.filter((row) => row.is_local !== true && (row.compound_position ?? "").trim().length > 0);

    if (!normalized) {
      return onlyCompound.slice(0, 120);
    }

    return onlyCompound.filter((row) => {
      return (
        (row.trailer_number ?? "").toLowerCase().includes(normalized) ||
        (row.compound_position ?? "").toLowerCase().includes(normalized) ||
        (row.customer ?? "").toLowerCase().includes(normalized)
      );
    }).slice(0, 120);
  }, [compoundFilter, trailers]);

  const departureRows = useMemo(() => {
    const normalized = departuresFilter.trim().toLowerCase();
    const candidates = trailers.filter((row) => {
      const status = normalizeText(row.operational_status);
      return status !== "departed" && row.is_local !== true;
    });

    if (!normalized) {
      return candidates.slice(0, 80);
    }

    return candidates.filter((row) => {
      return (
        (row.trailer_number ?? "").toLowerCase().includes(normalized) ||
        (row.customer ?? "").toLowerCase().includes(normalized) ||
        (row.compound_position ?? "").toLowerCase().includes(normalized)
      );
    }).slice(0, 80);
  }, [departuresFilter, trailers]);

  const exportRows = useMemo(() => {
    const normalized = exportsFilter.trim().toLowerCase();

    if (!normalized) {
      return exports.slice(0, 100);
    }

    return exports.filter((row) => {
      return (
        (row.trailer_number ?? "").toLowerCase().includes(normalized) ||
        (row.customer ?? "").toLowerCase().includes(normalized) ||
        getExportAllocationStatusLabel(row.status).toLowerCase().includes(normalized)
      );
    }).slice(0, 100);
  }, [exports, exportsFilter]);

  const startAction = useCallback((actionType: string, trailerRowId: string) => {
    const key = `${actionType}:${trailerRowId}`;
    setActioningKeys((current) => (current.includes(key) ? current : [...current, key]));
    return key;
  }, []);

  const finishAction = useCallback((actionKey: string) => {
    setActioningKeys((current) => current.filter((key) => key !== actionKey));
  }, []);

  const hasAction = useCallback((actionType: string, trailerRowId: string) => {
    return actioningKeys.includes(`${actionType}:${trailerRowId}`);
  }, [actioningKeys]);

  const hasAnyActionForTrailer = useCallback((trailerRowId: string) => {
    return actioningKeys.some((key) => key.endsWith(`:${trailerRowId}`));
  }, [actioningKeys]);

  const executeMobileAction = useCallback(async (input: {
    actionType: "MARK_ARRIVED" | "START_INSPECTION" | "SAVE_INSPECTION_PROGRESS" | "COMPLETE_INSPECTION";
    trailerRowId: string;
    payload: Record<string, unknown>;
    fallbackError: string;
    successMessage?: string;
  }) => {
    const actionKey = startAction(input.actionType, input.trailerRowId);
    setError(null);

    try {
      const sessionResult = await supabase.auth.getSession();
      const accessToken = sessionResult.data.session?.access_token;
      if (!accessToken) {
        throw new Error("Authentication session not available.");
      }

      const response = await fetch("/api/mobile-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: {
            actionType: input.actionType,
            payload: input.payload,
          },
        }),
      });

      const payload = (await response.json()) as { error?: string; message?: string; status?: string };
      if (!response.ok || payload.status === "failed") {
        throw new Error(payload.error ?? payload.message ?? input.fallbackError);
      }

      setSuccess(input.successMessage ?? payload.message ?? "Action completed.");
      await loadData({ showLoading: false });
      return true;
    } catch (actionErr) {
      setError(actionErr instanceof Error ? actionErr.message : input.fallbackError);
      return false;
    } finally {
      finishAction(actionKey);
    }
  }, [finishAction, loadData, startAction]);

  const markArrived = useCallback(async (row: VesselTrailerRow) => {
    if (hasAction("MARK_ARRIVED", row.id)) {
      return;
    }

    await executeMobileAction({
      actionType: "MARK_ARRIVED",
      trailerRowId: row.id,
      payload: {
        vesselTrailerId: row.id,
        trailerNumber: row.trailer_number ?? undefined,
        operationId: row.vessel_operation_id,
      },
      fallbackError: "Unable to confirm arrival.",
      successMessage: "Arrival confirmed.",
    });
  }, [executeMobileAction, hasAction]);

  const advanceExport = useCallback(async (row: ExportRow) => {
    if (hasAction("EXPORT_ADVANCE", row.id)) {
      return;
    }

    const actionKey = startAction("EXPORT_ADVANCE", row.id);
    setError(null);

    try {
      const result = await advanceExportAllocationStatus(supabase, {
        allocation: row,
        sourceModule: "export",
      });

      setSuccess(`Export updated to ${getExportAllocationStatusLabel(result.nextStatus)}.`);
      await loadData({ showLoading: false });
    } catch (actionErr) {
      setError(actionErr instanceof Error ? actionErr.message : "Unable to update export status.");
    } finally {
      finishAction(actionKey);
    }
  }, [finishAction, hasAction, loadData, startAction]);

  const selectedInspectionTrailer = useMemo<MobileInspectionTrailer | null>(() => {
    if (!inspectionTrailerId) {
      return null;
    }

    const row = vesselTrailers.find((item) => item.id === inspectionTrailerId);
    if (!row) {
      return null;
    }

    return {
      vesselTrailerId: row.id,
      trailerId: row.trailer_id ?? null,
      trailerNumber: row.trailer_number ?? "Unknown",
      operationId: row.vessel_operation_id,
      status: row.arrival_status,
      arrivalStatus: row.arrival_status,
      inspectionStartedAt: row.inspection_started_at,
      inspectionCompletedAt: row.inspection_completed_at,
      expectedFrontTemperature: row.expected_front_temperature,
      expectedRearTemperature: row.expected_rear_temperature,
      expectedTemperatureUnit: row.expected_temperature_unit,
      hasDamage: row.has_damage,
      hasTemperatureAlert: row.has_temperature_alert,
    };
  }, [inspectionTrailerId, vesselTrailers]);

  const selectedInspectionProgress = useMemo(() => {
    if (!selectedInspectionTrailer) {
      return INITIAL_INSPECTION_PROGRESS;
    }

    return inspectionProgressByTrailerId[selectedInspectionTrailer.vesselTrailerId] ?? INITIAL_INSPECTION_PROGRESS;
  }, [inspectionProgressByTrailerId, selectedInspectionTrailer]);

  const loadInspectionActivity = useCallback(async (target: MobileInspectionTrailer) => {
    setInspectionActivityLoading(true);

    try {
      const rows = await getTrailerActivity({
        trailerId: target.trailerId,
        trailerNumber: target.trailerNumber,
        limit: 40,
      });

      setInspectionActivityRows(rows);
    } catch (activityErr) {
      setInspectionActivityRows([]);
      setError(activityErr instanceof Error ? activityErr.message : "Unable to load inspection activity.");
    } finally {
      setInspectionActivityLoading(false);
    }
  }, []);

  const openInspectionPanel = useCallback(async (row: VesselTrailerRow) => {
    setInspectionTrailerId(row.id);
    setInspectionPanelOpen(true);

    if (!inspectionProgressByTrailerId[row.id]) {
      setInspectionProgressByTrailerId((current) => ({
        ...current,
        [row.id]: INITIAL_INSPECTION_PROGRESS,
      }));
    }

    const trailerForPanel: MobileInspectionTrailer = {
      vesselTrailerId: row.id,
      trailerId: row.trailer_id ?? null,
      trailerNumber: row.trailer_number ?? "Unknown",
      operationId: row.vessel_operation_id,
      status: row.arrival_status,
      arrivalStatus: row.arrival_status,
      inspectionStartedAt: row.inspection_started_at,
      inspectionCompletedAt: row.inspection_completed_at,
      expectedFrontTemperature: row.expected_front_temperature,
      expectedRearTemperature: row.expected_rear_temperature,
      expectedTemperatureUnit: row.expected_temperature_unit,
      hasDamage: row.has_damage,
      hasTemperatureAlert: row.has_temperature_alert,
    };

    await loadInspectionActivity(trailerForPanel);
  }, [inspectionProgressByTrailerId, loadInspectionActivity]);

  const updateInspectionProgress = useCallback((patch: Partial<MobileInspectionProgress>) => {
    if (!inspectionTrailerId) {
      return;
    }

    setInspectionProgressByTrailerId((current) => ({
      ...current,
      [inspectionTrailerId]: {
        ...(current[inspectionTrailerId] ?? INITIAL_INSPECTION_PROGRESS),
        ...patch,
      },
    }));
  }, [inspectionTrailerId]);

  const buildInspectionPayload = useCallback((trailer: MobileInspectionTrailer, progress: MobileInspectionProgress) => {
    return {
      vesselTrailerId: trailer.vesselTrailerId,
      trailerNumber: trailer.trailerNumber,
      frontTemperature: parseNumericInput(progress.frontTemperature),
      rearTemperature: parseNumericInput(progress.rearTemperature),
      unit: trailer.expectedTemperatureUnit ?? "C",
      notes: progress.notes,
      damage: {
        hasDamage: progress.damage === "yes",
        damageType: progress.damage === "yes" ? progress.damageType || null : null,
        damageLocation: progress.damage === "yes" ? progress.damageLocation || null : null,
        damageDescription: progress.damage === "yes" ? progress.damageDescription || null : null,
      },
    };
  }, []);

  const handleStartInspection = useCallback(async () => {
    if (!selectedInspectionTrailer || !canInspect) {
      return;
    }

    await executeMobileAction({
      actionType: "START_INSPECTION",
      trailerRowId: selectedInspectionTrailer.vesselTrailerId,
      payload: {
        vesselTrailerId: selectedInspectionTrailer.vesselTrailerId,
        trailerNumber: selectedInspectionTrailer.trailerNumber,
      },
      fallbackError: "Unable to start inspection.",
      successMessage: "Inspection started.",
    });
  }, [canInspect, executeMobileAction, selectedInspectionTrailer]);

  const handleSaveInspectionProgress = useCallback(async () => {
    if (!selectedInspectionTrailer || !canInspect) {
      return;
    }

    await executeMobileAction({
      actionType: "SAVE_INSPECTION_PROGRESS",
      trailerRowId: selectedInspectionTrailer.vesselTrailerId,
      payload: buildInspectionPayload(selectedInspectionTrailer, selectedInspectionProgress),
      fallbackError: "Unable to save inspection progress.",
      successMessage: "Inspection progress saved.",
    });
  }, [buildInspectionPayload, canInspect, executeMobileAction, selectedInspectionProgress, selectedInspectionTrailer]);

  const handleCompleteInspection = useCallback(async () => {
    if (!selectedInspectionTrailer || !canCompleteInspection) {
      return;
    }

    const succeeded = await executeMobileAction({
      actionType: "COMPLETE_INSPECTION",
      trailerRowId: selectedInspectionTrailer.vesselTrailerId,
      payload: buildInspectionPayload(selectedInspectionTrailer, selectedInspectionProgress),
      fallbackError: "Unable to complete inspection.",
      successMessage: "Inspection completed.",
    });

    if (succeeded) {
      setInspectionPanelOpen(false);
    }
  }, [buildInspectionPayload, canCompleteInspection, executeMobileAction, selectedInspectionProgress, selectedInspectionTrailer]);

  const handleUploadInspectionPhoto = useCallback(async (input: { file: File; category: string; description: string | null }) => {
    if (!selectedInspectionTrailer) {
      throw new Error("Select a trailer before uploading photos.");
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const uploadedBy = session?.user?.email?.trim() || session?.user?.id || "TrailerHub User";

    await saveVesselInspectionPhoto({
      vesselTrailerId: selectedInspectionTrailer.vesselTrailerId,
      vesselOperationId: selectedInspectionTrailer.operationId,
      trailerId: selectedInspectionTrailer.trailerId,
      trailerNumber: selectedInspectionTrailer.trailerNumber,
      file: input.file,
      category: input.category,
      description: input.description,
      uploadedBy,
    });

    await loadInspectionActivity(selectedInspectionTrailer);
  }, [loadInspectionActivity, selectedInspectionTrailer]);

  const inspectionPanelSubmitting = selectedInspectionTrailer
    ? hasAction("START_INSPECTION", selectedInspectionTrailer.vesselTrailerId)
      || hasAction("SAVE_INSPECTION_PROGRESS", selectedInspectionTrailer.vesselTrailerId)
      || hasAction("COMPLETE_INSPECTION", selectedInspectionTrailer.vesselTrailerId)
    : false;

  return (
    <PermissionGuard roleKey={mobileRoleKey} moduleKey="dashboard" action="view" allowWhenRoleMissing={false}>
      {!isSupervisorMobileRole ? (
        <section className="min-h-[60vh] px-3 py-6">
          <div className="mx-auto max-w-lg rounded-3xl border border-rose-200 bg-rose-50 p-5 text-rose-800 shadow-sm">
            <h2 className="text-xl font-semibold">Access denied</h2>
            <p className="mt-2 text-sm">You do not have permission to access Master Mobile.</p>
          </div>
        </section>
      ) : null}

      {isSupervisorMobileRole ? (
        <main className="mobile-safe-shell min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.16),_transparent_35%),linear-gradient(180deg,_#04111f_0%,_#eaf3ff_20%,_#f5f9ff_100%)] text-slate-900 md:hidden">
          <div className="mx-auto flex max-w-lg flex-col gap-3 px-2 pb-24 pt-2">
            <header className="rounded-[1.55rem] border border-white/60 bg-slate-950 px-4 py-4 text-white shadow-[0_16px_44px_rgba(15,23,42,0.24)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-cyan-300">Master Mobile</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">Operational Quay Console</h1>
              <p className="mt-1 text-sm text-slate-300">{userLabel} · {roleLabel}</p>
            </header>

            {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
            {success ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div> : null}

            {activeTab === "home" ? (
              <section className="space-y-3">
                <Card title="Core Operations" subtitle="Reach each operational workflow in one tap.">
                  <div className="grid grid-cols-2 gap-2">
                    <NavBlock icon={<Ship className="h-5 w-5" />} label="Vessel Operations" onPress={() => handleTabChange("vessel")} />
                    <NavBlock icon={<Layers3 className="h-5 w-5" />} label="Compound" onPress={() => handleTabChange("compound")} />
                    <NavBlock icon={<Truck className="h-5 w-5" />} label="Departures" onPress={() => handleTabChange("departures")} />
                    <NavBlock icon={<SquareStack className="h-5 w-5" />} label="Export Operations" onPress={() => handleTabChange("exports")} />
                  </div>
                </Card>

                <Card title="Live Summary" subtitle={isLoading || isLoadingData ? "Loading live operational counters..." : "Compact live indicators for quay decisions."}>
                  <div className="grid grid-cols-2 gap-2">
                    <MiniStat label="In Compound" value={summary.inCompound} />
                    <MiniStat label="Pending Arrivals" value={summary.pendingArrivals} />
                    <MiniStat label="Arrived" value={summary.arrivedCount} />
                    <MiniStat label="Priority" value={summary.priorityTrailers} />
                    <MiniStat label="Temp Alerts" value={summary.temperatureAlerts} tone="warn" icon={<ThermometerSnowflake className="h-3.5 w-3.5" />} />
                    <MiniStat label="Op Alerts" value={summary.operationalAlerts} tone="danger" icon={<AlertTriangle className="h-3.5 w-3.5" />} />
                  </div>
                </Card>

                <Card title="Operational Alerts" subtitle="Most recent active/open alerts.">
                  {alerts.length === 0 ? <p className="text-sm text-slate-500">No active alerts.</p> : (
                    <div className="space-y-2">
                      {alerts.slice(0, 4).map((alert) => (
                        <div key={alert.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <p className="text-sm font-semibold text-slate-900">{alert.title}</p>
                          <p className="text-xs text-slate-500">{(alert.severity ?? "info").toUpperCase()} · {alert.trailer_number ?? "No trailer"} · {formatDateTime(alert.created_at)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </section>
            ) : null}

            {activeTab === "vessel" ? (
              <section className="space-y-3">
                <Card title="Active Vessel Workspace" subtitle="Persistent quay queue with in-place Arrived and Inspection actions.">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {activeVessels.map((vessel) => (
                      <button
                        key={vessel.id}
                        type="button"
                        onClick={() => setSelectedVesselId(vessel.id)}
                        className={`min-w-[220px] rounded-2xl border px-3 py-2 text-left ${selectedVessel?.id === vessel.id ? "border-cyan-400 bg-cyan-50" : "border-slate-200 bg-white"}`}
                      >
                        <p className="text-sm font-semibold text-slate-900">{vessel.vessel_name ?? "Unnamed vessel"}</p>
                        <p className="text-xs text-slate-600">{vessel.sailing_reference ?? "No reference"}</p>
                        <p className="text-xs text-slate-500">ETA {formatDateTime(vessel.expected_arrival_at)} · ATA {formatDateTime(vessel.actual_arrival_at)}</p>
                      </button>
                    ))}
                  </div>

                  <div className="mt-2 grid grid-cols-5 gap-1.5 text-center">
                    <CountChip label="Expected" value={vesselQuickCounts.expected} />
                    <CountChip label="Arrived" value={vesselQuickCounts.arrived} />
                    <CountChip label="Pending" value={vesselQuickCounts.pending} />
                    <CountChip label="Insp. Pending" value={vesselQuickCounts.inspectionPending} />
                    <CountChip label="Priority" value={vesselQuickCounts.priority} />
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <QuickFilterChip label="All" active={vesselQuickFilter === "all"} onPress={() => setVesselQuickFilter("all")} />
                    <QuickFilterChip label="Pending Arrival" active={vesselQuickFilter === "pending_arrival"} onPress={() => setVesselQuickFilter("pending_arrival")} />
                    <QuickFilterChip label="Inspection Pending" active={vesselQuickFilter === "inspection_pending"} onPress={() => setVesselQuickFilter("inspection_pending")} />
                    <QuickFilterChip label="Priority" active={vesselQuickFilter === "priority"} onPress={() => setVesselQuickFilter("priority")} />
                    <QuickFilterChip label="Temperature Required" active={vesselQuickFilter === "temperature_required"} onPress={() => setVesselQuickFilter("temperature_required")} />
                    <QuickFilterChip label="Alerts" active={vesselQuickFilter === "alerts"} onPress={() => setVesselQuickFilter("alerts")} />
                  </div>

                  <div className="mt-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <Search className="h-4 w-4 text-slate-500" />
                    <input
                      value={vesselFilter}
                      onChange={(event) => setVesselFilter(event.target.value)}
                      placeholder="Find trailer or customer"
                      className="w-full bg-transparent text-sm outline-none"
                    />
                  </div>

                  <div className="mt-2 space-y-2">
                    {filteredVesselRows.length === 0 ? <p className="text-sm text-slate-500">No trailers match this vessel filter.</p> : null}
                    {filteredVesselRows.map((row) => {
                      const pendingArrivedAction = hasAction("MARK_ARRIVED", row.id);
                      const pendingAnyAction = hasAnyActionForTrailer(row.id);
                      const canMarkArrived = canArrive && isPendingArrivalState(row.arrival_status);
                      const canOpenInspection = canInspect && (isArrivedState(row.arrival_status) || row.inspection_started_at !== null || row.inspection_completed_at !== null);
                      const tempRequired = isTemperatureRequired(row);
                      const tempStatus = !tempRequired
                        ? "Temp n/a"
                        : row.has_temperature_alert
                          ? "Temp alert"
                          : row.inspection_completed_at
                            ? "Temp complete"
                            : "Temp pending";
                      const inspectionStatusLabel = row.inspection_completed_at
                        ? "Completed"
                        : isArrivedState(row.arrival_status)
                          ? "Arrived - Inspection Pending"
                          : "Not arrived";

                      return (
                        <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                          <p className="text-xl font-semibold tracking-tight text-slate-900">{row.trailer_number ?? "-"}</p>
                          <p className="text-xs text-slate-600">{row.customer ?? "-"}</p>

                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                            <InfoPill label="Priority" value={row.priority_level ?? "normal"} />
                            <InfoPill label="Arrival" value={row.arrival_status ?? "-"} />
                            <InfoPill label="Inspection" value={inspectionStatusLabel} />
                            <InfoPill label="Temperature" value={tempStatus} />
                          </div>

                          <div className="mt-2 flex flex-wrap gap-1">
                            {row.has_damage ? <Badge tone="danger" text="Damage" /> : <Badge tone="ok" text="No Damage" />}
                            {row.has_temperature_alert ? <Badge tone="warn" text="Temp Alert" /> : null}
                            {tempRequired ? <Badge tone="info" text="Temp Required" /> : null}
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => void markArrived(row)}
                              disabled={!canMarkArrived || pendingArrivedAction}
                              className="rounded-xl bg-cyan-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-cyan-300"
                            >
                              {pendingArrivedAction ? "Updating..." : "Arrived"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void openInspectionPanel(row);
                              }}
                              disabled={!canOpenInspection || pendingAnyAction}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                            >
                              {pendingAnyAction ? "Busy..." : "Inspect"}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </Card>
              </section>
            ) : null}

            {activeTab === "compound" ? (
              <section className="space-y-3">
                <Card title="Compound Live Access" subtitle="Search trailer and read position/status immediately.">
                  <div className="mb-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <Search className="h-4 w-4 text-slate-500" />
                    <input
                      value={compoundFilter}
                      onChange={(event) => setCompoundFilter(event.target.value)}
                      placeholder="Trailer, position, customer"
                      className="w-full bg-transparent text-sm outline-none"
                    />
                  </div>

                  <div className="space-y-2">
                    {compoundRows.length === 0 ? <p className="text-sm text-slate-500">No compound trailers match this filter.</p> : null}
                    {compoundRows.map((row) => (
                      <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                        <p className="text-lg font-semibold text-slate-900">{row.trailer_number ?? "-"}</p>
                        <p className="text-xs text-slate-600">{row.customer ?? "-"}</p>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <InfoPill label="Position" value={row.compound_position ?? "-"} />
                          <InfoPill label="Load" value={row.load_status ?? "-"} />
                          <InfoPill label="Status" value={row.operational_status ?? "-"} />
                          <InfoPill label="Area" value="Compound" />
                        </div>
                      </article>
                    ))}
                  </div>
                </Card>
              </section>
            ) : null}

            {activeTab === "departures" ? (
              <section className="space-y-3">
                <Card title="Departures Mobile Access" subtitle="Find trailer quickly and jump into existing departure workflow.">
                  <div className="mb-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <Search className="h-4 w-4 text-slate-500" />
                    <input
                      value={departuresFilter}
                      onChange={(event) => setDeparturesFilter(event.target.value)}
                      placeholder="Trailer, customer, position"
                      className="w-full bg-transparent text-sm outline-none"
                    />
                  </div>

                  {!canViewDepartures ? <p className="text-sm text-rose-700">Your role cannot access departures.</p> : null}

                  <div className="space-y-2">
                    {departureRows.length === 0 ? <p className="text-sm text-slate-500">No departure candidates found.</p> : null}
                    {departureRows.map((row) => {
                      const trailerNumber = row.trailer_number ?? "";
                      const targetHref = trailerNumber
                        ? `/dashboard/departure?search=${encodeURIComponent(trailerNumber)}`
                        : "/dashboard/departure";

                      return (
                        <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                          <p className="text-lg font-semibold text-slate-900">{trailerNumber || "-"}</p>
                          <p className="text-xs text-slate-600">{row.customer ?? "-"}</p>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                            <InfoPill label="Position" value={row.compound_position ?? "-"} />
                            <InfoPill label="Load" value={row.load_status ?? "-"} />
                          </div>
                          <Link
                            href={targetHref}
                            className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white"
                          >
                            Confirm Departure
                          </Link>
                        </article>
                      );
                    })}
                  </div>
                </Card>
              </section>
            ) : null}

            {activeTab === "exports" ? (
              <section className="space-y-3">
                <Card title="Export Operations Mobile Access" subtitle="Execute next valid action with existing export lifecycle logic.">
                  <div className="mb-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <Search className="h-4 w-4 text-slate-500" />
                    <input
                      value={exportsFilter}
                      onChange={(event) => setExportsFilter(event.target.value)}
                      placeholder="Trailer, customer, status"
                      className="w-full bg-transparent text-sm outline-none"
                    />
                  </div>

                  {!canViewExports ? <p className="text-sm text-rose-700">Your role cannot access export operations.</p> : null}

                  <div className="space-y-2">
                    {exportRows.length === 0 ? <p className="text-sm text-slate-500">No export allocations found.</p> : null}
                    {exportRows.map((row) => {
                      const nextAction = getAdvanceStatusActionLabel(row.status);
                      const pending = hasAction("EXPORT_ADVANCE", row.id);

                      return (
                        <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                          <p className="text-lg font-semibold text-slate-900">{row.trailer_number ?? "-"}</p>
                          <p className="text-xs text-slate-600">{row.customer ?? "-"}</p>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                            <InfoPill label="Status" value={getExportAllocationStatusLabel(row.status)} />
                            <InfoPill label="Priority" value={row.priority ?? "normal"} />
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => void advanceExport(row)}
                              disabled={!nextAction || pending}
                              className="rounded-xl bg-cyan-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-cyan-300"
                            >
                              {pending ? "Updating..." : nextAction ?? "No action"}
                            </button>
                            <Link
                              href={`/dashboard/export-operations/${row.id}`}
                              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                            >
                              Open Details
                            </Link>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </Card>
              </section>
            ) : null}
          </div>

          <div className="mobile-safe-nav fixed z-20 mx-auto max-w-lg rounded-[1.35rem] border border-slate-200/80 bg-white/95 px-2 py-2 shadow-[0_12px_40px_rgba(15,23,42,0.16)] backdrop-blur">
            <div className="grid grid-cols-5 gap-1">
              {tabConfig.map((tab) => {
                const isActive = tab.key === activeTab;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => handleTabChange(tab.key)}
                    className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-semibold transition ${isActive ? "bg-slate-950 text-white" : "text-slate-500"}`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <MobileInspectionPanel
            open={inspectionPanelOpen && Boolean(selectedInspectionTrailer)}
            trailer={selectedInspectionTrailer}
            progress={selectedInspectionProgress}
            activityRows={inspectionActivityRows}
            activityLoading={inspectionActivityLoading}
            isOnline={typeof window === "undefined" ? true : window.navigator.onLine}
            isSubmitting={inspectionPanelSubmitting}
            onClose={() => setInspectionPanelOpen(false)}
            onProgressChange={updateInspectionProgress}
            onStartInspection={() => {
              void handleStartInspection();
            }}
            onSaveProgress={() => {
              void handleSaveInspectionProgress();
            }}
            onCompleteInspection={() => {
              void handleCompleteInspection();
            }}
            onUploadPhoto={handleUploadInspectionPhoto}
          />
        </main>
      ) : null}

      {isSupervisorMobileRole ? (
        <section className="hidden min-h-[60vh] items-center justify-center md:flex">
          <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Master Mobile is optimized for phone screens.</p>
            <p className="mt-2 text-sm text-slate-600">Open this page in a mobile viewport to use the quay workflow.</p>
          </div>
        </section>
      ) : null}
    </PermissionGuard>
  );
}

type CardProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

function Card({ title, subtitle, children }: CardProps) {
  return (
    <section className="rounded-[1.6rem] border border-white/75 bg-white/95 p-4 shadow-[0_16px_42px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700">{title}</p>
        {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

type MiniStatProps = {
  label: string;
  value: number;
  tone?: "default" | "warn" | "danger";
  icon?: ReactNode;
};

function MiniStat({ label, value, tone = "default", icon }: MiniStatProps) {
  const toneClass = tone === "danger" ? "border-rose-200 bg-rose-50 text-rose-800" : tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-800";

  return (
    <article className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em]">{label}</p>
      <p className="mt-1 flex items-center gap-1 text-lg font-semibold">
        {icon}
        {value}
      </p>
    </article>
  );
}

type NavBlockProps = {
  icon: ReactNode;
  label: string;
  onPress: () => void;
};

function NavBlock({ icon, label, onPress }: NavBlockProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="rounded-2xl border border-cyan-200 bg-cyan-50 px-3 py-3 text-left text-sm font-semibold text-cyan-900"
    >
      <span className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-cyan-700">
        {icon}
      </span>
      <p>{label}</p>
    </button>
  );
}

type CountChipProps = {
  label: string;
  value: number;
};

function CountChip({ label, value }: CountChipProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-1.5 py-1 text-[10px]">
      <p className="font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

type QuickFilterChipProps = {
  label: string;
  active: boolean;
  onPress: () => void;
};

function QuickFilterChip({ label, active, onPress }: QuickFilterChipProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}
    >
      {label}
    </button>
  );
}

type BadgeProps = {
  tone: "info" | "warn" | "danger" | "ok";
  text: string;
};

function Badge({ tone, text }: BadgeProps) {
  const className = tone === "danger"
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : tone === "ok"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-cyan-200 bg-cyan-50 text-cyan-700";

  return <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${className}`}>{text}</span>;
}

type InfoPillProps = {
  label: string;
  value: string;
};

function InfoPill({ label, value }: InfoPillProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-0.5 text-xs font-medium text-slate-800">{value || "-"}</p>
    </div>
  );
}