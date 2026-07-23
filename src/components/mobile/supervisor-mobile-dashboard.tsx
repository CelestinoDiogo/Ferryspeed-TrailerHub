"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Bot, ClipboardCheck, LocateFixed, PackageSearch, Search, Ship, Truck } from "lucide-react";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { VoiceOperationsPanel } from "@/components/mobile/voice-operations-panel";
import { canAccessModule, canPerformAction } from "@/lib/auth/permissions";
import { toRoleLabel } from "@/lib/auth/roles";
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
import { useOperationalRealtime } from "@/lib/realtime/operational-realtime";
import { getTrailerCurrentLocationLabel } from "@/lib/trailer-location";
import { supabase } from "@/lib/supabase";

type TrailerRow = Database["public"]["Tables"]["trailers"]["Row"];
type DeliveryBookingRow = Database["public"]["Tables"]["delivery_bookings"]["Row"];
type VesselTrailerRow = Database["public"]["Tables"]["vessel_operation_trailers"]["Row"];

type MobileKpis = {
  inCompound: number;
  arrivalsToday: number;
  waitingCollectionOverdue: number;
  pendingInspection: number;
  temperatureAlerts: number;
  damageAlerts: number;
};

type MobileTrailerCard = {
  id: string;
  trailerNumber: string;
  customer: string;
  loadStatus: string;
  operationalStatus: string;
  compoundPosition: string;
  currentLocation: string;
};

