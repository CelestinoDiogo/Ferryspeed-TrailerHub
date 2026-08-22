import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { COMPOUND_CAPACITY, normalizeCompoundPosition } from "@/lib/compound-yard";
import { normalizeTrailerCurrentOperationalState } from "@/lib/operations/trailer-current-state";
import { createTrailerActivity } from "@/lib/trailer-activity";
import { logTrailerEvent } from "@/lib/trailer-audit-log";

type RouteSupabase = SupabaseClient<Database>;

export class LocalTrailerReturnError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "departed" | "position_conflict" | "invalid_position",
  ) {
    super(message);
    this.name = "LocalTrailerReturnError";
  }
}

export type LocalTrailerMainListRow = {
  id: string;
  trailer_number?: string | null;
  is_local?: boolean | null;
  compound_position?: string | null;
  load_status?: string | null;
  load_description?: string | null;
  customer?: string | null;
  consignee?: string | null;
  operational_status?: string | null;
  departure_date?: string | null;
  departure_time?: string | null;
};

export type ReturnLocalTrailerToMainListResult = {
  alreadyMain: boolean;
  trailer: LocalTrailerMainListRow;
};

const TRAILER_SELECT =
  "id, trailer_number, is_local, compound_position, load_status, load_description, customer, consignee, operational_status, departure_date, departure_time";

const ASSIGNABLE_POSITION = /^P(?:0[1-9]|[1-4]\d|50)$/;

export const resolveReturnToMainListPosition = (value?: string | null) => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  const normalized = normalizeCompoundPosition(trimmed);
  if (!normalized || !ASSIGNABLE_POSITION.test(normalized)) {
    throw new LocalTrailerReturnError(
      `Position ${trimmed.toUpperCase()} is not a valid Compound bay (P01–P${String(COMPOUND_CAPACITY).padStart(2, "0")}).`,
      "invalid_position",
    );
  }

  return normalized;
};

const isUniquePositionViolation = (error: { code?: string | null; message?: string | null } | null) => {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  return code === "23505" || message.includes("idx_trailers_active_compound_position_unique");
};

