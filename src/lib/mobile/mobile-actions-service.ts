import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  buildVesselSupabaseErrorMessage,
  normalizeCompoundPosition,
  normalizeExpectedTemperatureUnit,
  normalizeTrailerNumber,
  resolveExpectedFrontTemperature,
  resolveExpectedRearTemperature,
  type SupabaseErrorLike,
  type VesselOperationTrailerRecord,
} from "@/lib/vessel-operations";
import { moveCompoundTrailer } from "@/lib/compound-yard";
import { createTrailerActivity } from "@/lib/trailer-activity";
import { getTemperatureToleranceSettingsFromStorage, isTemperatureOutOfRange } from "@/lib/temperature-tolerance";
import type { MobileActionConflict, MobileActionRequest } from "@/lib/mobile/mobile-actions";

type RouteSupabase = SupabaseClient<Database>;

type MobileActionResult = {
  ok: boolean;
  status: "success" | "conflict" | "failed";
  message: string;
  retryable: boolean;
  conflict?: MobileActionConflict | null;
  updatedTrailer?: {
    trailerId: string | null;
    trailerNumber: string | null;
    loadStatus: string | null;
    compoundPosition: string | null;
    operationalStatus: string | null;
  } | null;
  updatedVesselTrailer?: {
    vesselTrailerId: string;
    trailerNumber: string | null;
    arrivalStatus: string | null;
    status: string | null;
    inspectionStartedAt: string | null;
    inspectionCompletedAt: string | null;
    hasDamage: boolean | null;
    hasTemperatureAlert: boolean | null;
  } | null;
};

const normalizeMessage = (value: unknown, fallback: string) => {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const resolveOperatorName = (user: User) => {
  const metadataName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name.trim());

  return metadataName || user.email || user.id || "TrailerHub User";
};

const buildConflict = (input: {
  code: string;
  message: string;
  serverState?: Record<string, unknown> | null;
}): MobileActionResult => {
  return {
    ok: false,
    status: "conflict",
    message: input.message,
    retryable: false,
    conflict: {
      code: input.code,
      message: input.message,
      serverState: input.serverState ?? null,
    },
  };
};

const isAlreadyArrivedMessage = (message: string) => {
  const lower = message.toLowerCase();
  return lower.includes("already confirmed") || lower.includes("already linked") || lower.includes("already exists");
};

const asVesselTrailerState = (row: VesselOperationTrailerRecord) => {
  return {
    vesselTrailerId: row.id,
    trailerNumber: row.trailer_number ?? null,
    arrivalStatus: row.arrival_status ?? null,
    status: row.status ?? null,
    inspectionStartedAt: row.inspection_started_at ?? null,
    inspectionCompletedAt: row.inspection_completed_at ?? null,
    hasDamage: row.has_damage ?? null,
    hasTemperatureAlert: row.has_temperature_alert ?? null,
  };
};

const getVesselTrailer = async (supabase: RouteSupabase, vesselTrailerId: string) => {
  const { data, error } = await supabase
    .from("vessel_operation_trailers")
    .select(
      "id, vessel_operation_id, trailer_id, trailer_number, customer, load_status, status, arrival_status, arrival_record_id, inspection_started_at, inspection_completed_at, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, temperature_required, has_damage, has_temperature_alert",
    )
    .eq("id", vesselTrailerId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to load vessel trailer.");
  }

  return (data ?? null) as VesselOperationTrailerRecord | null;
};

const resolveVesselTrailerForArrival = async (
  supabase: RouteSupabase,
  payload: Extract<MobileActionRequest, { actionType: "MARK_ARRIVED" }>['payload'],
) => {
  if (payload.vesselTrailerId) {
    return getVesselTrailer(supabase, payload.vesselTrailerId);
  }

  const normalizedTrailerNumber = normalizeTrailerNumber(payload.trailerNumber);
  if (!normalizedTrailerNumber) {
    return null;
  }

  const query = supabase
    .from("vessel_operation_trailers")
    .select(
      "id, vessel_operation_id, trailer_id, trailer_number, customer, load_status, status, arrival_status, arrival_record_id, inspection_started_at, inspection_completed_at, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, temperature_required, has_damage, has_temperature_alert",
    )
    .ilike("trailer_number", normalizedTrailerNumber)
    .order("updated_at", { ascending: false })
    .limit(5);

  const filteredQuery = payload.operationId ? query.eq("vessel_operation_id", payload.operationId) : query;
  const { data, error } = await filteredQuery;

  if (error) {
    throw new Error(error.message || "Unable to resolve vessel trailer by number.");
  }

  const rows = ((data ?? []) as VesselOperationTrailerRecord[]).filter((row) => normalizeTrailerNumber(row.trailer_number) === normalizedTrailerNumber);
  if (rows.length === 0) {
    return null;
  }

  const preferred = rows.find((row) => row.arrival_status === "available_for_arrival" || row.arrival_status === "expected") ?? rows[0];
  return preferred;
};

