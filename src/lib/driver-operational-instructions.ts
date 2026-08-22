import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadActiveDriverForUser } from "@/lib/driver-access";
import { loadCurrentUserRole } from "@/lib/rbac/service";

type RouteSupabase = SupabaseClient<Database>;
export type DriverOperationalInstructionRow = Database["public"]["Tables"]["driver_operational_instructions"]["Row"];
export type DriverOperationalInstructionEventRow =
  Database["public"]["Tables"]["driver_operational_instruction_events"]["Row"];

export const DRIVER_INSTRUCTION_MAX_LENGTH = 180;
export const DRIVER_RESPONSE_NOTE_MAX_LENGTH = 120;
const DEFAULT_HISTORY_LIMIT = 30;

export type DriverOperationalInstructionPriority = "normal" | "high" | "critical";
export type DriverQuickResponseType = "ok" | "completed" | "arrived" | "delayed" | "problem" | "call_me";

export type DriverInstructionResponseRecord = {
  id: string;
  instructionId: string;
  driverId: string;
  recipientUserId: string;
  deliveryBookingId: string | null;
  trailerId: string | null;
  trailerNumber: string | null;
  responseType: DriverQuickResponseType;
  message: string | null;
  createdByUserId: string;
  createdAt: string;
  isException: boolean;
};

export type DriverInstructionRecord = {
  id: string;
  driverId: string;
  recipientUserId: string;
  deliveryBookingId: string | null;
  trailerId: string | null;
  trailerNumber: string | null;
  instruction: string;
  priority: DriverOperationalInstructionPriority;
  senderUserId: string | null;
  senderDisplayName: string | null;
  createdAt: string;
  readAt: string | null;
  readBy: string | null;
  isRead: boolean;
  latestResponse: DriverInstructionResponseRecord | null;
  responseHistory: DriverInstructionResponseRecord[];
};

export type DriverInstructionTimelineEntry = {
  id: string;
  kind: "manager_instruction" | "driver_response";
  createdAt: string;
  actorLabel: string;
  text: string;
  responseType: DriverQuickResponseType | null;
  isException: boolean;
};

export type DriverInstructionContextFeed = {
  instructions: DriverInstructionRecord[];
  latestResponse: DriverInstructionResponseRecord | null;
  latestException: DriverInstructionResponseRecord | null;
  timeline: DriverInstructionTimelineEntry[];
};

export type DriverInstructionFeed = {
  driver: {
    id: string;
    displayName: string;
    userId: string;
  } | null;
  unreadCount: number;
  newestUnread: DriverInstructionRecord | null;
  recent: DriverInstructionRecord[];
};

export type SendDriverInstructionInput = {
  driverId: string;
  instruction: string;
  deliveryBookingId?: string | null;
  trailerId?: string | null;
  trailerNumber?: string | null;
  priority?: DriverOperationalInstructionPriority;
};

export type DriverQuickResponseInput = {
  instructionId: string;
  responseType: DriverQuickResponseType;
  note?: string | null;
};

const instructionSelect =
  "id,driver_id,recipient_user_id,delivery_booking_id,trailer_id,trailer_number,instruction,priority,sender_user_id,sender_display_name,created_at,read_at,read_by";

const instructionEventSelect =
  "id,instruction_id,driver_id,recipient_user_id,delivery_booking_id,trailer_id,trailer_number,event_type,message,created_by_user_id,created_at";

const normalizeText = (value?: string | null) => value?.trim() ?? "";

const isMissingInstructionEventsTableError = (error: { code?: string | null; message?: string | null } | null) => {
  if (!error) {
    return false;
  }

  const normalizedMessage = normalizeText(error.message).toLowerCase();
  return error.code === "42P01"
    || (normalizedMessage.includes("driver_operational_instruction_events")
      && (normalizedMessage.includes("does not exist") || normalizedMessage.includes("not found")));
};

const resolveSenderDisplayName = (user: User) => {
  const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "";
  const name = typeof user.user_metadata?.name === "string" ? user.user_metadata.name.trim() : "";

  return fullName || name || user.email || user.id || "Operations User";
};

