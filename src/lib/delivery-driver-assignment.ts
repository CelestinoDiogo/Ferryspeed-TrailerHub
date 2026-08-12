import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createTrailerActivity } from "@/lib/trailer-activity";

type TrailerHubSupabaseClient = SupabaseClient<Database>;

export type ActiveDriverOption = Pick<
  Database["public"]["Tables"]["drivers"]["Row"],
  "id" | "display_name" | "user_id" | "active"
>;

export const UNASSIGNED_DRIVER_LABEL = "Unassigned";

export const formatAssignedDriverName = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : UNASSIGNED_DRIVER_LABEL;
};

export async function listActiveDriverOptions(supabaseClient: TrailerHubSupabaseClient) {
  const { data, error } = await supabaseClient
    .from("drivers")
    .select("id, display_name, user_id, active")
    .eq("active", true)
    .order("display_name", { ascending: true });

  if (error) {
    throw new Error(error.message || "Unable to load active drivers.");
  }

  return (data ?? []) as ActiveDriverOption[];
}

type RecordDeliveryAssignmentChangeInput = {
  supabaseClient: TrailerHubSupabaseClient;
  bookingId: string;
  trailerId: string;
  trailerNumber: string;
  previousDriverId?: string | null;
  previousDriverName?: string | null;
  nextDriverId?: string | null;
  nextDriverName?: string | null;
};

const normalizeDriverValue = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export async function recordDeliveryAssignmentChange(input: RecordDeliveryAssignmentChangeInput) {
  const previousDriverId = normalizeDriverValue(input.previousDriverId);
  const nextDriverId = normalizeDriverValue(input.nextDriverId);

  if (previousDriverId === nextDriverId) {
    return;
  }

  const previousDriverName = normalizeDriverValue(input.previousDriverName);
  const nextDriverName = normalizeDriverValue(input.nextDriverName);

  let eventType = "delivery_driver_assigned";
  let eventTitle = "Delivery assigned";
  let eventDescription = `Delivery assigned to ${formatAssignedDriverName(nextDriverName)}.`;

  if (previousDriverId && nextDriverId) {
    eventType = "delivery_driver_reassigned";
    eventTitle = "Delivery reassigned";
    eventDescription = `Delivery reassigned from ${formatAssignedDriverName(previousDriverName)} to ${formatAssignedDriverName(nextDriverName)}.`;
  } else if (previousDriverId && !nextDriverId) {
    eventType = "delivery_driver_unassigned";
    eventTitle = "Delivery unassigned";
    eventDescription = `Delivery assignment removed from ${formatAssignedDriverName(previousDriverName)}.`;
  }

  const metadata = {
    previous_driver_id: previousDriverId,
    previous_driver_name: previousDriverName,
    next_driver_id: nextDriverId,
    next_driver_name: nextDriverName,
  };

  const previousValue = previousDriverId || previousDriverName
    ? { driver_id: previousDriverId, driver_name: previousDriverName }
    : null;

  const nextValue = nextDriverId || nextDriverName
    ? { driver_id: nextDriverId, driver_name: nextDriverName }
    : null;

  const { error: trailerEventError } = await input.supabaseClient.from("trailer_events").insert({
    trailer_id: input.trailerId,
    trailer_number: input.trailerNumber,
    event_type: eventType,
    event_description: eventDescription,
    old_value: previousValue,
    new_value: nextValue,
  });

  if (trailerEventError) {
    throw new Error(trailerEventError.message || "Unable to record delivery assignment event.");
  }

  await createTrailerActivity({
    supabaseClient: input.supabaseClient,
    trailerId: input.trailerId,
    trailerNumber: input.trailerNumber,
    eventType,
    eventTitle,
    eventDescription,
    sourceModule: "delivery",
    sourceRecordId: input.bookingId,
    metadata,
  });
}