"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

// ============================================================================
// Types
// ============================================================================

type TrailerRecord = {
  id: string;
  trailer_number: string | null;
  load_status?: string | null;
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
};

type FilterType = "all" | "ready" | "needs_preparation" | "action_required" | "empty" | "waiting_collection" | "today";

// ============================================================================
// Constants
// ============================================================================

const COMPOUND_POSITIONS = Array.from({ length: 50 }, (_, index) => `P${String(index + 1).padStart(2, "0")}`);

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
  const [trailers, setTrailers] = useState<TrailerRecord[]>([]);
  const [bookings, setBookings] = useState<DeliveryBooking[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [selectedPosition, setSelectedPosition] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load trailers and bookings in parallel ÔÇö single round trip
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const todayKey = getLocalDateKey();

        const [
          { data: trailersData, error: trailersError },
          { data: bookingsData, error: bookingsError },
          { data: exportAllocationsData, error: exportAllocationsError },
        ] = await Promise.all([
          supabase
            .from("trailers")
            .select(
              "id, trailer_number, load_status, customer, consignee, container_number, compound_position, departure_date, is_local, trailer_source, external_company"
            )
            .is("departure_date", null)
            .neq("is_local", true)
            .order("compound_position", { ascending: true }),
          supabase
            .from("delivery_bookings")
            .select(
              "id, trailer_id, delivery_date, delivery_time, customer, consignee, delivery_location, booking_reference, escort_required, status, notes"
            )
            .not("status", "in", '("collected","cancelled")')
            .gte("delivery_date", todayKey),
          supabase
            .from("export_allocations")
            .select("trailer_id, status, updated_at")
            .in("status", [...EXPORT_ACTIVE_STATUS_QUERY_VALUES]),
        ]);

        if (trailersError) {
          console.error("[Compound] Trailers error:", trailersError);
          throw trailersError;
        }
        if (bookingsError) {
          console.error("[Compound] Bookings error:", bookingsError);
          // Non-fatal ÔÇö we can still show trailer positions
        }
        if (exportAllocationsError) {
          throw exportAllocationsError;
        }

        const statusByTrailerId = buildActiveExportStatusByTrailerId(
          ((exportAllocationsData ?? []) as Array<{ trailer_id?: string | null; status?: string | null; updated_at?: string | null }>),
        );

        const visibleTrailers = ((trailersData ?? []) as TrailerRecord[]).filter((trailer) =>
          isTrailerEligibleForCompoundViews(trailer, statusByTrailerId.get(trailer.id)),
        );

        setTrailers(visibleTrailers);
        setBookings((bookingsData ?? []) as DeliveryBooking[]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to load compound data.";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    void loadData();
  }, []);

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
        return { position, trailer: null, booking: null, readiness: null, readinessReason: null, hasDeliveryToday: false };
      }

      const booking = bookingByTrailer.get(trailer.id) ?? null;
      const deliveryKey = booking ? getDateKey(booking.delivery_date) : null;
      const hasDeliveryToday = deliveryKey === todayKey;

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

      return { position, trailer, booking, readiness, readinessReason, hasDeliveryToday };
    });
  }, [trailers, bookings]);

  // Unassigned trailers (no valid position)
  const unassignedTrailers = useMemo(() => {
    const positionSet = new Set(COMPOUND_POSITIONS);
    return trailers.filter((t) => {
      const pos = normalizeCompoundPosition(t.compound_position);
      return !pos || !positionSet.has(pos);
    });
  }, [trailers]);

  // Apply search then filter ÔÇö no Supabase queries
  const filteredPositions = useMemo((): PositionState[] => {
    const term = search.trim().toLowerCase();

    return allPositionStates.filter((state) => {
      // Search filter
      if (term) {
        const haystack = [
          state.trailer?.trailer_number,
          state.trailer?.customer,
          state.trailer?.consignee,
          state.position,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }

      // Category filter
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
  }, [allPositionStates, search, filter]);

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
                Live operational map ÔÇö position, readiness and delivery status at a glance.
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
              <PrintFilters items={[{ label: "Filter", value: FILTERS.find((item) => item.value === filter)?.label ?? "All" }, { label: "Search", value: search.trim() || "Current filtered positions" }]} />
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
                { key: "customer", header: "Customer", render: (state) => state.trailer?.customer ?? "ÔÇö" },
                { key: "load_status", header: "Load", render: (state) => state.trailer?.load_status ?? "ÔÇö" },
                { key: "booking_status", header: "Booking Status", render: (state) => state.booking ? statusLabel(state.booking.status) : "No Booking" },
                { key: "readiness", header: "Readiness", render: (state) => getReadinessLabel(state.readiness) },
                { key: "time", header: "Delivery Time", render: (state) => state.booking?.delivery_time ? formatTime(state.booking.delivery_time) : "ÔÇö" },
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

            {/* Search + Filters */}
            <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by trailer, customer or positionÔÇª"
                  className="flex-1 rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {FILTERS.map(({ value, label }) => (
                  <button
                    key={value}
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
            </section>

            {/* Position Grid */}
            <section className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
              {filteredPositions.map((state) => {
                const colours = getPositionColours(state);
                const isSelected = selectedPosition === state.position;

                return (
                  <article
                    key={state.position}
                    onClick={() => setSelectedPosition(isSelected ? null : state.position)}
                    className={`cursor-pointer rounded-2xl border p-3 shadow-md transition hover:ring-1 hover:ring-cyan-400/50 ${colours.border} ${colours.bg} ${isSelected ? "ring-2 ring-cyan-400" : ""}`}
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
                          {state.trailer.trailer_number ?? "ÔÇö"}
                        </p>

                        {/* Customer */}
                        {state.trailer.customer ? (
                          <p className="truncate text-xs text-slate-400">{state.trailer.customer}</p>
                        ) : null}

                        {/* Load Status */}
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">
                          {state.trailer.load_status ?? "Unknown"}
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
                      <p className="mt-2 text-xs text-slate-400">Position: {trailer.compound_position ?? "ÔÇö"}</p>
                      <p className="mt-1 text-xs text-slate-400">Load: {trailer.load_status ?? "Unknown"}</p>
                      <p className="mt-1 text-xs text-slate-400">Customer: {trailer.customer ?? "ÔÇö"}</p>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