const toPriority = (value?: string | null): DriverOperationalInstructionPriority => {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized || normalized === "normal") {
    return "normal";
  }

  if (normalized === "high" || normalized === "critical") {
    return normalized;
  }

  throw new Error("Invalid instruction priority.");
};

const quickResponseTypes: DriverQuickResponseType[] = ["ok", "completed", "arrived", "delayed", "problem", "call_me"];
const exceptionResponseTypes = new Set<DriverQuickResponseType>(["delayed", "problem", "call_me"]);

const toQuickResponseType = (value: string): DriverQuickResponseType => {
  const normalized = normalizeText(value).toLowerCase().replace(/\s+/g, "_") as DriverQuickResponseType;
  if (!quickResponseTypes.includes(normalized)) {
    throw new Error("Invalid response type.");
  }

  return normalized;
};

const toResponseLabel = (value: DriverQuickResponseType) => value.replace("_", " ").toUpperCase();

const normalizeOptionalNote = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  if (normalized.length > DRIVER_RESPONSE_NOTE_MAX_LENGTH) {
    throw new Error(`Response note must be ${DRIVER_RESPONSE_NOTE_MAX_LENGTH} characters or less.`);
  }

  return normalized;
};

export const isDuplicateDriverInstructionResponse = (
  latest: Pick<DriverOperationalInstructionEventRow, "event_type" | "message"> | null | undefined,
  responseType: DriverQuickResponseType,
  message: string | null,
) => {
  if (!latest) {
    return false;
  }

  return latest.event_type === responseType && (latest.message ?? null) === (message ?? null);
};

const toInstructionResponseRecord = (row: DriverOperationalInstructionEventRow): DriverInstructionResponseRecord => {
  const responseType = toQuickResponseType(row.event_type);

  return {
    id: row.id,
    instructionId: row.instruction_id,
    driverId: row.driver_id,
    recipientUserId: row.recipient_user_id,
    deliveryBookingId: row.delivery_booking_id,
    trailerId: row.trailer_id,
    trailerNumber: row.trailer_number,
    responseType,
    message: row.message,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at ?? new Date().toISOString(),
    isException: exceptionResponseTypes.has(responseType),
  };
};

const buildResponseMap = (rows: DriverOperationalInstructionEventRow[]) => {
  const byInstructionId = new Map<string, DriverInstructionResponseRecord[]>();

  rows.forEach((row) => {
    const record = toInstructionResponseRecord(row);
    const current = byInstructionId.get(record.instructionId) ?? [];
    current.push(record);
    byInstructionId.set(record.instructionId, current);
  });

  byInstructionId.forEach((items, instructionId) => {
    const sorted = [...items].sort((a, b) => {
      const createdAtDifference = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return createdAtDifference || b.id.localeCompare(a.id);
    });
    byInstructionId.set(instructionId, sorted);
  });

  return byInstructionId;
};

const toInstructionRecord = (
  row: DriverOperationalInstructionRow,
  responseHistory: DriverInstructionResponseRecord[] = [],
): DriverInstructionRecord => ({
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
  createdAt: row.created_at ?? new Date().toISOString(),
  readAt: row.read_at,
  readBy: row.read_by,
  isRead: Boolean(row.read_at),
  latestResponse: responseHistory[0] ?? null,
  responseHistory,
});

const listResponseEventsForInstructions = async (
  supabase: RouteSupabase,
  instructionIds: string[],
  limit: number,
) => {
  if (instructionIds.length === 0) {
    return [] as DriverOperationalInstructionEventRow[];
  }

  const responseLimit = Math.max(1, Math.min(limit * 6, 300));
  const { data, error } = await supabase
    .from("driver_operational_instruction_events")
    .select(instructionEventSelect)
    .in("instruction_id", instructionIds)
    .order("created_at", { ascending: false })
    .limit(responseLimit);

  if (isMissingInstructionEventsTableError(error)) {
    return [] as DriverOperationalInstructionEventRow[];
  }

  if (error) {
    throw new Error(error.message || "Unable to load instruction response history.");
  }

  return (data ?? []) as DriverOperationalInstructionEventRow[];
};