const getTrailerById = async (supabase: RouteSupabase, trailerId: string) => {
  const { data, error } = await supabase
    .from("trailers")
    .select("id, trailer_number, load_status, customer, consignee, container_number, load_description, notes, compound_position, operational_status, departure_date, is_local")
    .eq("id", trailerId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to load trailer.");
  }

  return (data ?? null) as Database["public"]["Tables"]["trailers"]["Row"] | null;
};

const runMarkArrived = async (
  supabase: RouteSupabase,
  payload: Extract<MobileActionRequest, { actionType: "MARK_ARRIVED" }>['payload'],
  operatorName: string,
): Promise<MobileActionResult> => {
  const trailer = await resolveVesselTrailerForArrival(supabase, payload);

  if (!trailer) {
    return {
      ok: false,
      status: "failed",
      message: "Trailer was not found in vessel operations.",
      retryable: false,
    };
  }

  if (trailer.arrival_status === "arrived" || trailer.arrival_record_id) {
    return {
      ok: true,
      status: "success",
      message: `${trailer.trailer_number ?? "Trailer"} is already marked as arrived.`,
      retryable: false,
      updatedVesselTrailer: asVesselTrailerState(trailer),
    };
  }

  try {
    const receivedAt = payload.receivedAt ?? new Date().toISOString();

    const { data: trailerId, error: confirmError } = await supabase.rpc("confirm_vessel_trailer_arrival", {
      p_vessel_operation_trailer_id: trailer.id,
      p_received_at: receivedAt,
      p_confirmed_by: operatorName,
    });

    if (confirmError) {
      if (isAlreadyArrivedMessage(confirmError.message ?? "")) {
        return {
          ok: true,
          status: "success",
          message: `${trailer.trailer_number ?? "Trailer"} was already marked as arrived.`,
          retryable: false,
        };
      }

      throw confirmError;
    }

    const latestTrailer = await getVesselTrailer(supabase, trailer.id);
    const arrivalRecordId = typeof trailerId === "string" ? trailerId : latestTrailer?.arrival_record_id ?? null;
    const arrivalTrailer = arrivalRecordId ? await getTrailerById(supabase, arrivalRecordId) : null;

    await createTrailerActivity({
      supabaseClient: supabase,
      trailerId: arrivalTrailer?.id ?? trailer.trailer_id ?? null,
      trailerNumber: trailer.trailer_number ?? "UNKNOWN",
      eventType: "vessel_arrived",
      eventTitle: "Vessel trailer marked arrived",
      eventDescription: "Arrival confirmed from Master Mobile.",
      sourceModule: "vessel",
      sourceRecordId: trailer.id,
      previousStatus: trailer.arrival_status ?? trailer.status,
      newStatus: "arrived",
      metadata: {
        vessel_trailer_id: trailer.id,
        vessel_operation_id: trailer.vessel_operation_id,
      },
      performedBy: operatorName,
      createdAt: receivedAt,
    });

    return {
      ok: true,
      status: "success",
      message: `${trailer.trailer_number ?? "Trailer"} marked as arrived.`,
      retryable: false,
      updatedTrailer: arrivalTrailer
        ? {
            trailerId: arrivalTrailer.id,
            trailerNumber: arrivalTrailer.trailer_number,
            loadStatus: arrivalTrailer.load_status,
            compoundPosition: arrivalTrailer.compound_position,
            operationalStatus: arrivalTrailer.operational_status,
          }
        : null,
      updatedVesselTrailer: latestTrailer ? asVesselTrailerState(latestTrailer) : null,
    };
  } catch (error) {
    const supabaseError = (error && typeof error === "object" ? error : null) as SupabaseErrorLike | null;
    const message = buildVesselSupabaseErrorMessage(supabaseError, "Unable to confirm arrival.");
    return {
      ok: false,
      status: "failed",
      message,
      retryable: true,
    };
  }
};

