import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type DepartureUndoConflictCode =
  | "not_found"
  | "already_restored"
  | "stale_state"
  | "history_not_found"
  | "position_occupied";

export class DepartureUndoConflictError extends Error {
  constructor(public readonly code: DepartureUndoConflictCode) {
    super(
      code === "already_restored"
        ? "Departure has already been undone. The list has been refreshed."
        : code === "position_occupied"
          ? "The previous Compound position is now occupied. Move the occupying trailer or choose a position before retrying."
          : code === "history_not_found"
            ? "The matching departure history could not be found. No trailer state was changed."
            : code === "not_found"
              ? "Trailer was not found."
              : "Trailer state changed after this departure was recorded. The list has been refreshed.",
    );
    this.name = "DepartureUndoConflictError";
  }
}

type UndoDepartureInput = {
  trailerId: string;
  expectedDepartureAt: string;
  performedBy?: string | null;
};

type UndoDepartureResult = {
  trailerId: string;
  trailerNumber: string | null;
  restoredOperationalStatus: string | null;
  restoredCompoundPosition: string | null;
  loadStatus: string | null;
  occurredAt: string;
};

export const undoDeparture = async (
  supabaseClient: SupabaseClient<Database>,
  input: UndoDepartureInput,
): Promise<UndoDepartureResult> => {
  const { data, error } = await supabaseClient.rpc("undo_trailer_departure", {
    p_trailer_id: input.trailerId,
    p_expected_departure_at: input.expectedDepartureAt,
    p_performed_by: input.performedBy ?? null,
  });

  if (error) {
    throw new Error(error.message || "Unable to undo departure.");
  }

  const row = data?.[0];
  if (!row?.transitioned) {
    throw new DepartureUndoConflictError((row?.conflict_code ?? "stale_state") as DepartureUndoConflictCode);
  }

  return {
    trailerId: row.trailer_id,
    trailerNumber: row.trailer_number,
    restoredOperationalStatus: row.restored_operational_status,
    restoredCompoundPosition: row.restored_compound_position,
    loadStatus: row.load_status,
    occurredAt: row.occurred_at,
  };
};