const requireSupervisorOrAdministrator = async (supabase: RouteSupabase, userId: string) => {
  const role = await loadCurrentUserRole(supabase, userId);
  const roleKey = normalizeText(role?.role_key).toLowerCase();

  if (!role?.is_active || (roleKey !== "supervisor" && roleKey !== "administrator")) {
    throw new Error("Only supervisors or administrators can send operational instructions.");
  }
};

const assertInstructionText = (value: string) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error("Instruction text is required.");
  }

  if (normalized.length > DRIVER_INSTRUCTION_MAX_LENGTH) {
    throw new Error(`Instruction must be ${DRIVER_INSTRUCTION_MAX_LENGTH} characters or less.`);
  }

  return normalized;
};

export async function listDriverOperationalInstructionsForUser(
  supabase: RouteSupabase,
  userId: string,
  input?: { limit?: number },
): Promise<DriverInstructionFeed> {
  const driver = await loadActiveDriverForUser(supabase, userId);

  if (!driver) {
    return {
      driver: null,
      unreadCount: 0,
      newestUnread: null,
      recent: [],
    };
  }

  const limit = Math.max(1, Math.min(input?.limit ?? DEFAULT_HISTORY_LIMIT, 100));

  const [listResult, unreadCountResult] = await Promise.all([
    supabase
      .from("driver_operational_instructions")
      .select(instructionSelect)
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("driver_operational_instructions")
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", userId)
      .is("read_at", null),
  ]);

  if (listResult.error) {
    throw new Error(listResult.error.message || "Unable to load driver operational instructions.");
  }

  const instructionRows = (listResult.data ?? []) as DriverOperationalInstructionRow[];
  const responseRows = await listResponseEventsForInstructions(
    supabase,
    instructionRows.map((row) => row.id),
    limit,
  );
  const responseByInstruction = buildResponseMap(responseRows);

  const rows = instructionRows.map((row) => toInstructionRecord(row, responseByInstruction.get(row.id) ?? []));
  const unreadRows = rows.filter((row) => !row.readAt);
  const unreadCount =
    !unreadCountResult.error && typeof unreadCountResult.count === "number"
      ? unreadCountResult.count
      : unreadRows.length;

  return {
    driver: {
      id: driver.id,
      displayName: driver.display_name,
      userId: driver.user_id ?? userId,
    },
    unreadCount,
    newestUnread: unreadRows[0] ?? null,
    recent: rows,
  };
}

export async function markDriverOperationalInstructionRead(
  supabase: RouteSupabase,
  input: { instructionId: string },
): Promise<DriverInstructionRecord> {
  const { data, error } = await supabase.rpc("mark_driver_operational_instruction_read", {
    p_instruction_id: input.instructionId,
  } as never);

  if (error) {
    throw new Error(error.message || "Unable to mark instruction as read.");
  }

  const row = (Array.isArray(data) ? data[0] : data) as DriverOperationalInstructionRow | null;
  if (!row) {
    throw new Error("No instruction row returned after mark-read.");
  }

  return toInstructionRecord(row);
}

