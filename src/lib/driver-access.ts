import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type DriverRow = Database["public"]["Tables"]["drivers"]["Row"];
export type DeliveryBookingRow = Database["public"]["Tables"]["delivery_bookings"]["Row"];

export type DriverTaskScope = {
  driver: DriverRow | null;
  assignedBookings: DeliveryBookingRow[];
};

const driverBookingSelect =
  "id, trailer_id, driver_id, delivery_date, delivery_time, customer, consignee, delivery_location, booking_reference, escort_required, delivered_with_escort, status, notes, created_at, updated_at, delivered_at, waiting_collection_since, collection_due_date, collected_at, demurrage_free_days, demurrage_daily_rate, demurrage_currency, demurrage_notes";

export async function loadActiveDriverForUser(supabase: SupabaseClient<Database>, userId: string) {
  const { data, error } = await supabase
    .from("drivers")
    .select("id, user_id, display_name, phone, active, created_at, updated_at")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to load driver profile.");
  }

  return (data ?? null) as DriverRow | null;
}

export async function loadDriverById(supabase: SupabaseClient<Database>, driverId: string) {
  const { data, error } = await supabase
    .from("drivers")
    .select("id, user_id, display_name, phone, active, created_at, updated_at")
    .eq("id", driverId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to load Driver profile.");
  }

  return (data ?? null) as DriverRow | null;
}

export async function listActiveDrivers(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase
    .from("drivers")
    .select("id, display_name, active")
    .eq("active", true)
    .order("display_name", { ascending: true });

  if (error) {
    throw new Error(error.message || "Unable to load active Drivers.");
  }

  return (data ?? []) as Array<Pick<DriverRow, "id" | "display_name" | "active">>;
}

export async function listAssignedDeliveryBookingsForDriver(supabase: SupabaseClient<Database>, driverId: string) {
  const { data, error } = await supabase
    .from("delivery_bookings")
    .select(driverBookingSelect)
    .eq("driver_id", driverId)
    .order("delivery_date", { ascending: true })
    .order("delivery_time", { ascending: true });

  if (error) {
    throw new Error(error.message || "Unable to load assigned delivery bookings.");
  }

  return (data ?? []) as DeliveryBookingRow[];
}

export async function loadAssignedDeliveryBookingsForUser(supabase: SupabaseClient<Database>, userId: string): Promise<DriverTaskScope> {
  const driver = await loadActiveDriverForUser(supabase, userId);

  if (!driver) {
    return {
      driver: null,
      assignedBookings: [],
    };
  }

  const assignedBookings = await listAssignedDeliveryBookingsForDriver(supabase, driver.id);

  return {
    driver,
    assignedBookings,
  };
}