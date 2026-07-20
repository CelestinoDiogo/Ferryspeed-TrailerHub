"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  buildVesselSupabaseErrorMessage,
  computeVesselOperationSummary,
  logVesselSupabaseError,
  normalizeExpectedTemperatureUnit,
  normalizeTemperatureReadingPoint,
  normalizeTrailerNumber,
  resolveExpectedFrontTemperature,
  resolveExpectedRearTemperature,
  sortVesselOperationTrailersForArrivals,
  type SupabaseErrorLike,
  type VesselInspectionTemperatureRecord,
  type VesselOperationRecord,
  type VesselOperationSummary,
  type VesselOperationTrailerRecord,
  type VesselPriorityLevel,
  type VesselTrailerStatus,
} from "@/lib/vessel-operations";

export type TrailerFormState = {
  trailerNumber: string;
  customer: string;
  bookingReference: string;
  loadStatus: string;
  expectedFrontTemperature: string;
  expectedRearTemperature: string;
  expectedTemperatureUnit: string;
  priorityLevel: VesselPriorityLevel;
  notes: string;
};

export type TrailerInspectionState = {
  overallCondition: "good" | "attention_required";
  frontTemperature: string;
  rearTemperature: string;
  damage: "no" | "yes";
  damageType: string;
  damageLocation: string;
  damageDescription: string;
  notes: string;
  photos: File[];
};

type InsertTrailerRow = {
  trailer_number: string;
  customer?: string | null;
  booking_reference?: string | null;
  load_status?: string | null;
  expected_front_temperature?: number | null;
  expected_rear_temperature?: number | null;
  expected_temperature_unit?: string | null;
  temperature_required?: string | null;
  priority_level: VesselPriorityLevel;
  notes?: string | null;
};

type NormalizedOperationStatus = "draft" | "confirmed" | "completed";

export type CompletionSummary = {
  totalTrailers: number;
  arrived: number;
  inspected: number;
  pendingInspection: number;
  notArrived: number;
  notDischarged: number;
  damages: number;
  temperatureAlerts: number;
};

export type UseVesselOperationResult = {
  operation: VesselOperationRecord | null;
  operationStatus: NormalizedOperationStatus;
  trailers: VesselOperationTrailerRecord[];
  sortedTrailers: VesselOperationTrailerRecord[];
  summary: VesselOperationSummary;
  completionSummary: CompletionSummary;
  editable: boolean;
  isReadOnly: boolean;
  isLoading: boolean;
  isSaving: boolean;
  isCompleting: boolean;
  actioningTrailerId: string | null;
  error: string | null;
  success: string | null;
  formState: TrailerFormState;
  inspectionByTrailer: Record<string, TrailerInspectionState>;
  bulkText: string;
  setBulkText: (value: string) => void;
  getInspectionState: (trailerId: string) => TrailerInspectionState;
  handleFieldChange: <K extends keyof TrailerFormState>(field: K, value: TrailerFormState[K]) => void;
  handleInspectionFieldChange: <K extends keyof TrailerInspectionState>(trailerId: string, field: K, value: TrailerInspectionState[K]) => void;
  handleAddSingleTrailer: () => Promise<void>;
  handleBulkAdd: () => Promise<void>;
  handleTogglePriority: (trailer: VesselOperationTrailerRecord) => Promise<void>;
  handleRemoveTrailer: (trailer: VesselOperationTrailerRecord) => Promise<void>;
  handleConfirmList: () => Promise<void>;
  handleMarkArrived: (trailer: VesselOperationTrailerRecord) => Promise<void>;
  handleSaveInspection: (trailer: VesselOperationTrailerRecord) => Promise<void>;
  handleCompleteOperation: () => Promise<void>;
  reloadOperation: () => Promise<void>;
};

const initialTrailerForm: TrailerFormState = {
  trailerNumber: "",
  customer: "",
  bookingReference: "",
  loadStatus: "",
  expectedFrontTemperature: "",
  expectedRearTemperature: "",
  expectedTemperatureUnit: "C",
  priorityLevel: "normal",
  notes: "",
};

const initialInspectionState: TrailerInspectionState = {
  overallCondition: "good",
  frontTemperature: "",
  rearTemperature: "",
  damage: "no",
  damageType: "",
  damageLocation: "",
  damageDescription: "",
  notes: "",
  photos: [],
};

