"use client";

import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  formatVesselDateTime,
  getVesselPriorityClass,
  getVesselPriorityLabel,
  normalizeTrailerNumber,
  normalizeVesselText,
  type VesselInspectionDamageRecord,
  type VesselInspectionPhotoRecord,
  type VesselInspectionTemperatureRecord,
  type VesselOperationRecord,
  type VesselOperationTrailerRecord,
  type VesselTrailerStatus,
} from "@/lib/vessel-operations";

type ActiveTrailer = {
  id: string;
  trailer_number?: string | null;
  compound_position?: string | null;
  departure_date?: string | null;
  is_local?: boolean | null;
};

type DamageForm = {
  damageType: string;
  damageLocation: string;
  severity: string;
  description: string;
};

type TemperatureForm = {
  temperatureValue: string;
  unit: "C" | "F";
  readingPoint: string;
  notes: string;
  outOfRange: boolean;
};

type PhotoForm = {
  category: string;
  description: string;
};

type PhotoView = VesselInspectionPhotoRecord & { previewUrl?: string | null };

const initialDamageForm: DamageForm = {
  damageType: "",
  damageLocation: "",
  severity: "",
  description: "",
};

const initialTemperatureForm: TemperatureForm = {
  temperatureValue: "",
  unit: "C",
  readingPoint: "Front",
  notes: "",
  outOfRange: false,
};

const initialPhotoForm: PhotoForm = {
  category: "Damage",
  description: "",
};

const READING_POINTS = ["Front", "Middle", "Rear", "Display", "Cargo", "Other"];
const DAMAGE_TYPES = ["Dent", "Scratch", "Tear", "Seal", "Door", "Other"];
const PHOTO_CATEGORIES = ["Damage", "Seal", "Temperature Display", "Trailer Condition", "Cargo", "Other"];

const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

const sanitizeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

const positionLookup = (positions: ActiveTrailer[]) => {
  const taken = new Set<string>();
  positions.forEach((item) => {
    const normalized = normalizeTrailerNumber(item.compound_position);
    if (normalized) taken.add(normalized);
  });
  return taken;
};

