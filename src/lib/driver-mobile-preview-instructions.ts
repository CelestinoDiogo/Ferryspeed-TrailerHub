import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { DriverRow } from "@/lib/driver-access";

type RouteSupabase = SupabaseClient<Database>;
type InstructionRow = Database["public"]["Tables"]["driver_operational_instructions"]["Row"];

const instructionSelect =
  "id,driver_id,recipient_user_id,delivery_booking_id,trailer_id,trailer_number,instruction,priority,sender_user_id,sender_display_name,created_at,read_at,read_by";

const toPriority = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return normalized === "high" || normalized === "critical" ? normalized : "normal";
};

const toRecord = (row: InstructionRow) => ({
  id: row.id,
  driverId: row.driver_id,
  recipientUserId: row.recipient_user_id,
  deliveryBookingId: row.delivery_booking_id,
  trailerId: row.trailer_id,
  trailerNumber: row.trailer_number,
  instruction: row.instruction,
  priority: toPriority(row.priority),
  senderUserId: row.sender_user_id,
  senderDisplayName: row.sender_display_name,
  createdAt: row.created_at,
  readAt: row.read_at,
  readBy: row.read_by,
  isRead: Boolean(row.read_at),
  latestResponse: null,
  responseHistory: [],
});

export async function listDriverOperationalInstructionsForPreview(
  supabase: RouteSupabase,
  driver: Pick<DriverRow, "id" | "display_name" | "user_id">,
  input?: { limit?: number },
) {
  const limit = Math.max(1, Math.min(input?.limit ?? 30, 100));
  const { data, error } = await supabase
    .from("driver_operational_instructions")
    .select(instructionSelect)
    .eq("driver_id", driver.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message || "Unable to load preview instructions.");
  }

  const recent = ((data ?? []) as InstructionRow[]).map(toRecord);
  const unread = recent.filter((record) => !record.readAt);

  return {
    driver: {
      id: driver.id,
      displayName: driver.display_name,
      userId: driver.user_id,
    },
    unreadCount: unread.length,
    newestUnread: unread[0] ?? null,
    recent,
  };
}