const getOperationStatus = (operation?: VesselOperationRecord | null): NormalizedOperationStatus => {
  if (!operation) {
    return "draft";
  }

  if (operation.status === "completed" || operation.status === "cancelled") {
    return "completed";
  }

  if (
    operation.status === "confirmed" ||
    operation.list_status === "confirmed" ||
    operation.status === "arriving" ||
    operation.status === "discharging" ||
    operation.status === "inspection"
  ) {
    return "confirmed";
  }

  return "draft";
};

const normalizeTrailerStatus = (status?: string | null, arrivalStatus?: string | null): VesselTrailerStatus => {
  if (status === "inspected" || status === "positioned") return "inspected";
  if (status === "arrived" || status === "inspection_pending" || status === "inspection_in_progress") return "arrived";
  if (status === "not_arrived" || status === "cancelled" || status === "not_discharged") return "not_arrived";
  if (arrivalStatus === "arrived") return "arrived";
  if (arrivalStatus === "not_arrived" || arrivalStatus === "cancelled" || arrivalStatus === "not_discharged") return "not_arrived";
  return "expected";
};

const sanitizeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

const parseNumeric = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseOptionalTemperatureInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return { value: null, error: null as string | null };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { value: null, error: "Temperature values must be numeric." };
  }

  return { value: parsed, error: null as string | null };
};

const buildConfirmTrailerListOperatorError = (error: unknown) => {
  const baseMessage =
    "Unable to confirm trailer list. The database confirmation function is not available or could not complete the operation.";

  if (process.env.NODE_ENV === "production") {
    return baseMessage;
  }

  const supabaseError = (error ?? null) as SupabaseErrorLike | null;
  if (!supabaseError) {
    return baseMessage;
  }

  const details = [
    supabaseError.code ? `code: ${supabaseError.code}` : null,
    buildVesselSupabaseErrorMessage(supabaseError, ""),
  ]
    .filter(Boolean)
    .join(" | ");

  return details ? `${baseMessage} (${details})` : baseMessage;
};

const parseTemperatureRange = (value?: string | null) => {
  if (!value) return null;

  const matches = value.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) {
    return null;
  }

  const numbers = matches.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (numbers.length === 0) {
    return null;
  }

  if (numbers.length === 1) {
    return { min: numbers[0], max: numbers[0] };
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  return { min: sorted[0], max: sorted[1] };
};

const getTemperatureOutOfRange = (reading: number | null, required?: string | null) => {
  if (reading === null) return false;

  const range = parseTemperatureRange(required);
  if (!range) {
    return false;
  }

  return reading < range.min || reading > range.max;
};

