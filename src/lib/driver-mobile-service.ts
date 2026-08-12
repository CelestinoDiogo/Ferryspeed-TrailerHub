import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createTrailerActivity } from "@/lib/trailer-activity";
import type { Database } from "@/lib/database.types";
import { loadActiveDriverForUser, type DriverRow } from "@/lib/driver-access";

type RouteSupabase = SupabaseClient<Database>;
type DeliveryBookingRow = Database["public"]["Tables"]["delivery_bookings"]["Row"];

const driverBookingSelect =
  "id, trailer_id, driver_id, delivery_date, delivery_time, customer, consignee, delivery_location, booking_reference, escort_required, status, notes, created_at, updated_at, delivered_at, waiting_collection_since, collection_due_date, collected_at, demurrage_free_days, demurrage_daily_rate, demurrage_currency, demurrage_notes, driver_acknowledged_at, driver_acknowledged_by, temperature_required, collected_temperature_c";

type TrailerRow = Pick<
  Database["public"]["Tables"]["trailers"]["Row"],
  "id" | "trailer_number"
>;

export type DriverTaskAction = "ACKNOWLEDGED" | "COLLECTED" | "DELIVERED";
export type DriverTaskGroup = "current" | "upcoming" | "completed";

export type DriverMobileTask = {
  bookingId: string;
  trailerId: string;
  trailerNumber: string;
  customer: string | null;
  location: string | null;
  bookingReference: string | null;
  notes: string | null;
  status: string;
  deliveryDate: string;
  deliveryTime: string | null;
  group: DriverTaskGroup;
  nextAction: DriverTaskAction | null;
  deliveredAt: string | null;
  collectedAt: string | null;
  waitingCollectionSince: string | null;
  collectedTemperatureC: number | null;
  driverAcknowledgedAt: string | null;
  driverAcknowledgedBy: string | null;
  temperature: {
    required: boolean;
  };
};

export type DriverMobileTaskPayload = {
  driver: Pick<DriverRow, "id" | "display_name" | "user_id"> | null;
  tasks: DriverMobileTask[];
};

type DriverTransition = {
  nextStatus: string;
  eventType: string;
  eventDescription: string;
  patch: Database["public"]["Tables"]["delivery_bookings"]["Update"];
};

const normalizeStatus = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const resolveOperatorName = (user: User) => {
  const metadataName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim())
    || (typeof user.user_metadata?.name === "string" && user.user_metadata.name.trim());

  return metadataName || user.email || user.id || "Ferryspeed User";
};

const toDriverTaskGroup = (status: string): DriverTaskGroup => {
  const normalized = normalizeStatus(status);

  if (normalized === "delivered" || normalized === "collected" || normalized === "cancelled") {
    return "completed";
  }

  if (normalized === "scheduled") {
    return "upcoming";
  }

  return "current";
};

const toDriverLifecycleAction = (status: string): Exclude<DriverTaskAction, "ACKNOWLEDGED"> | null => {
  const normalized = normalizeStatus(status);

  if (normalized === "scheduled" || normalized === "ready" || normalized === "waiting_collection") {
    return "COLLECTED";
  }

  if (normalized === "on_delivery") {
    return "DELIVERED";
  }

  return null;
};

const toDriverNextAction = (booking: DeliveryBookingRow): DriverTaskAction | null => {
  const lifecycleAction = toDriverLifecycleAction(booking.status);
  if (!lifecycleAction) {
    return null;
  }

  if (!booking.driver_acknowledged_at) {
    return "ACKNOWLEDGED";
  }

  return lifecycleAction;
};

const buildTransition = (booking: DeliveryBookingRow, action: DriverTaskAction, nowIso: string): DriverTransition => {
  const status = normalizeStatus(booking.status);

  if (action === "COLLECTED") {
    if (status === "scheduled" || status === "ready") {
      return {
        nextStatus: "on_delivery",
        eventType: "delivery_status_changed",
        eventDescription: "Driver marked task as collected and moved to on_delivery.",
        patch: {
          status: "on_delivery",
          collected_at: booking.collected_at ?? nowIso,
          updated_at: nowIso,
        },
      };
    }

    if (status === "waiting_collection") {
      return {
        nextStatus: "collected",
        eventType: "trailer_collected",
        eventDescription: "Driver confirmed trailer collection.",
        patch: {
          status: "collected",
          collected_at: booking.collected_at ?? nowIso,
          updated_at: nowIso,
        },
      };
    }

    throw new Error("Task is not eligible for the Collected action.");
  }

  if (status === "on_delivery") {
    return {
      nextStatus: "delivered",
      eventType: "delivery_completed",
      eventDescription: "Driver marked delivery as completed.",
      patch: {
        status: "delivered",
        delivered_at: booking.delivered_at ?? nowIso,
        updated_at: nowIso,
      },
    };
  }

  throw new Error("Task is not eligible for the Delivered action.");
};

