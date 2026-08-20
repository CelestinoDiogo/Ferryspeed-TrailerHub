import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type TrailerHubSupabaseClient = SupabaseClient<Database>;

export const DELIVERY_BOOKING_STATUSES = [
  "scheduled",
  "ready",
  "on_delivery",
  "delivered",
  "waiting_collection",
  "collected",
  "cancelled",
] as const;

export type DeliveryBookingStatus = (typeof DELIVERY_BOOKING_STATUSES)[number];

export const DELIVERY_BOOKING_RELEASE_STATUSES = ["collected", "cancelled"] as const;

export type DeliveryBookingReleaseStatus = (typeof DELIVERY_BOOKING_RELEASE_STATUSES)[number];

export const DELIVERY_BOOKING_ACTIVE_STATUSES = [
  "scheduled",
  "ready",
  "on_delivery",
  "delivered",
  "waiting_collection",
] as const;

export type DeliveryBookingActiveStatus = (typeof DELIVERY_BOOKING_ACTIVE_STATUSES)[number];

export const DELIVERY_BOOKING_RELEASE_STATUS_QUERY = '("collected","cancelled")';

export const TRAILER_ACTIVE_DELIVERY_BOOKING_CODE = "TRAILER_ACTIVE_DELIVERY_BOOKING";

export const TRAILER_ACTIVE_DELIVERY_BOOKING_MESSAGE =
  "This trailer already has an active delivery booking and cannot be assigned to another booking until that booking is collected or cancelled.";

export type DeliveryBookingTrailerOption = {
  id: string;
  trailer_number: string;
  container_number?: string | null;
  customer?: string | null;
  consignee?: string | null;
};

export type ActiveDeliveryBookingRef = {
  id: string;
  trailer_id: string;
  status: string;
  booking_reference?: string | null;
};

export type DeliveryBookingInsertPayload = {
  trailer_id: string;
  driver_id?: string | null;
  delivery_date: string;
  delivery_time?: string | null;
  customer?: string | null;
  consignee?: string | null;
  delivery_location?: string | null;
  booking_reference?: string | null;
  escort_required?: boolean | null;
  status?: string | null;
  notes?: string | null;
};

export class DeliveryBookingAvailabilityError extends Error {
  code = TRAILER_ACTIVE_DELIVERY_BOOKING_CODE;
  status = 409;

  constructor(message = TRAILER_ACTIVE_DELIVERY_BOOKING_MESSAGE) {
    super(message);
    this.name = "DeliveryBookingAvailabilityError";
  }
}

export function normalizeDeliveryBookingStatus(status?: string | null) {
  return (status ?? "").trim().toLowerCase();
}

export function isReleasedDeliveryBookingStatus(status?: string | null) {
  const normalized = normalizeDeliveryBookingStatus(status);
  return DELIVERY_BOOKING_RELEASE_STATUSES.includes(normalized as DeliveryBookingReleaseStatus);
}

export function isActiveDeliveryBookingStatus(status?: string | null) {
  const normalized = normalizeDeliveryBookingStatus(status);
  if (!normalized) {
    return false;
  }

  return !isReleasedDeliveryBookingStatus(normalized);
}

export function getTrailerIdsReservedByActiveDeliveryBookings(
  bookings: Array<{ id?: string | null; trailer_id?: string | null; status?: string | null }>,
) {
  const reservedTrailerIds = new Set<string>();

  for (const booking of bookings) {
    if (!booking.trailer_id || !isActiveDeliveryBookingStatus(booking.status)) {
      continue;
    }

    reservedTrailerIds.add(booking.trailer_id);
  }

  return reservedTrailerIds;
}

export function excludeTrailersReservedByActiveDeliveryBookings<T extends { id: string }>(
  trailers: T[],
  bookings: Array<{ id?: string | null; trailer_id?: string | null; status?: string | null }>,
) {
  const reservedTrailerIds = getTrailerIdsReservedByActiveDeliveryBookings(bookings);
  return trailers.filter((trailer) => !reservedTrailerIds.has(trailer.id));
}

export async function listTrailerIdsWithActiveDeliveryBookings(
  supabaseClient: TrailerHubSupabaseClient,
) {
  const { data, error } = await supabaseClient
    .from("delivery_bookings")
    .select("id, trailer_id, status")
    .not("status", "in", DELIVERY_BOOKING_RELEASE_STATUS_QUERY);

  if (error) {
    throw new Error(error.message || "Unable to load active delivery bookings.");
  }

  return getTrailerIdsReservedByActiveDeliveryBookings(data ?? []);
}

export async function listTrailersAvailableForDeliveryBooking(
  supabaseClient: TrailerHubSupabaseClient,
) {
  const [trailersResult, activeBookingsResult] = await Promise.all([
    supabaseClient
      .from("trailers")
      .select("id, trailer_number, container_number, customer, consignee")
      .is("departure_date", null)
      .order("trailer_number", { ascending: true }),
    supabaseClient
      .from("delivery_bookings")
      .select("id, trailer_id, status")
      .not("status", "in", DELIVERY_BOOKING_RELEASE_STATUS_QUERY),
  ]);

  if (trailersResult.error) {
    throw new Error(trailersResult.error.message || "Unable to load trailers.");
  }

  if (activeBookingsResult.error) {
    throw new Error(activeBookingsResult.error.message || "Unable to load active delivery bookings.");
  }

  return excludeTrailersReservedByActiveDeliveryBookings(
    (trailersResult.data ?? []) as DeliveryBookingTrailerOption[],
    activeBookingsResult.data ?? [],
  );
}

export async function findActiveDeliveryBookingForTrailer(
  supabaseClient: TrailerHubSupabaseClient,
  trailerId: string,
) {
  const { data, error } = await supabaseClient
    .from("delivery_bookings")
    .select("id, trailer_id, status, booking_reference")
    .eq("trailer_id", trailerId)
    .not("status", "in", DELIVERY_BOOKING_RELEASE_STATUS_QUERY)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to check existing delivery bookings.");
  }

  if (!data || !isActiveDeliveryBookingStatus(data.status)) {
    return null;
  }

  return data as ActiveDeliveryBookingRef;
}

export async function assertTrailerAvailableForNewDeliveryBooking(
  supabaseClient: TrailerHubSupabaseClient,
  trailerId: string,
) {
  const activeBooking = await findActiveDeliveryBookingForTrailer(supabaseClient, trailerId);

  if (activeBooking) {
    throw new DeliveryBookingAvailabilityError();
  }
}

export async function createDeliveryBookingIfTrailerAvailable(
  supabaseClient: TrailerHubSupabaseClient,
  payload: DeliveryBookingInsertPayload,
) {
  await assertTrailerAvailableForNewDeliveryBooking(supabaseClient, payload.trailer_id);

  const { data, error } = await supabaseClient
    .from("delivery_bookings")
    .insert({
      trailer_id: payload.trailer_id,
      driver_id: payload.driver_id ?? null,
      delivery_date: payload.delivery_date,
      delivery_time: payload.delivery_time ?? null,
      customer: payload.customer ?? null,
      consignee: payload.consignee ?? null,
      delivery_location: payload.delivery_location ?? null,
      booking_reference: payload.booking_reference ?? null,
      escort_required: payload.escort_required ?? false,
      status: payload.status ?? "scheduled",
      notes: payload.notes ?? null,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message || "Unable to create delivery booking.");
  }

  return data;
}