const runMoveCompoundPosition = async (
  supabase: RouteSupabase,
  payload: Extract<MobileActionRequest, { actionType: "MOVE_COMPOUND_POSITION" }>['payload'],
  operatorName: string,
): Promise<MobileActionResult> => {
  const trailer = await getTrailerById(supabase, payload.trailerId);
  if (!trailer) {
    return buildConflict({
      code: "trailer_missing",
      message: "Trailer no longer exists.",
    });
  }

  if (trailer.departure_date) {
    return buildConflict({
      code: "trailer_departed",
      message: "Trailer already departed and cannot be moved.",
      serverState: { departureDate: trailer.departure_date },
    });
  }

  if (trailer.is_local === true) {
    return buildConflict({
      code: "local_trailer",
      message: "Local trailers cannot be moved into the compound grid.",
    });
  }

  const expectedCurrent = normalizeCompoundPosition(payload.expectedCurrentPosition);
  const currentNormalized = normalizeCompoundPosition(trailer.compound_position);

  if (expectedCurrent && expectedCurrent !== currentNormalized) {
    return buildConflict({
      code: "stale_position",
      message: `Trailer position changed from ${expectedCurrent} to ${currentNormalized ?? "none"}.`,
      serverState: { currentPosition: currentNormalized },
    });
  }

  const target = normalizeCompoundPosition(payload.targetPosition);
  if (!target) {
    return {
      ok: false,
      status: "failed",
      message: "Enter a valid compound position.",
      retryable: false,
    };
  }

  try {
    const updated = await moveCompoundTrailer(supabase, {
      trailerId: trailer.id,
      targetPosition: target,
      movedBy: operatorName,
      reason: payload.reason ?? "Master Mobile move",
    });

    await createTrailerActivity({
      supabaseClient: supabase,
      trailerId: updated?.id ?? trailer.id,
      trailerNumber: updated?.trailer_number ?? trailer.trailer_number ?? payload.trailerNumber ?? "UNKNOWN",
      eventType: "compound_position_changed",
      eventTitle: "Compound position changed",
      eventDescription: `Moved to ${target} from Master Mobile.`,
      sourceModule: "compound",
      sourceRecordId: trailer.id,
      previousCompoundPosition: trailer.compound_position,
      newCompoundPosition: updated?.compound_position ?? target,
      performedBy: operatorName,
    });

    return {
      ok: true,
      status: "success",
      message: `${updated?.trailer_number ?? trailer.trailer_number ?? "Trailer"} moved to ${updated?.compound_position ?? target}.`,
      retryable: false,
      updatedTrailer: {
        trailerId: updated?.id ?? trailer.id,
        trailerNumber: updated?.trailer_number ?? trailer.trailer_number,
        loadStatus: updated?.load_status ?? trailer.load_status,
        compoundPosition: updated?.compound_position ?? target,
        operationalStatus: updated?.operational_status ?? trailer.operational_status,
      },
    };
  } catch (error) {
    const message = normalizeMessage((error as { message?: string } | null)?.message, "Unable to move trailer.");

    if (message.toLowerCase().includes("occupied")) {
      return buildConflict({
        code: "position_occupied",
        message,
        serverState: { currentPosition: currentNormalized, targetPosition: target },
      });
    }

    return {
      ok: false,
      status: "failed",
      message,
      retryable: true,
    };
  }
};

