"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Home, Ship, Layers3, Truck, SquareStack, AlertTriangle, ThermometerSnowflake, Search } from "lucide-react";
import { PermissionGuard } from "@/components/auth/permission-guard";
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

type MobileTabKey = "home" | "vessel" | "compound" | "departures" | "exports";

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
  | "trailer_number"
  | "customer"
  | "arrival_status"
  | "priority_level"
  | "temperature_required"
  | "expected_front_temperature"
  | "expected_rear_temperature"
  | "expected_temperature_unit"
  | "inspection_completed_at"
  | "has_temperature_alert"
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

const EMPTY_SUMMARY: MobileSummary = {
  inCompound: 0,
  pendingArrivals: 0,
  arrivedCount: 0,
  priorityTrailers: 0,
  temperatureAlerts: 0,
  operationalAlerts: 0,
};

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const formatDateTime = (value?: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
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
  const [compoundFilter, setCompoundFilter] = useState("");
  const [departuresFilter, setDeparturesFilter] = useState("");
  const [exportsFilter, setExportsFilter] = useState("");

  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);
  const [arrivingIds, setArrivingIds] = useState<string[]>([]);
  const [exportActioningIds, setExportActioningIds] = useState<string[]>([]);

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
          .select("id, vessel_operation_id, trailer_number, customer, arrival_status, priority_level, temperature_required, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, inspection_completed_at, has_temperature_alert")
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

      const pendingArrivals = nextVesselTrailers.filter((row) => {
        const status = normalizeText(row.arrival_status);
        return status === "expected" || status === "available_for_arrival";
      }).length;

      const arrivedCount = nextVesselTrailers.filter((row) => normalizeText(row.arrival_status) === "arrived").length;
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

  const activeVessels = useMemo(
    () => vesselOperations.filter((row) => row.status !== "completed" && !row.final_locked_at),
    [vesselOperations],
  );

  const vesselRows = useMemo(() => {
    const normalized = vesselFilter.trim().toLowerCase();
    const selected = selectedVesselId ?? activeVessels[0]?.id ?? null;

    return vesselTrailers.filter((row) => {
      if (!selected || row.vessel_operation_id !== selected) {
        return false;
      }

      if (!normalized) {
        return true;
      }

      return (
        (row.trailer_number ?? "").toLowerCase().includes(normalized) ||
        (row.customer ?? "").toLowerCase().includes(normalized)
      );
    });
  }, [activeVessels, selectedVesselId, vesselFilter, vesselTrailers]);

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

  const markArrived = useCallback(async (row: VesselTrailerRow) => {
    if (arrivingIds.includes(row.id)) {
      return;
    }

    setArrivingIds((current) => [...current, row.id]);
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
            actionType: "MARK_ARRIVED",
            payload: {
              vesselTrailerId: row.id,
              trailerNumber: row.trailer_number ?? undefined,
              operationId: row.vessel_operation_id,
            },
          },
        }),
      });

      const payload = (await response.json()) as { error?: string; message?: string; status?: string };
      if (!response.ok || payload.status === "failed") {
        throw new Error(payload.error ?? payload.message ?? "Unable to confirm arrival.");
      }

      setSuccess(payload.message ?? "Arrival confirmed.");
      await loadData({ showLoading: false });
    } catch (actionErr) {
      setError(actionErr instanceof Error ? actionErr.message : "Unable to confirm arrival.");
    } finally {
      setArrivingIds((current) => current.filter((id) => id !== row.id));
    }
  }, [arrivingIds, loadData]);

  const advanceExport = useCallback(async (row: ExportRow) => {
    if (exportActioningIds.includes(row.id)) {
      return;
    }

    setExportActioningIds((current) => [...current, row.id]);
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
      setExportActioningIds((current) => current.filter((id) => id !== row.id));
    }
  }, [exportActioningIds, loadData]);

  const hasPendingVesselAction = (id: string) => arrivingIds.includes(id);
  const hasPendingExportAction = (id: string) => exportActioningIds.includes(id);

  const selectedVessel = activeVessels.find((row) => row.id === selectedVesselId) ?? activeVessels[0] ?? null;

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
                    <NavBlock icon={<Ship className="h-5 w-5" />} label="Vessel Operations" onPress={() => setActiveTab("vessel")} />
                    <NavBlock icon={<Layers3 className="h-5 w-5" />} label="Compound" onPress={() => setActiveTab("compound")} />
                    <NavBlock icon={<Truck className="h-5 w-5" />} label="Departures" onPress={() => setActiveTab("departures")} />
                    <NavBlock icon={<SquareStack className="h-5 w-5" />} label="Export Operations" onPress={() => setActiveTab("exports")} />
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
                <Card title="Active Vessel Operations" subtitle="Select a vessel, then run arrival or inspection actions.">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {activeVessels.map((vessel) => (
                      <button
                        key={vessel.id}
                        type="button"
                        onClick={() => setSelectedVesselId(vessel.id)}
                        className={`min-w-[220px] rounded-2xl border px-3 py-2 text-left ${selectedVesselId === vessel.id ? "border-cyan-400 bg-cyan-50" : "border-slate-200 bg-white"}`}
                      >
                        <p className="text-sm font-semibold text-slate-900">{vessel.vessel_name ?? "Unnamed vessel"}</p>
                        <p className="text-xs text-slate-600">{vessel.sailing_reference ?? "No reference"}</p>
                        <p className="text-xs text-slate-500">ETA {formatDateTime(vessel.expected_arrival_at)} · ATA {formatDateTime(vessel.actual_arrival_at)}</p>
                      </button>
                    ))}
                  </div>
                </Card>

                <Card
                  title={selectedVessel ? `${selectedVessel.vessel_name ?? "Vessel"} Trailer List` : "Trailer List"}
                  subtitle="One-touch Arrived and direct inspection access using existing vessel backend logic."
                >
                  <div className="mb-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <Search className="h-4 w-4 text-slate-500" />
                    <input
                      value={vesselFilter}
                      onChange={(event) => setVesselFilter(event.target.value)}
                      placeholder="Find trailer or customer"
                      className="w-full bg-transparent text-sm outline-none"
                    />
                  </div>

                  <div className="space-y-2">
                    {vesselRows.length === 0 ? <p className="text-sm text-slate-500">No trailers for this vessel.</p> : null}
                    {vesselRows.map((row) => {
                      const status = normalizeText(row.arrival_status);
                      const canMarkArrived = canArrive && (status === "expected" || status === "available_for_arrival");
                      const pending = hasPendingVesselAction(row.id);

                      return (
                        <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                          <p className="text-lg font-semibold text-slate-900">{row.trailer_number ?? "-"}</p>
                          <p className="text-xs text-slate-600">{row.customer ?? "-"}</p>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                            <InfoPill label="Priority" value={row.priority_level ?? "normal"} />
                            <InfoPill label="Arrival" value={row.arrival_status ?? "-"} />
                            <InfoPill label="Temp" value={row.temperature_required ?? row.expected_front_temperature?.toString() ?? "n/a"} />
                            <InfoPill label="Inspection" value={row.inspection_completed_at ? "done" : "pending"} />
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => void markArrived(row)}
                              disabled={!canMarkArrived || pending}
                              className="rounded-xl bg-cyan-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-cyan-300"
                            >
                              {pending ? "Updating..." : "Arrived"}
                            </button>
                            <Link
                              href={`/dashboard/vessel-operations/${row.vessel_operation_id}/boat-check/${row.id}?returnTo=/dashboard/mobile`}
                              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                            >
                              Inspection
                            </Link>
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
                      const pending = hasPendingExportAction(row.id);

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
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-semibold transition ${isActive ? "bg-slate-950 text-white" : "text-slate-500"}`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
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
