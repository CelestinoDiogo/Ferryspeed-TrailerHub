"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionCard } from "@/components/dashboard/action-card";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { supabase } from "@/lib/supabase";
import {
  calculateCollectionAging,
} from "@/lib/collection-aging";

type DashboardStats = {
  totalTrailers: number;
  emptyTrailers: number;
  loadedTrailers: number;
  maintenanceTrailers: number;
  arrivalsToday: number;
  departuresToday: number;
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

type OperationalAlert = {
  id: string;
  type: "missing_position" | "high_occupancy" | "loaded_no_customer" | "incomplete_info";
  severity: "warning" | "alert";
  title: string;
  description: string;
  trailerId?: string;
  trailerNumber?: string;
};

const defaultStats: DashboardStats = {
  totalTrailers: 0,
  emptyTrailers: 0,
  loadedTrailers: 0,
  maintenanceTrailers: 0,
  arrivalsToday: 0,
  departuresToday: 0,
  occupancy: 0,
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

export function TrailerDashboard() {
  const searchParams = useSearchParams();
  const [stats, setStats] = useState<DashboardStats>(defaultStats);
  const [trailers, setTrailers] = useState<TrailerRecord[]>([]);
  const [events, setEvents] = useState<TrailerEvent[]>([]);
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);
  const [todayDeliveries, setTodayDeliveries] = useState<DeliveryBooking[]>([]);
  const [waitingCollections, setWaitingCollections] = useState<WaitingCollectionItem[]>([]);
  const [waitingCollectionSummary, setWaitingCollectionSummary] = useState<WaitingCollectionSummary>({ count: 0, attentionRequiredCount: 0, oldestTrailer: null, oldestDays: 0 });
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

        const [{ data, error: supabaseError }, { data: eventsData, error: eventsError }, { data: deliveriesData, error: deliveriesError }, { data: waitingData }] =
          await Promise.all([
            supabase.from("trailers").select("id, trailer_number, load_status, arrival_date, departure_date, compound_position, customer, load_description"),
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
          ]);

        if (supabaseError) throw supabaseError;
        if (eventsError) throw eventsError;
        if (deliveriesError) throw deliveriesError;

        const trailers = (data ?? []) as TrailerRecord[];
        setTrailers(trailers);

        const activeTrailers = trailers.filter((item) => {
          const departureDate = item.departure_date;
          return departureDate === null || departureDate === undefined || departureDate === "";
        });

        const normalizedLoadStatus = (value?: string | null) => value?.trim().toLowerCase();

        const emptyTrailers = activeTrailers.filter(
          (item) => normalizedLoadStatus(item.load_status) === "empty"
        ).length;

        const loadedTrailers = activeTrailers.filter(
          (item) => normalizedLoadStatus(item.load_status) === "loaded"
        ).length;

        const maintenanceTrailers = activeTrailers.length - emptyTrailers - loadedTrailers;

        const arrivalsToday = trailers.filter(
          (item) => getDateKey(item.arrival_date) === todayKey
        ).length;

        const departuresToday = trailers.filter(
          (item) => getDateKey(item.departure_date) === todayKey
        ).length;

        const activeCount = activeTrailers.length;
        const occupancy = Math.min(
          100,
          Math.round((activeCount / COMPOUND_POSITIONS) * 100)
        );

        setStats({
          totalTrailers: activeCount,
          emptyTrailers,
          loadedTrailers,
          maintenanceTrailers,
          arrivalsToday,
          departuresToday,
          occupancy,
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
        const trailersWithoutPosition = activeTrailers.filter(
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
        const loadedTrailersNoCustomer = activeTrailers.filter((t) => {
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
        const loadedTrailersNoDescription = activeTrailers.filter((t) => {
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
      } finally {
        setIsLoading(false);
      }
    };

    void loadStats();
  }, [saved]);

  const statsCards = [
    {
      title: "Trailers in Compound",
      value: stats.totalTrailers.toString(),
      detail: "Currently active",
      accent: "from-cyan-500 to-blue-600",
    },
    {
      title: "Empty Trailers",
      value: stats.emptyTrailers.toString(),
      detail: "Ready for loading",
      accent: "from-emerald-500 to-teal-600",
    },
    {
      title: "Loaded Trailers",
      value: stats.loadedTrailers.toString(),
      detail: "Ready for departure",
      accent: "from-amber-500 to-orange-600",
    },
    {
      title: "Today's Arrivals",
      value: stats.arrivalsToday.toString(),
      detail: "Arrived today",
      accent: "from-violet-500 to-fuchsia-600",
    },
    {
      title: "Today's Departures",
      value: stats.departuresToday.toString(),
      detail: "Departed today",
      accent: "from-rose-500 to-red-600",
    },
    {
      title: "Compound Occupancy",
      value: `${stats.occupancy}%`,
      detail: "Space utilization",
      accent: "from-slate-600 to-slate-800",
    },
    {
      title: "Maintenance",
      value: stats.maintenanceTrailers.toString(),
      detail: "Needs review",
      accent: "bg-[var(--fs-red)]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
          <path d="m7 17 10-10M8 8l2 2m6 6 2 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      title: "Waiting Collection",
      value: waitingCollectionSummary.count.toString(),
      detail: "Ready for pickup",
      accent: "bg-[var(--fs-purple)]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 8v4l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  const actionCards = [
    { href: "/dashboard/new-arrival", title: "New Arrival", description: "Register incoming trailer", accentClass: "bg-[var(--fs-green)]" },
    { href: "/dashboard/departure", title: "Departure", description: "Dispatch and release trailer", accentClass: "bg-[var(--fs-red)]" },
    { href: "/dashboard/compound", title: "Compound", description: "View yard positions", accentClass: "bg-[var(--fs-blue)]" },
    { href: "/dashboard/load-trailer", title: "Load Trailer", description: "Update cargo and status", accentClass: "bg-[var(--fs-orange)]" },
    { href: "/dashboard/deliveries", title: "Deliveries", description: "Track live bookings", accentClass: "bg-[var(--fs-purple)]" },
    { href: "/dashboard/operations-centre", title: "Operations Centre", description: "Open daily command view", accentClass: "bg-[var(--fs-blue)]" },
    { href: "/dashboard/search", title: "Search", description: "Find trailer records quickly", accentClass: "bg-[var(--fs-panel-strong)]" },
    { href: "/dashboard/edit-trailer", title: "Edit Trailer", description: "Correct trailer data", accentClass: "bg-[var(--fs-panel-strong)]" },
    { href: "/dashboard/calendar", title: "Calendar", description: "Plan operations schedule", accentClass: "bg-[var(--fs-blue)]" },
    { href: "/dashboard/company-trailers", title: "Fleet", description: "Company trailer overview", accentClass: "bg-[var(--fs-green)]" },
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

  const statusClass = (status?: string | null) => {
    if (!status) return "fs-status fs-status-scheduled";
    return `fs-status fs-status-${status.toLowerCase()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <DashboardSection
        title="Dashboard"
        subtitle="Professional overview of compound, departures, arrivals and live operational load."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {actionCards.map((action) => (
            <ActionCard
              key={action.href}
              href={action.href}
              title={action.title}
              description={action.description}
              accentClass={action.accentClass}
              icon={
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                  <path d="M6 12h12M12 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              }
            />
          ))}
        </div>
      </DashboardSection>

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

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {statsCards.map((card) => (
            <KpiCard
              key={card.title}
              label={card.title}
              value={isLoading ? "..." : card.value}
              supportingText={card.detail}
              accentClass={card.accent}
              icon={card.icon as React.ReactNode}
            />
          ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <DashboardSection title="Compound Occupancy" subtitle="Live operational capacity with fallback-readable values.">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative h-28 w-28">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
                <circle cx="50" cy="50" r="45" stroke="rgba(105,190,157,0.2)" strokeWidth="8" fill="none" />
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
              <div className="absolute inset-0 flex items-center justify-center text-xl font-bold text-[var(--fs-text)]">{stats.occupancy}%</div>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-[var(--fs-border)] bg-[var(--fs-panel-strong)] p-3">
                <p className="text-[var(--fs-text-muted)]">Occupied</p>
                <p className="mt-1 text-xl font-bold">{stats.totalTrailers}</p>
              </div>
              <div className="rounded-xl border border-[var(--fs-border)] bg-[var(--fs-panel-strong)] p-3">
                <p className="text-[var(--fs-text-muted)]">Total Positions</p>
                <p className="mt-1 text-xl font-bold">{COMPOUND_POSITIONS}</p>
              </div>
              <div className="rounded-xl border border-[var(--fs-border)] bg-[var(--fs-panel-strong)] p-3 col-span-2">
                <p className="text-[var(--fs-text-muted)]">Available Positions</p>
                <p className="mt-1 text-xl font-bold">{Math.max(0, COMPOUND_POSITIONS - stats.totalTrailers)}</p>
              </div>
            </div>
          </div>
        </DashboardSection>

        <DashboardSection
          title="Operational Alerts"
          subtitle="Highlighted issues requiring immediate action."
          action={<span className="rounded-full border border-[var(--fs-border)] px-2.5 py-1 text-xs text-[var(--fs-text-muted)]">{alerts.length} active</span>}
        >
          <div className="space-y-2.5">
            {alerts.length === 0 ? (
              <p className="rounded-xl border border-[var(--fs-border)] bg-[var(--fs-panel-strong)] p-3 text-sm text-[var(--fs-text-muted)]">No operational alerts.</p>
            ) : (
              alerts.map((alert) => (
                <div key={alert.id} className={`rounded-xl border p-3 ${alert.severity === "alert" ? "border-[color:var(--fs-red)]/45 bg-[color:var(--fs-red)]/12" : "border-[color:var(--fs-orange)]/45 bg-[color:var(--fs-orange)]/12"}`}>
                  <p className="font-semibold text-sm">{alert.title}</p>
                  <p className="mt-1 text-sm text-[var(--fs-text-muted)]">{alert.description}</p>
                  {alert.trailerNumber ? <p className="mt-1 text-xs text-[var(--fs-text-muted)]">Trailer: {alert.trailerNumber}</p> : null}
                </div>
              ))
            )}
          </div>
        </DashboardSection>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <DashboardSection
          title="Recent Arrivals"
          subtitle="Latest trailer check-ins"
          action={<Link href="/dashboard/new-arrival" className="text-sm text-[var(--fs-green-light)] hover:underline">View all</Link>}
        >
          <div className="space-y-2">
            {recentArrivals.length === 0 ? <p className="text-sm text-[var(--fs-text-muted)]">No recent arrivals.</p> : recentArrivals.map((row) => (
              <div key={row.id} className="rounded-xl border border-[var(--fs-border)] bg-[var(--fs-panel-strong)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{row.trailer_number ?? "--"}</p>
                  <span className={statusClass(row.load_status)}>{row.load_status ?? "unknown"}</span>
                </div>
                <p className="mt-1 text-sm text-[var(--fs-text-muted)]">{row.arrival_date ? new Date(row.arrival_date).toLocaleDateString("en-GB") : "No date"}</p>
              </div>
            ))}
          </div>
        </DashboardSection>

        <DashboardSection
          title="Recent Departures"
          subtitle="Latest trailer releases"
          action={<Link href="/dashboard/departure" className="text-sm text-[var(--fs-green-light)] hover:underline">View all</Link>}
        >
          <div className="space-y-2">
            {recentDepartures.length === 0 ? <p className="text-sm text-[var(--fs-text-muted)]">No recent departures.</p> : recentDepartures.map((row) => (
              <div key={row.id} className="rounded-xl border border-[var(--fs-border)] bg-[var(--fs-panel-strong)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{row.trailer_number ?? "--"}</p>
                  <p className="text-xs text-[var(--fs-text-muted)]">{row.departure_date ? new Date(row.departure_date).toLocaleDateString("en-GB") : "No date"}</p>
                </div>
                <p className="mt-1 text-sm text-[var(--fs-text-muted)]">{row.customer ?? "No customer"}</p>
              </div>
            ))}
          </div>
        </DashboardSection>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <DashboardSection title="Waiting Collection" subtitle="Collection aging and pending pickups" action={<Link href="/dashboard/deliveries?filter=waiting_collection" className="text-sm text-[var(--fs-green-light)] hover:underline">View all</Link>}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--fs-border)] bg-[var(--fs-panel-strong)] p-3"><p className="text-xs text-[var(--fs-text-muted)]">Total Waiting</p><p className="mt-1 text-2xl font-bold">{waitingCollectionSummary.count}</p></div>
            <div className="rounded-xl border border-[var(--fs-border)] bg-[var(--fs-panel-strong)] p-3"><p className="text-xs text-[var(--fs-text-muted)]">Oldest Waiting</p><p className="mt-1 text-2xl font-bold">{waitingCollectionSummary.oldestDays}d</p></div>
            <div className="rounded-xl border border-[var(--fs-border)] bg-[var(--fs-panel-strong)] p-3"><p className="text-xs text-[var(--fs-text-muted)]">Attention Required</p><p className="mt-1 text-2xl font-bold text-[color:var(--fs-red)]">{waitingCollectionSummary.attentionRequiredCount}</p></div>
          </div>
          <div className="mt-3 space-y-2">
            {waitingCollections.slice(0, 5).map((item) => {
              const aging = calculateCollectionAging({
                delivery_date: item.delivery_date,
                delivered_at: item.delivered_at,
                waiting_collection_since: item.waiting_collection_since,
                collection_due_date: item.collection_due_date,
              });
              return (
                <div key={item.id} className="rounded-xl border border-[var(--fs-border)] bg-[var(--fs-panel-strong)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{item.trailer_number ?? "--"}</p>
                    <span className={`fs-status ${aging.agingLevel === "red" ? "fs-status-maintenance" : aging.agingLevel === "amber" ? "fs-status-loaded" : "fs-status-ready"}`}>{aging.agingLabel}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </DashboardSection>

        <DashboardSection title="Latest Activity" subtitle="Real events from trailer operations">
          <div className="space-y-2.5">
            {events.length === 0 ? (
              <p className="text-sm text-[var(--fs-text-muted)]">No recent activity available.</p>
            ) : (
              events.map((event) => (
                <div key={event.id} className="rounded-xl border border-[var(--fs-border)] bg-[var(--fs-panel-strong)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{event.trailer_number}</p>
                    <p className="text-xs text-[var(--fs-text-muted)]">{event.created_at ? new Date(event.created_at).toLocaleString("en-GB") : "Unknown"}</p>
                  </div>
                  <p className="mt-1 text-sm text-[var(--fs-text-muted)]">{event.event_type}</p>
                  <p className="mt-1 text-sm">{event.event_description ?? "No description"}</p>
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
              <Link key={booking.id} href={`/dashboard/deliveries/${booking.id}`} className="block rounded-xl border border-[var(--fs-border)] bg-[var(--fs-panel-strong)] p-3 hover:bg-[color:var(--fs-green)]/14 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fs-green-light)]">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">{booking.delivery_time ? booking.delivery_time.substring(0, 5) : "--:--"} - {booking.trailer_number ?? "--"}</p>
                    <p className="text-sm text-[var(--fs-text-muted)]">{booking.customer || booking.consignee || booking.delivery_location || "No customer"}</p>
                  </div>
                  <span className={statusClass(booking.status)}>{booking.status.replace(/_/g, " ")}</span>
                </div>
              </Link>
            ))
          )}
        </div>
      </DashboardSection>
    </div>
  );
}