const runChangeLoadStatus = async (
  supabase: RouteSupabase,
  payload: Extract<MobileActionRequest, { actionType: "CHANGE_LOAD_STATUS" }>['payload'],
  operatorName: string,
): Promise<MobileActionResult> => {
  const trailer = await getTrailerById(supabase, payload.trailerId);
  if (!trailer) {
    return buildConflict({ code: "trailer_missing", message: "Trailer no longer exists." });
  }

  if (trailer.departure_date) {
    return buildConflict({
      code: "trailer_departed",
      message: "Trailer already departed and cannot change load status.",
      serverState: { departureDate: trailer.departure_date },
    });
  }

  if (payload.expectedCurrentLoadStatus && trailer.load_status !== payload.expectedCurrentLoadStatus) {
    return buildConflict({
      code: "stale_load_status",
      message: `Load status changed from ${payload.expectedCurrentLoadStatus} to ${trailer.load_status ?? "Unknown"}.`,
      serverState: { currentLoadStatus: trailer.load_status },
    });
  }

  if (trailer.load_status === payload.nextLoadStatus) {
    return {
      ok: true,
      status: "success",
      message: `${trailer.trailer_number ?? "Trailer"} is already ${payload.nextLoadStatus}.`,
      retryable: false,
      updatedTrailer: {
        trailerId: trailer.id,
        trailerNumber: trailer.trailer_number,
        loadStatus: trailer.load_status,
        compoundPosition: trailer.compound_position,
        operationalStatus: trailer.operational_status,
      },
    };
  }

  const nextNotes = payload.notes?.trim() || null;
  const updatePayload: Database["public"]["Tables"]["trailers"]["Update"] = {
    load_status: payload.nextLoadStatus,
  };

  if (payload.nextLoadStatus === "Loaded") {
    updatePayload.customer = payload.customer?.trim() || trailer.customer;
    updatePayload.consignee = payload.consignee?.trim() || trailer.consignee;
    updatePayload.container_number = payload.containerNumber?.trim() || trailer.container_number;
    updatePayload.load_description = payload.loadDescription?.trim() || trailer.load_description;
    updatePayload.notes = nextNotes ?? trailer.notes;
  } else {
    updatePayload.load_description = payload.loadDescription?.trim() || null;
    updatePayload.notes = nextNotes ?? trailer.notes;
  }

  const { data: updated, error: updateError } = await supabase
    .from("trailers")
    .update(updatePayload)
    .eq("id", trailer.id)
    .select("id, trailer_number, load_status, compound_position, operational_status")
    .maybeSingle();

  if (updateError || !updated) {
    return {
      ok: false,
      status: "failed",
      message: buildVesselSupabaseErrorMessage(updateError, "Unable to update load status."),
      retryable: true,
    };
  }

  const nowIso = new Date().toISOString();

  await supabase.from("trailer_events").insert({
    trailer_id: trailer.id,
    trailer_number: trailer.trailer_number,
    event_type: payload.nextLoadStatus === "Loaded" ? "trailer_loaded" : "trailer_emptied",
    event_description: `Trailer marked as ${payload.nextLoadStatus.toLowerCase()} from Master Mobile.`,
    old_value: {
      load_status: trailer.load_status ?? null,
      customer: trailer.customer ?? null,
      consignee: trailer.consignee ?? null,
      container_number: trailer.container_number ?? null,
      load_description: trailer.load_description ?? null,
      notes: trailer.notes ?? null,
    },
    new_value: {
      load_status: payload.nextLoadStatus,
      customer: updatePayload.customer ?? null,
      consignee: updatePayload.consignee ?? null,
      container_number: updatePayload.container_number ?? null,
      load_description: updatePayload.load_description ?? null,
      notes: updatePayload.notes ?? null,
    },
  });

  await createTrailerActivity({
    supabaseClient: supabase,
    trailerId: trailer.id,
    trailerNumber: updated.trailer_number ?? trailer.trailer_number ?? payload.trailerNumber ?? "UNKNOWN",
    eventType: "load_status_changed",
    eventTitle: "Load status changed",
    eventDescription: `Load status set to ${payload.nextLoadStatus}.`,
    sourceModule: "compound",
    sourceRecordId: trailer.id,
    previousStatus: trailer.load_status,
    newStatus: payload.nextLoadStatus,
    metadata: {
      changed_at: nowIso,
    },
    performedBy: operatorName,
    createdAt: nowIso,
  });

  return {
    ok: true,
    status: "success",
    message: `${updated.trailer_number ?? trailer.trailer_number ?? "Trailer"} set to ${payload.nextLoadStatus}.`,
    retryable: false,
    updatedTrailer: {
      trailerId: updated.id,
      trailerNumber: updated.trailer_number,
      loadStatus: updated.load_status,
      compoundPosition: updated.compound_position,
      operationalStatus: updated.operational_status,
    },
  };
};

