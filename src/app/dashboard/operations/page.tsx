"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  calculateOperationalReadiness,
  type ReadinessLevel,
} from "@/lib/operational-readiness";
import {
  calculateCollectionAging,
  getCollectionSeverity,
} from "@/lib/collection-aging";

// ============================================================================
// Types
// ============================================================================

type Trailer = {
  id: string;
  trailer_number?: string | null;
  load_status?: string | null;
  customer?: string | null;
  consignee?: string | null;
  compound_position?: string | null;
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
  created_at?: string | null;
  trailer_number?: string | null;
  trailer_compound_position?: string | null;
  trailer_departure_date?: string | null;
  // Collection fields
  delivered_at?: string | null;
  waiting_collection_since?: string | null;
  collection_due_date?: string | null;
  demurrage_free_days?: number | null;
  demurrage_daily_rate?: number | null;
  demurrage_currency?: string | null;
};

type TrailerEvent = {
  id: string;
  trailer_id?: string | null;
  trailer_number: string;
  event_type: string;
  event_description?: string | null;
  created_at?: string | null;
};

type PriorityLevel = "critical" | "high" | "normal";

type PriorityItem = {
  id: string;
  booking: DeliveryBooking;
  priority: PriorityLevel;
  reason: string;
  deliveryTimeMinutes: number | null;
};

type OperationalAlert = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  bookingId?: string;
  trailerId?: string;
  trailerNumber?: string;
};

// ============================================================================
// Date and Time Utilities
// ============================================================================

const getLocalDateKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getDateKey = (value?: string | null) => {
  if (!value) return null;
  try {
    return new Date(value).toISOString().split("T")[0];
  } catch {
    return null;
  }
};