function VesselInspectionPageContent() {
  const params = useParams();
  const operationId = typeof params?.id === "string" ? params.id : "";
  const vesselTrailerId = typeof params?.vesselTrailerId === "string" ? params.vesselTrailerId : "";

  const [operation, setOperation] = useState<VesselOperationRecord | null>(null);
  const [trailer, setTrailer] = useState<VesselOperationTrailerRecord | null>(null);
  const [damageForm, setDamageForm] = useState<DamageForm>(initialDamageForm);
  const [temperatureForm, setTemperatureForm] = useState<TemperatureForm>(initialTemperatureForm);
  const [photoForm, setPhotoForm] = useState<PhotoForm>(initialPhotoForm);
  const [inspectionNotes, setInspectionNotes] = useState("");
  const [damages, setDamages] = useState<VesselInspectionDamageRecord[]>([]);
  const [temperatures, setTemperatures] = useState<VesselInspectionTemperatureRecord[]>([]);
  const [photos, setPhotos] = useState<PhotoView[]>([]);
  const [activeTrailers, setActiveTrailers] = useState<ActiveTrailer[]>([]);
  const [selectedPreview, setSelectedPreview] = useState<{ url: string; title: string } | null>(null);
  const [positionValue, setPositionValue] = useState("");
  const [autoPosition, setAutoPosition] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadInspection = useCallback(async () => {
    if (!operationId || !vesselTrailerId) {
      setError("Invalid inspection route.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [operationResult, trailerResult, damagesResult, temperaturesResult, photosResult, activeTrailersResult] = await Promise.all([
        supabase
          .from("vessel_operations")
          .select("id, vessel_name, sailing_reference, origin_port, berth, expected_arrival_at, actual_arrival_at, status, notes, created_at, updated_at")
          .eq("id", operationId)
          .single(),
        supabase
          .from("vessel_operation_trailers")
          .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, load_description, temperature_required, priority_level, priority_reason, planned_destination, planning_notes, status, arrived_at, arrival_confirmed_by, inspection_started_at, inspection_completed_at, position_assigned_at, assigned_position, has_damage, has_temperature_alert, created_at, updated_at")
          .eq("id", vesselTrailerId)
          .single(),
        supabase.from("vessel_inspection_damages").select("id, vessel_operation_id, vessel_operation_trailer_id, damage_type, damage_location, severity, description, recorded_at, recorded_by").eq("vessel_operation_trailer_id", vesselTrailerId).order("recorded_at", { ascending: false }),
        supabase.from("vessel_inspection_temperatures").select("id, vessel_operation_id, vessel_operation_trailer_id, temperature_value, unit, reading_point, notes, out_of_range, recorded_at, recorded_by").eq("vessel_operation_trailer_id", vesselTrailerId).order("recorded_at", { ascending: false }),
        supabase.from("vessel_inspection_photos").select("id, vessel_operation_id, vessel_operation_trailer_id, category, storage_path, file_name, description, uploaded_at, uploaded_by").eq("vessel_operation_trailer_id", vesselTrailerId).order("uploaded_at", { ascending: false }),
        supabase.from("trailers").select("id, trailer_number, compound_position, departure_date, is_local").is("departure_date", null).neq("is_local", true),
      ]);

      if (operationResult.error || !operationResult.data) throw operationResult.error ?? new Error("Operation not found.");
      if (trailerResult.error || !trailerResult.data) throw trailerResult.error ?? new Error("Trailer not found.");
      if (damagesResult.error) throw damagesResult.error;
      if (temperaturesResult.error) throw temperaturesResult.error;
      if (photosResult.error) throw photosResult.error;
      if (activeTrailersResult.error) throw activeTrailersResult.error;

      setOperation(operationResult.data as VesselOperationRecord);
      const trailerRow = trailerResult.data as VesselOperationTrailerRecord;
      setTrailer(trailerRow);
      setInspectionNotes(trailerRow.planning_notes ?? operationResult.data.notes ?? "");
      setDamages((damagesResult.data ?? []) as VesselInspectionDamageRecord[]);
      setTemperatures((temperaturesResult.data ?? []) as VesselInspectionTemperatureRecord[]);
      const photoRows = (photosResult.data ?? []) as VesselInspectionPhotoRecord[];
      setPhotos(
        photoRows.map((photo) => ({
          ...photo,
          previewUrl: photo.storage_path ? supabase.storage.from("vessel-inspection-photos").getPublicUrl(photo.storage_path).data.publicUrl : null,
        })),
      );
      setActiveTrailers((activeTrailersResult.data ?? []) as ActiveTrailer[]);
    } catch (loadErr) {
      console.error("Unable to load inspection data:", loadErr);
      setError("Unable to load inspection data.");
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

  const takenPositions = useMemo(() => positionLookup(activeTrailers.filter((item) => item.id !== trailer?.trailer_id)), [activeTrailers, trailer?.trailer_id]);

  const handleCompleteRefresh = async () => {
    await loadInspection();
  };

  const addDamage = async () => {
    if (!operation || !trailer || !damageForm.description.trim()) {
      setError("Damage description is required.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const nowIso = new Date().toISOString();
      const { data, error: insertError } = await supabase
        .from("vessel_inspection_damages")
        .insert({
          vessel_operation_id: operation.id,
          vessel_operation_trailer_id: trailer.id,
          damage_type: damageForm.damageType.trim() || null,
          damage_location: damageForm.damageLocation.trim() || null,
          severity: damageForm.severity.trim() || null,
          description: damageForm.description.trim(),
          recorded_at: nowIso,
          recorded_by: "TrailerHub User",
        })
        .select("id, vessel_operation_id, vessel_operation_trailer_id, damage_type, damage_location, severity, description, recorded_at, recorded_by")
        .single();

      if (insertError || !data) throw new Error(insertError?.message || "Unable to add damage.");

      const { error: updateError } = await supabase
        .from("vessel_operation_trailers")
        .update({ has_damage: true, updated_at: nowIso })
        .eq("id", trailer.id);

      if (updateError) throw updateError;

      const { error: eventError } = await supabase.from("trailer_events").insert({
        trailer_id: trailer.trailer_id ?? null,
        trailer_number: trailer.trailer_number,
        event_type: "vessel_damage_recorded",
        event_description: `Damage recorded for ${trailer.trailer_number ?? "trailer"}.`,
        old_value: { vessel_operation_trailer_id: trailer.id, has_damage: trailer.has_damage ?? false },
        new_value: { vessel_operation_trailer_id: trailer.id, has_damage: true, recorded_at: nowIso },
      });

      if (eventError) console.error("Failed to save damage event:", eventError);

      setDamages((current) => [data as VesselInspectionDamageRecord, ...current]);
      setTrailer((current) => (current ? { ...current, has_damage: true } : current));
      setDamageForm(initialDamageForm);
      setSuccess("Damage recorded.");
    } catch (damageErr) {
      console.error("Unable to add damage:", damageErr);
      setError("Unable to add damage.");
    } finally {
      setIsSaving(false);
    }
  };

  const removeDamage = async (damageId: string) => {
    const confirmed = window.confirm("Delete this damage record?");
    if (!confirmed) return;

    setIsSaving(true);
    setError(null);
    try {
      const { error: deleteError } = await supabase.from("vessel_inspection_damages").delete().eq("id", damageId);
      if (deleteError) throw deleteError;

      const nextDamages = damages.filter((item) => item.id !== damageId);
      setDamages(nextDamages);
      if (nextDamages.length === 0 && trailer) {
        await supabase.from("vessel_operation_trailers").update({ has_damage: false, updated_at: new Date().toISOString() }).eq("id", trailer.id);
        setTrailer((current) => (current ? { ...current, has_damage: false } : current));
      }
    } catch (removeErr) {
      console.error("Unable to delete damage:", removeErr);
      setError("Unable to delete damage.");
    } finally {
      setIsSaving(false);
    }
  };

  const addTemperature = async () => {
    if (!operation || !trailer || !temperatureForm.temperatureValue.trim()) {
      setError("Temperature value is required.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const nowIso = new Date().toISOString();
      const { data, error: insertError } = await supabase
        .from("vessel_inspection_temperatures")
        .insert({
          vessel_operation_id: operation.id,
          vessel_operation_trailer_id: trailer.id,
          temperature_value: Number(temperatureForm.temperatureValue),
          unit: temperatureForm.unit,
          reading_point: temperatureForm.readingPoint.trim() || null,
          notes: temperatureForm.notes.trim() || null,
          out_of_range: temperatureForm.outOfRange,
          recorded_at: nowIso,
          recorded_by: "TrailerHub User",
        })
        .select("id, vessel_operation_id, vessel_operation_trailer_id, temperature_value, unit, reading_point, notes, out_of_range, recorded_at, recorded_by")
        .single();

      if (insertError || !data) throw new Error(insertError?.message || "Unable to add temperature.");

      if (temperatureForm.outOfRange) {
        await supabase.from("vessel_operation_trailers").update({ has_temperature_alert: true, updated_at: nowIso }).eq("id", trailer.id);
        setTrailer((current) => (current ? { ...current, has_temperature_alert: true } : current));
      }

      const { error: eventError } = await supabase.from("trailer_events").insert({
        trailer_id: trailer.trailer_id ?? null,
        trailer_number: trailer.trailer_number,
        event_type: "vessel_temperature_recorded",
        event_description: `Temperature recorded for ${trailer.trailer_number ?? "trailer"}.`,
        old_value: { vessel_operation_trailer_id: trailer.id },
        new_value: { vessel_operation_trailer_id: trailer.id, out_of_range: temperatureForm.outOfRange, recorded_at: nowIso },
      });

      if (eventError) console.error("Failed to save temperature event:", eventError);

      setTemperatures((current) => [data as VesselInspectionTemperatureRecord, ...current]);
      setTemperatureForm(initialTemperatureForm);
      setSuccess("Temperature recorded.");
    } catch (tempErr) {
      console.error("Unable to add temperature:", tempErr);
      setError("Unable to add temperature.");
    } finally {
      setIsSaving(false);
    }
  };

  const uploadPhoto = async (file: File) => {
    if (!operation || !trailer) {
      return;
    }

    if (!file.type || !file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setError("Only JPG, PNG, and WEBP images are allowed.");
      return;
    }

    if (file.size > MAX_PHOTO_SIZE) {
      setError("Image size must be 10 MB or less.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const nowIso = new Date().toISOString();
      const safeFileName = sanitizeFileName(file.name || "photo");
      const path = `vessel-operations/${operation.id}/${normalizeTrailerNumber(trailer.trailer_number)}/${nowIso.replace(/[:.]/g, "-")}-${safeFileName}`;

      const { error: uploadError } = await supabase.storage.from("vessel-inspection-photos").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });

      if (uploadError) throw uploadError;

      const { data, error: insertError } = await supabase
        .from("vessel_inspection_photos")
        .insert({
          vessel_operation_id: operation.id,
          vessel_operation_trailer_id: trailer.id,
          category: photoForm.category.trim() || null,
          storage_path: path,
          file_name: safeFileName,
          description: photoForm.description.trim() || null,
          uploaded_at: nowIso,
          uploaded_by: "TrailerHub User",
        })
        .select("id, vessel_operation_id, vessel_operation_trailer_id, category, storage_path, file_name, description, uploaded_at, uploaded_by")
        .single();

      if (insertError || !data) throw new Error(insertError?.message || "Unable to save photo metadata.");

      const previewUrl = supabase.storage.from("vessel-inspection-photos").getPublicUrl(path).data.publicUrl;
      setPhotos((current) => [{ ...(data as VesselInspectionPhotoRecord), previewUrl }, ...current]);

      const { error: eventError } = await supabase.from("trailer_events").insert({
        trailer_id: trailer.trailer_id ?? null,
        trailer_number: trailer.trailer_number,
        event_type: "vessel_inspection_photo_added",
        event_description: `Inspection photo added for ${trailer.trailer_number ?? "trailer"}.`,
        old_value: { vessel_operation_trailer_id: trailer.id },
        new_value: { vessel_operation_trailer_id: trailer.id, category: photoForm.category, uploaded_at: nowIso },
      });

      if (eventError) console.error("Failed to save photo event:", eventError);

      setPhotoForm(initialPhotoForm);
      setSuccess("Photo uploaded.");
    } catch (photoErr) {
      console.error("Unable to upload photo:", photoErr);
      setError("Unable to upload photo.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleAssignPosition = async () => {
    if (!operation || !trailer) return;

    const plannedDestination = normalizeVesselText(trailer.planned_destination);
    const wantsCompound = plannedDestination === "compound";
    const normalizedPosition = normalizeTrailerNumber(positionValue);

    setIsSaving(true);
    setError(null);
    try {
      let assignedPosition = normalizedPosition;

      if (wantsCompound) {
        if (!assignedPosition && autoPosition) {
          const availablePosition = Array.from({ length: 50 }, (_, index) => `P${String(index + 1).padStart(2, "0")}`).find((position) => !takenPositions.has(position));
          assignedPosition = availablePosition ?? "";
        }

        if (!assignedPosition) {
          setError("Please select or auto assign a compound position.");
          return;
        }

        if (takenPositions.has(assignedPosition)) {
          setError(`Position ${assignedPosition} is already occupied.`);
          return;
        }

        const { error: updateError } = await supabase.from("vessel_operation_trailers").update({
          assigned_position: assignedPosition,
          position_assigned_at: new Date().toISOString(),
          status: "positioned" as VesselTrailerStatus,
          updated_at: new Date().toISOString(),
        }).eq("id", trailer.id);

        if (updateError) throw updateError;

        if (trailer.trailer_id) {
          await supabase.from("trailers").update({ compound_position: assignedPosition, is_local: false }).eq("id", trailer.trailer_id);
        }
      } else {
        const { error: updateError } = await supabase.from("vessel_operation_trailers").update({
          assigned_position: null,
          position_assigned_at: new Date().toISOString(),
          status: "positioned" as VesselTrailerStatus,
          updated_at: new Date().toISOString(),
        }).eq("id", trailer.id);

        if (updateError) throw updateError;
      }

      const { error: eventError } = await supabase.from("trailer_events").insert({
        trailer_id: trailer.trailer_id ?? null,
        trailer_number: trailer.trailer_number,
        event_type: "vessel_position_assigned",
        event_description: `Position assigned for ${trailer.trailer_number ?? "trailer"}.`,
        old_value: { vessel_operation_trailer_id: trailer.id, assigned_position: trailer.assigned_position ?? null },
        new_value: { vessel_operation_trailer_id: trailer.id, assigned_position: wantsCompound ? assignedPosition : null },
      });

      if (eventError) console.error("Failed to save position event:", eventError);

      setTrailer((current) => current ? { ...current, assigned_position: wantsCompound ? assignedPosition : null, position_assigned_at: new Date().toISOString(), status: "positioned" } : current);
      setSuccess("Position assigned.");
      await handleCompleteRefresh();
    } catch (assignErr) {
      console.error("Unable to assign position:", assignErr);
      setError("Unable to assign position.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCompleteInspection = async () => {
    if (!operation || !trailer) return;

    const confirmed = window.confirm(`Complete inspection for ${trailer.trailer_number ?? "trailer"}?`);
    if (!confirmed) return;

    setIsSaving(true);
    setError(null);
    try {
      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase.from("vessel_operation_trailers").update({ status: "inspected" as VesselTrailerStatus, inspection_completed_at: nowIso, planning_notes: inspectionNotes.trim() || null, updated_at: nowIso }).eq("id", trailer.id);
      if (updateError) throw updateError;

      if (operation) {
        await supabase.from("vessel_operations").update({ notes: inspectionNotes.trim() || null, updated_at: nowIso }).eq("id", operation.id);
      }

      const { error: eventError } = await supabase.from("trailer_events").insert({
        trailer_id: trailer.trailer_id ?? null,
        trailer_number: trailer.trailer_number,
        event_type: "vessel_inspection_completed",
        event_description: `Inspection completed for ${trailer.trailer_number ?? "trailer"}.`,
        old_value: { vessel_operation_trailer_id: trailer.id, status: trailer.status },
        new_value: { vessel_operation_trailer_id: trailer.id, status: "inspected", inspection_completed_at: nowIso },
      });

      if (eventError) console.error("Failed to save inspection completed event:", eventError);

      setTrailer((current) => current ? { ...current, status: "inspected", inspection_completed_at: nowIso, planning_notes: inspectionNotes.trim() || null } : current);
      setSuccess("Inspection completed.");
    } catch (completeErr) {
      console.error("Unable to complete inspection:", completeErr);
      setError("Unable to complete inspection.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">Loading inspection...</div>
      </main>
    );
  }

  if (!operation || !trailer) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-rose-500/30 bg-rose-500/10 p-6 text-sm text-rose-200">{error ?? "Inspection not found."}</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Inspection</h1>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">
                {operation.vessel_name ?? "Unnamed vessel"} - {trailer.trailer_number ?? "Trailer"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/dashboard/vessel-operations/${operation.id}/boat-check`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                Back to Boat Check
              </Link>
              <Link href={`/dashboard/new-arrival?vesselTrailerId=${trailer.id}`} className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20">
                Register Arrival
              </Link>
              <Link href={`/dashboard/vessel-operations/${operation.id}/summary`} className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20">
                Summary
              </Link>
            </div>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
        {success ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div> : null}

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">General Information</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Vessel</p><p className="mt-1 font-semibold text-white">{operation.vessel_name ?? "-"}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Trailer Number</p><p className="mt-1 font-semibold text-white">{trailer.trailer_number ?? "-"}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Customer</p><p className="mt-1 font-semibold text-white">{trailer.customer ?? "-"}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Booking Reference</p><p className="mt-1 font-semibold text-white">{trailer.booking_reference ?? "-"}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Priority</p><p className={`mt-1 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getVesselPriorityClass(trailer.priority_level)}`}>{getVesselPriorityLabel(trailer.priority_level)}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Priority Reason</p><p className="mt-1 font-semibold text-white">{trailer.priority_reason ?? "-"}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Planned Destination</p><p className="mt-1 font-semibold text-white">{trailer.planned_destination ?? "-"}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Arrived At</p><p className="mt-1 font-semibold text-white">{formatVesselDateTime(trailer.arrived_at)}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inspection Started At</p><p className="mt-1 font-semibold text-white">{formatVesselDateTime(trailer.inspection_started_at)}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inspection Completed At</p><p className="mt-1 font-semibold text-white">{formatVesselDateTime(trailer.inspection_completed_at)}</p></div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Positioning</p>
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-slate-200">Assign Position</label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setAutoPosition(true)} className={`rounded-2xl px-4 py-2 text-sm font-semibold ${autoPosition ? "bg-cyan-500 text-slate-950" : "border border-white/10 bg-slate-800 text-white"}`}>Auto</button>
                <button type="button" onClick={() => setAutoPosition(false)} className={`rounded-2xl px-4 py-2 text-sm font-semibold ${!autoPosition ? "bg-cyan-500 text-slate-950" : "border border-white/10 bg-slate-800 text-white"}`}>Manual</button>
              </div>
              <input value={positionValue} onChange={(event) => setPositionValue(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="P01" />
              <button type="button" onClick={() => void handleAssignPosition()} disabled={isSaving} className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60">
                Assign Position
              </button>
              <p className="text-sm text-slate-300">If the planned destination is Compound, this will validate a compound position and update the linked trailer record.</p>
              {trailer.assigned_position ? <p className="text-sm text-emerald-200">Current assigned position: {trailer.assigned_position}</p> : null}
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Damage Inspection</p>
            <div className="mt-4 grid gap-3">
              <input list="damage-types" value={damageForm.damageType} onChange={(event) => setDamageForm((current) => ({ ...current, damageType: event.target.value }))} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Damage Type" />
              <datalist id="damage-types">{DAMAGE_TYPES.map((option) => <option key={option} value={option} />)}</datalist>
              <input value={damageForm.damageLocation} onChange={(event) => setDamageForm((current) => ({ ...current, damageLocation: event.target.value }))} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Damage Location" />
              <input value={damageForm.severity} onChange={(event) => setDamageForm((current) => ({ ...current, severity: event.target.value }))} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Severity" />
              <textarea value={damageForm.description} onChange={(event) => setDamageForm((current) => ({ ...current, description: event.target.value }))} rows={3} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Description *" />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void addDamage()} disabled={isSaving} className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60">Add Damage</button>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {damages.length === 0 ? <p className="text-sm text-slate-400">No damages recorded.</p> : damages.map((damage) => (
                <div key={damage.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-sm text-slate-200">
                  <p className="font-semibold text-white">{damage.damage_type ?? "Damage"} - {damage.severity ?? "-"}</p>
                  <p className="mt-1 text-slate-300">{damage.damage_location ?? "-"}</p>
                  <p className="mt-1 text-slate-300">{damage.description ?? "-"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 bg-slate-900 px-2.5 py-1 text-xs">Recorded {formatVesselDateTime(damage.recorded_at)}</span>
                    <button type="button" onClick={() => void removeDamage(damage.id)} className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-200">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Temperature Readings</p>
            <div className="mt-4 grid gap-3">
              <input value={temperatureForm.temperatureValue} onChange={(event) => setTemperatureForm((current) => ({ ...current, temperatureValue: event.target.value }))} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Temperature Value *" />
              <div className="grid gap-3 sm:grid-cols-2">
                <select value={temperatureForm.unit} onChange={(event) => setTemperatureForm((current) => ({ ...current, unit: event.target.value as "C" | "F" }))} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none">
                  <option value="C">C</option>
                  <option value="F">F</option>
                </select>
                <input list="reading-points" value={temperatureForm.readingPoint} onChange={(event) => setTemperatureForm((current) => ({ ...current, readingPoint: event.target.value }))} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Reading Point" />
                <datalist id="reading-points">{READING_POINTS.map((option) => <option key={option} value={option} />)}</datalist>
              </div>
              <textarea value={temperatureForm.notes} onChange={(event) => setTemperatureForm((current) => ({ ...current, notes: event.target.value }))} rows={3} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Notes" />
              <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={temperatureForm.outOfRange} onChange={(event) => setTemperatureForm((current) => ({ ...current, outOfRange: event.target.checked }))} /> Out of Range</label>
              <button type="button" onClick={() => void addTemperature()} disabled={isSaving} className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60">Add Temperature</button>
            </div>

            <div className="mt-5 space-y-3">
              {temperatures.length === 0 ? <p className="text-sm text-slate-400">No temperatures recorded.</p> : temperatures.map((reading) => (
                <div key={reading.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-sm text-slate-200">
                  <p className="font-semibold text-white">{reading.temperature_value}{reading.unit ?? "C"} - {reading.reading_point ?? "-"}</p>
                  <p className="mt-1 text-slate-300">{reading.notes ?? "-"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {reading.out_of_range ? <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-200">Out of Range</span> : null}
                    <span className="rounded-full border border-white/10 bg-slate-900 px-2.5 py-1 text-xs">Recorded {formatVesselDateTime(reading.recorded_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Photos</p>
          <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
              <label className="mb-2 block text-sm font-medium text-slate-200">Category</label>
              <select value={photoForm.category} onChange={(event) => setPhotoForm((current) => ({ ...current, category: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none">
                {PHOTO_CATEGORIES.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <label className="mt-4 mb-2 block text-sm font-medium text-slate-200">Photo *</label>
              <input type="file" accept="image/*" capture="environment" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void uploadPhoto(file);
                  event.currentTarget.value = "";
                }
              }} className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" />
              <label className="mt-4 mb-2 block text-sm font-medium text-slate-200">Description</label>
              <textarea value={photoForm.description} onChange={(event) => setPhotoForm((current) => ({ ...current, description: event.target.value }))} rows={3} className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {photos.length === 0 ? <p className="text-sm text-slate-400">No photos uploaded.</p> : photos.map((photo) => (
                <button key={photo.id} type="button" onClick={() => photo.previewUrl && setSelectedPreview({ url: photo.previewUrl, title: photo.file_name ?? "Photo" })} className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70 text-left">
                  <div className="relative aspect-square w-full bg-slate-950">
                    {photo.previewUrl ? <Image src={photo.previewUrl} alt={photo.description ?? photo.file_name ?? "Inspection photo"} fill className="object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-slate-400">No preview</div>}
                  </div>
                  <div className="p-3 text-sm text-slate-200">
                    <p className="font-semibold text-white">{photo.category ?? "Photo"}</p>
                    <p className="mt-1 text-slate-300">{photo.description ?? "-"}</p>
                    <p className="mt-1 text-xs text-slate-400">{formatVesselDateTime(photo.uploaded_at)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">General Notes</p>
          <textarea value={inspectionNotes} onChange={(event) => setInspectionNotes(event.target.value)} rows={4} className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Inspection notes" />
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void handleCompleteInspection()} disabled={isSaving} className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60">Complete Inspection</button>
          </div>
        </section>

        {selectedPreview ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" onClick={() => setSelectedPreview(null)}>
            <div className="max-h-[90vh] max-w-5xl overflow-hidden rounded-3xl bg-slate-950 shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
                <p className="text-sm font-semibold text-white">{selectedPreview.title}</p>
                <button type="button" onClick={() => setSelectedPreview(null)} className="rounded-2xl border border-white/10 bg-slate-800 px-3 py-2 text-sm font-semibold text-white">Close</button>
              </div>
              <div className="relative max-h-[82vh] min-h-[320px] w-[90vw] max-w-5xl">
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