const validateInspectionCompletion = (
  trailer: VesselOperationTrailerRecord,
  payload: Extract<MobileActionRequest, { actionType: "COMPLETE_INSPECTION" | "SAVE_INSPECTION_PROGRESS" }>['payload'],
  complete: boolean,
) => {
  const expectedFrontTemperature = resolveExpectedFrontTemperature(trailer);
  const expectedRearTemperature = resolveExpectedRearTemperature(trailer);
  const hasLegacyExpectedRange = Boolean(trailer.temperature_required?.trim()) && expectedFrontTemperature === null;

  if (complete && expectedFrontTemperature !== null && payload.frontTemperature === null) {
    return "Front temperature is required for this trailer.";
  }

  if (complete && expectedRearTemperature !== null && payload.rearTemperature === null) {
    return "Rear temperature is required for this trailer.";
  }

  if (complete && hasLegacyExpectedRange && payload.frontTemperature === null) {
    return "Front temperature is required for this trailer.";
  }

  if (payload.damage?.hasDamage && !payload.damage.damageDescription?.trim()) {
    return "Damage description is required when damage is marked as yes.";
  }

  return null;
};

const persistInspection = async (
  supabase: RouteSupabase,
  trailer: VesselOperationTrailerRecord,
  payload: Extract<MobileActionRequest, { actionType: "COMPLETE_INSPECTION" | "SAVE_INSPECTION_PROGRESS" }>['payload'],
  operatorName: string,
  complete: boolean,
): Promise<MobileActionResult> => {
  const validationError = validateInspectionCompletion(trailer, payload, complete);
  if (validationError) {
    return {
      ok: false,
      status: "failed",
      message: validationError,
      retryable: false,
    };
  }

  const nowIso = new Date().toISOString();
  const expectedUnit = normalizeExpectedTemperatureUnit(payload.unit ?? trailer.expected_temperature_unit);
  const expectedFrontTemperature = resolveExpectedFrontTemperature(trailer);
  const expectedRearTemperature = resolveExpectedRearTemperature(trailer);
  const tolerance = getTemperatureToleranceSettingsFromStorage();

  const frontOut = isTemperatureOutOfRange(payload.frontTemperature ?? null, expectedFrontTemperature, tolerance);
  const rearOut = isTemperatureOutOfRange(payload.rearTemperature ?? null, expectedRearTemperature, tolerance);

  const { error: deleteTemperatureError } = await supabase
    .from("vessel_inspection_temperatures")
    .delete()
    .eq("vessel_trailer_id", trailer.id)
    .in("reading_point", ["front", "rear", "Front", "Rear"]);

  if (deleteTemperatureError) {
    return {
      ok: false,
      status: "failed",
      message: buildVesselSupabaseErrorMessage(deleteTemperatureError, "Unable to update inspection temperatures."),
      retryable: true,
    };
  }

  const temperatureRows = [
    {
      vessel_trailer_id: trailer.id,
      trailer_id: trailer.trailer_id ?? null,
      trailer_number: trailer.trailer_number ?? null,
      temperature_value: payload.frontTemperature ?? null,
      temperature_unit: expectedUnit,
      reading_point: "front",
      notes: payload.notes?.trim() || null,
      is_out_of_range: frontOut,
      recorded_at: nowIso,
      recorded_by: operatorName,
    },
    {
      vessel_trailer_id: trailer.id,
      trailer_id: trailer.trailer_id ?? null,
      trailer_number: trailer.trailer_number ?? null,
      temperature_value: payload.rearTemperature ?? null,
      temperature_unit: expectedUnit,
      reading_point: "rear",
      notes: payload.notes?.trim() || null,
      is_out_of_range: rearOut,
      recorded_at: nowIso,
      recorded_by: operatorName,
    },
  ];

  const { error: temperatureInsertError } = await supabase.from("vessel_inspection_temperatures").insert(temperatureRows as never);
  if (temperatureInsertError) {
    return {
      ok: false,
      status: "failed",
      message: buildVesselSupabaseErrorMessage(temperatureInsertError, "Unable to save temperatures."),
      retryable: true,
    };
  }

  const { error: deleteDamageError } = await supabase
    .from("vessel_inspection_damages")
    .delete()
    .eq("vessel_trailer_id", trailer.id);

  if (deleteDamageError) {
    return {
      ok: false,
      status: "failed",
      message: buildVesselSupabaseErrorMessage(deleteDamageError, "Unable to clear previous damages."),
      retryable: true,
    };
  }

  if (payload.damage?.hasDamage) {
    const { error: insertDamageError } = await supabase.from("vessel_inspection_damages").insert({
      vessel_trailer_id: trailer.id,
      trailer_id: trailer.trailer_id ?? null,
      trailer_number: trailer.trailer_number ?? null,
      vessel_operation_id: trailer.vessel_operation_id,
      damage_type: payload.damage.damageType?.trim() || null,
      damage_location: payload.damage.damageLocation?.trim() || null,
      severity: "moderate",
      description: payload.damage.damageDescription?.trim() || null,
      recorded_at: nowIso,
      recorded_by: operatorName,
    } as never);

    if (insertDamageError) {
      return {
        ok: false,
        status: "failed",
        message: buildVesselSupabaseErrorMessage(insertDamageError, "Unable to save damage details."),
        retryable: true,
      };
    }
  }

  const trailerUpdate: Database["public"]["Tables"]["vessel_operation_trailers"]["Update"] = {
    inspection_started_at: trailer.inspection_started_at ?? nowIso,
    planning_notes: payload.notes?.trim() || trailer.planning_notes || null,
    has_damage: payload.damage?.hasDamage ?? false,
    has_temperature_alert: frontOut || rearOut,
    updated_at: nowIso,
  };

  if (complete) {
    trailerUpdate.status = "inspected";
    trailerUpdate.inspection_completed_at = nowIso;
  }

  const { data: updated, error: trailerUpdateError } = await supabase
    .from("vessel_operation_trailers")
    .update(trailerUpdate)
    .eq("id", trailer.id)
    .select(
      "id, vessel_operation_id, trailer_id, trailer_number, customer, load_status, status, arrival_status, arrival_record_id, inspection_started_at, inspection_completed_at, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, temperature_required, has_damage, has_temperature_alert",
    )
    .maybeSingle();

  if (trailerUpdateError || !updated) {
    return {
      ok: false,
      status: "failed",
      message: buildVesselSupabaseErrorMessage(trailerUpdateError, "Unable to update inspection status."),
      retryable: true,
    };
  }

  await createTrailerActivity({
    supabaseClient: supabase,
    trailerId: updated.trailer_id ?? null,
    trailerNumber: updated.trailer_number ?? trailer.trailer_number ?? payload.trailerNumber ?? "UNKNOWN",
    eventType: complete ? "inspection_completed" : "inspection_started",
    eventTitle: complete ? "Inspection completed" : "Inspection progress saved",
    eventDescription: complete ? "Inspection completed from Master Mobile." : "Inspection progress saved from Master Mobile.",
    sourceModule: "inspection",
    sourceRecordId: trailer.id,
    previousStatus: trailer.status,
    newStatus: updated.status,
    metadata: {
      vessel_trailer_id: trailer.id,
      vessel_operation_id: trailer.vessel_operation_id,
      has_damage: payload.damage?.hasDamage ?? false,
      has_temperature_alert: frontOut || rearOut,
    },
    performedBy: operatorName,
    createdAt: nowIso,
  });

  return {
    ok: true,
    status: "success",
    message: complete
      ? `${updated.trailer_number ?? "Trailer"} inspection completed.`
      : `${updated.trailer_number ?? "Trailer"} inspection progress saved.`,
    retryable: false,
    updatedVesselTrailer: asVesselTrailerState(updated as VesselOperationTrailerRecord),
  };
};

