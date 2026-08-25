import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type DamagePersistClient = Pick<SupabaseClient<Database>, "from">;

export const LIVE_VESSEL_INSPECTION_DAMAGE_INSERT_COLUMNS = [
  "vessel_trailer_id",
  "trailer_id",
  "trailer_number",
  "damage_type",
  "damage_location",
  "severity",
  "description",
  "recorded_at",
  "recorded_by",
] as const;

export const LIVE_VESSEL_INSPECTION_DAMAGE_SEVERITIES = [
  "minor",
  "moderate",
  "major",
  "critical",
] as const;

export type LiveVesselInspectionDamageSeverity =
  (typeof LIVE_VESSEL_INSPECTION_DAMAGE_SEVERITIES)[number];

export function normalizeInspectionDamageSeverity(
  value?: string | null,
): LiveVesselInspectionDamageSeverity {
  const normalized = (value ?? "").trim().toLowerCase();

  if (normalized === "minor") {
    return "minor";
  }
  if (normalized === "moderate") {
    return "moderate";
  }
  if (normalized === "major" || normalized === "severe") {
    return "major";
  }
  if (normalized === "critical") {
    return "critical";
  }

  return "minor";
}

export type PersistInspectionDamageInput = {
  vesselTrailerId: string;
  vesselOperationId?: string | null;
  trailerId?: string | null;
  trailerNumber?: string | null;
  hasDamage: boolean;
  damageType?: string | null;
  damageLocation?: string | null;
  severity?: string | null;
  description?: string | null;
  recordedAt: string;
  recordedBy: string;
};

export type InspectionDamageInsertPayload = {
  vessel_trailer_id: string;
  trailer_id: string | null;
  trailer_number: string;
  damage_type: string | null;
  damage_location: string | null;
  severity: string;
  description: string;
  recorded_at: string;
  recorded_by: string;
};

type PersistError = { message?: string } | null;

export function buildInspectionDamageInsertPayload(
  input: PersistInspectionDamageInput,
): InspectionDamageInsertPayload {
  return {
    vessel_trailer_id: input.vesselTrailerId,
    trailer_id: input.trailerId ?? null,
    trailer_number: (input.trailerNumber ?? "").trim(),
    damage_type: (input.damageType ?? "").trim() || null,
    damage_location: (input.damageLocation ?? "").trim() || null,
    severity: normalizeInspectionDamageSeverity(input.severity),
    description: (input.description ?? "").trim(),
    recorded_at: input.recordedAt,
    recorded_by: input.recordedBy,
  };
}

export async function persistVesselInspectionDamage(
  supabase: DamagePersistClient,
  input: PersistInspectionDamageInput,
): Promise<{ error: PersistError }> {
  if (input.hasDamage) {
    const payload = buildInspectionDamageInsertPayload(input);
    const { data, error: insertError } = await supabase
      .from("vessel_inspection_damages")
      .insert(payload as never)
      .select("id")
      .single();

    if (insertError || !data?.id) {
      return {
        error: insertError ?? { message: "Unable to save damage details." },
      };
    }

    const { error: deleteError } = await supabase
      .from("vessel_inspection_damages")
      .delete()
      .eq("vessel_trailer_id", input.vesselTrailerId)
      .neq("id", data.id);

    return { error: deleteError };
  }

  const { error } = await supabase
    .from("vessel_inspection_damages")
    .delete()
    .eq("vessel_trailer_id", input.vesselTrailerId);

  return { error };
}
