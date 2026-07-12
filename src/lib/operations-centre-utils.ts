import { calculateOperationalReadiness, getDateKey, type ReadinessLevel } from "@/lib/operational-readiness";

export type OpsTrailer = {
  id: string;
  trailer_number?: string | null;
  load_status?: string | null;
  customer?: string | null;
  consignee?: string | null;
  compound_position?: string | null;
  arrival_date?: string | null;
  departure_date?: string | null;
};

export type OpsBooking = {
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
  delivered_at?: string | null;
  waiting_collection_since?: string | null;
  collection_due_date?: string | null;
  trailer_number?: string | null;
  trailer_compound_position?: string | null;
  trailer_departure_date?: string | null;
};

export type PriorityLevel = "critical" | "high" | "normal";

export type PriorityItem = {
  id: string;
  booking: OpsBooking;
  priority: PriorityLevel;
  reason: string;
  deliveryTimeMinutes: number | null;
};

const getTimeUntil = (timeStr?: string | null): number | null => {
  if (!timeStr) return null;
  try {
    const now = new Date();
    const [hours, minutes] = timeStr.split(":").map(Number);
    const delivery = new Date(now);
    delivery.setHours(hours, minutes, 0, 0);
    const diff = delivery.getTime() - now.getTime();
    return Math.floor(diff / 60000);
  } catch {
    return null;
  }
};

export const calculatePriority = (
  booking: OpsBooking,
  allTrailers: OpsTrailer[],
  todayKey: string
): { priority: PriorityLevel; reason: string; minutesUntil: number | null } => {
  const deliveryKey = getDateKey(booking.delivery_date);
  const minutesUntil = getTimeUntil(booking.delivery_time);
  const trailer = allTrailers.find((t) => t.id === booking.trailer_id);
  const isCompleted = booking.status === "collected" || booking.status === "cancelled";
  const isLoadedStatus = (s?: string | null) => s?.trim().toLowerCase() === "loaded";

  if (deliveryKey && deliveryKey < todayKey && !isCompleted) {
    return { priority: "critical", reason: "Delivery overdue.", minutesUntil };
  }

  if (deliveryKey === todayKey && minutesUntil !== null && minutesUntil < 0) {
    if (booking.status === "scheduled" || booking.status === "ready") {
      return { priority: "critical", reason: "Delivery overdue.", minutesUntil };
    }
  }

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

  if (deliveryKey === todayKey && minutesUntil !== null && minutesUntil >= 0 && minutesUntil <= 120) {
    return { priority: "high", reason: `Delivery in ${minutesUntil} minutes.`, minutesUntil };
  }

  if (booking.escort_required && booking.status !== "ready" && booking.status !== "on_delivery" && booking.status !== "delivered") {
    return { priority: "high", reason: "Escort required.", minutesUntil };
  }

  if (deliveryKey === todayKey && !trailer?.compound_position) {
    return { priority: "high", reason: "Trailer has no compound position.", minutesUntil };
  }

  if (deliveryKey === todayKey && isLoadedStatus(trailer?.load_status) && !trailer?.customer) {
    return { priority: "high", reason: "Loaded trailer has no customer.", minutesUntil };
  }

  if (deliveryKey === todayKey) {
    return { priority: "normal", reason: "Scheduled for today.", minutesUntil };
  }

  return { priority: "normal", reason: "Upcoming delivery.", minutesUntil };
};

export const buildPriorityQueue = (
  bookings: OpsBooking[],
  trailers: OpsTrailer[],
  todayKey: string,
  limit = 8
): PriorityItem[] => {
  const activeBookings = bookings.filter((b) => b.status !== "collected" && b.status !== "cancelled");

  const withPriorities = activeBookings
    .map((booking) => {
      const { priority, reason, minutesUntil } = calculatePriority(booking, trailers, todayKey);

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
      const readinessOrder: Record<ReadinessLevel, number> = {
        action_required: 0,
        needs_preparation: 1,
        ready: 2,
      };

      const readinessDiff = readinessOrder[a.readinessLevel] - readinessOrder[b.readinessLevel];
      if (readinessDiff !== 0) return readinessDiff;

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
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      booking: item.booking,
      priority: item.priority,
      reason: item.reason,
      deliveryTimeMinutes: item.deliveryTimeMinutes,
    }));

  return withPriorities;
};