const runStartInspection = async (
  supabase: RouteSupabase,
  payload: Extract<MobileActionRequest, { actionType: "START_INSPECTION" }>['payload'],
  operatorName: string,
): Promise<MobileActionResult> => {
  const trailer = await getVesselTrailer(supabase, payload.vesselTrailerId);
  if (!trailer) {
    return buildConflict({ code: "vessel_trailer_missing", message: "Trailer is no longer available for inspection." });
  }

  if (trailer.inspection_completed_at) {
    return buildConflict({
      code: "inspection_completed",
      message: "Inspection was already completed on another device.",
      serverState: {
        inspectionCompletedAt: trailer.inspection_completed_at,
      },
    });
  }

  if (!(trailer.arrival_status === "arrived" || trailer.status === "arrived" || trailer.status === "inspection_pending" || trailer.status === "inspected")) {
    return {
      ok: false,
      status: "failed",
      message: "Only arrived trailers can start inspection.",
      retryable: false,
    };
  }

  if (trailer.inspection_started_at) {
    return {
      ok: true,
      status: "success",
      message: `${trailer.trailer_number ?? "Trailer"} inspection already started.`,
      retryable: false,
      updatedVesselTrailer: asVesselTrailerState(trailer),
    };
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from("vessel_operation_trailers")
    .update({
      inspection_started_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", trailer.id)
    .is("inspection_started_at", null)
    .select(
      "id, vessel_operation_id, trailer_id, trailer_number, customer, load_status, status, arrival_status, arrival_record_id, inspection_started_at, inspection_completed_at, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, temperature_required, has_damage, has_temperature_alert",
    )
    .maybeSingle();

  if (updateError || !updated) {
    return buildConflict({
      code: "inspection_stale",
      message: "Inspection state changed before this action was applied.",
      serverState: {
        inspectionStartedAt: trailer.inspection_started_at,
        inspectionCompletedAt: trailer.inspection_completed_at,
      },
    });
  }

  await createTrailerActivity({
    supabaseClient: supabase,
    trailerId: updated.trailer_id ?? null,
    trailerNumber: updated.trailer_number ?? trailer.trailer_number ?? payload.trailerNumber ?? "UNKNOWN",
    eventType: "inspection_started",
    eventTitle: "Inspection started",
    eventDescription: "Inspection started from Master Mobile.",
    sourceModule: "inspection",
    sourceRecordId: trailer.id,
    previousStatus: trailer.status,
    newStatus: updated.status,
    metadata: {
      vessel_trailer_id: trailer.id,
      vessel_operation_id: trailer.vessel_operation_id,
    },
    performedBy: operatorName,
    createdAt: nowIso,
  });

  return {
    ok: true,
    status: "success",
    message: `${updated.trailer_number ?? "Trailer"} inspection started.`,
    retryable: false,
    updatedVesselTrailer: asVesselTrailerState(updated as VesselOperationTrailerRecord),
  };
};

const runSaveInspectionProgress = async (
  supabase: RouteSupabase,
  payload: Extract<MobileActionRequest, { actionType: "SAVE_INSPECTION_PROGRESS" }>['payload'],
  operatorName: string,
): Promise<MobileActionResult> => {
  const trailer = await getVesselTrailer(supabase, payload.vesselTrailerId);
  if (!trailer) {
    return buildConflict({ code: "vessel_trailer_missing", message: "Trailer is no longer available for inspection." });
  }

  if (trailer.inspection_completed_at) {
    return buildConflict({
      code: "inspection_completed",
      message: "Inspection was already completed on another device.",
      serverState: { inspectionCompletedAt: trailer.inspection_completed_at },
    });
  }

  return persistInspection(supabase, trailer, payload, operatorName, false);
};

const runCompleteInspection = async (
  supabase: RouteSupabase,
  payload: Extract<MobileActionRequest, { actionType: "COMPLETE_INSPECTION" }>['payload'],
  operatorName: string,
): Promise<MobileActionResult> => {
  const trailer = await getVesselTrailer(supabase, payload.vesselTrailerId);
  if (!trailer) {
    return buildConflict({ code: "vessel_trailer_missing", message: "Trailer is no longer available for inspection." });
  }

  if (trailer.inspection_completed_at || trailer.status === "inspected") {
    return {
      ok: true,
      status: "success",
      message: `${trailer.trailer_number ?? "Trailer"} inspection already completed.`,
      retryable: false,
      updatedVesselTrailer: asVesselTrailerState(trailer),
    };
  }

  return persistInspection(supabase, trailer, payload, operatorName, true);
};

export async function executeMobileAction(
  supabase: RouteSupabase,
  user: User,
  action: MobileActionRequest,
): Promise<MobileActionResult> {
  const operatorName = resolveOperatorName(user);

  if (action.actionType === "MARK_ARRIVED") {
    return runMarkArrived(supabase, action.payload, operatorName);
  }

  if (action.actionType === "MOVE_COMPOUND_POSITION") {
    return runMoveCompoundPosition(supabase, action.payload, operatorName);
  }

  if (action.actionType === "CHANGE_LOAD_STATUS") {
    return runChangeLoadStatus(supabase, action.payload, operatorName);
  }

  if (action.actionType === "START_INSPECTION") {
    return runStartInspection(supabase, action.payload, operatorName);
  }

  if (action.actionType === "SAVE_INSPECTION_PROGRESS") {
    return runSaveInspectionProgress(supabase, action.payload, operatorName);
  }

  if (action.actionType === "COMPLETE_INSPECTION") {
    return runCompleteInspection(supabase, action.payload, operatorName);
  }

  return {
    ok: false,
    status: "failed",
    message: "Unsupported action type.",
    retryable: false,
  };
}