export async function createDriverOperationalInstructionResponse(
  supabase: RouteSupabase,
  userId: string,
  input: DriverQuickResponseInput,
): Promise<DriverInstructionResponseRecord> {
  const driver = await loadActiveDriverForUser(supabase, userId);
  if (!driver) {
    throw new Error("No active driver profile linked to this account.");
  }

  const responseType = toQuickResponseType(input.responseType);
  const note = normalizeOptionalNote(input.note);

  const { data: instruction, error: instructionError } = await supabase
    .from("driver_operational_instructions")
    .select(instructionSelect)
    .eq("id", input.instructionId)
    .eq("recipient_user_id", userId)
    .eq("driver_id", driver.id)
    .maybeSingle();

  if (instructionError) {
    throw new Error(instructionError.message || "Unable to validate instruction response context.");
  }

  if (!instruction) {
    throw new Error("Instruction not found for the authenticated driver.");
  }

  const { data: latestEvents, error: latestEventError } = await supabase
    .from("driver_operational_instruction_events")
    .select(instructionEventSelect)
    .eq("instruction_id", instruction.id)
    .eq("recipient_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (isMissingInstructionEventsTableError(latestEventError)) {
    throw new Error("Driver response events are not available until migration 042 is applied.");
  }

  if (latestEventError) {
    throw new Error(latestEventError.message || "Unable to validate existing driver response.");
  }

  const latestEvent = ((latestEvents ?? [])[0] ?? null) as DriverOperationalInstructionEventRow | null;
  if (isDuplicateDriverInstructionResponse(latestEvent, responseType, note)) {
    return toInstructionResponseRecord(latestEvent as DriverOperationalInstructionEventRow);
  }

  const payload: Database["public"]["Tables"]["driver_operational_instruction_events"]["Insert"] = {
    instruction_id: instruction.id,
    driver_id: instruction.driver_id,
    recipient_user_id: instruction.recipient_user_id,
    delivery_booking_id: instruction.delivery_booking_id,
    trailer_id: instruction.trailer_id,
    trailer_number: instruction.trailer_number,
    event_type: responseType,
    message: note,
    created_by_user_id: userId,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("driver_operational_instruction_events")
    .insert(payload)
    .select(instructionEventSelect)
    .single();

  if (isMissingInstructionEventsTableError(insertError)) {
    throw new Error("Driver response events are not available until migration 042 is applied.");
  }

  if (insertError) {
    throw new Error(insertError.message || "Unable to record driver response.");
  }

  return toInstructionResponseRecord(inserted as DriverOperationalInstructionEventRow);
}

export async function sendDriverOperationalInstruction(
  supabase: RouteSupabase,
  input: SendDriverInstructionInput,
  user: User,
): Promise<DriverInstructionRecord> {
  await requireSupervisorOrAdministrator(supabase, user.id);

  const instruction = assertInstructionText(input.instruction);
  const priority = toPriority(input.priority);
  const senderDisplayName = resolveSenderDisplayName(user);

  const { data: driver, error: driverError } = await supabase
    .from("drivers")
    .select("id,user_id,display_name,active")
    .eq("id", input.driverId)
    .eq("active", true)
    .maybeSingle();

  if (driverError) {
    throw new Error(driverError.message || "Unable to load driver for operational instruction.");
  }

  if (!driver || !driver.user_id) {
    throw new Error("Driver was not found or is not linked to a user account.");
  }

  const deliveryBookingId: string | null = input.deliveryBookingId ?? null;
  let trailerId: string | null = input.trailerId ?? null;
  let trailerNumber: string | null = normalizeText(input.trailerNumber).toUpperCase() || null;

  if (deliveryBookingId) {
    const { data: booking, error: bookingError } = await supabase
      .from("delivery_bookings")
      .select("id,driver_id,trailer_id")
      .eq("id", deliveryBookingId)
      .maybeSingle();

    if (bookingError) {
      throw new Error(bookingError.message || "Unable to validate delivery booking context.");
    }

    if (!booking) {
      throw new Error("Delivery booking context was not found.");
    }

    if (booking.driver_id !== input.driverId) {
      throw new Error("Delivery booking is not assigned to the selected driver.");
    }

    if (trailerId && booking.trailer_id && trailerId !== booking.trailer_id) {
      throw new Error("Trailer context does not match the selected delivery booking.");
    }

    trailerId = trailerId ?? booking.trailer_id;
  }

  if (trailerNumber && !trailerId) {
    throw new Error("Trailer number requires a selected trailer context.");
  }

  if (trailerId) {
    const { data: trailer, error: trailerError } = await supabase
      .from("trailers")
      .select("id,trailer_number")
      .eq("id", trailerId)
      .maybeSingle();

    if (trailerError) {
      throw new Error(trailerError.message || "Unable to resolve trailer context for instruction.");
    }

    if (!trailer) {
      throw new Error("Trailer context was not found.");
    }

    const canonicalTrailerNumber = normalizeText(trailer.trailer_number).toUpperCase() || null;
    if (trailerNumber && canonicalTrailerNumber && trailerNumber !== canonicalTrailerNumber) {
      throw new Error("Trailer number does not match the selected trailer context.");
    }

    trailerNumber = canonicalTrailerNumber;
  }

  const payload: Database["public"]["Tables"]["driver_operational_instructions"]["Insert"] = {
    driver_id: input.driverId,
    recipient_user_id: driver.user_id,
    delivery_booking_id: deliveryBookingId,
    trailer_id: trailerId,
    trailer_number: trailerNumber,
    instruction,
    priority,
    sender_user_id: user.id,
    sender_display_name: senderDisplayName,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("driver_operational_instructions")
    .insert(payload)
    .select("id,driver_id,recipient_user_id,delivery_booking_id,trailer_id,trailer_number,instruction,priority,sender_user_id,sender_display_name,created_at,read_at,read_by")
    .single();

  if (insertError) {
    throw new Error(insertError.message || "Unable to send operational instruction.");
  }

  return toInstructionRecord(inserted as DriverOperationalInstructionRow);
}

export async function listOperationalInstructionsForDriverContext(
  supabase: RouteSupabase,
  input: {
    userId: string;
    driverId: string;
    deliveryBookingId?: string | null;
    trailerId?: string | null;
    limit?: number;
  },
): Promise<DriverInstructionRecord[]> {
  await requireSupervisorOrAdministrator(supabase, input.userId);

  let query = supabase
    .from("driver_operational_instructions")
    .select(instructionSelect)
    .eq("driver_id", input.driverId)
    .order("created_at", { ascending: false });

  if (input.deliveryBookingId) {
    query = query.eq("delivery_booking_id", input.deliveryBookingId);
  }

  if (input.trailerId) {
    query = query.eq("trailer_id", input.trailerId);
  }

  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_HISTORY_LIMIT, 100));
  const { data, error } = await query.limit(limit);

  if (error) {
    throw new Error(error.message || "Unable to load operational instruction history.");
  }

  const instructionRows = (data ?? []) as DriverOperationalInstructionRow[];
  const responseRows = await listResponseEventsForInstructions(
    supabase,
    instructionRows.map((row) => row.id),
    limit,
  );
  const responseByInstruction = buildResponseMap(responseRows);

  return instructionRows.map((row) => toInstructionRecord(row, responseByInstruction.get(row.id) ?? []));
}