const formatDate = (value: string) => {
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

const formatTime = (value?: string | null) => {
  if (!value) return "—";
  try {
    return value.substring(0, 5);
  } catch {
    return "—";
  }
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

const statusLabel = (status: string) => {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const getTimeUntil = (timeStr?: string | null): number | null => {
  if (!timeStr) return null;
  try {
    const now = new Date();
    const [hours, minutes] = timeStr.split(":").map(Number);
    const delivery = new Date(now);
    delivery.setHours(hours, minutes, 0, 0);
    const diff = delivery.getTime() - now.getTime();
    return Math.floor(diff / 60000); // minutes
  } catch {
    return null;
  }
};

const getNextStatus = (currentStatus: string) => {
  const sequence: Record<string, string> = {
    scheduled: "ready",
    ready: "on_delivery",
    on_delivery: "delivered",
    delivered: "waiting_collection",
    waiting_collection: "collected",
  };
  return sequence[currentStatus] || null;
};

const statusColors: Record<string, { bg: string; text: string; border: string }> = {
  scheduled: { bg: "bg-slate-500/10", text: "text-slate-300", border: "border-slate-500/30" },
  ready: { bg: "bg-emerald-500/10", text: "text-emerald-200", border: "border-emerald-500/30" },
  on_delivery: { bg: "bg-cyan-500/10", text: "text-cyan-200", border: "border-cyan-500/30" },
  delivered: { bg: "bg-emerald-500/10", text: "text-emerald-200", border: "border-emerald-500/30" },
  waiting_collection: { bg: "bg-amber-500/10", text: "text-amber-200", border: "border-amber-500/30" },
  collected: { bg: "bg-emerald-500/10", text: "text-emerald-200", border: "border-emerald-500/30" },
  cancelled: { bg: "bg-rose-500/10", text: "text-rose-200", border: "border-rose-500/30" },
};

// ============================================================================
// Priority Queue Logic
// ============================================================================

const calculatePriority = (
  booking: DeliveryBooking,
  allBookings: DeliveryBooking[],
  allTrailers: Trailer[],
  todayKey: string
): { priority: PriorityLevel; reason: string; minutesUntil: number | null } => {
  const deliveryKey = getDateKey(booking.delivery_date);
  const minutesUntil = getTimeUntil(booking.delivery_time);
  const trailer = allTrailers.find((t) => t.id === booking.trailer_id);
  const isCompleted = booking.status === "collected" || booking.status === "cancelled";
  const isLoadedStatus = (s?: string | null) => s?.trim().toLowerCase() === "loaded";

  // Critical: delivery date is before today and not completed
  if (deliveryKey && deliveryKey < todayKey && !isCompleted) {
    return { priority: "critical", reason: "Delivery overdue.", minutesUntil };
  }

  // Critical: delivery is today, time has passed, still scheduled or ready
  if (deliveryKey === todayKey && minutesUntil !== null && minutesUntil < 0) {
    if (booking.status === "scheduled" || booking.status === "ready") {
      return { priority: "critical", reason: "Delivery overdue.", minutesUntil };
    }
  }

  // Critical: due within 60 minutes and missing important info
  if (deliveryKey === todayKey && minutesUntil !== null && minutesUntil >= 0 && minutesUntil <= 60) {
    if (!booking.delivery_time) {
      return { priority: "critical", reason: "Delivery time missing.", minutesUntil };
    }
    if (!trailer?.compound_position) {
      return { priority: "critical", reason: "Trailer has no compound position.", minutesUntil };
    }
    if (isLoadedStatus(trailer?.load_status) && !trailer?.customer) {
      return { priority: "critical", reason: "Loaded trailer has no customer.", minutesUntil };
    }
  }

  // High: due within 2 hours
  if (deliveryKey === todayKey && minutesUntil !== null && minutesUntil >= 0 && minutesUntil <= 120) {
    return { priority: "high", reason: `Delivery in ${minutesUntil} minutes.`, minutesUntil };
  }

  // High: escort required but not ready
  if (booking.escort_required && booking.status !== "ready" && booking.status !== "on_delivery" && booking.status !== "delivered") {
    return { priority: "high", reason: "Escort required.", minutesUntil };
  }

  // High: today and trailer has no compound position
  if (deliveryKey === todayKey && !trailer?.compound_position) {
    return { priority: "high", reason: "Trailer has no compound position.", minutesUntil };
  }

  // High: today, trailer is loaded but no customer
  if (deliveryKey === todayKey && isLoadedStatus(trailer?.load_status) && !trailer?.customer) {
    return { priority: "high", reason: "Loaded trailer has no customer.", minutesUntil };
  }

  // Normal: scheduled later today
  if (deliveryKey === todayKey) {
    return { priority: "normal", reason: "Scheduled for today.", minutesUntil };
  }

  // Normal: future delivery
  return { priority: "normal", reason: "Upcoming delivery.", minutesUntil };
};

// ============================================================================
// Alert Generation Logic
// ============================================================================

const generateAlerts = (
  bookings: DeliveryBooking[],
  trailers: Trailer[],
  todayKey: string
): OperationalAlert[] => {
  const alerts: OperationalAlert[] = [];
  const seenBookingIds = new Set<string>();

  // Alert: delivery is overdue and not collected or cancelled
  bookings.forEach((booking) => {
    if (seenBookingIds.has(booking.id)) return;
    const deliveryKey = getDateKey(booking.delivery_date);
    if (deliveryKey && deliveryKey < todayKey && booking.status !== "collected" && booking.status !== "cancelled") {
      alerts.push({
        id: `overdue_${booking.id}`,
        severity: "critical",
        title: "Delivery Overdue",
        description: `Delivery scheduled for ${formatDate(booking.delivery_date)} is still ${statusLabel(booking.status).toLowerCase()}.`,
        bookingId: booking.id,
        trailerNumber: booking.trailer_number ?? undefined,
      });
      seenBookingIds.add(booking.id);
    }
  });

  // Alert: delivery is today with no delivery time
  bookings.forEach((booking) => {
    if (seenBookingIds.has(booking.id)) return;
    const deliveryKey = getDateKey(booking.delivery_date);
    if (deliveryKey === todayKey && !booking.delivery_time) {
      alerts.push({
        id: `no_time_${booking.id}`,
        severity: "warning",
        title: "Missing Delivery Time",
        description: `Delivery for today (${booking.customer || booking.consignee || "unknown"}) has no scheduled time.`,
        bookingId: booking.id,
        trailerNumber: booking.trailer_number ?? undefined,
      });
      seenBookingIds.add(booking.id);
    }
  });

  // Alert: delivery today with no compound position
  bookings.forEach((booking) => {
    if (seenBookingIds.has(booking.id)) return;
    const deliveryKey = getDateKey(booking.delivery_date);
    if (deliveryKey === todayKey) {
      const trailer = trailers.find((t) => t.id === booking.trailer_id);
      if (!trailer?.compound_position) {
        alerts.push({
          id: `no_position_${booking.id}`,
          severity: "warning",
          title: "No Compound Position",
          description: `Trailer ${booking.trailer_number || "unknown"} for today's delivery has no compound position assigned.`,
          bookingId: booking.id,
          trailerId: booking.trailer_id,
          trailerNumber: booking.trailer_number ?? undefined,
        });
        seenBookingIds.add(booking.id);
      }
    }
  });

  // Alert: loaded trailer has no customer
  bookings.forEach((booking) => {
    if (seenBookingIds.has(booking.id)) return;
    const trailer = trailers.find((t) => t.id === booking.trailer_id);
    if (trailer) {
      const isLoaded = trailer.load_status?.trim().toLowerCase() === "loaded";
      if (isLoaded && !trailer.customer) {
        alerts.push({
          id: `no_customer_${booking.id}`,
          severity: "warning",
          title: "Loaded Trailer Without Customer",
          description: `Trailer ${booking.trailer_number || "unknown"} is loaded but has no customer assigned.`,
          bookingId: booking.id,
          trailerId: booking.trailer_id,
          trailerNumber: booking.trailer_number ?? undefined,
        });
        seenBookingIds.add(booking.id);
      }
    }
  });

  // Alert: booking requires escort
  bookings.forEach((booking) => {
    if (seenBookingIds.has(booking.id)) return;
    if (booking.escort_required && booking.status !== "on_delivery" && booking.status !== "delivered") {
      alerts.push({
        id: `escort_${booking.id}`,
        severity: "info",
        title: "Escort Required",
        description: `Delivery to ${booking.customer || booking.consignee || "unknown"} requires escort.`,
        bookingId: booking.id,
        trailerNumber: booking.trailer_number ?? undefined,
      });
      seenBookingIds.add(booking.id);
    }
  });

  // Alert: booking status is on_delivery but trailer still has compound position
  bookings.forEach((booking) => {
    if (seenBookingIds.has(booking.id)) return;
    if (booking.status === "on_delivery") {
      const trailer = trailers.find((t) => t.id === booking.trailer_id);
      if (trailer?.compound_position) {
        alerts.push({
          id: `still_at_compound_${booking.id}`,
          severity: "warning",
          title: "Trailer On Delivery But Still At Compound",
          description: `Trailer ${booking.trailer_number || "unknown"} marked as on delivery but still has compound position ${trailer.compound_position}.`,
          bookingId: booking.id,
          trailerId: booking.trailer_id,
          trailerNumber: booking.trailer_number ?? undefined,
        });
        seenBookingIds.add(booking.id);
      }
    }
  });

  // Alert: booking status is waiting_collection — use aging to set severity
  bookings.forEach((booking) => {
    if (seenBookingIds.has(booking.id)) return;
    if (booking.status === "waiting_collection") {
      const aging = calculateCollectionAging({
        delivery_date: booking.delivery_date,
        delivered_at: booking.delivered_at,
        waiting_collection_since: booking.waiting_collection_since,
        collection_due_date: booking.collection_due_date,
      });
      const severity = getCollectionSeverity(aging);
      const overdueNote = aging.isOverdue && aging.overdueDays ? ` ${aging.overdueDays}d overdue.` : "";
      alerts.push({
        id: `waiting_${booking.id}`,
        severity,
        title: severity === "critical" ? "Collection Overdue" : "Waiting For Collection",
        description: `${booking.customer || booking.consignee || "Unknown"} (${booking.trailer_number ?? "—"}) — ${aging.waitingDays} day${aging.waitingDays !== 1 ? "s" : ""} waiting. Collection status: ${aging.agingLabel}.${overdueNote}`,
        bookingId: booking.id,
        trailerNumber: booking.trailer_number ?? undefined,
      });
      seenBookingIds.add(booking.id);
    }
  });

  return alerts;
};

// ============================================================================
// Main Component
// ============================================================================

export default function OperationsPage() {
  const [todayDeliveries, setTodayDeliveries] = useState<DeliveryBooking[]>([]);
  const [allBookings, setAllBookings] = useState<DeliveryBooking[]>([]);
  const [trailers, setTrailers] = useState<Trailer[]>([]);
  const [events, setEvents] = useState<TrailerEvent[]>([]);
  const [priorityQueue, setPriorityQueue] = useState<PriorityItem[]>([]);
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusChanging, setStatusChanging] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const todayKey = getLocalDateKey();

        const [
          { data: bookingsData, error: bookingsError },
          { data: trailersData, error: trailersError },
          { data: eventsData, error: eventsError },
        ] = await Promise.all([
          supabase
            .from("delivery_bookings")
            .select(
              `id, trailer_id, delivery_date, delivery_time, customer, consignee,
               delivery_location, booking_reference, escort_required, status, notes, created_at,
               delivered_at, waiting_collection_since, collection_due_date,
               demurrage_free_days, demurrage_daily_rate, demurrage_currency,
               trailers(id, trailer_number, load_status, customer, consignee, compound_position)`
            )
            .order("delivery_date", { ascending: true })
            .order("delivery_time", { ascending: true }),
          supabase
            .from("trailers")
            .select("id, trailer_number, load_status, customer, consignee, compound_position"),
          supabase
            .from("trailer_events")
            .select("id, trailer_id, trailer_number, event_type, event_description, created_at")
            .order("created_at", { ascending: false })
            .limit(10),
        ]);

        if (bookingsError) {
          console.error("Bookings load error:", {
            message: bookingsError.message,
            details: bookingsError.details,
            hint: bookingsError.hint,
            code: bookingsError.code,
          });
          throw bookingsError;
        }

        if (trailersError) {
          console.error("Trailers load error:", {
            message: trailersError.message,
            details: trailersError.details,
            hint: trailersError.hint,
            code: trailersError.code,
          });
          throw trailersError;
        }

        if (eventsError) {
          console.error("Events load error:", {
            message: eventsError.message,
            details: eventsError.details,
            hint: eventsError.hint,
            code: eventsError.code,
          });
          // Events failure should not block the page
        }

        // Enrich bookings with trailer_number from join
        const enrichedBookings = ((bookingsData ?? []) as Array<Record<string, unknown>>).map((booking) => {
          const joinedTrailer = booking["trailers"] as Record<string, unknown> | null;
          return {
            ...booking,
            trailer_number: (joinedTrailer?.["trailer_number"] as string | null) ?? "—",
            trailer_compound_position: (joinedTrailer?.["compound_position"] as string | null) ?? null,
            trailer_departure_date: (joinedTrailer?.["departure_date"] as string | null) ?? null,
          };
        }) as DeliveryBooking[];

        const trailersList = (trailersData ?? []) as Trailer[];

        // Today's deliveries
        const todayBookings = enrichedBookings.filter(
          (b) => getDateKey(b.delivery_date) === todayKey
        );
        setTodayDeliveries(todayBookings);

        // Exclude collected and cancelled from priority queue
        const activeBookings = enrichedBookings.filter(
          (b) => b.status !== "collected" && b.status !== "cancelled"
        );

        // Calculate priorities with readiness
        const withPrioritiesAndReadiness = activeBookings
          .map((booking) => {
            const { priority, reason, minutesUntil } = calculatePriority(
              booking,
              activeBookings,
              trailersList,
              todayKey
            );

            // Calculate readiness for sorting
            const trailerForReadiness = booking.trailer_id
              ? {
                  id: booking.trailer_id,
                  trailer_number: booking.trailer_number,
                  compound_position: booking.trailer_compound_position,
                  departure_date: booking.trailer_departure_date,
                }
              : null;

            const readiness = calculateOperationalReadiness(
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
              trailerForReadiness,
              todayKey
            );

            return {
              id: booking.id,
              booking,
              priority,
              reason,
              deliveryTimeMinutes: minutesUntil,
              readinessLevel: readiness.level,
            };
          })
          .sort((a, b) => {
            // Primary sort: readiness (action_required > needs_preparation > ready)
            const readinessOrder: Record<ReadinessLevel, number> = {
              action_required: 0,
              needs_preparation: 1,
              ready: 2,
            };

            const readinessDiff = readinessOrder[a.readinessLevel] - readinessOrder[b.readinessLevel];
            if (readinessDiff !== 0) return readinessDiff;

            // Secondary sort: priority level (critical > high > normal)
            const priorityOrder: Record<PriorityLevel, number> = {
              critical: 0,
              high: 1,
              normal: 2,
            };
            if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
              return priorityOrder[a.priority] - priorityOrder[b.priority];
            }

            // Tertiary sort: time until delivery
            if (a.deliveryTimeMinutes === null && b.deliveryTimeMinutes === null) return 0;
            if (a.deliveryTimeMinutes === null) return 1;
            if (b.deliveryTimeMinutes === null) return -1;
            return a.deliveryTimeMinutes - b.deliveryTimeMinutes;
          })
          .slice(0, 8) // Limit to 8 items
          .map((item) => ({
            id: item.id,
            booking: item.booking,
            priority: item.priority,
            reason: item.reason,
            deliveryTimeMinutes: item.deliveryTimeMinutes,
          })); // Remove readiness from final item

        setPriorityQueue(withPrioritiesAndReadiness as PriorityItem[]);

        // Generate alerts
        const generatedAlerts = generateAlerts(enrichedBookings, trailersList, todayKey);
        setAlerts(generatedAlerts);

        setAllBookings(enrichedBookings);
        setTrailers(trailersList);
        setEvents((eventsData ?? []) as TrailerEvent[]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to load operations data.";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    void loadData();
  }, []);

  const handleStatusChange = async (
    bookingId: string,
    currentStatus: string,
    newStatus: string,
    trailerNumber: string,
    trailerId: string
  ) => {
    setStatusChanging(bookingId);

    try {
      const { error: updateError } = await supabase
        .from("delivery_bookings")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", bookingId);

      if (updateError) throw updateError;

      // Create event
      const eventDescription = `Delivery status changed from ${statusLabel(currentStatus)} to ${statusLabel(newStatus)}.`;
      const { error: eventError } = await supabase
        .from("trailer_events")
        .insert({
          trailer_id: trailerId,
          trailer_number: trailerNumber,
          event_type: "delivery_status_changed",
          event_description: eventDescription,
          old_value: { status: currentStatus },
          new_value: { status: newStatus },
        });

      if (eventError) {
        console.error("Event creation failed:", eventError);
      }

      // Update local state
      setAllBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, status: newStatus } : b))
      );
      setTodayDeliveries((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, status: newStatus } : b))
      );

      // Recalculate priority queue and alerts
      const todayKey = getLocalDateKey();
      const activeBookings = allBookings.filter(
        (b) => b.status !== "collected" && b.status !== "cancelled"
      );
      const updatedQueue = activeBookings
        .filter((b) => b.id !== bookingId)
        .concat([
          {
            ...allBookings.find((b) => b.id === bookingId),
            status: newStatus,
          } as DeliveryBooking,
        ])
        .map((booking) => {
          const { priority, reason, minutesUntil } = calculatePriority(
            booking,
            activeBookings,
            trailers,
            todayKey
          );
          return {
            id: booking.id,
            booking,
            priority,
            reason,
            deliveryTimeMinutes: minutesUntil,
          };
        })
        .sort((a, b) => {
          const priorityOrder: Record<PriorityLevel, number> = {
            critical: 0,
            high: 1,
            normal: 2,
          };
          if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
            return priorityOrder[a.priority] - priorityOrder[b.priority];
          }
          if (a.deliveryTimeMinutes === null && b.deliveryTimeMinutes === null) return 0;
          if (a.deliveryTimeMinutes === null) return 1;
          if (b.deliveryTimeMinutes === null) return -1;
          return a.deliveryTimeMinutes - b.deliveryTimeMinutes;
        })
        .slice(0, 8);
      setPriorityQueue(updatedQueue);

      const generatedAlerts = generateAlerts(allBookings, trailers, todayKey);
      setAlerts(generatedAlerts);
    } catch (err) {
      console.error("Status update error:", err);
    } finally {
      setStatusChanging(null);
    }
  };

  // Calculate KPI values
  const deliveriesToday = todayDeliveries.length;
  const readyCount = todayDeliveries.filter((b) => b.status === "ready").length;
  const onDeliveryCount = todayDeliveries.filter((b) => b.status === "on_delivery").length;
  const waitingCount = todayDeliveries.filter((b) => b.status === "waiting_collection").length;
  const alertCount = alerts.length;

  // All-time waiting collection counts (not just today)
  const allWaiting = allBookings.filter((b) => b.status === "waiting_collection");
  const overdueCollections = allWaiting.filter((b) => {
    const aging = calculateCollectionAging({ delivery_date: b.delivery_date, delivered_at: b.delivered_at, waiting_collection_since: b.waiting_collection_since, collection_due_date: b.collection_due_date });
    return aging.isOverdue;
  }).length;
  const attentionRequiredCollections = allWaiting.filter((b) => {
    const aging = calculateCollectionAging({ delivery_date: b.delivery_date, delivered_at: b.delivered_at, waiting_collection_since: b.waiting_collection_since, collection_due_date: b.collection_due_date });
    return aging.agingLevel === "red";
  }).length;
  const oldestWaitingDays = allWaiting.reduce((max, b) => {
    const aging = calculateCollectionAging({ delivery_date: b.delivery_date, delivered_at: b.delivered_at, waiting_collection_since: b.waiting_collection_since, collection_due_date: b.collection_due_date });
    return Math.max(max, aging.waitingDays);
  }, 0);

  // Calculate operational readiness counts
  const readinessCounts = todayDeliveries.reduce(
    (acc, booking) => {
      const trailerForReadiness = booking.trailer_id
        ? {
            id: booking.trailer_id,
            trailer_number: booking.trailer_number,
            compound_position: booking.trailer_compound_position,
            departure_date: booking.trailer_departure_date,
          }
        : null;

      const readiness = calculateOperationalReadiness(
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
        trailerForReadiness,
        getLocalDateKey()
      );

      if (readiness.level === "ready") acc.ready += 1;
      if (readiness.level === "needs_preparation") acc.needsPrep += 1;
      if (readiness.level === "action_required") acc.actionRequired += 1;

      return acc;
    },
    { ready: 0, needsPrep: 0, actionRequired: 0 }
  );

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 text-slate-100">
        {/* Header */}
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">
                Ferryspeed TrailerHub
              </p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Operations Board</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300 sm:text-base">
                Real-time operational dashboard with priority queue and alerts.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/dashboard"
                className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                Back to Dashboard
              </Link>
              <Link
                href="/dashboard/calendar"
                className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                Calendar
              </Link>
              <Link
                href="/dashboard/operations-centre"
                className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                Ops Centre
              </Link>
              <Link
                href="/dashboard/deliveries/new"
                className="rounded-2xl bg-cyan-500 px-4 py-3 text-center text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
              >
                + Create Delivery
              </Link>
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {/* KPI Cards */}
        {isLoading ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-center text-slate-400">
            Loading operations data...
          </div>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Deliveries Today</p>
                <p className="mt-2 text-2xl font-bold text-cyan-300">{deliveriesToday}</p>
              </article>

              <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Ready</p>
                <p className="mt-2 text-2xl font-bold text-emerald-300">{readyCount}</p>
              </article>

              <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">On Delivery</p>
                <p className="mt-2 text-2xl font-bold text-cyan-300">{onDeliveryCount}</p>
              </article>

              <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Waiting Collection</p>
                <p className="mt-2 text-2xl font-bold text-amber-300">{waitingCount}</p>
              </article>

              <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Alerts</p>
                <p className={`mt-2 text-2xl font-bold ${alertCount > 0 ? "text-rose-300" : "text-emerald-300"}`}>
                  {alertCount}
                </p>
              </article>

              {/* Operational Readiness Summary */}
              <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Readiness</p>
                <div className="mt-3 space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-300">🟢 {readinessCounts.ready}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-amber-300">🟡 {readinessCounts.needsPrep}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-rose-300">🔴 {readinessCounts.actionRequired}</span>
                  </div>
                </div>
              </article>
            </section>

            {/* Waiting Collection Summary */}
            {allWaiting.length > 0 ? (
              <section className="rounded-3xl border border-purple-500/20 bg-purple-500/5 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-purple-400">Waiting Collection</p>
                  <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-xs text-purple-300">{allWaiting.length} total</span>
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">Oldest waiting: {oldestWaitingDays}d</span>
                  <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-xs text-rose-300">Attention required: {attentionRequiredCollections}</span>
                  {overdueCollections > 0 ? <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-xs text-rose-300">{overdueCollections} overdue</span> : null}
                  <Link href="/dashboard/deliveries?filter=waiting" className="ml-auto text-xs text-purple-400 hover:underline">View All →</Link>
                </div>
              </section>
            ) : null}

            {/* Today Deliveries */}
            <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">
                    Today Deliveries
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-white">
                    {todayDeliveries.length} scheduled
                  </h2>
                </div>
              </div>

              {todayDeliveries.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-slate-950/80 p-5 text-center text-sm text-slate-400">
                  No deliveries are scheduled for today.
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {todayDeliveries.map((booking) => {
                    const colors = statusColors[booking.status] || statusColors.scheduled;
                    const nextStatus = getNextStatus(booking.status);

                    return (
                      <div
                        key={booking.id}
                        className="rounded-2xl border border-white/10 bg-slate-950/80 p-4 sm:p-5"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex-1">
                            <div className="flex items-baseline gap-2 sm:gap-3">
                              <p className="text-lg font-bold text-white">
                                {formatTime(booking.delivery_time)}
                              </p>
                              <p className="text-cyan-300">{booking.trailer_number}</p>
                            </div>
                            <p className="mt-2 text-sm text-slate-300">
                              {booking.customer || booking.consignee || "Unknown"}{" "}
                              {booking.delivery_location && `→ ${booking.delivery_location}`}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                              {booking.booking_reference ? (
                                <span className="rounded-full border border-white/10 bg-slate-900/70 px-2 py-1">
                                  Ref: {booking.booking_reference}
                                </span>
                              ) : null}
                              {booking.escort_required ? (
                                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-200">
                                  ⚠ Escort
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 sm:items-end">
                            <span className={`rounded-full px-3 py-1 text-xs font-medium ${colors.bg} ${colors.text} border ${colors.border}`}>
                              {statusLabel(booking.status)}
                            </span>

                            <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end">
                              <Link
                                href={`/dashboard/deliveries/${encodeURIComponent(booking.id)}`}
                                className="rounded-xl border border-white/10 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                              >
                                Details
                              </Link>

                              <Link
                                href={`/dashboard/trailers/${encodeURIComponent(booking.trailer_id)}`}
                                className="rounded-xl border border-white/10 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                              >
                                Trailer
                              </Link>

                              {nextStatus && (
                                <button
                                  onClick={() =>
                                    handleStatusChange(
                                      booking.id,
                                      booking.status,
                                      nextStatus,
                                      booking.trailer_number ?? "—",
                                      booking.trailer_id
                                    )
                                  }
                                  disabled={statusChanging === booking.id}
                                  className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {statusChanging === booking.id ? "…" : "Next"}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Priority Queue */}
            <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">
                    Priority Queue
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-white">
                    {priorityQueue.length} item{priorityQueue.length === 1 ? "" : "s"}
                  </h2>
                </div>
              </div>

              {priorityQueue.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-slate-950/80 p-5 text-center text-sm text-slate-400">
                  No items require attention.
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {priorityQueue.map((item) => {
                    const severityColor =
                      item.priority === "critical"
                        ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
                        : item.priority === "high"
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                          : "border-slate-500/30 bg-slate-500/10 text-slate-300";

                    return (
                      <div
                        key={item.id}
                        className={`rounded-2xl border ${severityColor} p-4`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wider">
                                {item.priority}
                              </span>
                              <p className="font-semibold">{item.booking.trailer_number}</p>
                            </div>
                            <p className="mt-2 text-sm">{item.reason}</p>
                            <p className="mt-1 text-xs text-slate-400">
                              {item.booking.customer || item.booking.consignee || "Unknown"}
                            </p>
                          </div>

                          <Link
                            href={`/dashboard/deliveries/${encodeURIComponent(item.id)}`}
                            className="rounded-xl border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                          >
                            View
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {priorityQueue.length > 0 ? (
                <Link
                  href="/dashboard/deliveries"
                  className="mt-5 block rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-center text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20"
                >
                  View All Deliveries
                </Link>
              ) : null}
            </section>

            {/* Operational Alerts */}
            <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">
                    Operational Alerts
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-white">
                    {alerts.length} alert{alerts.length === 1 ? "" : "s"}
                  </h2>
                </div>
              </div>

              {alerts.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-slate-950/80 p-5 text-center text-sm text-slate-400">
                  No operational issues require attention.
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {alerts.map((alert) => {
                    const alertColor =
                      alert.severity === "critical"
                        ? "border-rose-500/30 bg-rose-500/10"
                        : alert.severity === "warning"
                          ? "border-amber-500/30 bg-amber-500/10"
                          : "border-blue-500/30 bg-blue-500/10";

                    const textColor =
                      alert.severity === "critical"
                        ? "text-rose-200"
                        : alert.severity === "warning"
                          ? "text-amber-200"
                          : "text-blue-200";

                    return (
                      <div key={alert.id} className={`rounded-2xl border ${alertColor} p-4`}>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex-1">
                            <p className={`font-semibold ${textColor}`}>{alert.title}</p>
                            <p className="mt-1 text-sm text-slate-300">{alert.description}</p>
                            {alert.trailerNumber ? (
                              <p className="mt-2 text-xs text-slate-400">
                                Trailer: <span className="font-mono font-semibold">{alert.trailerNumber}</span>
                              </p>
                            ) : null}
                          </div>

                          {alert.bookingId ? (
                            <Link
                              href={`/dashboard/deliveries/${encodeURIComponent(alert.bookingId)}`}
                              className="rounded-xl border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                            >
                              View
                            </Link>
                          ) : alert.trailerId ? (
                            <Link
                              href={`/dashboard/trailers/${encodeURIComponent(alert.trailerId)}`}
                              className="rounded-xl border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                            >
                              View
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Latest Activity */}
            <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">
                    Latest Activity
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-white">
                    Recent events
                  </h2>
                </div>
              </div>

              {events.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-slate-950/80 p-5 text-center text-sm text-slate-400">
                  No recent activity is available.
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="flex gap-3 rounded-2xl border border-white/10 bg-slate-950/80 p-4 sm:gap-4 sm:p-5"
                    >
                      <div className="flex flex-col items-center">
                        <div className="mt-1 h-2.5 w-2.5 rounded-full bg-cyan-400" />
                        <div className="mt-2 h-full w-px bg-slate-700" />
                      </div>

                      <div className="flex-1">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
                              {event.event_type || "Event"}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-white">
                              {event.event_description || "Activity recorded"}
                            </p>
                          </div>
                          <p className="text-xs text-slate-400">{formatDateTime(event.created_at)}</p>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <Link
                            href={`/dashboard/trailers/${encodeURIComponent(event.trailer_id || "")}`}
                            className="rounded-full border border-white/10 bg-slate-900/70 px-2.5 py-1 text-slate-300 hover:bg-slate-800"
                          >
                            {event.trailer_number || "Trailer"} →
                          </Link>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
    </div>
  );
}
