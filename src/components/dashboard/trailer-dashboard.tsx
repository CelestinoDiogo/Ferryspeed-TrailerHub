"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PrintButton } from "@/components/print/print-button";
import { PrintFilters } from "@/components/print/print-filters";
import { PrintFooter } from "@/components/print/print-footer";
import { PrintHeader } from "@/components/print/print-header";
import { PrintReportLayout } from "@/components/print/print-report-layout";
import { PrintSummary } from "@/components/print/print-summary";
import { PrintTable } from "@/components/print/print-table";
import { supabase } from "@/lib/supabase";
import {
  calculateCollectionAging,
} from "@/lib/collection-aging";
import {
  isExportAllocationActive,
  isExportAllocationOverdue,
  normalizeExportAllocationRecord,
  type ExportAllocationRecord,
} from "@/lib/export-allocation";

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

type OperationalAlert = {
  id: string;
  type: "missing_position" | "high_occupancy" | "loaded_no_customer" | "incomplete_info";
  severity: "warning" | "alert";
  title: string;
  description: string;
  trailerId?: string;
  trailerNumber?: string;
  href?: string;
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

export function TrailerDashboard() {
  const searchParams = useSearchParams();
  const [stats, setStats] = useState<DashboardStats>(defaultStats);
  const [trailers, setTrailers] = useState<TrailerRecord[]>([]);
  const [events, setEvents] = useState<TrailerEvent[]>([]);
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);
  const [todayDeliveries, setTodayDeliveries] = useState<DeliveryBooking[]>([]);
  const [waitingCollections, setWaitingCollections] = useState<WaitingCollectionItem[]>([]);
  const [waitingCollectionSummary, setWaitingCollectionSummary] = useState<WaitingCollectionSummary>({ count: 0, attentionRequiredCount: 0, oldestTrailer: null, oldestDays: 0 });
  const [exportSummary, setExportSummary] = useState<ExportSummary>(defaultExportSummary);
  const [vesselOperations, setVesselOperations] = useState<VesselOperationCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const saved = searchParams.get("saved");
  const notice = saved === "1" ? "Operation saved successfully. Dashboard refreshed." : null;

  useEffect(() => {
    const loadStats = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const todayKey = getDateKey(new Date().toISOString());

        const [{ data, error: supabaseError }, { data: eventsData, error: eventsError }, { data: deliveriesData, error: deliveriesError }, { data: waitingData }, { data: exportAllocationsData, error: exportAllocationsError }, { data: vesselData, error: vesselError }] =
          await Promise.all([
            supabase.from("trailers").select("id, trailer_number, load_status, arrival_date, departure_date, compound_position, customer, load_description, trailer_source, external_company, external_reference, is_local"),
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
              .select("id, trailer_id, status, expected_return_at, shipped_at"),
            supabase
              .from("vessel_operations")
              .select("id, vessel_name, sailing_reference, expected_arrival_at, actual_arrival_at, status, created_at")
              .order("expected_arrival_at", { ascending: true })
              .limit(4)
          ]);

        if (supabaseError) throw supabaseError;
        if (eventsError) throw eventsError;
        if (deliveriesError) throw deliveriesError;
        if (exportAllocationsError) throw exportAllocationsError;
        if (vesselError) throw vesselError;

        const trailers = (data ?? []) as TrailerRecord[];
        const exportAllocations = ((exportAllocationsData ?? []) as ExportAllocationRecord[]).map((row) =>
          normalizeExportAllocationRecord(row),
        );
        setVesselOperations((vesselData ?? []) as VesselOperationCard[]);
        setTrailers(trailers);

        const activeTrailers = trailers.filter((item) => {
          const departureDate = item.departure_date;
          return departureDate === null || departureDate === undefined || departureDate === "";
        });

        const localTrailers = activeTrailers.filter((item) => item.is_local === true);
        const compoundTrailers = activeTrailers.filter((item) => item.is_local !== true);

        const normalizedLoadStatus = (value?: string | null) => value?.trim().toLowerCase();

        const activeExportAllocations = exportAllocations.filter((item) => isExportAllocationActive(item.status));

        const trailersWithActiveExportAllocation = new Set<string>(activeExportAllocations.map((item) => item.trailer_id));

        const availableEmptyTrailers = compoundTrailers.filter(
          (item) => normalizedLoadStatus(item.load_status) === "empty" && !trailersWithActiveExportAllocation.has(item.id)
        ).length;

        const loadedTrailers = compoundTrailers.filter(
          (item) => normalizedLoadStatus(item.load_status) === "loaded"
        ).length;

        const activeCount = compoundTrailers.length;
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
        waitingList.forEach((b) => {
          const aging = calculateCollectionAging({
            delivery_date: b["delivery_date"] as string,
            delivered_at: b["delivered_at"] as string | null,
            waiting_collection_since: b["waiting_collection_since"] as string | null,
            collection_due_date: b["collection_due_date"] as string | null,
          });
          if (aging.agingLevel === "red") attentionRequiredCount++;
          if (aging.waitingDays > oldestDays) {
            oldestDays = aging.waitingDays;
            oldestTrailer = ((b["trailers"] as Record<string, unknown> | null)?.["trailer_number"] as string | null) ?? null;
          }
        });
        setWaitingCollectionSummary({ count: waitingList.length, attentionRequiredCount, oldestTrailer, oldestDays });

        // Generate operational alerts
        const generatedAlerts: OperationalAlert[] = [];

        // Check for trailers without compound position
        const trailersWithoutPosition = compoundTrailers.filter(
          (t) => !t.compound_position || t.compound_position.trim() === ""
        );
        if (trailersWithoutPosition.length > 0) {
          generatedAlerts.push({
            id: "missing_position_alert",
            type: "missing_position",
            severity: "alert",
            title: `${trailersWithoutPosition.length} Trailer${trailersWithoutPosition.length === 1 ? "" : "s"} Without Position`,
            description: `${trailersWithoutPosition.length} trailer${trailersWithoutPosition.length === 1 ? "" : "s"} not yet assigned to a compound position.`,
            trailerNumber: trailersWithoutPosition[0]?.trailer_number ?? undefined,
          });
        }

        // Check for high occupancy (above 80%)
        if (occupancy > 80) {
          generatedAlerts.push({
            id: "high_occupancy_alert",
            type: "high_occupancy",
            severity: "warning",
            title: "Compound Occupancy High",
            description: `Compound is at ${occupancy}% capacity. Plan departures to maintain operations.`,
          });
        }

        // Check for loaded trailers without customer
        const loadedTrailersNoCustomer = compoundTrailers.filter((t) => {
          const isLoaded = normalizedLoadStatus(t.load_status) === "loaded";
          const hasCustomer = t.customer && t.customer.trim() !== "";
          return isLoaded && !hasCustomer;
        });
        if (loadedTrailersNoCustomer.length > 0) {
          generatedAlerts.push({
            id: "loaded_no_customer_alert",
            type: "loaded_no_customer",
            severity: "warning",
            title: `${loadedTrailersNoCustomer.length} Loaded Trailer${loadedTrailersNoCustomer.length === 1 ? "" : "s"} Without Customer`,
            description: `${loadedTrailersNoCustomer.length} loaded trailer${loadedTrailersNoCustomer.length === 1 ? "" : "s"} missing customer information.`,
            trailerNumber: loadedTrailersNoCustomer[0]?.trailer_number ?? undefined,
          });
        }

        // Check for incomplete information (loaded without description)
        const loadedTrailersNoDescription = compoundTrailers.filter((t) => {
          const isLoaded = normalizedLoadStatus(t.load_status) === "loaded";
          const hasDescription = t.load_description && t.load_description.trim() !== "";
          return isLoaded && !hasDescription;
        });
        if (loadedTrailersNoDescription.length > 0) {
          generatedAlerts.push({
            id: "incomplete_info_alert",
            type: "incomplete_info",
            severity: "warning",
            title: `${loadedTrailersNoDescription.length} Trailer${loadedTrailersNoDescription.length === 1 ? "" : "s"} Missing Load Description`,
            description: `${loadedTrailersNoDescription.length} loaded trailer${loadedTrailersNoDescription.length === 1 ? "" : "s"} without load description.`,
            trailerNumber: loadedTrailersNoDescription[0]?.trailer_number ?? undefined,
          });
        }

        if (overdueExportAllocations.length > 0) {
          generatedAlerts.push({
            id: "export_overdue_alert",
            type: "incomplete_info",
            severity: "alert",
            title: `${overdueExportAllocations.length} Export Allocation${overdueExportAllocations.length === 1 ? "" : "s"} Overdue`,
            description: `${overdueExportAllocations.length} export allocation${overdueExportAllocations.length === 1 ? "" : "s"} exceeded expected return time.`,
            href: "/dashboard/export-operations?filter=overdue",
          });
        }

        setAlerts(generatedAlerts);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : JSON.stringify(err);
        setError(message);
        setStats(defaultStats);
        setEvents([]);
        setAlerts([]);
        setTrailers([]);
        setTodayDeliveries([]);
        setWaitingCollections([]);
        setWaitingCollectionSummary({ count: 0, attentionRequiredCount: 0, oldestTrailer: null, oldestDays: 0 });
        setExportSummary(defaultExportSummary);
      } finally {
        setIsLoading(false);
      }
    };

    void loadStats();
  }, [saved]);

  const statsCards: Array<{
    title: string;
    value: string;
    detail: string;
    accent: string;
    labelClass: string;
    href: string;
  }> = [
    {
      title: "Trailers in Compound",
      value: stats.totalTrailers.toString(),
      detail: "Currently active",
      accent: "bg-[var(--fs-green)]",
      labelClass: "text-[var(--fs-green-light)]",
      href: "/dashboard/search?filter=compound",
    },
    {
      title: "Available Empty",
      value: stats.availableEmptyTrailers.toString(),
      detail: "Compound empty and not allocated",
      accent: "bg-[var(--fs-emerald)]",
      labelClass: "text-[var(--fs-emerald)]",
      href: "/dashboard/search?status=empty",
    },
    {
      title: "Loaded Trailers",
      value: stats.loadedTrailers.toString(),
      detail: "Ready for departure",
      accent: "bg-[var(--fs-orange)]",
      labelClass: "text-[var(--fs-orange)]",
      href: "/dashboard/search?status=loaded",
    },
    {
      title: "Local Trailers",
      value: stats.localTrailers.toString(),
      detail: "Excluded from compound",
      accent: "bg-[var(--fs-indigo)]",
      labelClass: "text-[var(--fs-indigo)]",
      href: "/dashboard/search?filter=local",
    },
    {
      title: "Allocated",
      value: stats.allocatedTrailers.toString(),
      detail: "Assigned for export loading",
      accent: "bg-[var(--fs-cyan)]",
      labelClass: "text-[var(--fs-cyan)]",
      href: "/dashboard/export-operations?filter=allocated",
    },
    {
      title: "At Customer",
      value: stats.atCustomerTrailers.toString(),
      detail: "Delivered empty or waiting loading",
      accent: "bg-[var(--fs-orange)]",
      labelClass: "text-[var(--fs-orange)]",
      href: "/dashboard/export-operations?filter=at_customer",
    },
    {
      title: "Waiting Collection",
      value: waitingCollectionSummary.count.toString(),
      detail: "Delivery bookings pending pickup",
      accent: "bg-[var(--fs-purple)]",
      labelClass: "text-[var(--fs-purple)]",
      href: "/dashboard/deliveries?filter=waiting",
    },
    {
      title: "Compound Occupancy",
      value: `${stats.occupancy}%`,
      detail: "Space utilization",
      accent: "bg-[var(--fs-green-light)]",
      labelClass: "text-[var(--fs-green-light)]",
      href: "/dashboard/compound",
    },
  ];

  const recentArrivals = trailers
    .filter((item) => getDateKey(item.arrival_date) !== null)
    .sort((a, b) => new Date(b.arrival_date ?? 0).getTime() - new Date(a.arrival_date ?? 0).getTime())
    .slice(0, 8);

  const recentDepartures = trailers
    .filter((item) => getDateKey(item.departure_date) !== null)
    .sort((a, b) => new Date(b.departure_date ?? 0).getTime() - new Date(a.departure_date ?? 0).getTime())
    .slice(0, 8);

  const occupancyDashOffset = 282.7 - ((Math.max(0, Math.min(100, stats.occupancy)) / 100) * 282.7);
  const printedAt = getPrintedDateTime();

  const statusClass = (status?: string | null) => {
    if (!status) return "fs-status fs-status-scheduled";
    return `fs-status fs-status-${status.toLowerCase()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-3xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel)] px-6 py-7 shadow-xl">
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--fs-border-strong)] bg-white/5 px-3 py-1 text-xs font-semibold text-[var(--fs-text-muted)]">
            <span className="h-2 w-2 rounded-full bg-[var(--fs-green-light)]" aria-hidden="true" />
            <span>Live Operations</span>
          </div>
          <p className="mt-5 text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300">Ferryspeed TrailerHub</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--fs-text)] sm:text-4xl">Operational Dashboard</h1>
          <p className="mt-3 text-base text-[var(--fs-text-muted)]">Live overview of compound and trailer operations.</p>
          <div className="mt-4">
            <PrintButton label="Print / Export Summary" disabled={isLoading} />
          </div>
        </div>
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
          rows={alerts.slice(0, 8)}
          columns={[
            { key: "title", header: "Urgent / Exception", render: (alert) => alert.title },
            { key: "severity", header: "Severity", render: (alert) => alert.severity },
            { key: "description", header: "Description", render: (alert) => alert.description },
            { key: "trailer", header: "Trailer", render: (alert) => alert.trailerNumber ?? "—" },
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
          <div className="rounded-2xl border border-[var(--fs-border)] bg-[var(--fs-panel)] px-4 py-3 text-sm text-[var(--fs-text)]">
            {notice}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-[color:var(--fs-red)]/45 bg-[color:var(--fs-red)]/12 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          {statsCards.map((card) => (
            <Link key={card.title} href={card.href} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fs-green-light)]">
              <KpiCard
                label={card.title}
                value={isLoading ? "..." : card.value}
                supportingText={card.detail}
                accentClass={card.accent}
                labelClass={card.labelClass}
              />
            </Link>
          ))}
      </section>

      <DashboardSection
        title="Vessel Operations"
        subtitle="Live ferry workflow and inspection pipeline."
        action={<Link href="/dashboard/vessel-operations" className="text-sm text-[var(--fs-green-light)] hover:underline">Open module</Link>}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {vesselOperations.length === 0 ? (
            <p className="rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel-strong)] p-4 text-sm text-[var(--fs-text-muted)] md:col-span-2 xl:col-span-4">No active vessel operations at the moment.</p>
          ) : (
            vesselOperations.map((operation) => (
              <Link key={operation.id} href="/dashboard/vessel-operations" className="rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel-strong)] p-4 transition hover:border-white/20 hover:bg-[var(--fs-panel-hover)]">
                <p className="text-sm font-semibold text-[var(--fs-text)]">{operation.vessel_name ?? "Unnamed vessel"}</p>
                <p className="mt-1 text-xs text-[var(--fs-text-muted)]">{operation.sailing_reference ?? "No reference"}</p>
                <p className="mt-2 text-2xl font-bold text-cyan-200">{operation.status ?? "unknown"}</p>
                <p className="mt-1 text-xs text-[var(--fs-text-muted)]">ETA {operation.expected_arrival_at ? new Date(operation.expected_arrival_at).toLocaleString("en-GB") : "—"}</p>
              </Link>
            ))
          )}
        </div>
      </DashboardSection>

      <DashboardSection
        title="Operational Alerts"
        subtitle="Highlighted issues requiring immediate action."
        action={<span className="rounded-full border border-[var(--fs-border-strong)] bg-white/5 px-2.5 py-1 text-xs text-[var(--fs-text-muted)]">{alerts.length} active</span>}
      >
        <div className="space-y-3">
          {alerts.length === 0 ? (
            <p className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm text-emerald-100">No operational alerts. All monitored areas are clear.</p>
          ) : (
            alerts.map((alert) => (
              <div key={alert.id} className={`rounded-2xl border p-4 ${alert.severity === "alert" ? "border-rose-400/35 bg-rose-500/14" : "border-amber-400/35 bg-amber-500/14"}`}>
                <p className="text-sm font-semibold text-[var(--fs-text)]">{alert.title}</p>
                <p className="mt-1.5 text-sm text-[var(--fs-text-muted)]">{alert.description}</p>
                {alert.trailerNumber ? <p className="mt-2 text-xs text-[var(--fs-text-muted)]">Trailer: {alert.trailerNumber}</p> : null}
                {alert.href ? <Link href={alert.href} className="mt-2 inline-block text-xs font-semibold text-cyan-200 underline hover:text-cyan-100">Open</Link> : null}
              </div>
            ))
          )}
        </div>
      </DashboardSection>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <DashboardSection title="Compound Occupancy" subtitle="Live operational capacity with fallback-readable values.">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative h-32 w-32 sm:h-36 sm:w-36">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
                <circle cx="50" cy="50" r="45" stroke="rgba(105,190,157,0.28)" strokeWidth="8" fill="none" />
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  stroke="var(--fs-green-light)"
                  strokeWidth="8"
                  fill="none"
                  strokeDasharray="282.7"
                  strokeDashoffset={occupancyDashOffset}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center text-2xl font-bold tracking-tight text-[var(--fs-text)]">{stats.occupancy}%</div>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-2.5 text-sm">
              <div className="rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel-strong)] p-3.5">
                <p className="text-sm text-[var(--fs-text-muted)]">Occupied</p>
                <p className="mt-1 text-2xl font-bold text-[var(--fs-text)]">{stats.totalTrailers}</p>
              </div>
              <div className="rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel-strong)] p-3.5">
                <p className="text-sm text-[var(--fs-text-muted)]">Total Positions</p>
                <p className="mt-1 text-2xl font-bold text-[var(--fs-text)]">{COMPOUND_POSITIONS}</p>
              </div>
              <div className="col-span-2 rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel-strong)] p-3.5">
                <p className="text-sm text-[var(--fs-text-muted)]">Available Positions</p>
                <p className="mt-1 text-2xl font-bold text-[var(--fs-green-light)]">{Math.max(0, COMPOUND_POSITIONS - stats.totalTrailers)}</p>
              </div>
            </div>
          </div>
        </DashboardSection>

        <DashboardSection title="Export Operations" subtitle="Compact overview of current export allocation workload.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Link href="/dashboard/export-operations?filter=allocated" className="rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel-strong)] p-4 transition hover:border-white/20 hover:bg-[var(--fs-panel-hover)]">
              <p className="text-sm font-semibold text-[var(--fs-text)]">Allocated</p>
              <p className="mt-2 text-3xl font-bold text-cyan-200">{exportSummary.allocated}</p>
            </Link>
            <Link href="/dashboard/export-operations?filter=at_customer" className="rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel-strong)] p-4 transition hover:border-white/20 hover:bg-[var(--fs-panel-hover)]">
              <p className="text-sm font-semibold text-[var(--fs-text)]">At Customer</p>
              <p className="mt-2 text-3xl font-bold text-amber-200">{exportSummary.atCustomer}</p>
            </Link>
            <Link href="/dashboard/export-operations?filter=collected_loaded" className="rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel-strong)] p-4 transition hover:border-white/20 hover:bg-[var(--fs-panel-hover)]">
              <p className="text-sm font-semibold text-[var(--fs-text)]">Collected Loaded</p>
              <p className="mt-2 text-3xl font-bold text-orange-200">{exportSummary.collectedLoaded}</p>
            </Link>
            <Link href="/dashboard/export-operations?filter=overdue" className="rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel-strong)] p-4 transition hover:border-white/20 hover:bg-[var(--fs-panel-hover)]">
              <p className="text-sm font-semibold text-[var(--fs-text)]">Overdue</p>
              <p className="mt-2 text-3xl font-bold text-rose-200">{exportSummary.overdue}</p>
            </Link>
          </div>
        </DashboardSection>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <DashboardSection title="Waiting Collection" subtitle="Collection aging and pending pickups" action={<Link href="/dashboard/deliveries?filter=waiting" className="text-sm text-[var(--fs-green-light)] hover:underline">View all</Link>}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel-strong)] p-3.5"><p className="text-sm text-[var(--fs-text-muted)]">Total Waiting</p><p className="mt-1 text-2xl font-bold text-[var(--fs-text)]">{waitingCollectionSummary.count}</p></div>
            <div className="rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel-strong)] p-3.5"><p className="text-sm text-[var(--fs-text-muted)]">Oldest Waiting</p><p className="mt-1 text-2xl font-bold text-[var(--fs-text)]">{waitingCollectionSummary.oldestDays}d</p></div>
            <div className="rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel-strong)] p-3.5"><p className="text-sm text-[var(--fs-text-muted)]">Attention Required</p><p className="mt-1 text-2xl font-bold text-rose-200">{waitingCollectionSummary.attentionRequiredCount}</p></div>
          </div>
          <div className="mt-4 space-y-2">
            {waitingCollections.slice(0, 5).map((item) => {
              const aging = calculateCollectionAging({
                delivery_date: item.delivery_date,
                delivered_at: item.delivered_at,
                waiting_collection_since: item.waiting_collection_since,
                collection_due_date: item.collection_due_date,
              });
              const waitingClass = aging.agingLevel === "red" ? "fs-status-attention" : aging.agingLevel === "amber" ? "fs-status-monitor" : "fs-status-ready";
              return (
                <div key={item.id} className="rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel-strong)] p-3 transition-colors hover:bg-[var(--fs-panel-hover)]">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-[var(--fs-text)]">{item.trailer_number ?? "--"}</p>
                    <span className={`fs-status ${waitingClass}`}>{aging.agingLabel}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </DashboardSection>

        <DashboardSection
          title="Recent Arrivals"
          subtitle="Latest trailer check-ins"
          action={<Link href="/dashboard/search?filter=arrivals_today" className="text-sm text-[var(--fs-green-light)] hover:underline">View all</Link>}
        >
          <div className="space-y-2">
            {recentArrivals.length === 0 ? <p className="text-sm text-[var(--fs-text-muted)]">No recent arrivals.</p> : recentArrivals.map((row) => (
              <div key={row.id} className="rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel-strong)] px-3.5 py-3 transition-colors hover:bg-[var(--fs-panel-hover)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--fs-text)]">{row.trailer_number ?? "--"}</p>
                  <p className="text-xs text-[var(--fs-text-muted)]">{row.arrival_date ? new Date(row.arrival_date).toLocaleDateString("en-GB") : "No date"}</p>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <p className="text-sm text-[var(--fs-text-muted)]">{row.customer ?? "No customer"}</p>
                  <span className={statusClass(row.load_status)}>{row.load_status ?? "unknown"}</span>
                </div>
              </div>
            ))}
          </div>
        </DashboardSection>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <DashboardSection
          title="Recent Departures"
          subtitle="Latest trailer releases"
          action={<Link href="/dashboard/search?filter=departures_today" className="text-sm text-[var(--fs-green-light)] hover:underline">View all</Link>}
        >
          <div className="space-y-2">
            {recentDepartures.length === 0 ? <p className="text-sm text-[var(--fs-text-muted)]">No recent departures.</p> : recentDepartures.map((row) => (
              <div key={row.id} className="rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel-strong)] px-3.5 py-3 transition-colors hover:bg-[var(--fs-panel-hover)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--fs-text)]">{row.trailer_number ?? "--"}</p>
                  <p className="text-xs text-[var(--fs-text-muted)]">{row.departure_date ? new Date(row.departure_date).toLocaleDateString("en-GB") : "No date"}</p>
                </div>
                <p className="mt-1 text-sm text-[var(--fs-text-muted)]">{row.customer ?? "No customer"}</p>
              </div>
            ))}
          </div>
        </DashboardSection>

        <DashboardSection title="Latest Activity" subtitle="Real events from trailer operations">
          <div className="space-y-2">
            {events.length === 0 ? (
              <p className="text-sm text-[var(--fs-text-muted)]">No recent activity available.</p>
            ) : (
              events.map((event) => (
                <div key={event.id} className="rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel-strong)] px-3.5 py-3 transition-colors hover:bg-[var(--fs-panel-hover)]">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-[var(--fs-text)]">{event.trailer_number}</p>
                        <span className="rounded-full border border-[var(--fs-border-strong)] bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fs-text-muted)]">
                          {event.event_type === "movement_reversed" ? "Undo" : event.event_type.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--fs-text)]">{event.event_type === "movement_reversed" ? "Movement Reversed" : event.event_description ?? "No description"}</p>
                      {event.event_type !== "movement_reversed" && event.event_description ? (
                        <p className="mt-1 text-xs text-[var(--fs-text-muted)]">{event.event_type.replace(/_/g, " ")}</p>
                      ) : null}
                    </div>
                    <p className="text-xs text-[var(--fs-text-muted)]">{event.created_at ? new Date(event.created_at).toLocaleString("en-GB") : "Unknown"}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </DashboardSection>
      </div>

      <DashboardSection
        title="Planned Deliveries"
        subtitle="Today bookings and live status"
        action={<Link href="/dashboard/deliveries" className="text-sm text-[var(--fs-green-light)] hover:underline">View all</Link>}
      >
        <div className="space-y-2">
          {todayDeliveries.length === 0 ? (
            <p className="text-sm text-[var(--fs-text-muted)]">No deliveries scheduled for today.</p>
          ) : (
            todayDeliveries.map((booking) => (
              <Link key={booking.id} href={`/dashboard/deliveries/${booking.id}`} className="block rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel-strong)] px-3.5 py-3 hover:bg-[var(--fs-panel-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fs-green-light)]">
                <div className="grid gap-2 sm:grid-cols-[5rem_8rem_1fr_auto] sm:items-center sm:gap-3">
                  <p className="text-sm font-semibold text-[var(--fs-text)]">{booking.delivery_time ? booking.delivery_time.substring(0, 5) : "--:--"}</p>
                  <p className="text-sm font-semibold text-cyan-200">{booking.trailer_number ?? "--"}</p>
                  <p className="text-sm text-[var(--fs-text-muted)]">{booking.customer || booking.consignee || booking.delivery_location || "No customer"}</p>
                  <div className="flex justify-start sm:justify-end">
                    <span className={statusClass(booking.status)}>{booking.status.replace(/_/g, " ")}</span>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </DashboardSection>
    </div>
  );
}