const toTask = (booking: DeliveryBookingRow, trailerNumber: string): DriverMobileTask => {
  return {
    bookingId: booking.id,
    trailerId: booking.trailer_id,
    trailerNumber,
    customer: booking.customer,
    location: booking.delivery_location,
    bookingReference: booking.booking_reference,
    notes: booking.notes,
    status: booking.status,
    deliveryDate: booking.delivery_date,
    deliveryTime: booking.delivery_time,
    group: toDriverTaskGroup(booking.status),
    nextAction: toDriverNextAction(booking),
    deliveredAt: booking.delivered_at,
    collectedAt: booking.collected_at,
    waitingCollectionSince: booking.waiting_collection_since,
    collectedTemperatureC: booking.collected_temperature_c,
    driverAcknowledgedAt: booking.driver_acknowledged_at,
    driverAcknowledgedBy: booking.driver_acknowledged_by,
    temperature: {
      required: Boolean(booking.temperature_required),
    },
  };
};

export async function loadDriverMobileTasksForUser(supabase: RouteSupabase, userId: string): Promise<DriverMobileTaskPayload> {
  const driver = await loadActiveDriverForUser(supabase, userId);
  if (!driver) {
    return {
      driver: null,
      tasks: [],
    };
  }

  const { data: bookings, error: bookingsError } = await supabase
    .from("delivery_bookings")
    .select(driverBookingSelect)
    .eq("driver_id", driver.id)
    .order("delivery_date", { ascending: true })
    .order("delivery_time", { ascending: true });

  if (bookingsError) {
    throw new Error(bookingsError.message || "Unable to load driver tasks.");
  }

  const bookingRows = (bookings ?? []) as DeliveryBookingRow[];

  const trailerIds = Array.from(new Set(bookingRows.map((row) => row.trailer_id).filter((id): id is string => Boolean(id))));

  const [trailersResult] = await Promise.all([
    trailerIds.length > 0
      ? supabase.from("trailers").select("id, trailer_number").in("id", trailerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (trailersResult.error) {
    throw new Error(trailersResult.error.message || "Unable to resolve trailer numbers.");
  }

  const trailers = (trailersResult.data ?? []) as TrailerRow[];
  const trailerNumberById = new Map(trailers.map((row) => [row.id, row.trailer_number?.trim() || "-"]));

  return {
    driver: {
      id: driver.id,
      display_name: driver.display_name,
      user_id: driver.user_id,
    },
    tasks: bookingRows.map((row) => {
      const trailerNumber = trailerNumberById.get(row.trailer_id) ?? "-";
      return toTask(row, trailerNumber);
    }),
  };
}

export async function applyDriverTaskAction(input: {
  supabase: RouteSupabase;
  user: User;
  bookingId: string;
  action: DriverTaskAction;
  temperatureC?: number | null;
}) {
  const driver = await loadActiveDriverForUser(input.supabase, input.user.id);
  if (!driver) {
    throw new Error("No driver profile linked to this account.");
  }

  const { data: booking, error: bookingError } = await input.supabase
    .from("delivery_bookings")
    .select(driverBookingSelect)
    .eq("id", input.bookingId)
    .eq("driver_id", driver.id)
    .maybeSingle();

  if (bookingError) {
    throw new Error(bookingError.message || "Unable to load task.");
  }

  if (!booking) {
    throw new Error("Task not found or not assigned to the authenticated driver.");
  }

  const row = booking as DeliveryBookingRow;
  if (input.action === "ACKNOWLEDGED") {
    if (row.driver_acknowledged_at) {
      return row;
    }

    const nowIso = new Date().toISOString();
    const patch: Database["public"]["Tables"]["delivery_bookings"]["Update"] = {
      driver_acknowledged_at: nowIso,
      driver_acknowledged_by: input.user.id,
      updated_at: nowIso,
    };

    const { data: acknowledgedBooking, error: acknowledgeError } = await input.supabase
      .from("delivery_bookings")
      .update(patch)
      .eq("id", row.id)
      .eq("driver_id", driver.id)
      .select(driverBookingSelect)
      .maybeSingle();

    if (acknowledgeError || !acknowledgedBooking) {
      throw new Error(acknowledgeError?.message || "Unable to acknowledge task.");
    }

    const operatorName = resolveOperatorName(input.user);
    const trailerNumber = await resolveTrailerNumberForBooking(input.supabase, row);
    const eventMetadata = {
      previous_status: row.status,
      next_status: row.status,
      driver_id: driver.id,
      user_id: input.user.id,
      action: "ACKNOWLEDGED",
      acknowledged_at: nowIso,
    };

    const { error: insertEventError } = await input.supabase.from("trailer_events").insert({
      trailer_id: row.trailer_id,
      trailer_number: trailerNumber,
      event_type: "driver_task_acknowledged",
      event_description: "Driver acknowledged assigned delivery task.",
      old_value: { driver_acknowledged_at: null },
      new_value: eventMetadata,
      created_by: operatorName,
    });

    if (insertEventError) {
      throw new Error(insertEventError.message || "Unable to create driver acknowledgment trailer event.");
    }

    await createTrailerActivity({
      supabaseClient: input.supabase,
      trailerId: row.trailer_id,
      trailerNumber,
      eventType: "driver_task_acknowledged",
      eventTitle: "Driver acknowledged task",
      eventDescription: `Delivery booking ${row.booking_reference ?? row.id} acknowledged by assigned driver.`,
      sourceModule: "delivery",
      sourceRecordId: row.id,
      previousStatus: row.status,
      newStatus: row.status,
      metadata: eventMetadata,
      performedBy: operatorName,
      createdAt: nowIso,
    });

    return acknowledgedBooking as DeliveryBookingRow;
  }

  if (input.action === "COLLECTED" && row.temperature_required) {
    if (typeof input.temperatureC !== "number" || !Number.isFinite(input.temperatureC)) {
      throw new Error("Temperature reading is required before marking this booking as collected.");
    }
  }

  if (!row.driver_acknowledged_at) {
    throw new Error("Task must be acknowledged before lifecycle status updates.");
  }

  const nowIso = new Date().toISOString();
  const transition = buildTransition(row, input.action, nowIso);
  const patch: Database["public"]["Tables"]["delivery_bookings"]["Update"] = {
    ...transition.patch,
  };

  if (input.action === "COLLECTED" && typeof input.temperatureC === "number" && Number.isFinite(input.temperatureC)) {
    patch.collected_temperature_c = input.temperatureC;
  }

  const { data: updated, error: updateError } = await input.supabase
    .from("delivery_bookings")
    .update(patch)
    .eq("id", row.id)
    .eq("driver_id", driver.id)
    .select(driverBookingSelect)
    .maybeSingle();

  if (updateError || !updated) {
    throw new Error(updateError?.message || "Unable to update task.");
  }

  const operatorName = resolveOperatorName(input.user);
  const trailerNumber = await resolveTrailerNumberForBooking(input.supabase, row);

  const eventMetadata = {
    previous_status: row.status,
    next_status: transition.nextStatus,
    driver_id: driver.id,
    user_id: input.user.id,
    action: input.action,
    temperature_c: typeof input.temperatureC === "number" ? input.temperatureC : null,
  };

  const { error: insertEventError } = await input.supabase.from("trailer_events").insert({
    trailer_id: row.trailer_id,
    trailer_number: trailerNumber,
    event_type: transition.eventType,
    event_description: transition.eventDescription,
    old_value: { status: row.status },
    new_value: eventMetadata,
    created_by: operatorName,
  });

  if (insertEventError) {
    throw new Error(insertEventError.message || "Unable to create driver trailer event.");
  }

  await createTrailerActivity({
    supabaseClient: input.supabase,
    trailerId: row.trailer_id,
    trailerNumber,
    eventType: "delivery_status_changed",
    eventTitle: transition.eventDescription,
    eventDescription: `Delivery booking ${row.booking_reference ?? row.id}: ${row.status} -> ${transition.nextStatus}`,
    sourceModule: "delivery",
    sourceRecordId: row.id,
    previousStatus: row.status,
    newStatus: transition.nextStatus,
    metadata: eventMetadata,
    performedBy: operatorName,
    createdAt: nowIso,
  });

  if (typeof input.temperatureC === "number" && Number.isFinite(input.temperatureC)) {
    await createTrailerActivity({
      supabaseClient: input.supabase,
      trailerId: row.trailer_id,
      trailerNumber,
      eventType: "temperature_recorded",
      eventTitle: "Driver temperature reading",
      eventDescription: `Driver submitted ${input.temperatureC.toFixed(1)} C during ${input.action.toLowerCase()} action.`,
      sourceModule: "delivery",
      sourceRecordId: row.id,
      metadata: {
        action: input.action,
        temperature_c: input.temperatureC,
        driver_id: driver.id,
        user_id: input.user.id,
      },
      performedBy: operatorName,
      createdAt: nowIso,
    });
  }

  return updated as DeliveryBookingRow;
}

async function resolveTrailerNumberForBooking(supabase: RouteSupabase, booking: DeliveryBookingRow) {
  const fallback = booking.booking_reference?.trim() || booking.trailer_id;

  const { data, error } = await supabase
    .from("trailers")
    .select("trailer_number")
    .eq("id", booking.trailer_id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to resolve trailer number for driver task.");
  }

  return data?.trailer_number?.trim() || fallback;
}