export async function returnLocalTrailerToMainList(
  supabase: RouteSupabase,
  input: {
    trailerId: string;
    operatorName: string;
    compoundPosition?: string | null;
  },
): Promise<ReturnLocalTrailerToMainListResult> {
  const { data: trailer, error: loadError } = await supabase
    .from("trailers")
    .select(TRAILER_SELECT)
    .eq("id", input.trailerId)
    .maybeSingle();

  if (loadError) {
    throw new Error(loadError.message || "Unable to load trailer.");
  }

  if (!trailer) {
    throw new LocalTrailerReturnError("Trailer not found.", "not_found");
  }

  if ((trailer.departure_date ?? "").trim()) {
    throw new LocalTrailerReturnError("Departed trailers cannot be returned to the Main List.", "departed");
  }

  if (trailer.is_local !== true) {
    return { alreadyMain: true, trailer: trailer as LocalTrailerMainListRow };
  }

  const requestedPosition = resolveReturnToMainListPosition(input.compoundPosition);

  if (requestedPosition) {
    const { data: occupants, error: occupancyError } = await supabase
      .from("trailers")
      .select("id, trailer_number, compound_position, is_local, departure_date")
      .is("departure_date", null)
      .neq("id", trailer.id);

    if (occupancyError) {
      throw new Error(occupancyError.message || "Unable to check compound position availability.");
    }

    const occupant = (occupants ?? []).find(
      (row) =>
        row.is_local !== true &&
        normalizeCompoundPosition(row.compound_position) === requestedPosition,
    );

    if (occupant) {
      throw new LocalTrailerReturnError(
        `Position ${requestedPosition} is already occupied${occupant.trailer_number ? ` by ${occupant.trailer_number}` : ""}. The trailer was left as Local.`,
        "position_conflict",
      );
    }
  }

  const currentState = normalizeTrailerCurrentOperationalState(
    {
      departure_date: trailer.departure_date,
      departure_time: trailer.departure_time,
      operational_status: trailer.operational_status,
      is_local: false,
      compound_position: requestedPosition,
    },
    { intent: requestedPosition ? "place_on_compound" : "sync" },
  );
  const { data: updated, error: updateError } = await supabase
    .from("trailers")
    .update({
      is_local: false,
      compound_position: requestedPosition,
      operational_status: currentState.operational_status,
      ...(currentState.clearDepartureTime || currentState.patch.departure_date !== undefined
        ? { departure_time: currentState.departure_time, departure_date: currentState.departure_date }
        : {}),
    })
    .eq("id", trailer.id)
    .eq("is_local", true)
    .select(TRAILER_SELECT)
    .maybeSingle();

  if (isUniquePositionViolation(updateError)) {
    throw new LocalTrailerReturnError(
      `Position ${requestedPosition} is already occupied. The trailer was left as Local.`,
      "position_conflict",
    );
  }

  if (updateError) {
    throw new Error(updateError.message || "Unable to return trailer to the Main List.");
  }

  if (!updated) {
    throw new LocalTrailerReturnError(
      "The trailer could not be returned to the Main List because its Local state changed.",
      "not_found",
    );
  }

  const saved = updated as LocalTrailerMainListRow;
  const previousValue = {
    is_local: true,
    compound_position: trailer.compound_position ?? null,
    operational_status: trailer.operational_status ?? null,
  };
  const newValue = {
    is_local: false,
    compound_position: saved.compound_position ?? null,
    operational_status: saved.operational_status ?? null,
  };
  const assignedPosition = Boolean(requestedPosition);
  const eventDescription = assignedPosition
    ? `Trailer returned to Main List. Compound position ${requestedPosition} assigned.`
    : "Trailer returned to Main List.";

  const { error: eventError } = await supabase.from("trailer_events").insert({
    trailer_id: trailer.id,
    trailer_number: trailer.trailer_number,
    event_type: "trailer_location_changed",
    event_description: eventDescription,
    old_value: previousValue,
    new_value: newValue,
  });

  if (eventError) {
    throw new Error(eventError.message || "Unable to create trailer event history.");
  }

  if (assignedPosition && (trailer.compound_position ?? null) !== requestedPosition) {
    const { error: positionEventError } = await supabase.from("trailer_events").insert({
      trailer_id: trailer.id,
      trailer_number: trailer.trailer_number,
      event_type: "compound_position_changed",
      event_description: `Compound position assigned: ${requestedPosition}.`,
      old_value: { compound_position: trailer.compound_position ?? null },
      new_value: { compound_position: requestedPosition },
    });

    if (positionEventError) {
      throw new Error(positionEventError.message || "Unable to create compound position history.");
    }
  }

  await logTrailerEvent({
    trailerId: trailer.id,
    trailerNumber: trailer.trailer_number,
    eventType: "trailer_returned_to_main_list",
    description: eventDescription,
    previousValue,
    newValue,
    sourceModule: "compound",
    performedBy: input.operatorName,
  });

  await createTrailerActivity({
    supabaseClient: supabase,
    trailerId: trailer.id,
    trailerNumber: trailer.trailer_number ?? trailer.id,
    eventType: "trailer_location_changed",
    eventTitle: "Trailer returned to Main List",
    eventDescription: assignedPosition
      ? `Trailer classification changed from Local to Main List. Compound position ${requestedPosition} assigned.`
      : "Trailer classification changed from Local to Main List. No compound position was assigned.",
    sourceModule: "compound",
    sourceRecordId: trailer.id,
    previousStatus: trailer.operational_status ?? null,
    newStatus: saved.operational_status ?? null,
    previousCompoundPosition: trailer.compound_position ?? null,
    newCompoundPosition: saved.compound_position ?? null,
    metadata: previousValue,
    performedBy: input.operatorName,
  });

  return { alreadyMain: false, trailer: saved };
}