const emptyKpis: MobileKpis = {
  inCompound: 0,
  arrivalsToday: 0,
  waitingCollectionOverdue: 0,
  pendingInspection: 0,
  temperatureAlerts: 0,
  damageAlerts: 0,
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

export function SupervisorMobileDashboard() {
  const { roleKey, fullName, email, isLoading } = useCurrentUser();
  const [query, setQuery] = useState("");
  const [kpis, setKpis] = useState<MobileKpis>(emptyKpis);
  const [trailers, setTrailers] = useState<MobileTrailerCard[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
            .select("id, trailer_id, delivery_date, delivered_at, waiting_collection_since, collection_due_date, status")
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
        const deliveryRows = (deliveryResult.data ?? []) as DeliveryBookingRow[];
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
        });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load mobile dashboard.");
      } finally {
        setIsDataLoading(false);
      }
    }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useOperationalRealtime(["dashboard"], () => {
    void loadData();
  }, { debounceMs: 900 });

  const filteredTrailers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
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
  }, [query, trailers]);

  const userLabel = fullName ?? email ?? "Authenticated User";
  const roleLabel = toRoleLabel(roleKey);
  const isSupervisorMobileRole = roleKey === "supervisor" || roleKey === "administrator";

  const canAccessAi = roleKey ? canAccessModule(roleKey, "ai_assistant") : false;
  const canArrive = roleKey ? canPerformAction(roleKey, "arrivals", "create") : false;
  const canInspect = roleKey ? canPerformAction(roleKey, "vessel_operations", "edit") : false;
  const canChangePosition = roleKey ? canPerformAction(roleKey, "compound", "edit") : false;
  const canChangeLoad = roleKey ? canPerformAction(roleKey, "compound", "edit") : false;
  const canDepart = roleKey ? canPerformAction(roleKey, "departures", "complete") : false;
  const canTimeline = roleKey ? canAccessModule(roleKey, "timeline") : false;

  return (
    <PermissionGuard roleKey={roleKey} moduleKey="dashboard" action="view" allowWhenRoleMissing={false}>
      {!isSupervisorMobileRole ? (
        <section className="min-h-[60vh] px-3 py-6">
          <div className="mx-auto max-w-lg rounded-3xl border border-rose-200 bg-rose-50 p-5 text-rose-800 shadow-sm">
            <h2 className="text-xl font-semibold">Access denied</h2>
            <p className="mt-2 text-sm">You do not have permission to access this area.</p>
          </div>
        </section>
      ) : null}

      {isSupervisorMobileRole ? (
      <main className="min-h-screen bg-slate-100 px-3 py-4 text-slate-900 md:hidden">
        <div className="mx-auto max-w-lg space-y-4">
          <header className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-cyan-700">Master Mobile</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">Supervisor Dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">{userLabel} · {roleLabel}</p>
          </header>

          <VoiceOperationsPanel roleKey={roleKey} />

          <section className="grid grid-cols-2 gap-3">
            <KpiCard label="In Compound" value={kpis.inCompound} icon={<PackageSearch className="h-4 w-4" />} />
            <KpiCard label="Arrivals Today" value={kpis.arrivalsToday} icon={<Truck className="h-4 w-4" />} />
            <KpiCard label="Collection 24h+" value={kpis.waitingCollectionOverdue} icon={<ClipboardCheck className="h-4 w-4" />} />
            <KpiCard label="Pending Inspection" value={kpis.pendingInspection} icon={<Ship className="h-4 w-4" />} />
            <KpiCard label="Temp Alerts" value={kpis.temperatureAlerts} icon={<LocateFixed className="h-4 w-4" />} />
            <KpiCard label="Damage Alerts" value={kpis.damageAlerts} icon={<LocateFixed className="h-4 w-4" />} />
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <label htmlFor="mobile-search" className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Quick Search</label>
            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2">
              <Search className="h-4 w-4 text-slate-500" />
              <input
                id="mobile-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Trailer, position or customer"
                className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
            </div>
          </section>

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
          ) : null}

          <section className="space-y-3 pb-20">
            {isLoading || isDataLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">Loading mobile dashboard...</div>
            ) : filteredTrailers.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">No trailers match your search.</div>
            ) : (
              filteredTrailers.map((trailer) => (
                <article key={trailer.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold text-slate-900">{trailer.trailerNumber}</p>
                      <p className="text-xs text-slate-500">{trailer.customer}</p>
                    </div>
                    <Link href={`/dashboard/trailers/${trailer.id}`} className="rounded-xl border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                      Open
                    </Link>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <InfoRow label="Position" value={trailer.compoundPosition} />
                    <InfoRow label="Load" value={trailer.loadStatus} />
                    <InfoRow label="Status" value={trailer.operationalStatus} />
                    <InfoRow label="Location" value={trailer.currentLocation} />
                  </dl>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <QuickActionButton label="Arrived" href="/dashboard/new-arrival" enabled={canArrive} />
                    <QuickActionButton label="Inspection" href="/dashboard/vessel-operations" enabled={canInspect} />
                    <QuickActionButton label="Change Position" href={`/dashboard/edit-trailer?id=${encodeURIComponent(trailer.id)}`} enabled={canChangePosition} />
                    <QuickActionButton label="Change Load" href="/dashboard/load-trailer" enabled={canChangeLoad} />
                    <QuickActionButton label="Confirm Departed" href="/dashboard/departure" enabled={canDepart} />
                    <QuickActionButton label="Timeline" href="/dashboard/trailer-timeline" enabled={canTimeline} />
                  </div>
                </article>
              ))
            )}
          </section>
        </div>

        {canAccessAi ? (
          <Link
            href="/dashboard/ai-assistant"
            className="fixed bottom-5 right-5 inline-flex h-14 w-14 items-center justify-center rounded-full bg-cyan-600 text-white shadow-lg shadow-cyan-700/30"
            aria-label="Open AI Assistant"
          >
            <Bot className="h-6 w-6" />
          </Link>
        ) : null}
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
};

function KpiCard({ label, value, icon }: KpiCardProps) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between text-slate-500">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">{label}</p>
        {icon}
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
      <span className="rounded-xl border border-slate-200 bg-slate-100 px-2 py-2 text-center text-[11px] font-semibold text-slate-400">
        {label}
      </span>
    );
  }

  return (
    <Link href={href} className="rounded-xl border border-cyan-200 bg-cyan-50 px-2 py-2 text-center text-[11px] font-semibold text-cyan-800">
      {label}
    </Link>
  );
}
