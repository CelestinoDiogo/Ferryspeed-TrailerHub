// Operational Readiness Calculation Logic
// Deterministic calculation based on booking and trailer data

export type ReadinessLevel = "ready" | "needs_preparation" | "action_required";

export type ReadinessResult = {
  level: ReadinessLevel;
  reason: string;
  details: ReadinessChecklistItem[];
};

export type ReadinessChecklistItem = {
  label: string;
  value: boolean;
  optional?: boolean;
};

// Get local date in YYYY-MM-DD format
export const getLocalDateKey = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Parse date to YYYY-MM-DD
export const getDateKey = (value?: string | null): string | null => {
  if (!value) return null;
  try {
    return new Date(value).toISOString().split("T")[0];
  } catch {
    return null;
  }
};

// Get minutes until delivery time
export const getTimeUntil = (timeStr?: string | null): number | null => {
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

type BookingData = {
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

type TrailerData = {
  id: string;
  trailer_number?: string | null;
  load_status?: string | null;
  customer?: string | null;
  consignee?: string | null;
  compound_position?: string | null;
  departure_date?: string | null;
};

/**
 * Calculate operational readiness for a booking
 * @param booking - The delivery booking
 * @param trailer - The associated trailer
 * @param todayKey - Today's date in YYYY-MM-DD format
 * @returns ReadinessResult with level, reason, and checklist
 */
export const calculateOperationalReadiness = (
  booking: BookingData,
  trailer: TrailerData | null | undefined,
  todayKey: string
): ReadinessResult => {
  // Helper: is trailer active?
  const isTrailerActive = !trailer?.departure_date;

  // Helper: is status in valid delivery states?
  const isValidDeliveryStatus = ["scheduled", "ready", "on_delivery"].includes(booking.status);

  // Helper: has field?
  const hasField = (value: unknown): boolean => {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    return true;
  };

  // Helper: get minutes until delivery
  const minutesUntil = getTimeUntil(booking.delivery_time);

  // Helper: is delivery today?
  const deliveryKey = getDateKey(booking.delivery_date);
  const isToday = deliveryKey === todayKey;

  // Build checklist
  const checklist: ReadinessChecklistItem[] = [
    {
      label: "Trailer Assigned",
      value: hasField(booking.trailer_id),
    },
    {
      label: "Trailer Active",
      value: isTrailerActive,
    },
    {
      label: "Compound Position",
      value: hasField(trailer?.compound_position),
    },
    {
      label: "Delivery Date",
      value: hasField(booking.delivery_date),
    },
    {
      label: "Delivery Time",
      value: hasField(booking.delivery_time),
    },
    {
      label: "Customer",
      value: hasField(booking.customer),
    },
    {
      label: "Status Valid",
      value: isValidDeliveryStatus,
    },
  ];

  // Add optional fields to checklist
  if (booking.escort_required) {
    checklist.push({
      label: "Escort",
      value: booking.status === "ready",
    });
  }

  if (hasField(booking.booking_reference)) {
    checklist.push({
      label: "Booking Reference",
      value: true,
      optional: true,
    });
  }

  if (hasField(booking.consignee)) {
    checklist.push({
      label: "Consignee",
      value: true,
      optional: true,
    });
  }

  // Determine readiness level
  // ACTION REQUIRED
  if (!hasField(booking.trailer_id)) {
    return {
      level: "action_required",
      reason: "No trailer assigned.",
      details: checklist,
    };
  }

  if (!isTrailerActive) {
    return {
      level: "action_required",
      reason: "Trailer is not active.",
      details: checklist,
    };
  }

  if (!isValidDeliveryStatus) {
    return {
      level: "action_required",
      reason: `Invalid status: ${booking.status}.`,
      details: checklist,
    };
  }

  // Delivery overdue
  if (deliveryKey && deliveryKey < todayKey) {
    return {
      level: "action_required",
      reason: "Delivery overdue.",
      details: checklist,
    };
  }

  // Delivery today with time passed
  if (isToday && minutesUntil !== null && minutesUntil < 0) {
    return {
      level: "action_required",
      reason: "Delivery time passed.",
      details: checklist,
    };
  }

  // Delivery within 60 minutes - strict requirements
  if (isToday && minutesUntil !== null && minutesUntil >= 0 && minutesUntil <= 60) {
    if (!hasField(booking.delivery_time)) {
      return {
        level: "action_required",
        reason: "Delivery time missing (imminent).",
        details: checklist,
      };
    }

    if (!hasField(trailer?.compound_position)) {
      return {
        level: "action_required",
        reason: "No compound position (imminent).",
        details: checklist,
      };
    }

    if (!hasField(booking.customer)) {
      return {
        level: "action_required",
        reason: "No customer (imminent).",
        details: checklist,
      };
    }

    // All critical fields present within 60 min window
    if (booking.escort_required && booking.status !== "ready") {
      return {
        level: "action_required",
        reason: "Escort required but not ready (imminent).",
        details: checklist,
      };
    }
  }

  // READY: All critical requirements met
  if (
    hasField(booking.trailer_id) &&
    isTrailerActive &&
    hasField(trailer?.compound_position) &&
    hasField(booking.delivery_date) &&
    hasField(booking.delivery_time) &&
    hasField(booking.customer) &&
    isValidDeliveryStatus &&
    (!booking.escort_required || booking.status === "ready")
  ) {
    return {
      level: "ready",
      reason: "Everything complete.",
      details: checklist,
    };
  }

  // NEEDS PREPARATION: Valid but preparation required
  // Missing optional info
  if (!hasField(booking.booking_reference)) {
    return {
      level: "needs_preparation",
      reason: "Booking reference missing.",
      details: checklist,
    };
  }

  // Escort required but not ready
  if (booking.escort_required && booking.status !== "ready") {
    return {
      level: "needs_preparation",
      reason: "Escort required.",
      details: checklist,
    };
  }

  // Delivery today but more than 2 hours away
  if (isToday && minutesUntil !== null && minutesUntil > 120) {
    return {
      level: "needs_preparation",
      reason: `Delivery in ${minutesUntil} minutes.`,
      details: checklist,
    };
  }

  // Delivery in future, valid but needs prep
  if (deliveryKey && deliveryKey > todayKey) {
    return {
      level: "needs_preparation",
      reason: "Scheduled for future delivery.",
      details: checklist,
    };
  }

  // Default to needs preparation
  return {
    level: "needs_preparation",
    reason: "Preparation in progress.",
    details: checklist,
  };
};

/**
 * Get styling for readiness level
 */
export const getReadinessColor = (level: ReadinessLevel): { bg: string; text: string; border: string; dot: string } => {
  switch (level) {
    case "ready":
      return {
        bg: "bg-emerald-500/10",
        text: "text-emerald-200",
        border: "border-emerald-500/30",
        dot: "bg-emerald-400",
      };
    case "needs_preparation":
      return {
        bg: "bg-amber-500/10",
        text: "text-amber-200",
        border: "border-amber-500/30",
        dot: "bg-amber-400",
      };
    case "action_required":
      return {
        bg: "bg-rose-500/10",
        text: "text-rose-200",
        border: "border-rose-500/30",
        dot: "bg-rose-400",
      };
  }
};

/**
 * Get display emoji for readiness level
 */
export const getReadinessEmoji = (level: ReadinessLevel): string => {
  switch (level) {
    case "ready":
      return "🟢";
    case "needs_preparation":
      return "🟡";
    case "action_required":
      return "🔴";
  }
};

/**
 * Get readable label for readiness level
 */
export const getReadinessLabel = (level: ReadinessLevel): string => {
  switch (level) {
    case "ready":
      return "Ready";
    case "needs_preparation":
      return "Needs Preparation";
    case "action_required":
      return "Action Required";
  }
};
