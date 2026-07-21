"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  buildVesselSupabaseErrorMessage,
  formatVesselDateTime,
  getVesselInspectionProgressLabel,
  getVesselInspectionProgressState,
  getVesselPriorityClass,
  getVesselPriorityLabel,
  getVesselTrailerStatusClass,
  logVesselSupabaseError,
  normalizeExpectedTemperatureUnit,
  resolveExpectedFrontTemperature,
  resolveExpectedRearTemperature,
  type SupabaseErrorLike,
  type VesselInspectionDamageRecord,
  type VesselInspectionPhotoRecord,
  type VesselInspectionTemperatureRecord,
  type VesselOperationRecord,
  type VesselOperationTrailerRecord,
} from "@/lib/vessel-operations";

type PhotoView = VesselInspectionPhotoRecord & { previewUrl?: string | null };
type SelectedInspectionPhoto = {
  id: string;
  file: File;
  previewUrl: string;
  source: "camera" | "upload";
};

type DamageChoice = "no" | "yes";

type OverallCondition = "good" | "attention_required";

const DAMAGE_TYPES = ["Dent", "Scratch", "Broken Light", "Door Damage", "Curtain Damage", "Tyre Damage", "Tail Lift Damage", "Other"];
const DAMAGE_LOCATIONS = ["Front", "Rear", "Left Side", "Right Side", "Roof", "Undercarriage", "Interior", "Other"];
const DAMAGE_SEVERITIES = ["Minor", "Moderate", "Severe"];

const MAX_PHOTO_SIZE = 10 * 1024 * 1024;

const normalizeReadingPoint = (value?: string | null) => (value ?? "").trim().toLowerCase();

const parseNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseTemperatureRange = (value?: string | null) => {
  if (!value?.trim()) {
    return null;
  }

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

const isOutOfConfiguredRange = (value: number | null, configuredRange?: string | null) => {
  if (value === null) {
    return false;
  }

  const range = parseTemperatureRange(configuredRange);
  if (!range) {
    return false;
  }

  return value < range.min || value > range.max;
};

const hasExpectedMismatch = (actual: number | null, expected: number | null) => {
  if (actual === null || expected === null) {
    return false;
  }

  return Math.abs(actual - expected) > 0.01;
};

const sanitizeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
const buildSelectedPhotoId = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

const isStorageConfigurationError = (errorMessage: string) => {
  const lower = errorMessage.toLowerCase();
  return lower.includes("bucket") || lower.includes("storage") || lower.includes("not found") || lower.includes("no such");
};

const asSupabaseErrorLike = (error: unknown) => error as SupabaseErrorLike;

function VesselInspectionPageContent() {
  const params = useParams();
  const operationId = typeof params?.id === "string" ? params.id : "";
  const vesselTrailerId = typeof params?.vesselTrailerId === "string" ? params.vesselTrailerId : "";

  const [operation, setOperation] = useState<VesselOperationRecord | null>(null);
  const [trailer, setTrailer] = useState<VesselOperationTrailerRecord | null>(null);
  const [temperatures, setTemperatures] = useState<VesselInspectionTemperatureRecord[]>([]);
  const [damageRecord, setDamageRecord] = useState<VesselInspectionDamageRecord | null>(null);
  const [photos, setPhotos] = useState<PhotoView[]>([]);
  const [receptionConfirmedAt, setReceptionConfirmedAt] = useState<string | null>(null);

  const [overallCondition, setOverallCondition] = useState<OverallCondition>("good");
  const [frontTemperature, setFrontTemperature] = useState("");
  const [rearTemperature, setRearTemperature] = useState("");
  const [frontAlertManual, setFrontAlertManual] = useState(false);
  const [rearAlertManual, setRearAlertManual] = useState(false);

  const [damageChoice, setDamageChoice] = useState<DamageChoice>("no");
  const [damageType, setDamageType] = useState("");
  const [damageLocation, setDamageLocation] = useState("");
  const [damageSeverity, setDamageSeverity] = useState("");
  const [damageDescription, setDamageDescription] = useState("");

  const [inspectionNotes, setInspectionNotes] = useState("");
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedInspectionPhoto[]>([]);
  const [photoSelectionError, setPhotoSelectionError] = useState<string | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<{ url: string; title: string } | null>(null);
  const selectedPhotosRef = useRef<SelectedInspectionPhoto[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [storageStatus, setStorageStatus] = useState<string | null>(null);
  const isReadOnly = operation?.status === "completed" || operation?.status === "cancelled";

  useEffect(() => {
    selectedPhotosRef.current = selectedPhotos;
  }, [selectedPhotos]);

  useEffect(() => {
    return () => {
      selectedPhotosRef.current.forEach((photo) => {
        URL.revokeObjectURL(photo.previewUrl);
      });
    };
  }, []);

  const clearSelectedPhotos = useCallback(() => {
    setSelectedPhotos((current) => {
      current.forEach((photo) => {
        URL.revokeObjectURL(photo.previewUrl);
      });
      return [];
    });
  }, []);

  const removeSelectedPhoto = useCallback((photoId: string) => {
    setSelectedPhotos((current) => {
      const target = current.find((photo) => photo.id === photoId);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }

      return current.filter((photo) => photo.id !== photoId);
    });
  }, []);

  const addSelectedPhotos = useCallback((files: FileList | null, source: "camera" | "upload") => {
    if (!files || files.length === 0) {
      return;
    }

    const nextFiles = Array.from(files);
    const rejectionMessages: string[] = [];

    setSelectedPhotos((current) => {
      const existingIds = new Set(current.map((photo) => photo.id));
      const additions: SelectedInspectionPhoto[] = [];

      for (const file of nextFiles) {
        if (!file.type.toLowerCase().startsWith("image/")) {
          rejectionMessages.push(`Only image files can be uploaded. Rejected ${file.name}.`);
          continue;
        }

        if (file.size > MAX_PHOTO_SIZE) {
          rejectionMessages.push(`Photo size must be 10 MB or less. Rejected ${file.name}.`);
          continue;
        }

        const photoId = buildSelectedPhotoId(file);
        if (existingIds.has(photoId)) {
          continue;
        }

        existingIds.add(photoId);
        additions.push({
          id: photoId,
          file,
          previewUrl: URL.createObjectURL(file),
          source,
        });
      }

      return [...current, ...additions];
    });

    setPhotoSelectionError(rejectionMessages.length > 0 ? rejectionMessages.join(" ") : null);
  }, []);

  const loadInspection = useCallback(async () => {
    if (!operationId || !vesselTrailerId) {
      setError("Invalid inspection reference.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setStorageStatus(null);

    try {
      const [operationResult, trailerResult, temperaturesResult, damagesResult, photosResult] = await Promise.all([
        supabase
          .from("vessel_operations")
          .select("id, vessel_name, sailing_reference, origin_port, berth, expected_arrival_at, actual_arrival_at, status, notes, created_at, updated_at")
          .eq("id", operationId)
          .single(),
        supabase
          .from("vessel_operation_trailers")
          .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, load_description, temperature_required, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, priority_level, priority_reason, planned_destination, planning_notes, status, arrived_at, arrival_status, arrival_confirmed_at, arrival_confirmed_by, inspection_started_at, inspection_completed_at, has_damage, has_temperature_alert, created_at, updated_at")
          .eq("id", vesselTrailerId)
          .single(),
        supabase
          .from("vessel_inspection_temperatures")
          .select("id, vessel_trailer_id, trailer_id, trailer_number, temperature_value, temperature_unit, reading_point, notes, is_out_of_range, recorded_at, recorded_by")
          .eq("vessel_trailer_id", vesselTrailerId)
          .order("recorded_at", { ascending: false }),
        supabase
          .from("vessel_inspection_damages")
          .select("id, vessel_trailer_id, damage_type, damage_location, severity, description, recorded_at, recorded_by")
          .eq("vessel_trailer_id", vesselTrailerId)
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("vessel_inspection_photos")
          .select("id, vessel_trailer_id, category, storage_path, file_name, description, uploaded_at, uploaded_by")
          .eq("vessel_trailer_id", vesselTrailerId)
          .order("uploaded_at", { ascending: false }),
      ]);

      if (operationResult.error || !operationResult.data) {
        logVesselSupabaseError("Load boat check operation failed", operationResult.error);
        throw operationResult.error ?? new Error("Operation not found.");
      }

      if (trailerResult.error || !trailerResult.data) {
        logVesselSupabaseError("Load boat check trailer failed", trailerResult.error);
        throw trailerResult.error ?? new Error("Trailer not found.");
      }

      if (temperaturesResult.error) {
        logVesselSupabaseError("Load boat check temperatures failed", temperaturesResult.error);
        throw temperaturesResult.error;
      }

      if (damagesResult.error) {
        logVesselSupabaseError("Load boat check damages failed", damagesResult.error);
        throw damagesResult.error;
      }

      if (photosResult.error) {
        logVesselSupabaseError("Load boat check photos failed", photosResult.error);
        throw photosResult.error;
      }

      const trailerRow = trailerResult.data as VesselOperationTrailerRecord;

      if (!trailerRow.inspection_started_at && trailerRow.status !== "inspected") {
        const nowIso = new Date().toISOString();
        const { data: startRow, error: startError } = await supabase
          .from("vessel_operation_trailers")
          .update({
            updated_at: nowIso,
            inspection_started_at: nowIso,
          })
          .eq("id", trailerRow.id)
          .is("inspection_started_at", null)
          .select("inspection_started_at")
          .maybeSingle();

        if (startError) {
          logVesselSupabaseError("Mark inspection started failed", startError);
          throw startError;
        }

        trailerRow.inspection_started_at = startRow?.inspection_started_at ?? trailerRow.inspection_started_at ?? nowIso;
      }

      setOperation(operationResult.data as VesselOperationRecord);
      setTrailer(trailerRow);

      const tempRows = (temperaturesResult.data ?? []) as VesselInspectionTemperatureRecord[];
      setTemperatures(tempRows);

      const frontRow = tempRows.find((row) => normalizeReadingPoint(row.reading_point) === "front");
      const rearRow = tempRows.find((row) => normalizeReadingPoint(row.reading_point) === "rear");

      setFrontTemperature(frontRow?.temperature_value?.toString() ?? "");
      setRearTemperature(rearRow?.temperature_value?.toString() ?? "");
      setFrontAlertManual(Boolean(frontRow?.is_out_of_range));
      setRearAlertManual(Boolean(rearRow?.is_out_of_range));

      const loadedDamage = (damagesResult.data as VesselInspectionDamageRecord | null) ?? null;
      setDamageRecord(loadedDamage);
      if (loadedDamage) {
        setDamageChoice("yes");
        setDamageType(loadedDamage.damage_type ?? "");
        setDamageLocation(loadedDamage.damage_location ?? "");
        setDamageSeverity(loadedDamage.severity ?? "");
        setDamageDescription(loadedDamage.description ?? "");
      } else {
        setDamageChoice("no");
        setDamageType("");
        setDamageLocation("");
        setDamageSeverity("");
        setDamageDescription("");
      }

      setInspectionNotes(trailerRow.planning_notes ?? "");

      const photoRows = (photosResult.data ?? []) as VesselInspectionPhotoRecord[];
      setPhotos(
        photoRows.map((photo) => ({
          ...photo,
          previewUrl: photo.storage_path
            ? supabase.storage.from("vessel-inspection-photos").getPublicUrl(photo.storage_path).data.publicUrl
            : null,
        })),
      );

      const { data: receptionEvents } = await supabase
        .from("trailer_events")
        .select("created_at, trailer_number, event_type, new_value")
        .eq("event_type", "vessel_arrival_received")
        .eq("trailer_number", trailerRow.trailer_number ?? "")
        .order("created_at", { ascending: false })
        .limit(20);

      const matchedReception = (receptionEvents ?? []).find((event) => {
        const payload = (event as { new_value?: unknown }).new_value as Record<string, unknown> | null | undefined;
        return payload?.vessel_trailer_id === trailerRow.id;
      }) as { created_at?: string | null } | undefined;

      setReceptionConfirmedAt(matchedReception?.created_at ?? null);
    } catch (loadErr) {
      logVesselSupabaseError("Unable to load inspection", asSupabaseErrorLike(loadErr));
      setError(buildVesselSupabaseErrorMessage(asSupabaseErrorLike(loadErr), "Unable to load inspection."));
    } finally {
      setIsLoading(false);
    }
  }, [operationId, vesselTrailerId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadInspection();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadInspection]);

  const expectedFrontTemperature = useMemo(() => (trailer ? resolveExpectedFrontTemperature(trailer) : null), [trailer]);
  const expectedRearTemperature = useMemo(() => (trailer ? resolveExpectedRearTemperature(trailer) : null), [trailer]);
  const expectedTemperatureUnit = useMemo(() => normalizeExpectedTemperatureUnit(trailer?.expected_temperature_unit), [trailer?.expected_temperature_unit]);
  const isFrontTemperatureRequired = useMemo(() => {
    if (expectedFrontTemperature !== null) {
      return true;
    }

    return Boolean(trailer?.temperature_required?.trim());
  }, [expectedFrontTemperature, trailer?.temperature_required]);
  const isRearTemperatureRequired = useMemo(() => expectedRearTemperature !== null, [expectedRearTemperature]);

  const hasExistingInspection = useMemo(() => {
    return Boolean(
      trailer?.status === "inspected" ||
      temperatures.length > 0 ||
      damageRecord ||
      inspectionNotes.trim() ||
      photos.length > 0,
    );
  }, [damageRecord, inspectionNotes, photos.length, temperatures.length, trailer?.status]);

  const timelineEntries = useMemo(() => {
    if (!operation || !trailer) {
      return [] as Array<{ key: string; label: string; value?: string | null }>;
    }

    return [
      { key: "added", label: "Added to Vessel Operation", value: trailer.created_at },
      { key: "confirmed", label: "Expected List Confirmed", value: operation.list_confirmed_at },
      { key: "arrived", label: "Arrived", value: trailer.arrival_confirmed_at ?? trailer.arrived_at },
      { key: "inspection-start", label: "Inspection Started", value: trailer.inspection_started_at },
      { key: "inspection-complete", label: "Inspection Completed", value: trailer.inspection_completed_at },
      { key: "reception", label: "Reception Confirmed", value: receptionConfirmedAt },
      { key: "position", label: "Compound Position Assigned", value: trailer.position_assigned_at },
    ].filter((item) => Boolean(item.value));
  }, [operation, receptionConfirmedAt, trailer]);

  const uploadSelectedPhotos = useCallback(
    async (operationData: VesselOperationRecord, trailerData: VesselOperationTrailerRecord, nowIso: string) => {
      if (selectedPhotos.length === 0) {
        return { uploadedCount: 0, failedFiles: [] as string[] };
      }

      const nextPhotos: PhotoView[] = [];
      const failedFiles: string[] = [];

      for (const selectedPhoto of selectedPhotos) {
        const { file, source } = selectedPhoto;

        if (!file.type.toLowerCase().startsWith("image/")) {
          failedFiles.push(`${file.name} (Only image files can be uploaded.)`);
          continue;
        }

        if (file.size > MAX_PHOTO_SIZE) {
          failedFiles.push(`${file.name} (Photo size must be 10 MB or less.)`);
          continue;
        }

        const safeFileName = sanitizeFileName(file.name || "photo");
        const storagePath = `vessel-operations/${operationData.id}/${trailerData.id}/${Date.now()}-${safeFileName}`;

        const { error: uploadError } = await supabase.storage
          .from("vessel-inspection-photos")
          .upload(storagePath, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type,
          });

        if (uploadError) {
          if (isStorageConfigurationError(uploadError.message || "")) {
            console.error("Photo upload skipped due to storage configuration:", uploadError);
            failedFiles.push(`${file.name} (${uploadError.message || "Photo storage is not configured in this environment."})`);
            continue;
          }
          failedFiles.push(`${file.name} (${uploadError.message || "Upload failed."})`);
          continue;
        }

        const { data: photoData, error: photoInsertError } = await supabase
          .from("vessel_inspection_photos")
          .insert({
            vessel_trailer_id: trailerData.id,
            category: source === "camera" ? "boat_check_camera" : "boat_check_upload",
            storage_path: storagePath,
            file_name: safeFileName,
            description: inspectionNotes.trim() || null,
            uploaded_at: nowIso,
            uploaded_by: "TrailerHub User",
          })
          .select("id, vessel_trailer_id, category, storage_path, file_name, description, uploaded_at, uploaded_by")
          .single();

        if (photoInsertError || !photoData) {
          const { error: cleanupError } = await supabase.storage.from("vessel-inspection-photos").remove([storagePath]);
          if (cleanupError) {
            console.error("Unable to clean up orphaned inspection photo:", cleanupError);
          }
          failedFiles.push(`${file.name} (${photoInsertError?.message || "Unable to save photo metadata."})`);
          continue;
        }

        nextPhotos.push({
          ...(photoData as VesselInspectionPhotoRecord),
          previewUrl: supabase.storage.from("vessel-inspection-photos").getPublicUrl(storagePath).data.publicUrl,
        });
      }

      if (nextPhotos.length > 0) {
        setPhotos((current) => [...nextPhotos, ...current]);
      }

      return {
        uploadedCount: nextPhotos.length,
        failedFiles,
      };
    },
    [inspectionNotes, selectedPhotos],
  );

  const handleSaveInspection = useCallback(async () => {
    if (!operation || !trailer) {
      return;
    }

    if (!vesselTrailerId || trailer.id !== vesselTrailerId) {
      setError("Unable to validate the selected trailer inspection. Refresh and try again.");
      return;
    }

    if (operation.status === "completed" || operation.status === "cancelled") {
      setError("Completed operations are read-only.");
      return;
    }

    if (isSaving) {
      return;
    }

    const frontValue = parseNumber(frontTemperature);
    const rearValue = parseNumber(rearTemperature);

    if (isFrontTemperatureRequired && frontValue === null) {
      setError("Actual front temperature is required for this trailer.");
      return;
    }

    if (isRearTemperatureRequired && rearValue === null) {
      setError("Actual rear temperature is required for this trailer.");
      return;
    }

    if (damageChoice === "yes" && !damageDescription.trim()) {
      setError("Damage description is required when damage is set to Yes.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);
    setStorageStatus(null);
    setPhotoSelectionError(null);

    try {
      const nowIso = new Date().toISOString();

      const frontOutOfRange = frontAlertManual || (expectedFrontTemperature !== null
        ? hasExpectedMismatch(frontValue, expectedFrontTemperature)
        : isOutOfConfiguredRange(frontValue, trailer.temperature_required));
      const rearOutOfRange = rearAlertManual || hasExpectedMismatch(rearValue, expectedRearTemperature);

      const { error: deleteTemperatureError } = await supabase
        .from("vessel_inspection_temperatures")
        .delete()
        .eq("vessel_trailer_id", trailer.id)
        .in("reading_point", ["front", "rear", "Front", "Rear"]);

      if (deleteTemperatureError) {
        logVesselSupabaseError("Delete existing boat check temperatures failed", deleteTemperatureError);
        throw deleteTemperatureError;
      }

      const temperaturePayload = [
        {
          vessel_trailer_id: trailer.id,
          trailer_id: trailer.trailer_id ?? null,
          trailer_number: trailer.trailer_number ?? null,
          temperature_value: frontValue,
            temperature_unit: expectedTemperatureUnit,
          reading_point: "front",
          notes: inspectionNotes.trim() || null,
          is_out_of_range: frontOutOfRange,
          recorded_at: nowIso,
          recorded_by: "TrailerHub User",
        },
        {
          vessel_trailer_id: trailer.id,
          trailer_id: trailer.trailer_id ?? null,
          trailer_number: trailer.trailer_number ?? null,
          temperature_value: rearValue,
            temperature_unit: expectedTemperatureUnit,
          reading_point: "rear",
          notes: inspectionNotes.trim() || null,
          is_out_of_range: rearOutOfRange,
          recorded_at: nowIso,
          recorded_by: "TrailerHub User",
        },
      ];

      const { error: tempInsertError } = await supabase.from("vessel_inspection_temperatures").insert(temperaturePayload as never);

      if (tempInsertError) {
        logVesselSupabaseError("Insert boat check temperatures failed", tempInsertError);
        throw tempInsertError;
      }

      const { error: damageDeleteError } = await supabase
        .from("vessel_inspection_damages")
        .delete()
        .eq("vessel_trailer_id", trailer.id);

      if (damageDeleteError) {
        logVesselSupabaseError("Delete existing boat check damages failed", damageDeleteError);
        throw damageDeleteError;
      }

      if (damageChoice === "yes") {
        const { error: damageInsertError } = await supabase.from("vessel_inspection_damages").insert({
          vessel_trailer_id: trailer.id,
          damage_type: damageType.trim() || null,
          damage_location: damageLocation.trim() || null,
          severity: damageSeverity.trim() || null,
          description: damageDescription.trim(),
          recorded_at: nowIso,
          recorded_by: "TrailerHub User",
        });

        if (damageInsertError) {
          logVesselSupabaseError("Insert boat check damage failed", damageInsertError);
          throw damageInsertError;
        }
      }

      const hasTemperatureAlert = frontOutOfRange || rearOutOfRange;
      const hasDamage = damageChoice === "yes";

      const trailerUpdatePayload = {
        status: "inspected",
        inspection_completed_at: nowIso,
        has_damage: hasDamage,
        has_temperature_alert: hasTemperatureAlert,
        planning_notes: inspectionNotes.trim() || null,
        updated_at: nowIso,
        inspection_started_at: trailer.inspection_started_at ?? nowIso,
      };

      const { error: trailerUpdateError } = await supabase
        .from("vessel_operation_trailers")
        .update(trailerUpdatePayload)
        .eq("id", trailer.id);

      if (trailerUpdateError) {
        logVesselSupabaseError("Finalize boat check trailer update failed", trailerUpdateError);
        throw trailerUpdateError;
      }

      const photoResult = await uploadSelectedPhotos(operation, trailer, nowIso);

      clearSelectedPhotos();
      await loadInspection();

      if (photoResult.failedFiles.length > 0) {
        setStorageStatus(`Inspection saved. Some photos could not be saved: ${photoResult.failedFiles.join(", ")}`);
      } else if (photoResult.uploadedCount > 0) {
        setStorageStatus(`${photoResult.uploadedCount} new photo${photoResult.uploadedCount === 1 ? "" : "s"} saved successfully.`);
      }

      setSuccess("Inspection saved successfully.");
    } catch (saveErr) {
      logVesselSupabaseError("Unable to save inspection", asSupabaseErrorLike(saveErr));
      setError(buildVesselSupabaseErrorMessage(asSupabaseErrorLike(saveErr), "Unable to save inspection."));
    } finally {
      setIsSaving(false);
    }
  }, [
    damageChoice,
    damageDescription,
    damageLocation,
    damageSeverity,
    damageType,
    frontAlertManual,
    frontTemperature,
    inspectionNotes,
    isSaving,
    operation,
    rearAlertManual,
    rearTemperature,
    expectedFrontTemperature,
    expectedRearTemperature,
    expectedTemperatureUnit,
    isFrontTemperatureRequired,
    isRearTemperatureRequired,
    trailer,
    vesselTrailerId,
    clearSelectedPhotos,
    loadInspection,
    uploadSelectedPhotos,
  ]);

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">Loading inspection...</div>
      </main>
    );
  }

  if (!operation || !trailer) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-3xl border border-rose-500/30 bg-rose-500/10 p-6 text-sm text-rose-200">{error ?? "Inspection not found."}</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{hasExistingInspection ? "Update Inspection" : "Start Inspection"}</h1>
              <p className="mt-2 text-sm text-slate-300">{operation.vessel_name ?? "Unnamed vessel"} - {trailer.trailer_number ?? "Trailer"}</p>
            </div>
            <Link href={`/dashboard/vessel-operations/${operation.id}/boat-check`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
              Back to Boat Check
            </Link>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
        {success ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div> : null}
        {storageStatus ? <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{storageStatus}</div> : null}

        <fieldset disabled={isReadOnly} className="contents">
        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <p className="text-sm text-slate-200">Trailer: <span className="font-semibold text-white">{trailer.trailer_number ?? "-"}</span></p>
            <p className="text-sm text-slate-200">Priority: <span className={`rounded-full border px-2 py-0.5 text-xs ${getVesselPriorityClass(trailer.priority_level)}`}>{getVesselPriorityLabel(trailer.priority_level)}</span></p>
            <p className="text-sm text-slate-200">Arrived At: <span className="font-semibold text-white">{formatVesselDateTime(trailer.arrival_confirmed_at ?? trailer.arrived_at)}</span></p>
            <p className="text-sm text-slate-200">Inspection Status: <span className={`rounded-full border px-2 py-0.5 text-xs ${getVesselTrailerStatusClass(trailer.status)}`}>{getVesselInspectionProgressLabel(getVesselInspectionProgressState(trailer))}</span></p>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Operational Timeline</p>
          <div className="mt-4 space-y-2">
            {timelineEntries.length === 0 ? (
              <p className="text-sm text-slate-400">No timeline events recorded yet.</p>
            ) : (
              timelineEntries.map((entry) => (
                <div key={entry.key} className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-200">
                  <span className="font-semibold text-white">{entry.label}:</span> {formatVesselDateTime(entry.value)}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Overall Condition</p>
          <select value={overallCondition} onChange={(event) => setOverallCondition(event.target.value as OverallCondition)} className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none">
            <option value="good">Good</option>
            <option value="attention_required">Attention Required</option>
          </select>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Temperatures</p>
          <p className="mt-2 text-xs text-slate-400">Unit: {expectedTemperatureUnit}. Front expected: {expectedFrontTemperature === null ? "-" : expectedFrontTemperature}. Rear expected: {expectedRearTemperature === null ? "-" : expectedRearTemperature}.</p>
          <p className="mt-1 text-xs text-slate-400">{isFrontTemperatureRequired ? "Actual front temperature is required." : "Actual front temperature is optional."} {isRearTemperatureRequired ? "Actual rear temperature is required." : "Actual rear temperature is optional."}</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-200">
              Actual Front Temperature ({expectedTemperatureUnit})
              <input type="number" value={frontTemperature} onChange={(event) => setFrontTemperature(event.target.value)} className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" />
            </label>
            <label className="text-sm text-slate-200">
              Actual Rear Temperature ({expectedTemperatureUnit})
              <input type="number" value={rearTemperature} onChange={(event) => setRearTemperature(event.target.value)} className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" />
            </label>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={frontAlertManual} onChange={(event) => setFrontAlertManual(event.target.checked)} /> Mark front as alert
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={rearAlertManual} onChange={(event) => setRearAlertManual(event.target.checked)} /> Mark rear as alert
            </label>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Damage</p>

          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setDamageChoice("no")} className={`rounded-2xl px-4 py-2 text-sm font-semibold ${damageChoice === "no" ? "bg-cyan-500 text-slate-950" : "border border-white/10 bg-slate-950/80 text-white"}`}>No</button>
            <button type="button" onClick={() => setDamageChoice("yes")} className={`rounded-2xl px-4 py-2 text-sm font-semibold ${damageChoice === "yes" ? "bg-cyan-500 text-slate-950" : "border border-white/10 bg-slate-950/80 text-white"}`}>Yes</button>
          </div>

          {damageChoice === "yes" ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-200">
                Damage Type
                <select value={damageType} onChange={(event) => setDamageType(event.target.value)} className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none">
                  <option value="">Select type</option>
                  {DAMAGE_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>

              <label className="text-sm text-slate-200">
                Damage Location
                <select value={damageLocation} onChange={(event) => setDamageLocation(event.target.value)} className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none">
                  <option value="">Select location</option>
                  {DAMAGE_LOCATIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>

              <label className="text-sm text-slate-200 sm:col-span-2">
                Severity
                <select value={damageSeverity} onChange={(event) => setDamageSeverity(event.target.value)} className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none">
                  <option value="">Select severity</option>
                  {DAMAGE_SEVERITIES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>

              <label className="text-sm text-slate-200 sm:col-span-2">
                Description
                <textarea rows={3} value={damageDescription} onChange={(event) => setDamageDescription(event.target.value)} className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" />
              </label>
            </div>
          ) : null}
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Inspection Notes</p>
          <textarea rows={4} value={inspectionNotes} onChange={(event) => setInspectionNotes(event.target.value)} className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="General inspection notes" />
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Photos</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
              Take Photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(event) => {
                  addSelectedPhotos(event.target.files, "camera");
                  event.currentTarget.value = "";
                }}
              />
            </label>

            <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl border border-white/10 bg-slate-800 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700">
              Upload Photo
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  addSelectedPhotos(event.target.files, "upload");
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>

          {photoSelectionError ? <div className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{photoSelectionError}</div> : null}

          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Saved Photos</p>
            <div className="mt-3 grid gap-3 grid-cols-2 lg:grid-cols-4">
              {photos.length === 0 ? <div className="col-span-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-slate-400">No saved photos yet.</div> : null}
              {photos.map((photo) => (
                <button key={photo.id} type="button" onClick={() => photo.previewUrl && setSelectedPreview({ url: photo.previewUrl, title: photo.file_name ?? "Photo" })} className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70 text-left">
                  <div className="relative aspect-video w-full bg-slate-950">
                    {photo.previewUrl ? <Image src={photo.previewUrl} alt={photo.file_name ?? "Inspection photo"} fill className="object-cover" /> : null}
                  </div>
                  <div className="p-3 text-xs text-slate-300">
                    <p className="font-semibold text-white">{photo.file_name ?? photo.category ?? "Photo"}</p>
                    <p>{photo.category ?? "Saved"}</p>
                    <p>{formatVesselDateTime(photo.uploaded_at)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">New Photos</p>
            <div className="mt-3 grid gap-3 grid-cols-2 lg:grid-cols-4">
              {selectedPhotos.length === 0 ? <div className="col-span-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-slate-400">No new photos selected.</div> : null}
              {selectedPhotos.map((photo) => (
                <div key={photo.id} className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70">
                  <button type="button" onClick={() => setSelectedPreview({ url: photo.previewUrl, title: photo.file.name })} className="block w-full text-left">
                    <div className="relative aspect-video w-full bg-slate-950">
                      <Image src={photo.previewUrl} alt={photo.file.name} fill className="object-cover" />
                    </div>
                  </button>
                  <div className="space-y-2 p-3 text-xs text-slate-300">
                    <p className="truncate font-semibold text-white">{photo.file.name}</p>
                    <p>Source: {photo.source === "camera" ? "Camera" : "Upload"}</p>
                    <button
                      type="button"
                      onClick={() => removeSelectedPhoto(photo.id)}
                      className="inline-flex rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100 hover:bg-rose-500/20"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <button type="button" onClick={() => void handleSaveInspection()} disabled={isSaving || isReadOnly} className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60">
            {isSaving ? "Saving..." : isReadOnly ? "Read Only" : hasExistingInspection ? "Update Inspection" : "Save Inspection"}
          </button>
        </section>
        </fieldset>

        {selectedPreview ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" onClick={() => setSelectedPreview(null)}>
            <div className="max-h-[90vh] max-w-4xl overflow-hidden rounded-3xl bg-slate-950 shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-white/10 p-4">
                <p className="text-sm font-semibold text-white">{selectedPreview.title}</p>
                <button type="button" onClick={() => setSelectedPreview(null)} className="rounded-2xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white">Close</button>
              </div>
              <div className="relative h-[70vh] w-[85vw] max-w-4xl">
                <Image src={selectedPreview.url} alt={selectedPreview.title} fill className="object-contain" />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export default function VesselInspectionPage() {
  return <VesselInspectionPageContent />;
}
