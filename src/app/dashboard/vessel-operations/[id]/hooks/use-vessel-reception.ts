"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  canConfirmVesselTrailerReception,
  getFirstAvailableCompoundPosition,
  logVesselSupabaseError,
  normalizeCompoundPosition,
  normalizeTrailerNumber,
  resolveVesselReceptionLoadStatus,
  resolveVesselReceptionOwnership,
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

type VesselTrailerSnapshot = Pick<
  VesselOperationTrailerRecord,
  | "id"
  | "trailer_id"
  | "trailer_number"
  | "customer"
  | "load_status"
  | "ownership_type"
  | "trailer_source"
  | "external_company"
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
  loadStatus: "",
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
      "id, trailer_id, trailer_number, customer, load_status, ownership_type, trailer_source, external_company, status, arrival_status, arrival_record_id, arrival_confirmed_at, arrived_at, assigned_position, inspection_completed_at",
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
        loadStatus: resolveVesselReceptionLoadStatus(activeTrailer?.load_status, trailer.load_status),
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

    if (!formState.loadStatus) {
      setError("Choose Loaded or Empty before completing reception.");
      return null;
    }

    if (!canConfirmVesselTrailerReception(selectedTrailer, operation)) {
      setError("Trailer is not available for reception.");
      return null;
    }

    const normalizedTrailerNumber = normalizeTrailerNumber(selectedTrailer.trailer_number);
    if (!normalizedTrailerNumber) {
      setError("Trailer Number is required before reception can be confirmed.");
      return null;
    }

    setIsSubmitting(true);
    setError(null);

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
      const ownership = resolveVesselReceptionOwnership({
        ownershipType: currentTrailer.ownership_type,
        vesselTrailerSource: currentTrailer.trailer_source,
        vesselExternalCompany: currentTrailer.external_company,
        currentTrailerSource: existingTrailer?.trailer_source,
        currentExternalCompany: existingTrailer?.external_company,
        trailerNumber: currentTrailer.trailer_number,
      });
      const { data: mainTrailerId, error: receptionError } = await supabase.rpc("confirm_vessel_trailer_arrival", {
        p_vessel_operation_trailer_id: currentTrailer.id,
        p_received_at: nowIso,
        p_compound_position: confirmedPosition,
        p_arrival_notes: formState.notes.trim() || null,
        p_condition_on_arrival: null,
        p_confirmed_by: operatorName,
        p_explicit_load_status: formState.loadStatus,
        p_customer: customerValue,
        p_destination: destination === "hold" ? "awaiting_position" : destination,
        p_trailer_source: ownership.trailerSource,
        p_external_company: ownership.externalCompany,
        p_is_local: destination === "local",
      });

      if (receptionError || !mainTrailerId) {
        logVesselSupabaseError("Failed to confirm vessel reception", receptionError);
        throw new Error(receptionError?.message || "Unable to confirm vessel reception.");
      }

      const successMessage = formState.destination === "compound"
        ? `Trailer received and assigned to Compound position ${confirmedPosition}.`
        : `Reception confirmed for ${normalizedTrailerNumber}.`;

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
  }, [closeReception, formState, onSuccess, operation, selectedTrailer]);

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
    selectedTrailer,
    submitReception,
    updateField,
  };
}