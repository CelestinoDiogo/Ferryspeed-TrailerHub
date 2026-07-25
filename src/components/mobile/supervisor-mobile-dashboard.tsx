"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  loadMobileActionQueue,
  removeQueuedAction,
  saveMobileActionQueue,
  type MobileActionQueueItem,
  updateQueuedAction,
} from "@/lib/mobile/mobile-action-queue";
import { useOperationalRealtime } from "@/lib/realtime/operational-realtime";
import { getTrailerCurrentLocationLabel } from "@/lib/trailer-location";
import { supabase } from "@/lib/supabase";
import { getSessionToken } from "@/lib/voice/session";

type TrailerRow = Database["public"]["Tables"]["trailers"]["Row"];
type DeliveryBookingRow = Database["public"]["Tables"]["delivery_bookings"]["Row"];
type VesselTrailerRow = Database["public"]["Tables"]["vessel_operation_trailers"]["Row"];

type MobileTabKey = "home" | "operations" | "compound" | "search" | "more";

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
  commandText: string;
  actionLabel: string;
  severity: "high" | "medium" | "low";
};

type MobileSyncLog = {
  id: string;
  label: string;
  resolvedAt: string;
  status: "completed" | "failed" | "conflict";
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

const tabConfig: Array<{ key: MobileTabKey; label: string; icon: ReactNode }> = [
  { key: "home", label: "Home", icon: <Home className="h-4 w-4" /> },
  { key: "operations", label: "Ops", icon: <Sparkles className="h-4 w-4" /> },
  { key: "compound", label: "Compound", icon: <Layers3 className="h-4 w-4" /> },
  { key: "search", label: "Search", icon: <ScanSearch className="h-4 w-4" /> },
  { key: "more", label: "More", icon: <MenuSquare className="h-4 w-4" /> },
];

export function SupervisorMobileDashboard() {
  const { roleKey, fullName, email, isLoading } = useCurrentUser();
  const [activeTab, setActiveTab] = useState<MobileTabKey>("home");
  const [searchQuery, setSearchQuery] = useState("");
  const [quickCommand, setQuickCommand] = useState("");
  const [selectedTrailerId, setSelectedTrailerId] = useState<string | null>(null);
  const [movePosition, setMovePosition] = useState("");
  const [loadStatus, setLoadStatus] = useState<"Loaded" | "Empty">("Loaded");
  const [kpis, setKpis] = useState<MobileKpis>(emptyKpis);
  const [trailers, setTrailers] = useState<MobileTrailerCard[]>([]);
  const [operations, setOperations] = useState<MobileOperationCard[]>([]);
  const [queueItems, setQueueItems] = useState<MobileActionQueueItem[]>([]);
  const [syncLog, setSyncLog] = useState<MobileSyncLog[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const selectedTrailer = useMemo(
    () => trailers.find((trailer) => trailer.id === selectedTrailerId) ?? null,
    [selectedTrailerId, trailers],
  );

  const selectedTrailerNumber = selectedTrailer?.trailerNumber ?? null;

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
          .select("id, trailer_number, arrival_status, inspection_completed_at, has_temperature_alert, has_damage")
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
          commandText: `where is trailer ${trailerNumber ?? ""}`.trim(),
          actionLabel: "Locate",
          severity: "high",
        });
      });

      vesselRows
        .filter((row) => normalizeText(row.arrival_status) === "arrived" && !row.inspection_completed_at)
        .slice(0, 3)
        .forEach((row) => {
          operationCards.push({
            id: `inspection-${row.id}`,
            title: `Inspection pending ${row.trailer_number}`,
            detail: "Boat Check has not been completed yet.",
            trailerNumber: row.trailer_number,
            commandText: `start inspection for trailer ${row.trailer_number ?? ""}`.trim(),
            actionLabel: "Inspect",
            severity: "high",
          });
        });

      vesselRows
        .filter((row) => row.has_temperature_alert === true || row.has_damage === true)
        .slice(0, 3)
        .forEach((row) => {
          operationCards.push({
            id: `alert-${row.id}`,
            title: `${row.trailer_number} needs attention`,
            detail: row.has_temperature_alert ? "Temperature alert is active." : "Damage alert is active.",
            trailerNumber: row.trailer_number,
            commandText: `where is trailer ${row.trailer_number ?? ""}`.trim(),
            actionLabel: "Locate",
            severity: "medium",
          });
        });

      cards.slice(0, 2).forEach((row) => {
        operationCards.push({
          id: `compound-${row.id}`,
          title: row.trailerNumber,
          detail: `${row.currentLocation} · ${row.compoundPosition}`,
          trailerNumber: row.trailerNumber,
          commandText: `mark trailer ${row.trailerNumber} arrived`,
          actionLabel: "Arrived",
          severity: row.hasAlerts ? "high" : "low",
        });
      });

      setOperations(operationCards.slice(0, 8));
      setQueueItems(loadMobileActionQueue());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load mobile dashboard.");
    } finally {
      setIsDataLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    setIsOnline(window.navigator.onLine);
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

  useOperationalRealtime(["dashboard"], () => {
    void loadData();
  }, { debounceMs: 900 });

  const syncQueuedActions = useCallback(
    async (itemsToSync?: MobileActionQueueItem[]) => {
      const pendingItems = (itemsToSync ?? queueItems).filter((item) => item.status === "pending" || item.status === "failed");
      if (pendingItems.length === 0 || isSyncingQueue || !isOnline) {
        return;
      }

      setIsSyncingQueue(true);
      setQueueError(null);

      try {
        const token = await getSessionToken();

        for (const item of pendingItems.sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
          setQueueItems((current) => updateQueuedAction(current, item.id, { status: "syncing", attempts: item.attempts + 1, error: null }));

          try {
            const response = await fetch("/api/voice-operations", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                commandText: item.commandText,
                context: { lastTrailerNumber: item.trailerNumber ?? null, lastIntent: null, lastCustomer: null },
                confirmed: true,
              }),
            });

            const payload = (await response.json()) as { error?: string; message?: string };
            if (response.status === 401) {
              throw new Error("Your session has expired. Please sign in again.");
            }

            if (!response.ok) {
              throw new Error(payload.error ?? payload.message ?? "Action rejected by the server.");
            }

            setQueueItems((current) => removeQueuedAction(current, item.id));
            const syncEntry: MobileSyncLog = {
              id: item.id,
              label: item.label,
              resolvedAt: new Date().toISOString(),
              status: "completed",
              detail: payload.message ?? "Synced successfully.",
            };
            setSyncLog((current) => [
              syncEntry,
              ...current,
            ].slice(0, 8));
          } catch (syncError) {
            const classified = classifyActionFailure(syncError);
            setQueueItems((current) => updateQueuedAction(current, item.id, { status: classified.status, error: classified.message }));
            setSyncLog((current) => [
              {
                id: item.id,
                label: item.label,
                resolvedAt: new Date().toISOString(),
                status: classified.status as MobileSyncLog["status"],
                detail: classified.message,
              },
              ...current,
            ].slice(0, 8));
          }
        }
      } catch (syncError) {
        setQueueError(syncError instanceof Error ? syncError.message : "Unable to sync queued actions.");
      } finally {
        setIsSyncingQueue(false);
      }
    },
    [isOnline, isSyncingQueue, queueItems],
  );

  useEffect(() => {
    if (isOnline && queueItems.some((item) => item.status === "pending")) {
      void syncQueuedActions();
    }
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

  const compoundTrailers = useMemo(
    () => trailers.filter((trailer) => trailer.isLocal === false).slice(0, 24),
    [trailers],
  );

  const pendingQueueCount = queueItems.filter((item) => item.status === "pending" || item.status === "failed" || item.status === "conflict").length;
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

  const enqueueAction = useCallback(
    (input: { source: MobileTabKey; label: string; commandText: string; trailerNumber?: string | null }) => {
      const nextItem = createMobileActionQueueItem(input);
      const nextQueue = [nextItem, ...queueItems].slice(0, 30);
      setQueueItems(nextQueue);
      setQueueError(null);

      if (isOnline) {
        void syncQueuedActions(nextQueue);
      }
    },
    [isOnline, queueItems, syncQueuedActions],
  );

  const handleQueueMove = useCallback(() => {
    if (!selectedTrailerNumber || !movePosition.trim()) {
      return;
    }

    enqueueAction({
      source: "compound",
      label: `Move ${selectedTrailerNumber} to ${movePosition.toUpperCase()}`,
      commandText: `move trailer ${selectedTrailerNumber} to position ${movePosition.toUpperCase()}`,
      trailerNumber: selectedTrailerNumber,
    });
    setMovePosition("");
  }, [enqueueAction, movePosition, selectedTrailerNumber]);

  const handleQueueLoadStatus = useCallback(() => {
    if (!selectedTrailerNumber) {
      return;
    }

    enqueueAction({
      source: "compound",
      label: `Set ${selectedTrailerNumber} ${loadStatus.toLowerCase()}`,
      commandText: `mark trailer ${selectedTrailerNumber} ${loadStatus.toLowerCase()}`,
      trailerNumber: selectedTrailerNumber,
    });
  }, [enqueueAction, loadStatus, selectedTrailerNumber]);

  const handleQueueVoiceCommand = useCallback(() => {
    if (!quickCommand.trim()) {
      return;
    }

    enqueueAction({
      source: "more",
      label: quickCommand.trim(),
      commandText: quickCommand.trim(),
      trailerNumber: selectedTrailerNumber,
    });
    setQuickCommand("");
  }, [enqueueAction, quickCommand, selectedTrailerNumber]);

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
        <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(6,182,212,0.18),_transparent_35%),linear-gradient(180deg,_#07111f_0%,_#f5f7fb_18%,_#eef6ff_100%)] px-3 pb-28 pt-3 text-slate-900 md:hidden">
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
                  <p className="mt-1">Queue: {pendingQueueCount} pending</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-200">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Selected</p>
                  <p className="mt-1 font-medium text-white">{selectedTrailerNumber ?? "None"}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Sync</p>
                  <p className="mt-1 font-medium text-white">{isSyncingQueue ? "Processing" : "Ready"}</p>
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

            {activeTab === "home" ? (
              <HomeTab
                loading={isLoading || isDataLoading}
                trailerCount={trailers.length}
                operations={operations}
                trailers={trailers.slice(0, 6)}
                selectedTrailer={selectedTrailer}
                onSelectTrailer={setSelectedTrailerId}
                onQueueAction={enqueueAction}
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
                onQueueAction={enqueueAction}
                canArrive={canArrive}
                canInspect={canInspect}
                canChangeLoad={canChangeLoad}
                canTimeline={canTimeline}
              />
            ) : null}

            {activeTab === "compound" ? (
              <CompoundTab
                loading={isLoading || isDataLoading}
                selectedTrailer={selectedTrailer}
                selectedTrailerNumber={selectedTrailerNumber}
                compoundTrailers={compoundTrailers}
                movePosition={movePosition}
                loadStatus={loadStatus}
                onSelectTrailer={setSelectedTrailerId}
                onMovePositionChange={setMovePosition}
                onLoadStatusChange={setLoadStatus}
                onQueueMove={handleQueueMove}
                onQueueLoadStatus={handleQueueLoadStatus}
              />
            ) : null}

            {activeTab === "search" ? (
              <SearchTab
                loading={isLoading || isDataLoading}
                query={searchQuery}
                trailers={filteredTrailers}
                onQueryChange={setSearchQuery}
                onSelectTrailer={setSelectedTrailerId}
                onQueueAction={enqueueAction}
              />
            ) : null}

            {activeTab === "more" ? (
              <MoreTab
                roleKey={mobileRoleKey}
                roleLabel={roleLabel}
                queueItems={queueItems}
                syncLog={syncLog}
                canAccessAi={canAccessAi}
                onOpenAssistant={() => setAssistantOpen(true)}
                onClearResolved={() => {
                  setQueueItems((current) => current.filter((item) => item.status === "pending" || item.status === "syncing"));
                  setSyncLog([]);
                }}
                onRetrySync={() => void syncQueuedActions()}
              />
            ) : null}

            <div className="fixed inset-x-3 bottom-3 z-20 mx-auto max-w-lg rounded-[1.4rem] border border-slate-200/80 bg-white/95 px-2 py-2 shadow-[0_12px_40px_rgba(15,23,42,0.16)] backdrop-blur">
              <div className="grid grid-cols-5 gap-1">
                {tabConfig.map((tab) => {
                  const isActive = tab.key === activeTab;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
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
                className="fixed right-4 top-16 inline-flex h-14 w-14 items-center justify-center rounded-full bg-cyan-600 text-white shadow-lg shadow-cyan-700/30"
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
  onQueueAction: (input: { source: MobileTabKey; label: string; commandText: string; trailerNumber?: string | null }) => void;
  canAccessAi: boolean;
  onOpenAssistant: () => void;
};

function HomeTab({ loading, trailerCount, operations, trailers, selectedTrailer, onSelectTrailer, onQueueAction, canAccessAi, onOpenAssistant }: HomeTabProps) {
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
                onAction={() => onQueueAction({ source: "home", label: operation.title, commandText: operation.commandText, trailerNumber: operation.trailerNumber })}
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
  onQueueAction: (input: { source: MobileTabKey; label: string; commandText: string; trailerNumber?: string | null }) => void;
  canArrive: boolean;
  canInspect: boolean;
  canChangeLoad: boolean;
  canTimeline: boolean;
};

function OperationsTab({ loading, operations, trailers, onSelectTrailer, onQueueAction, canArrive, canInspect, canChangeLoad, canTimeline }: OperationsTabProps) {
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
                onAction={() => onQueueAction({ source: "operations", label: operation.title, commandText: operation.commandText, trailerNumber: operation.trailerNumber })}
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
  movePosition: string;
  loadStatus: "Loaded" | "Empty";
  onSelectTrailer: (trailerId: string) => void;
  onMovePositionChange: (value: string) => void;
  onLoadStatusChange: (value: "Loaded" | "Empty") => void;
  onQueueMove: () => void;
  onQueueLoadStatus: () => void;
};

function CompoundTab({ loading, selectedTrailer, selectedTrailerNumber, compoundTrailers, movePosition, loadStatus, onSelectTrailer, onMovePositionChange, onLoadStatusChange, onQueueMove, onQueueLoadStatus }: CompoundTabProps) {
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
          <button type="button" onClick={onQueueMove} disabled={!selectedTrailerNumber || movePosition.trim().length === 0} className="rounded-2xl bg-cyan-600 px-3 py-3 text-sm font-semibold text-white disabled:bg-cyan-300">
            Move
          </button>
        </div>

        <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
          <select value={loadStatus} onChange={(event) => onLoadStatusChange(event.target.value as "Loaded" | "Empty")} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none">
            <option value="Loaded">Loaded</option>
            <option value="Empty">Empty</option>
          </select>
          <button type="button" onClick={onQueueLoadStatus} disabled={!selectedTrailerNumber} className="rounded-2xl bg-slate-950 px-3 py-3 text-sm font-semibold text-white disabled:bg-slate-300">
            Set load
          </button>
        </div>
      </CardShell>

      <CardShell title="Compound trailers" subtitle={loading ? "Refreshing live positions" : "Tap to select a trailer for the tools above"}>
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
  onQueueAction: (input: { source: MobileTabKey; label: string; commandText: string; trailerNumber?: string | null }) => void;
};

function SearchTab({ loading, query, trailers, onQueryChange, onSelectTrailer, onQueueAction }: SearchTabProps) {
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
                <button type="button" onClick={() => onQueueAction({ source: "search", label: `Locate ${trailer.trailerNumber}`, commandText: `where is trailer ${trailer.trailerNumber}`, trailerNumber: trailer.trailerNumber })} className="rounded-2xl bg-cyan-600 px-3 py-2 text-xs font-semibold text-white">
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
  canAccessAi: boolean;
  onOpenAssistant: () => void;
  onClearResolved: () => void;
  onRetrySync: () => void;
};

function MoreTab({ roleKey, roleLabel, queueItems, syncLog, canAccessAi, onOpenAssistant, onClearResolved, onRetrySync }: MoreTabProps) {
  return (
    <section className="space-y-3 pb-24">
      <CardShell title="Voice operations" subtitle={`Current role is ${roleLabel}`}>
        <VoiceOperationsPanel roleKey={roleKey} />
      </CardShell>

      <CardShell title="Queue status" subtitle="Pending actions are stored locally until they can be replayed">
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
                    <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                    <p className="text-xs text-slate-500">{item.commandText}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${item.status === "conflict" ? "bg-amber-100 text-amber-700" : item.status === "failed" ? "bg-rose-100 text-rose-700" : item.status === "syncing" ? "bg-cyan-100 text-cyan-700" : "bg-slate-200 text-slate-700"}`}>
                    {item.status}
                  </span>
                </div>
                {item.error ? <p className="mt-2 text-xs text-rose-700">{item.error}</p> : null}
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
  onAction: () => void;
};

function MobileActionRow({ title, detail, severity, actionLabel, onAction }: MobileActionRowProps) {
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
      <button type="button" onClick={onAction} className="mt-3 inline-flex items-center gap-1 rounded-2xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white">
        {actionLabel}
        <MoveRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}