export async function listOperationalInstructionContextForManager(
  supabase: RouteSupabase,
  input: {
    userId: string;
    driverId: string;
    deliveryBookingId?: string | null;
    trailerId?: string | null;
    limit?: number;
  },
): Promise<DriverInstructionContextFeed> {
  const instructions = await listOperationalInstructionsForDriverContext(supabase, input);

  const responseRows = instructions
    .flatMap((item) => item.responseHistory)
    .sort((a, b) => {
      const createdAtDifference = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return createdAtDifference || b.id.localeCompare(a.id);
    });
  const latestResponse = responseRows[0] ?? null;
  const latestException = responseRows.find((item) => item.isException) ?? null;

  const timeline: DriverInstructionTimelineEntry[] = [
    ...instructions.map((item) => ({
      id: `instruction:${item.id}`,
      kind: "manager_instruction" as const,
      createdAt: item.createdAt,
      actorLabel: item.senderDisplayName?.trim() || "Manager",
      text: item.instruction,
      responseType: null,
      isException: false,
    })),
    ...responseRows.map((response) => ({
      id: `response:${response.id}`,
      kind: "driver_response" as const,
      createdAt: response.createdAt,
      actorLabel: "Driver",
      text: response.message ? `${toResponseLabel(response.responseType)} - ${response.message}` : toResponseLabel(response.responseType),
      responseType: response.responseType,
      isException: response.isException,
    })),
  ]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-(Math.max(1, Math.min(input.limit ?? DEFAULT_HISTORY_LIMIT, 100)) * 2));

  return {
    instructions,
    latestResponse,
    latestException,
    timeline,
  };
}
