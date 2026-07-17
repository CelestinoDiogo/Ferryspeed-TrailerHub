"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  canConfirmVesselTrailerReception,
  getFirstAvailableCompoundPosition,
  getVesselReceptionDate,
  hasCompletedBoatCheck,
  logVesselSupabaseError,
  normalizeCompoundPosition,
  normalizeTrailerNumber,
  type VesselOperationRecord,
  type VesselOperationTrailerRecord,
  type VesselReceptionDestination,
  type VesselReceptionLoadStatus,
} from "@/lib/vessel-operations";
import type { Database } from "@/lib/database.types";

type ActiveTrailerRow = Pick<
  Database["public"]["Tables"]["trailers"]["Row"],
  | "id"
  | "trailer_number"
  | "load_status"
  | "customer"
  | "compound_position"
  | "notes"
  | "departure_date"
  | "trailer_source"
  | "external_company"
  | "external_reference"
  | "is_local"
  | "operational_status"
  | "arrival_date"
  | "source_vessel_operation_trailer_id"
>;

type SavedTrailerRow = Pick<
  Database["public"]["Tables"]["trailers"]["Row"],
  | "id"
  | "trailer_number"
  | "compound_position"
  | "load_status"
  | "customer"
  | "notes"
  | "departure_date"
  | "is_local"
  | "trailer_source"
  | "operational_status"
  | "arrival_date"
  | "source_vessel_operation_trailer_id"
>;

type VesselTrailerSnapshot = Pick<
  VesselOperationTrailerRecord,
  | "id"
  | "trailer_id"
  | "trailer_number"
  | "customer"
  | "load_status"
  | "status"
  | "arrival_status"
  | "arrival_record_id"
  | "arrival_confirmed_at"
  | "arrived_at"
  | "assigned_position"
  | "inspection_completed_at"
>;

export type ReceptionFormState = {
  destination: VesselReceptionDestination;
  loadStatus: VesselReceptionLoadStatus;
  customer: string;
  notes: string;
};

type UseVesselReceptionOptions = {
  operation: VesselOperationRecord | null;
  onSuccess?: (message: string) => Promise<void> | void;
};

type SubmitResult = {
  message: string;
};

const initialFormState: ReceptionFormState = {
  destination: "compound",
  loadStatus: "Empty",
  customer: "",
  notes: "",
};

const resolveOperatorName = async () => {
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    return "TrailerHub User";
  }

  const metadataName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name.trim());

  return metadataName || user.email || user.id || "TrailerHub User";
};

const getActiveTrailerCandidates = async (normalizedTrailerNumber: string) => {
  const { data, error } = await supabase
    .from("trailers")
    .select(
      "id, trailer_number, load_status, customer, compound_position, notes, departure_date, trailer_source, external_company, external_reference, is_local, operational_status, arrival_date, source_vessel_operation_trailer_id",
    )
    .is("departure_date", null)
    .ilike("trailer_number", normalizedTrailerNumber);

  if (error) {
    throw error;
  }

  return ((data ?? []) as ActiveTrailerRow[]).filter(
    (item) => normalizeTrailerNumber(item.trailer_number) === normalizedTrailerNumber,
  );
};

const getExistingActiveTrailer = async (normalizedTrailerNumber: string) => {
  const matches = await getActiveTrailerCandidates(normalizedTrailerNumber);

  if (matches.length > 1) {
    throw new Error(`Multiple active trailer records exist for ${normalizedTrailerNumber}. Resolve the duplicate before reception.`);
  }

  return matches[0] ?? null;
};

const getOccupiedPositions = async (currentTrailerId?: string) => {
  const query = supabase
    .from("trailers")
    .select("id, compound_position")
    .is("departure_date", null)
    .neq("is_local", true);

  const { data, error } = currentTrailerId ? await query.neq("id", currentTrailerId) : await query;

  if (error) {
    throw error;
  }

  const occupiedPositions = new Set<string>();
  (data ?? []).forEach((item) => {
    const normalizedPosition = normalizeCompoundPosition(item.compound_position as string | null | undefined);
    if (normalizedPosition) {
      occupiedPositions.add(normalizedPosition);
    }
  });

  return occupiedPositions;
};