const getTemperatureMismatch = (actual: number | null, expected: number | null) => {
  if (actual === null || expected === null) {
    return false;
  }

  return Math.abs(actual - expected) > 0.01;
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

export function useVesselOperation(operationId: string): UseVesselOperationResult {
  const [operation, setOperation] = useState<VesselOperationRecord | null>(null);
  const [trailers, setTrailers] = useState<VesselOperationTrailerRecord[]>([]);
  const [formState, setFormState] = useState<TrailerFormState>(initialTrailerForm);
  const [inspectionByTrailer, setInspectionByTrailer] = useState<Record<string, TrailerInspectionState>>({});
  const [bulkText, setBulkTextState] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [actioningTrailerId, setActioningTrailerId] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadOperation = useCallback(async () => {
    if (!operationId) {
      setError("Invalid vessel operation id.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [operationResult, trailersResult] = await Promise.all([
        supabase
          .from("vessel_operations")
          .select("id, vessel_name, sailing_reference, origin_port, berth, expected_arrival_at, actual_arrival_at, status, list_status, list_confirmed_at, list_confirmed_by, notes, created_at, updated_at")
          .eq("id", operationId)
          .single(),
        supabase
          .from("vessel_operation_trailers")
          .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, load_description, temperature_required, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, priority_level, priority_reason, planned_destination, planning_notes, status, arrived_at, arrival_status, arrival_confirmed_at, arrival_record_id, arrival_confirmed_by, inspection_started_at, inspection_completed_at, position_assigned_at, assigned_position, has_damage, has_temperature_alert, created_at, updated_at")
          .eq("vessel_operation_id", operationId)
          .order("created_at", { ascending: true }),
      ]);

      if (operationResult.error || !operationResult.data) {
        logVesselSupabaseError("Load vessel operation failed", operationResult.error);
        throw operationResult.error ?? new Error("Unable to load vessel operation.");
      }

      if (trailersResult.error) {
        logVesselSupabaseError("Load vessel operation trailers failed", trailersResult.error);
        throw trailersResult.error;
      }

      const trailerRows = (trailersResult.data ?? []) as VesselOperationTrailerRecord[];
      const vesselTrailerIds = trailerRows.map((item) => item.id);
      const temperaturesResult = vesselTrailerIds.length
        ? await supabase
            .from("vessel_inspection_temperatures")
            .select("id, vessel_trailer_id, trailer_id, trailer_number, temperature_value, temperature_unit, reading_point, notes, is_out_of_range, recorded_at, recorded_by")
            .in("vessel_trailer_id", vesselTrailerIds)
            .order("recorded_at", { ascending: false })
        : { data: [], error: null };

      if (temperaturesResult.error) {
        logVesselSupabaseError("Load vessel inspection temperatures failed", temperaturesResult.error);
        throw temperaturesResult.error;
      }

      const temperaturesByTrailer = new Map<string, VesselInspectionTemperatureRecord[]>();
      ((temperaturesResult.data ?? []) as VesselInspectionTemperatureRecord[]).forEach((row) => {
        const trailerId = row.vessel_trailer_id;
        if (!trailerId) {
          return;
        }

        const collection = temperaturesByTrailer.get(trailerId) ?? [];
        collection.push(row);
        temperaturesByTrailer.set(trailerId, collection);
      });

      const normalizedTrailers = trailerRows.map((item) => {
        const normalizedStatus = normalizeTrailerStatus(item.status, item.arrival_status);

        return {
          ...item,
          status: normalizedStatus,
          arrival_status: (item.arrival_status ?? "expected") as VesselOperationTrailerRecord["arrival_status"],
        };
      });

      const nextInspectionState: Record<string, TrailerInspectionState> = {};
      normalizedTrailers.forEach((item) => {
        const trailerTemperatures = temperaturesByTrailer.get(item.id) ?? [];
        const front = trailerTemperatures.find((row) => normalizeTemperatureReadingPoint(row.reading_point) === "front") ?? null;
        const rear = trailerTemperatures.find((row) => normalizeTemperatureReadingPoint(row.reading_point) === "rear") ?? null;

        if (!front && !rear) {
          return;
        }

        nextInspectionState[item.id] = {
          ...initialInspectionState,
          frontTemperature: front?.temperature_value?.toString() ?? "",
          rearTemperature: rear?.temperature_value?.toString() ?? "",
          notes: front?.notes ?? rear?.notes ?? "",
        };
      });

      setOperation(operationResult.data as VesselOperationRecord);
      setTrailers(sortVesselOperationTrailersForArrivals(normalizedTrailers));
      setInspectionByTrailer((current) => ({ ...current, ...nextInspectionState }));
    } catch (loadErr) {
      console.error("Unable to load vessel operation:", loadErr);
      setError("Unable to load vessel operation.");
    } finally {
      setIsLoading(false);
    }
  }, [operationId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadOperation();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadOperation]);

  const operationStatus = getOperationStatus(operation);
  const isReadOnly = operationStatus === "completed";
  const editable = operationStatus === "draft";

  const summary = useMemo(() => computeVesselOperationSummary(trailers), [trailers]);
  const completionSummary = useMemo<CompletionSummary>(() => {
    const activeTrailers = trailers.filter((item) => item.arrival_status !== "cancelled" && item.status !== "cancelled");

    const totalTrailers = activeTrailers.length;
    const arrived = activeTrailers.filter((item) => item.arrival_status === "arrived").length;
    const inspected = activeTrailers.filter((item) => item.status === "inspected").length;
    const pendingInspection = activeTrailers.filter((item) => item.arrival_status === "arrived" && item.status !== "inspected").length;
    const notArrived = activeTrailers.filter((item) => item.arrival_status === "expected" || item.arrival_status === "available_for_arrival").length;
    const notDischarged = activeTrailers.filter((item) => item.arrival_status === "not_discharged" || item.status === "not_discharged").length;
    const damages = activeTrailers.filter((item) => Boolean(item.has_damage)).length;
    const temperatureAlerts = activeTrailers.filter((item) => Boolean(item.has_temperature_alert)).length;

    return {
      totalTrailers,
      arrived,
      inspected,
      pendingInspection,
      notArrived,
      notDischarged,
      damages,
      temperatureAlerts,
    };
  }, [trailers]);
  const sortedTrailers = useMemo(() => sortVesselOperationTrailersForArrivals(trailers), [trailers]);

  const existingTrailerNumbers = useMemo(
    () => new Set(trailers.map((item) => normalizeTrailerNumber(item.trailer_number))),
    [trailers],
  );

  const handleFieldChange = useCallback(<K extends keyof TrailerFormState>(field: K, value: TrailerFormState[K]) => {
    setFormState((current) => ({ ...current, [field]: value }));
  }, []);

  const getInspectionState = useCallback(
    (trailerId: string): TrailerInspectionState => inspectionByTrailer[trailerId] ?? initialInspectionState,
    [inspectionByTrailer],
  );

  const handleInspectionFieldChange = useCallback(
    <K extends keyof TrailerInspectionState>(trailerId: string, field: K, value: TrailerInspectionState[K]) => {
      setInspectionByTrailer((current) => ({
        ...current,
        [trailerId]: {
          ...(current[trailerId] ?? initialInspectionState),
          [field]: value,
        },
      }));
    },
    [],
  );

  const insertTrailers = useCallback(
    async (rows: InsertTrailerRow[]) => {
      if (!operation) return;

      const nowIso = new Date().toISOString();
      const payload = rows.map((row) => ({
        vessel_operation_id: operation.id,
        trailer_number: row.trailer_number,
        customer: row.customer ?? null,
        booking_reference: row.booking_reference ?? null,
        load_status: row.load_status ?? null,
        expected_front_temperature: row.expected_front_temperature ?? null,
        expected_rear_temperature: row.expected_rear_temperature ?? null,
        expected_temperature_unit: row.expected_temperature_unit ?? "C",
        temperature_required: row.temperature_required ?? null,
        priority_level: row.priority_level,
        status: "expected" as VesselTrailerStatus,
        arrival_status: "expected",
        planning_notes: row.notes ?? null,
        created_at: nowIso,
        updated_at: nowIso,
      }));

      const { error: insertError } = await supabase.from("vessel_operation_trailers").insert(payload);
      if (insertError) {
        logVesselSupabaseError("Insert vessel trailers failed", insertError);
        throw insertError;
      }

      for (const row of payload) {
        const { error: eventError } = await supabase.from("trailer_events").insert({
          trailer_id: null,
          trailer_number: row.trailer_number,
          event_type: "vessel_trailer_planned",
          event_description: `Trailer planned for vessel ${operation.vessel_name ?? "operation"}.`,
          old_value: null,
          new_value: row,
        });

        if (eventError) {
          logVesselSupabaseError("Insert vessel trailer event failed", eventError);
        }
      }
    },
    [operation],
  );

  const handleAddSingleTrailer = useCallback(async () => {
    if (!editable) {
      setError("Trailer list is locked after confirmation.");
      return;
    }

    const trailerNumber = normalizeTrailerNumber(formState.trailerNumber);
    if (!trailerNumber) {
      setError("Trailer number is required.");
      return;
    }

    if (existingTrailerNumbers.has(trailerNumber)) {
      setError(`Trailer ${trailerNumber} already exists in this vessel operation.`);
      return;
    }

    const parsedFrontExpected = parseOptionalTemperatureInput(formState.expectedFrontTemperature);
    if (parsedFrontExpected.error) {
      setError(parsedFrontExpected.error);
      return;
    }

    const parsedRearExpected = parseOptionalTemperatureInput(formState.expectedRearTemperature);
    if (parsedRearExpected.error) {
      setError(parsedRearExpected.error);
      return;
    }

    const expectedTemperatureUnit = normalizeExpectedTemperatureUnit(formState.expectedTemperatureUnit);

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await insertTrailers([
        {
          trailer_number: trailerNumber,
          customer: formState.customer.trim() || null,
          booking_reference: formState.bookingReference.trim() || null,
          load_status: formState.loadStatus.trim() || null,
          expected_front_temperature: parsedFrontExpected.value,
          expected_rear_temperature: parsedRearExpected.value,
          expected_temperature_unit: expectedTemperatureUnit,
          temperature_required: parsedFrontExpected.value !== null ? String(parsedFrontExpected.value) : null,
          priority_level: formState.priorityLevel,
          notes: formState.notes.trim() || null,
        },
      ]);

      setFormState(initialTrailerForm);
      setSuccess("Trailer added to vessel operation.");
      await loadOperation();
    } catch (saveErr) {
      console.error("Unable to add trailer:", saveErr);
      setError("Unable to add trailer.");
    } finally {
      setIsSaving(false);
    }
  }, [editable, existingTrailerNumbers, formState, insertTrailers, loadOperation]);

  const handleBulkAdd = useCallback(async () => {
    if (!editable) {
      setError("Trailer list is locked after confirmation.");
      return;
    }

    const trailerNumbers = bulkText
      .split(/\r?\n/)
      .map((line) => normalizeTrailerNumber(line))
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index);

    const newTrailerNumbers = trailerNumbers.filter((value) => !existingTrailerNumbers.has(value));

    if (newTrailerNumbers.length === 0) {
      setError("No new trailer numbers found in the bulk list.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await insertTrailers(
        newTrailerNumbers.map((trailerNumber) => ({
          trailer_number: trailerNumber,
          priority_level: "normal" as VesselPriorityLevel,
        })),
      );
      setBulkTextState("");
      setSuccess(`${newTrailerNumbers.length} trailer${newTrailerNumbers.length === 1 ? "" : "s"} added.`);
      await loadOperation();
    } catch (saveErr) {
      console.error("Unable to add bulk trailer list:", saveErr);
      setError("Unable to add bulk trailer list.");
    } finally {
      setIsSaving(false);
    }
  }, [bulkText, editable, existingTrailerNumbers, insertTrailers, loadOperation]);

  const handleTogglePriority = useCallback(
    async (trailer: VesselOperationTrailerRecord) => {
      if (!editable) {
        setError("Trailer list is locked after confirmation.");
        return;
      }

      setActioningTrailerId(trailer.id);
      setError(null);
      setSuccess(null);

      try {
        const nextPriorityLevel: VesselPriorityLevel = trailer.priority_level === "priority" ? "normal" : "priority";
        const nowIso = new Date().toISOString();
        const { error: updateError } = await supabase
          .from("vessel_operation_trailers")
          .update({
            priority_level: nextPriorityLevel,
            updated_at: nowIso,
          })
          .eq("id", trailer.id);

        if (updateError) {
          logVesselSupabaseError("Update vessel trailer priority failed", updateError);
          throw updateError;
        }

        await loadOperation();
        setSuccess(`Priority updated for ${trailer.trailer_number ?? "trailer"}.`);
      } catch (priorityErr) {
        console.error("Unable to update trailer priority:", priorityErr);
        setError("Unable to update trailer priority.");
      } finally {
        setActioningTrailerId(null);
      }
    },
    [editable, loadOperation],
  );

  const handleRemoveTrailer = useCallback(
    async (trailer: VesselOperationTrailerRecord) => {
      if (!editable) {
        setError("Trailer list is locked after confirmation.");
        return;
      }

      if (trailer.status !== "expected") {
        setError("Only expected trailers can be removed.");
        return;
      }

      const confirmed = window.confirm(`Remove trailer ${trailer.trailer_number ?? ""} from this vessel operation?`);
      if (!confirmed) return;

      setActioningTrailerId(trailer.id);
      setError(null);

      try {
        const { error: deleteError } = await supabase.from("vessel_operation_trailers").delete().eq("id", trailer.id);
        if (deleteError) {
          logVesselSupabaseError("Delete vessel trailer failed", deleteError);
          throw deleteError;
        }

        await loadOperation();
        setSuccess(`Trailer ${trailer.trailer_number ?? ""} removed.`);
      } catch (deleteErr) {
        console.error("Unable to remove trailer:", deleteErr);
        setError("Unable to remove trailer.");
      } finally {
        setActioningTrailerId(null);
      }
    },
    [editable, loadOperation],
  );

  const handleConfirmList = useCallback(async () => {
    if (!operation) return;

    if ((operation.list_status ?? "draft") === "confirmed") {
      setSuccess("Expected arrival list is already confirmed.");
      return;
    }

    const confirmed = window.confirm("Confirm trailer list? After confirmation the list becomes read-only.");
    if (!confirmed) return;

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const operatorName = await resolveOperatorName();

      const { error: confirmError } = await supabase.rpc("confirm_vessel_operation_list", {
        p_vessel_operation_id: operation.id,
        p_confirmed_by: operatorName,
      });

      if (confirmError) {
        logVesselSupabaseError("Confirm trailer list via RPC failed", confirmError);
        throw confirmError;
      }

      const { error: eventError } = await supabase.from("trailer_events").insert({
        trailer_id: null,
        trailer_number: operation.vessel_name ?? operation.sailing_reference ?? "Vessel Operation",
        event_type: "vessel_expected_list_confirmed",
        event_description: "Expected arrival list confirmed.",
        new_value: {
          vessel_operation_id: operation.id,
          confirmed_by: operatorName,
        },
      });

      if (eventError) {
        logVesselSupabaseError("Insert expected list confirmation event failed", eventError);
      }

      setSuccess("Trailer list confirmed.");
      await loadOperation();
    } catch (listErr) {
      console.error("Unable to confirm trailer list:", listErr);
      setError(buildConfirmTrailerListOperatorError(listErr));
    } finally {
      setIsSaving(false);
    }
  }, [loadOperation, operation]);

  const handleMarkArrived = useCallback(
    async (trailer: VesselOperationTrailerRecord) => {
      if (operationStatus !== "confirmed") {
        setError("Only confirmed operations can register arrivals.");
        return;
      }

      if (trailer.arrival_status === "arrived" || trailer.status === "arrived" || trailer.status === "inspected") {
        setError("Arrival already confirmed for this trailer.");
        return;
      }

      setActioningTrailerId(trailer.id);
      setError(null);
      setSuccess(null);

      try {
        const nowIso = new Date().toISOString();
        const operatorName = await resolveOperatorName();
        const { error: updateError } = await supabase
          .from("vessel_operation_trailers")
          .update({
            status: "arrived",
            arrival_status: "arrived",
            arrived_at: nowIso,
            arrival_confirmed_at: nowIso,
            arrival_confirmed_by: operatorName,
            updated_at: nowIso,
          })
          .eq("id", trailer.id)
          .eq("arrival_status", "available_for_arrival")
          .is("arrival_record_id", null);

        if (updateError) {
          throw updateError;
        }

        const { error: eventError } = await supabase.from("trailer_events").insert({
          trailer_id: null,
          trailer_number: trailer.trailer_number ?? null,
          event_type: "vessel_trailer_marked_arrived",
          event_description: "Expected trailer marked as arrived.",
          old_value: {
            vessel_trailer_id: trailer.id,
            arrival_status: trailer.arrival_status,
          },
          new_value: {
            vessel_trailer_id: trailer.id,
            arrival_status: "arrived",
            arrived_at: nowIso,
            arrived_by: operatorName,
          },
        });

        if (eventError) {
          logVesselSupabaseError("Insert mark arrived event failed", eventError);
        }

        setSuccess(`Arrival confirmed for ${trailer.trailer_number ?? "trailer"}.`);
        await loadOperation();
      } catch (arrivalErr) {
        console.error("Unable to confirm arrival:", arrivalErr);
        setError("Unable to confirm arrival.");
      } finally {
        setActioningTrailerId(null);
      }
    },
    [loadOperation, operationStatus],
  );

  const handleSaveInspection = useCallback(
    async (trailer: VesselOperationTrailerRecord) => {
      if (!operation || operationStatus !== "confirmed") {
        setError("Boat check is available only while operation is confirmed.");
        return;
      }

      if (!(trailer.status === "arrived" || trailer.status === "inspected")) {
        setError("Only arrived trailers can be inspected.");
        return;
      }

      const inspection = inspectionByTrailer[trailer.id] ?? initialInspectionState;
      const frontTemperature = parseNumeric(inspection.frontTemperature);
      const rearTemperature = parseNumeric(inspection.rearTemperature);
      const expectedFrontTemperature = resolveExpectedFrontTemperature(trailer);
      const expectedRearTemperature = resolveExpectedRearTemperature(trailer);
      const expectedTemperatureUnit = normalizeExpectedTemperatureUnit(trailer.expected_temperature_unit);
      const hasLegacyExpectedRange = Boolean(trailer.temperature_required?.trim()) && expectedFrontTemperature === null;

      if (expectedFrontTemperature !== null && frontTemperature === null) {
        setError("Front temperature is required for this trailer.");
        return;
      }

      if (expectedRearTemperature !== null && rearTemperature === null) {
        setError("Rear temperature is required for this trailer.");
        return;
      }

      if (hasLegacyExpectedRange && frontTemperature === null) {
        setError("Front temperature is required for this trailer.");
        return;
      }

      if (inspection.damage === "yes" && !inspection.damageDescription.trim()) {
        setError("Damage description is required when damage is marked as yes.");
        return;
      }

      setActioningTrailerId(trailer.id);
      setError(null);
      setSuccess(null);

      try {
        const nowIso = new Date().toISOString();

        const frontOut = hasLegacyExpectedRange
          ? getTemperatureOutOfRange(frontTemperature, trailer.temperature_required)
          : getTemperatureMismatch(frontTemperature, expectedFrontTemperature);
        const rearOut = getTemperatureMismatch(rearTemperature, expectedRearTemperature);

        const { error: deleteTemperatureError } = await supabase
          .from("vessel_inspection_temperatures")
          .delete()
          .eq("vessel_trailer_id", trailer.id)
          .in("reading_point", ["front", "rear", "Front", "Rear"]);

        if (deleteTemperatureError) {
          throw deleteTemperatureError;
        }

        const temperaturePayload = [
          {
            vessel_trailer_id: trailer.id,
            trailer_id: trailer.trailer_id ?? null,
            trailer_number: trailer.trailer_number ?? null,
            temperature_value: frontTemperature,
            temperature_unit: expectedTemperatureUnit,
            reading_point: "front",
            notes: inspection.notes.trim() || null,
            is_out_of_range: frontOut,
            recorded_at: nowIso,
            recorded_by: "TrailerHub User",
          },
          {
            vessel_trailer_id: trailer.id,
            trailer_id: trailer.trailer_id ?? null,
            trailer_number: trailer.trailer_number ?? null,
            temperature_value: rearTemperature,
            temperature_unit: expectedTemperatureUnit,
            reading_point: "rear",
            notes: inspection.notes.trim() || null,
            is_out_of_range: rearOut,
            recorded_at: nowIso,
            recorded_by: "TrailerHub User",
          },
        ];

        const { error: temperatureError } = await supabase.from("vessel_inspection_temperatures").insert(temperaturePayload as never);
        if (temperatureError) {
          throw temperatureError;
        }

        const { error: damageDeleteError } = await supabase
          .from("vessel_inspection_damages")
          .delete()
          .eq("vessel_trailer_id", trailer.id);

        if (damageDeleteError) {
          console.error("Boat check damage delete Supabase error", {
            error: damageDeleteError,
            message: damageDeleteError.message,
            details: damageDeleteError.details,
            hint: damageDeleteError.hint,
            code: damageDeleteError.code,
            name: damageDeleteError.name,
            status: (damageDeleteError as { status?: number }).status,
          });
          throw damageDeleteError;
        }

        if (inspection.damage === "yes") {
          const damagePayload = {
            vessel_trailer_id: trailer.id,
            trailer_id: trailer.trailer_id ?? null,
            trailer_number: trailer.trailer_number ?? null,
            damage_type: inspection.damageType.trim() || null,
            damage_location: inspection.damageLocation.trim() || null,
            severity: inspection.overallCondition === "attention_required" ? "moderate" : "minor",
            description: inspection.damageDescription.trim(),
            recorded_at: nowIso,
            recorded_by: "TrailerHub User",
          };

          const { error: damageInsertError } = await supabase.from("vessel_inspection_damages").insert(damagePayload);
          if (damageInsertError) {
            console.error("Boat check damage insert Supabase error", {
              error: damageInsertError,
              message: damageInsertError.message,
              details: damageInsertError.details,
              hint: damageInsertError.hint,
              code: damageInsertError.code,
              name: damageInsertError.name,
              status: (damageInsertError as { status?: number }).status,
            });
            throw damageInsertError;
          }
        }

        if (inspection.photos.length > 0) {
          for (const photo of inspection.photos) {
            const storagePath = `operation-${operation.id}/trailer-${trailer.id}/${Date.now()}-${sanitizeFileName(photo.name || "photo")}`;
            const { error: uploadError } = await supabase.storage.from("vessel-inspection-photos").upload(storagePath, photo, {
              cacheControl: "3600",
              upsert: false,
            });

            if (uploadError) {
              throw uploadError;
            }

            const photoPayload = {
              vessel_trailer_id: trailer.id,
              category: "Boat Check",
              storage_path: storagePath,
              file_name: photo.name,
              description: inspection.notes.trim() || null,
              uploaded_at: nowIso,
              uploaded_by: "TrailerHub User",
            };

            const { error: photoError } = await supabase.from("vessel_inspection_photos").insert(photoPayload as never);
            if (photoError) {
              throw photoError;
            }
          }
        }

        const hasTemperatureAlert = frontOut || rearOut;
        const { error: trailerUpdateError } = await supabase
          .from("vessel_operation_trailers")
          .update({
            status: "inspected",
            inspection_completed_at: nowIso,
            planning_notes: inspection.notes.trim() || trailer.planning_notes || null,
            has_damage: inspection.damage === "yes",
            has_temperature_alert: hasTemperatureAlert,
            updated_at: nowIso,
          })
          .eq("id", trailer.id);

        if (trailerUpdateError) {
          throw trailerUpdateError;
        }

        setInspectionByTrailer((current) => ({
          ...current,
          [trailer.id]: initialInspectionState,
        }));

        setSuccess(`Boat check saved for ${trailer.trailer_number ?? "trailer"}.`);
        await loadOperation();
      } catch (inspectionErr) {
        console.error("Unable to save inspection:", inspectionErr);
        setError("Unable to save boat check.");
      } finally {
        setActioningTrailerId(null);
      }
    },
    [inspectionByTrailer, loadOperation, operation, operationStatus],
  );

  const handleCompleteOperation = useCallback(async () => {
    if (!operation || operationStatus !== "confirmed") {
      setError("Only confirmed operations can be completed.");
      return;
    }

    if (completionSummary.totalTrailers === 0) {
      setError("Cannot complete operation with no trailers.");
      return;
    }

    const confirmation = window.confirm(
      `Complete boat operation?\n\nTotal Trailers: ${completionSummary.totalTrailers}\nArrived: ${completionSummary.arrived}\nInspected: ${completionSummary.inspected}\nPending inspection: ${completionSummary.pendingInspection}\nNot arrived: ${completionSummary.notArrived}\nDamages: ${completionSummary.damages}\nTemperature alerts: ${completionSummary.temperatureAlerts}`,
    );

    if (!confirmation) {
      return;
    }

    if (completionSummary.pendingInspection > 0) {
      const pendingConfirmation = window.confirm(
        "Some arrived trailers have not been inspected.\nComplete operation anyway?",
      );

      if (!pendingConfirmation) {
        return;
      }
    }

    if (completionSummary.notArrived > 0) {
      const notArrivedConfirmation = window.confirm(
        "Some trailers have not been discharged.\nThey will be marked as Not Discharged.",
      );

      if (!notArrivedConfirmation) {
        return;
      }
    }

    setIsCompleting(true);
    setError(null);
    setSuccess(null);

    try {
      const nowIso = new Date().toISOString();

      const { error: markNotArrivedError } = await supabase
        .from("vessel_operation_trailers")
        .update({
          arrival_status: "not_discharged",
          updated_at: nowIso,
        })
        .eq("vessel_operation_id", operation.id)
        .in("arrival_status", ["expected", "available_for_arrival"]);

      if (markNotArrivedError) {
        console.error("Complete operation trailer update Supabase error", {
          message: markNotArrivedError.message,
          details: markNotArrivedError.details,
          hint: markNotArrivedError.hint,
          code: markNotArrivedError.code,
        });
        logVesselSupabaseError("Complete operation trailer update failed", markNotArrivedError);
        throw markNotArrivedError;
      }

      const completePayload = {
        status: "completed",
        updated_at: nowIso,
      };

      const { error: completeError } = await supabase
        .from("vessel_operations")
        .update(completePayload)
        .eq("id", operation.id);

      if (completeError) {
        console.error("Complete operation update Supabase error", {
          message: completeError.message,
          details: completeError.details,
          hint: completeError.hint,
          code: completeError.code,
        });
        logVesselSupabaseError("Complete operation update failed", completeError);
        throw completeError;
      }

      setSuccess("Boat operation completed. This operation is now read-only.");
      await loadOperation();
    } catch (completeErr) {
      console.error("Unable to complete operation:", completeErr);
      setError("Unable to complete operation.");
    } finally {
      setIsCompleting(false);
    }
  }, [completionSummary, loadOperation, operation, operationStatus]);

  const setBulkText = useCallback((value: string) => {
    setBulkTextState(value);
  }, []);

  return {
    operation,
    operationStatus,
    trailers,
    sortedTrailers,
    summary,
    completionSummary,
    editable,
    isReadOnly,
    isLoading,
    isSaving,
    isCompleting,
    actioningTrailerId,
    error,
    success,
    formState,
    inspectionByTrailer,
    bulkText,
    setBulkText,
    getInspectionState,
    handleFieldChange,
    handleInspectionFieldChange,
    handleAddSingleTrailer,
    handleBulkAdd,
    handleTogglePriority,
    handleRemoveTrailer,
    handleConfirmList,
    handleMarkArrived,
    handleSaveInspection,
    handleCompleteOperation,
    reloadOperation: loadOperation,
  };
}
