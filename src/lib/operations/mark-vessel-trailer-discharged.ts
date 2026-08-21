import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createTrailerActivity, type TrailerActivitySourceModule } from "@/lib/trailer-activity";
import type { VesselOperationTrailerRecord } from "@/lib/vessel-operations";

type RouteSupabase = SupabaseClient<Database>;

const DISCHARGE_SELECT =
  "id, vessel_operation_id, trailer_id, trailer_number, status, arrival_status, arrival_record_id, discharged_at, arrived_at, arrival_confirmed_at, arrival_confirmed_by, inspection_started_at, inspection_completed_at";

const TERMINAL_ARRIVAL_STATUSES = new Set(["cancelled", "no_show", "not_discharged"]);

export type MarkVesselTrailerDischargedResult = {
  vesselTrailerId: string;
  dischargedAt: string | null;
  alreadyDischarged: boolean;
  trailer: VesselOperationTrailerRecord;
};

const asTrailerRecord = (row: Record<string, unknown>) => row as unknown as VesselOperationTrailerRecord;

export async function markVesselTrailerDischarged(input: {
  supabase: RouteSupabase;
  vesselTrailerId: string;
  operatorName: string;
  dischargedAt?: string;
  sourceModule?: TrailerActivitySourceModule;
  eventDescription?: string;
}): Promise<MarkVesselTrailerDischargedResult> {
  const { data: current, error: loadError } = await input.supabase
    .from("vessel_operation_trailers")
    .select(DISCHARGE_SELECT)
    .eq("id", input.vesselTrailerId)
    .maybeSingle();

  if (loadError) {
    throw new Error(loadError.message || "Unable to load vessel trailer for discharge.");
  }

  if (!current) {
    throw new Error("Vessel operation trailer was not found.");
  }

  const trailer = asTrailerRecord(current);
  const arrivalStatus = trailer.arrival_status ?? "expected";

  if (TERMINAL_ARRIVAL_STATUSES.has(arrivalStatus)) {
    throw new Error(`Trailer is marked ${arrivalStatus.replace(/_/g, " ")} and cannot be discharged.`);
  }

  if (trailer.discharged_at) {
    return {
      vesselTrailerId: trailer.id,
      dischargedAt: trailer.discharged_at,
      alreadyDischarged: true,
      trailer,
    };
  }

  if (arrivalStatus === "arrived" || trailer.arrival_record_id) {
    return {
      vesselTrailerId: trailer.id,
      dischargedAt: trailer.discharged_at ?? null,
      alreadyDischarged: true,
      trailer,
    };
  }

  const nowIso = input.dischargedAt ?? new Date().toISOString();
  const { data: updated, error: updateError } = await input.supabase
    .from("vessel_operation_trailers")
    .update({
      status: trailer.status === "inspected" ? trailer.status : "arrived",
      arrival_status: "arrived",
      discharged_at: nowIso,
      arrived_at: trailer.arrived_at ?? nowIso,
      arrival_confirmed_at: trailer.arrival_confirmed_at ?? nowIso,
      arrival_confirmed_by: input.operatorName,
      updated_at: nowIso,
    })
    .eq("id", trailer.id)
    .in("arrival_status", ["expected", "available_for_arrival"])
    .is("discharged_at", null)
    .is("arrival_record_id", null)
    .select(DISCHARGE_SELECT)
    .maybeSingle();

  if (updateError) {
    throw new Error(updateError.message || "Unable to record vessel discharge.");
  }

  if (!updated) {
    const { data: latest } = await input.supabase
      .from("vessel_operation_trailers")
      .select(DISCHARGE_SELECT)
      .eq("id", trailer.id)
      .maybeSingle();

    const latestTrailer = latest ? asTrailerRecord(latest) : trailer;
    if (latestTrailer.discharged_at) {
      return {
        vesselTrailerId: latestTrailer.id,
        dischargedAt: latestTrailer.discharged_at,
        alreadyDischarged: true,
        trailer: latestTrailer,
      };
    }

    throw new Error("Discharge is no longer available for this trailer.");
  }

  const discharged = asTrailerRecord(updated);

  const { error: eventError } = await input.supabase.from("trailer_events").insert({
    trailer_id: discharged.trailer_id ?? null,
    trailer_number: discharged.trailer_number ?? null,
    event_type: "vessel_trailer_marked_arrived",
    event_description: input.eventDescription ?? "Trailer discharged from vessel.",
    old_value: {
      vessel_trailer_id: trailer.id,
      arrival_status: trailer.arrival_status,
      discharged_at: trailer.discharged_at ?? null,
    },
    new_value: {
      vessel_trailer_id: discharged.id,
      arrival_status: "arrived",
      discharged_at: nowIso,
      arrived_by: input.operatorName,
    },
  });

  if (eventError) {
    console.error("Unable to save vessel discharge event:", eventError);
  }

  try {
    await createTrailerActivity({
      supabaseClient: input.supabase,
      trailerId: discharged.trailer_id ?? null,
      trailerNumber: discharged.trailer_number ?? "",
      eventType: "vessel_arrived",
      eventTitle: "Trailer discharged from vessel",
      eventDescription: input.eventDescription ?? "Trailer discharged from vessel.",
      sourceModule: input.sourceModule ?? "vessel",
      sourceRecordId: discharged.id,
      previousStatus: trailer.arrival_status ?? trailer.status,
      newStatus: "arrived",
      metadata: {
        vessel_trailer_id: discharged.id,
        vessel_operation_id: discharged.vessel_operation_id,
        discharged_at: nowIso,
      },
      performedBy: input.operatorName,
      createdAt: nowIso,
    });
  } catch (activityError) {
    console.error("Unable to log trailer activity for vessel discharge:", activityError);
  }

  return {
    vesselTrailerId: discharged.id,
    dischargedAt: nowIso,
    alreadyDischarged: false,
    trailer: {
      ...discharged,
      discharged_at: nowIso,
      arrived_at: discharged.arrived_at ?? nowIso,
      arrival_confirmed_at: discharged.arrival_confirmed_at ?? nowIso,
      arrival_status: "arrived",
    },
  };
}