const getNextAvailableCompoundPosition = async (currentTrailerId?: string) => {
  const occupiedPositions = await getOccupiedPositions(currentTrailerId);
  return {
    occupiedPositions,
    nextAvailablePosition: getFirstAvailableCompoundPosition(occupiedPositions),
  };
};

const getCurrentVesselTrailer = async (trailerId: string) => {
  const { data, error } = await supabase
    .from("vessel_operation_trailers")
    .select(
      "id, trailer_id, trailer_number, customer, load_status, status, arrival_status, arrival_record_id, arrival_confirmed_at, arrived_at, assigned_position, inspection_completed_at",
    )
    .eq("id", trailerId)
    .single();

  if (error || !data) {
    throw error ?? new Error("Vessel trailer not found.");
  }

  return data as VesselTrailerSnapshot;
};

export function useVesselReception({ operation, onSuccess }: UseVesselReceptionOptions) {
  const [selectedTrailer, setSelectedTrailer] = useState<VesselOperationTrailerRecord | null>(null);
  const [existingActiveTrailer, setExistingActiveTrailer] = useState<ActiveTrailerRow | null>(null);
  const [formState, setFormState] = useState<ReceptionFormState>(initialFormState);
  const [nextAvailablePosition, setNextAvailablePosition] = useState<string | null>(null);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOpen = Boolean(selectedTrailer);
  const requiresInspectionWarning = useMemo(
    () => Boolean(selectedTrailer && !hasCompletedBoatCheck(selectedTrailer)),
    [selectedTrailer],
  );

  const closeReception = useCallback(() => {
    setSelectedTrailer(null);
    setExistingActiveTrailer(null);
    setFormState(initialFormState);
    setNextAvailablePosition(null);
    setError(null);
    setIsLoadingOptions(false);
  }, []);

  const updateField = useCallback(<K extends keyof ReceptionFormState>(field: K, value: ReceptionFormState[K]) => {
    setFormState((current) => ({ ...current, [field]: value }));
  }, []);

  const openReception = useCallback(async (trailer: VesselOperationTrailerRecord) => {
    if (!canConfirmVesselTrailerReception(trailer, operation)) {
      setError("Trailer is not available for reception.");
      return;
    }

    const normalizedTrailerNumber = normalizeTrailerNumber(trailer.trailer_number);
    if (!normalizedTrailerNumber) {
      setError("Trailer Number is required before reception can be confirmed.");
      return;
    }

    setSelectedTrailer(trailer);
    setIsLoadingOptions(true);
    setError(null);

    try {
      const activeTrailer = await getExistingActiveTrailer(normalizedTrailerNumber);
      const currentAssignedPosition =
        activeTrailer && activeTrailer.is_local !== true
          ? normalizeCompoundPosition(activeTrailer.compound_position)
          : null;
      const { nextAvailablePosition: nextOpenPosition } = await getNextAvailableCompoundPosition(activeTrailer?.id);

      setExistingActiveTrailer(activeTrailer);
      setNextAvailablePosition(currentAssignedPosition ?? nextOpenPosition);
      setFormState({
        destination: activeTrailer?.is_local === true ? "local" : "compound",
        loadStatus: activeTrailer?.load_status === "Loaded" ? "Loaded" : trailer.load_status === "Loaded" ? "Loaded" : "Empty",
        customer: activeTrailer?.customer?.trim() || trailer.customer?.trim() || "",
        notes: "",
      });
    } catch (loadError) {
      console.error("Unable to load reception options:", loadError);
      setError(loadError instanceof Error ? loadError.message : "Unable to load reception options.");
    } finally {
      setIsLoadingOptions(false);
    }
  }, [operation]);

  const submitReception = useCallback(async (): Promise<SubmitResult | null> => {
    if (!selectedTrailer || !operation) {
      return null;
    }

    if (!canConfirmVesselTrailerReception(selectedTrailer, operation)) {
      setError("Trailer is not available for reception.");
      return null;
    }

    if (!hasCompletedBoatCheck(selectedTrailer)) {
      setError("Boat Check must be completed before reception can be confirmed.");
      return null;
    }

    const normalizedTrailerNumber = normalizeTrailerNumber(selectedTrailer.trailer_number);
    if (!normalizedTrailerNumber) {
      setError("Trailer Number is required before reception can be confirmed.");
      return null;
    }

    setIsSubmitting(true);
    setError(null);

    let createdTrailerRecord = false;

    try {
      const nowIso = new Date().toISOString();
      const operatorName = await resolveOperatorName();
      const currentTrailer = await getCurrentVesselTrailer(selectedTrailer.id);

      if (!canConfirmVesselTrailerReception(currentTrailer, operation)) {
        throw new Error(currentTrailer.arrival_record_id ? "Reception already confirmed for this trailer." : "Trailer is not available for reception.");
      }

      const existingTrailer = await getExistingActiveTrailer(normalizedTrailerNumber);
      const previousPosition =
        formState.destination === "compound" && existingTrailer && existingTrailer.is_local !== true
          ? normalizeCompoundPosition(existingTrailer.compound_position)
          : null;

      let automaticPosition: string | null = null;
      if (formState.destination === "compound") {
        const firstAttempt = await getNextAvailableCompoundPosition(existingTrailer?.id);
        automaticPosition = previousPosition ?? firstAttempt.nextAvailablePosition;

        if (!automaticPosition) {
          throw new Error("The Compound is full. No position is available.");
        }

        const availabilityCheck = await getNextAvailableCompoundPosition(existingTrailer?.id);
        if (availabilityCheck.occupiedPositions.has(automaticPosition)) {
          automaticPosition = getFirstAvailableCompoundPosition(availabilityCheck.occupiedPositions);
        }

        if (!automaticPosition) {
          throw new Error("The Compound is full. No position is available.");
        }

        const retryCheck = await getNextAvailableCompoundPosition(existingTrailer?.id);
        if (retryCheck.occupiedPositions.has(automaticPosition)) {
          const retriedPosition = getFirstAvailableCompoundPosition(retryCheck.occupiedPositions);
          if (!retriedPosition) {
            throw new Error("The Compound is full. No position is available.");
          }

          automaticPosition = retriedPosition;
        }
      }

      const destination = formState.destination;
      const confirmedPosition = destination === "compound" ? automaticPosition : null;

      if (destination === "compound" && !confirmedPosition) {
        throw new Error("No Compound position is available. The trailer should be placed in Awaiting Position.");
      }

      const customerValue = formState.customer.trim() || currentTrailer.customer?.trim() || existingTrailer?.customer?.trim() || null;
      const notesValue = formState.notes.trim() || existingTrailer?.notes?.trim() || null;
      const receptionArrivalDate = getVesselReceptionDate(currentTrailer.arrived_at ?? currentTrailer.arrival_confirmed_at ?? nowIso);
      const trailerSource = existingTrailer?.trailer_source === "outsourced" ? "outsourced" : "company";
      const mainTrailerPayload: Database["public"]["Tables"]["trailers"]["Insert"] = {
        trailer_number: normalizedTrailerNumber,
        arrival_date: receptionArrivalDate,
        load_status: formState.loadStatus,
        customer: customerValue,
        notes: notesValue,
        departure_date: null,
        operational_status: destination === "compound" ? "In Compound" : destination === "local" ? "Local Trailer" : "Awaiting Position",
        compound_position: confirmedPosition,
        is_local: destination === "local",
        trailer_source: trailerSource,
        source_vessel_operation_trailer_id:
          existingTrailer?.source_vessel_operation_trailer_id && existingTrailer.source_vessel_operation_trailer_id !== currentTrailer.id
            ? existingTrailer.source_vessel_operation_trailer_id
            : currentTrailer.id,
      };

      console.log("Automatic position:", automaticPosition);

      let mainTrailerId = existingTrailer?.id ?? null;
      let mainTrailerNumber = normalizedTrailerNumber;
      let savedTrailer: SavedTrailerRow | null = null;

      console.log("Reception debug:", {
        existingTrailer,
        automaticPosition,
        destination,
        trailerPayload: mainTrailerPayload,
        savedTrailer,
      });

      if (existingTrailer) {
        const { data: updatedTrailer, error: updateError } = await supabase
          .from("trailers")
          .update(mainTrailerPayload)
          .eq("id", existingTrailer.id)
          .select()
          .single();

        console.log("Save error:", updateError);
        console.log("Trailer record:", updatedTrailer);

        if (updateError || !updatedTrailer) {
          throw new Error((updateError ?? new Error("Unable to update main trailer record.")).message);
        }

        savedTrailer = updatedTrailer as SavedTrailerRow;

        mainTrailerId = savedTrailer.id;
        mainTrailerNumber = savedTrailer.trailer_number ?? normalizedTrailerNumber;
      } else {
        createdTrailerRecord = true;

        const { data: insertedTrailer, error: insertError } = await supabase
          .from("trailers")
          .insert(mainTrailerPayload)
          .select()
          .single();

        console.log("Save error:", insertError);
        console.log("Trailer record:", insertedTrailer);

        if (insertError || !insertedTrailer) {
          throw new Error((insertError ?? new Error("Unable to create main trailer record.")).message);
        }

        savedTrailer = insertedTrailer as SavedTrailerRow;

        mainTrailerId = savedTrailer.id;
        mainTrailerNumber = savedTrailer.trailer_number ?? normalizedTrailerNumber;
      }

      if (!savedTrailer) {
        throw new Error("Trailer reception was not saved because no trailer record was returned.");
      }

      const finalPosition = savedTrailer?.compound_position ?? confirmedPosition ?? null;

      if (!savedTrailer?.id) {
        throw new Error("The main trailer record was not created, so reception cannot be completed.");
      }

      const vesselTrailerStatus = currentTrailer.status === "inspected" ? "inspected" : "arrived";
      const vesselTrailerUpdate: Database["public"]["Tables"]["vessel_operation_trailers"]["Update"] = {
        trailer_id: savedTrailer.id,
        arrival_record_id: savedTrailer.id,
        arrival_confirmed_at: currentTrailer.arrival_confirmed_at ?? nowIso,
        arrival_confirmed_by: operatorName,
        assigned_position: destination === "compound" ? finalPosition : null,
        position_assigned_at: destination === "compound" ? nowIso : null,
        status: vesselTrailerStatus,
        updated_at: nowIso,
      };

      const { data: linkedTrailer, error: linkError } = await supabase
        .from("vessel_operation_trailers")
        .update(vesselTrailerUpdate)
        .eq("id", currentTrailer.id)
        .is("arrival_record_id", null)
        .select("id")
        .maybeSingle();

      if (linkError || !linkedTrailer) {
        const partialMessage = createdTrailerRecord
          ? "Reception created the main trailer record, but linking back to the vessel trailer failed. Review the trailer manually before retrying."
          : "Main trailer record updated, but linking back to the vessel trailer failed. Review the trailer manually before retrying.";
        throw linkError ?? new Error(partialMessage);
      }

      const eventDescription = formState.destination === "compound"
        ? `Trailer received from vessel operation and automatically assigned to Compound position ${finalPosition}.`
        : "Trailer received from vessel operation and assigned as Local Trailer.";

      const { error: eventError } = await supabase.from("trailer_events").insert({
        trailer_id: mainTrailerId,
        trailer_number: mainTrailerNumber,
        event_type: "vessel_arrival_received",
        event_description: eventDescription,
        new_value: {
          vessel_operation_id: operation.id,
          vessel_operation_trailer_id: currentTrailer.id,
          trailer_id: savedTrailer.id,
          arrival_record_id: savedTrailer.id,
          compound_position: destination === "compound" ? finalPosition : null,
          destination,
          load_status: formState.loadStatus,
          customer: customerValue,
          received_at: nowIso,
          received_by: operatorName,
        },
      });

      if (eventError) {
        logVesselSupabaseError("Failed to create vessel reception event", eventError);
      }

      const successMessage = formState.destination === "compound"
        ? `Trailer received and assigned to Compound position ${finalPosition}.`
        : `Reception confirmed for ${mainTrailerNumber} as Local Trailer.`;

      closeReception();
      if (onSuccess) {
        await onSuccess(successMessage);
      }

      return { message: successMessage };
    } catch (submitError) {
      console.error("Unable to confirm reception:", submitError);
      setError(submitError instanceof Error ? submitError.message : "Unable to confirm reception.");
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, [closeReception, formState, onSuccess, operation, requiresInspectionWarning, selectedTrailer]);

  return {
    closeReception,
    error,
    existingActiveTrailer,
    formState,
    isLoadingOptions,
    isOpen,
    isSubmitting,
    nextAvailablePosition,
    openReception,
    requiresInspectionWarning,
    selectedTrailer,
    submitReception,
    updateField,
  };
}