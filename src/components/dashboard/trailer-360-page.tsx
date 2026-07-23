"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "@/components/print/print-button";
import { TrailerAuditLogTable } from "@/components/trailers/trailer-audit-log-table";
import { TrailerTimeline } from "@/components/trailers/trailer-timeline";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { loadTrailerAuditLog, type TrailerAuditRow } from "@/lib/trailer-audit-log";
import { getTrailerCurrentLocationLabel } from "@/lib/trailer-location";
import {
  getExportAllocationStatusClasses,
  getExportAllocationStatusLabel,
  normalizeExportAllocationStatus,
  type ExportAllocationRecord,
} from "@/lib/export-allocation";
import { getVesselInspectionProgressLabel, getVesselInspectionProgressState, type VesselInspectionPhotoRecord, type VesselTrailerStatus } from "@/lib/vessel-operations";
import {
  loadTrailerOperationalProfile,
  type TrailerOperationalProfile,
} from "@/lib/operations/trailer-operational-engine";

const PHOTO_SIGNED_URL_TTL_SECONDS = 60 * 60;

type PhotoView = VesselInspectionPhotoRecord & {
  previewUrl: string;
};

type VesselOperationTrailerDbRow = Database["public"]["Tables"]["vessel_operation_trailers"]["Row"];
type VesselOperationDbRow = Database["public"]["Tables"]["vessel_operations"]["Row"];
type VesselInspectionDamageDbRow = Database["public"]["Tables"]["vessel_inspection_damages"]["Row"];
type VesselInspectionTemperatureDbRow = Database["public"]["Tables"]["vessel_inspection_temperatures"]["Row"];

type ExportAllocationView = Pick<
  ExportAllocationRecord,
  | "id"
  | "customer"
  | "collection_address"
  | "haulier"
  | "booking_reference"
  | "priority"
  | "status"
  | "allocated_at"
  | "delivered_empty_at"
  | "waiting_loading_at"
  | "collected_loaded_at"
  | "completed_at"
  | "cancelled_at"
  | "expected_return_at"
  | "notes"
  | "created_at"
  | "updated_at"
>;

type VesselOperationGroup = {
  id: string;
  vesselName: string;
  sailingReference: string | null;
  originPort: string | null;
  expectedArrivalAt: string | null;
  actualArrivalAt: string | null;
  status: string;
  latestTrailer: TrailerOperationalProfile["vesselOperationTrailers"][number] | null;
  trailers: TrailerOperationalProfile["vesselOperationTrailers"];
};

type Trailer360PageProps = {
  trailerId: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const formatDate = (value?: string | null) => {
  if (!value) {
    return "—";
  }

  try {
    return new Date(value).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "—";
  }

  try {
    return new Date(value).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

const formatTemperature = (value?: number | string | null, unit?: string | null) => {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  return `${value}${unit ? ` ${unit}` : ""}`;
};

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const getLoadBadgeClass = (loadStatus?: string | null) => {
  const normalized = normalizeText(loadStatus);

  if (normalized === "empty") {
    return "border-emerald-400/30 bg-emerald-500/10 text-emerald-700";
  }

  if (normalized === "loaded") {
    return "border-amber-400/30 bg-amber-500/10 text-amber-700";
  }

  if (normalized.includes("maint")) {
    return "border-rose-400/30 bg-rose-500/10 text-rose-700";
  }

  return "border-slate-300 bg-slate-100 text-slate-700";
};

const getOperationalStatusLabel = (profile: TrailerOperationalProfile) => {
  if (profile.trailer?.departure_date) {
    return "Departed";
  }

  return profile.position.stageLabel || "Operational Status Pending";
};

const buildExportTimeline = (allocation: ExportAllocationView) => [
  { key: "allocated", label: "Allocated", value: allocation.allocated_at },
  { key: "delivered_empty", label: "Delivered Empty", value: allocation.delivered_empty_at },
  { key: "waiting_loading", label: "Waiting Loading", value: allocation.waiting_loading_at },
  { key: "collected_loaded", label: "Collected Loaded", value: allocation.collected_loaded_at },
  { key: "completed", label: "Completed", value: allocation.completed_at },
  { key: "cancelled", label: "Cancelled", value: allocation.cancelled_at },
].filter((item) => Boolean(item.value));

const buildInspectionSummary = (
  profile: TrailerOperationalProfile,
  photos: PhotoView[],
) => {
  const trailerRows = profile.vesselOperationTrailers;
  const latestTrailer = trailerRows[0] ?? null;
  const damages = profile.inspectionDamages;
  const temperatures = profile.inspectionTemperatures;
  const frontReading = temperatures.filter((row) => normalizeText(row.reading_point) === "front").sort((left, right) => (new Date(right.recorded_at ?? 0).getTime() - new Date(left.recorded_at ?? 0).getTime()))[0] ?? null;
  const rearReading = temperatures.filter((row) => normalizeText(row.reading_point) === "rear").sort((left, right) => (new Date(right.recorded_at ?? 0).getTime() - new Date(left.recorded_at ?? 0).getTime()))[0] ?? null;

  return {
    latestTrailer,
    completedAt: latestTrailer?.inspection_completed_at ?? null,
    startedAt: latestTrailer?.inspection_started_at ?? null,
    statusLabel: latestTrailer?.inspection_completed_at
      ? "Completed"
      : latestTrailer?.inspection_started_at
        ? "In Progress"
        : "Pending",
    hasDamage: Boolean(latestTrailer?.has_damage) || damages.length > 0,
    temperatureAlert: Boolean(latestTrailer?.has_temperature_alert) || temperatures.some((row) => row.is_out_of_range === true),
    damageCount: damages.length,
    photoCount: photos.length,
    frontReading,
    rearReading,
    damages,
    temperatures,
  };
};

export function Trailer360Page({ trailerId }: Trailer360PageProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "timeline">("timeline");
  const [profile, setProfile] = useState<TrailerOperationalProfile | null>(null);
  const [auditRows, setAuditRows] = useState<TrailerAuditRow[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [exportAllocations, setExportAllocations] = useState<ExportAllocationView[]>([]);
  const [photos, setPhotos] = useState<PhotoView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [vesselSectionError, setVesselSectionError] = useState<string | null>(null);
  const [inspectionSectionError, setInspectionSectionError] = useState<string | null>(null);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<{ url: string; title: string } | null>(null);

  const genericPageError = "Unable to load trailer details right now.";
  const genericVesselError = "Unable to load vessel operation details right now.";
  const genericInspectionError = "Unable to load inspection details right now.";
  const genericGalleryError = "Unable to load inspection photos right now.";

  const loadTrailer = useCallback(async () => {
    if (!trailerId) {
      setPageError("Trailer not found.");
      setIsLoading(false);
      return;
    }

    if (!UUID_PATTERN.test(trailerId)) {
      console.warn("Invalid trailer reference parameter:", trailerId);
      setPageError("Invalid trailer reference.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setPageError(null);
    setVesselSectionError(null);
    setInspectionSectionError(null);
    setGalleryError(null);

    try {
      const loadedProfile = await loadTrailerOperationalProfile(supabase, trailerId);
      const loadedAuditRows = await loadTrailerAuditLog({
        trailerId,
        timeFilter: "all",
        limit: 1200,
      });
      setAuditRows(loadedAuditRows);
      setAuditError(null);

      const allocationRows = loadedProfile.exportAllocations
        .map((row) => ({
          id: row.id,
          customer: row.customer ?? null,
          collection_address: row.collection_address ?? null,
          haulier: row.haulier ?? null,
          booking_reference: row.booking_reference ?? null,
          priority: (row.priority ?? "normal") as ExportAllocationView["priority"],
          status: normalizeExportAllocationStatus(row.status),
          allocated_at: row.allocated_at ?? null,
          delivered_empty_at: row.delivered_empty_at ?? null,
          waiting_loading_at: row.waiting_loading_at ?? null,
          collected_loaded_at: row.collected_loaded_at ?? null,
          completed_at: row.completed_at ?? null,
          cancelled_at: row.cancelled_at ?? null,
          expected_return_at: row.expected_return_at ?? null,
          notes: row.notes ?? null,
          created_at: row.created_at ?? null,
          updated_at: row.updated_at ?? null,
        }))
        .sort((left, right) => new Date(right.updated_at ?? right.created_at ?? 0).getTime() - new Date(left.updated_at ?? left.created_at ?? 0).getTime());
      setExportAllocations(allocationRows);

      const trailer = loadedProfile.trailer;
      let vesselTrailerRows: VesselOperationTrailerDbRow[] = [];
      let vesselOperationRows: VesselOperationDbRow[] = [];
      let damageRows: VesselInspectionDamageDbRow[] = [];
      let temperatureRows: VesselInspectionTemperatureDbRow[] = [];
      let photoRows: VesselInspectionPhotoRecord[] = [];

      if (trailer?.id) {
        const vesselTrailerResult = await supabase
          .from("vessel_operation_trailers")
          .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, load_description, temperature_required, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, priority_level, priority_reason, planned_destination, planning_notes, status, arrived_at, arrival_status, arrival_confirmed_at, arrival_record_id, arrival_confirmed_by, inspection_started_at, inspection_completed_at, position_assigned_at, assigned_position, has_damage, has_temperature_alert, created_at, updated_at")
          .eq("trailer_id", trailer.id)
          .order("created_at", { ascending: false });

        if (vesselTrailerResult.error) {
          setVesselSectionError(genericVesselError);
          vesselTrailerRows = [];
        } else {
          vesselTrailerRows = (vesselTrailerResult.data ?? []) as VesselOperationTrailerDbRow[];
        }

        const vesselOperationIds = Array.from(new Set(vesselTrailerRows.map((row) => row.vessel_operation_id).filter((value): value is string => Boolean(value))));

        if (vesselOperationIds.length > 0) {
          const vesselOperationResult = await supabase
            .from("vessel_operations")
            .select("id, vessel_name, sailing_reference, origin_port, berth, expected_arrival_at, actual_arrival_at, status, list_status, list_confirmed_at, list_confirmed_by, notes, created_at, updated_at")
            .in("id", vesselOperationIds);

          if (vesselOperationResult.error) {
            setVesselSectionError(genericVesselError);
            vesselOperationRows = [];
          } else {
            vesselOperationRows = (vesselOperationResult.data ?? []) as VesselOperationDbRow[];
          }
        }

        const vesselTrailerIds = vesselTrailerRows.map((row) => row.id).filter((value): value is string => Boolean(value));

        if (vesselTrailerIds.length > 0) {
          const [damageResult, temperatureResult, photoResult] = await Promise.all([
            supabase
              .from("vessel_inspection_damages")
              .select("id, vessel_trailer_id, trailer_id, trailer_number, damage_type, damage_location, severity, description, recorded_at, recorded_by")
              .in("vessel_trailer_id", vesselTrailerIds),
            supabase
              .from("vessel_inspection_temperatures")
              .select("id, vessel_trailer_id, trailer_id, trailer_number, temperature_value, temperature_unit, reading_point, notes, is_out_of_range, recorded_at, recorded_by")
              .in("vessel_trailer_id", vesselTrailerIds),
            supabase
              .from("vessel_inspection_photos")
              .select("id, vessel_trailer_id, category, storage_path, file_name, description, uploaded_at, uploaded_by")
              .in("vessel_trailer_id", vesselTrailerIds),
          ]);

          if (damageResult.error) {
            setInspectionSectionError(genericInspectionError);
            damageRows = [];
          } else {
            damageRows = (damageResult.data ?? []) as VesselInspectionDamageDbRow[];
          }

          if (temperatureResult.error) {
            setInspectionSectionError(genericInspectionError);
            temperatureRows = [];
          } else {
            temperatureRows = (temperatureResult.data ?? []) as VesselInspectionTemperatureDbRow[];
          }

          if (photoResult.error) {
            setGalleryError(genericGalleryError);
            photoRows = [];
          } else {
            photoRows = (photoResult.data ?? []) as VesselInspectionPhotoRecord[];
          }
        }
      }

      const hydratedProfile: TrailerOperationalProfile = {
        ...loadedProfile,
        vesselOperationTrailers: vesselTrailerRows,
        vesselOperations: vesselOperationRows,
        inspectionDamages: damageRows,
        inspectionTemperatures: temperatureRows,
      };
      setProfile(hydratedProfile);

      const mergedPhotos = [
        ...photoRows,
      ].filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index);

      const settledPhotoViews = await Promise.allSettled(
        mergedPhotos
          .filter((row) => Boolean(row.storage_path))
          .map(async (row) => {
            const storagePath = row.storage_path as string;
            const signedResult = await supabase.storage
              .from("vessel-inspection-photos")
              .createSignedUrl(storagePath, PHOTO_SIGNED_URL_TTL_SECONDS);
            const previewUrl =
              signedResult.data?.signedUrl ??
              supabase.storage.from("vessel-inspection-photos").getPublicUrl(storagePath).data.publicUrl;

            if (!previewUrl) {
              throw new Error(`Unable to resolve preview URL for photo ${row.id}`);
            }

            return {
              ...row,
              previewUrl,
            } satisfies PhotoView;
          }),
      );

      const failedPhotosCount = settledPhotoViews.filter((result) => result.status === "rejected").length;
      if (failedPhotosCount > 0) {
        setGalleryError(`Some photos could not be loaded (${failedPhotosCount}).`);
      }

      const resolvedPhotoViews = settledPhotoViews
        .filter((result) => result.status === "fulfilled")
        .map((result) => (result.status === "fulfilled" ? result.value : null))
        .filter((value): value is PhotoView => Boolean(value));

      setPhotos(
        resolvedPhotoViews.sort(
          (left, right) => new Date(right.uploaded_at ?? 0).getTime() - new Date(left.uploaded_at ?? 0).getTime(),
        ),
      );
    } catch (error) {
      console.error("Unable to load trailer 360 view:", error);
      setPageError(genericPageError);
      setProfile(null);
      setAuditRows([]);
      setAuditError("Unable to load trailer timeline.");
      setExportAllocations([]);
      setPhotos([]);
    } finally {
      setIsLoading(false);
    }
  }, [trailerId]);

  useEffect(() => {
    void loadTrailer();
  }, [loadTrailer]);

  const vesselOperationGroups = useMemo<VesselOperationGroup[]>(() => {
    if (!profile) {
      return [];
    }

    const operationsById = new Map(profile.vesselOperations.map((row) => [row.id, row]));
    const groups = new Map<string, VesselOperationGroup>();

    profile.vesselOperationTrailers.forEach((row) => {
      const operation = operationsById.get(row.vessel_operation_id);
      if (!operation) {
        return;
      }

      const existing = groups.get(operation.id) ?? {
        id: operation.id,
        vesselName: operation.vessel_name ?? "Unnamed vessel",
        sailingReference: operation.sailing_reference ?? null,
        originPort: operation.origin_port ?? null,
        expectedArrivalAt: operation.expected_arrival_at ?? null,
        actualArrivalAt: operation.actual_arrival_at ?? null,
        status: operation.status,
        latestTrailer: null,
        trailers: [],
      };

      existing.trailers.push(row);
      groups.set(operation.id, existing);
    });

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        trailers: [...group.trailers].sort((left, right) => new Date(right.created_at ?? right.updated_at ?? 0).getTime() - new Date(left.created_at ?? left.updated_at ?? 0).getTime()),
      }))
      .map((group) => ({
        ...group,
        latestTrailer:
          group.trailers.find((row) => row.trailer_id === profile.trailer?.id) ??
          group.trailers.find((row) => normalizeText(row.trailer_number) === normalizeText(profile.trailer?.trailer_number)) ??
          group.trailers[0] ??
          null,
      }))
      .sort((left, right) => new Date(right.actualArrivalAt ?? right.expectedArrivalAt ?? 0).getTime() - new Date(left.actualArrivalAt ?? left.expectedArrivalAt ?? 0).getTime());
  }, [profile]);

  const latestExportAllocation = exportAllocations[0] ?? null;
  const inspectionSummary = useMemo(() => (profile ? buildInspectionSummary(profile, photos) : null), [photos, profile]);
  const currentLocation = profile
    ? getTrailerCurrentLocationLabel({
        departureDate: profile.trailer?.departure_date,
        isLocal: profile.trailer?.is_local,
        compoundPosition: profile.position.compoundPosition,
        waitingForCompound: profile.position.operationalStage === "hold",
        exportLocation: profile.position.currentLocation?.includes("Export") ? profile.position.currentLocation : null,
        fallbackLocation: profile.position.currentLocation,
      })
    : "—";
  const currentStatus = profile ? getOperationalStatusLabel(profile) : "—";
  const loadBadgeClass = getLoadBadgeClass(profile?.trailer?.load_status);

  const trailer = profile?.trailer ?? null;

  const getInspectionStatusLabel = (row: TrailerOperationalProfile["vesselOperationTrailers"][number]) =>
    getVesselInspectionProgressLabel(
      getVesselInspectionProgressState({
        status: (row.status ?? "expected") as VesselTrailerStatus,
        inspection_started_at: row.inspection_started_at ?? null,
        inspection_completed_at: row.inspection_completed_at ?? null,
        has_damage: row.has_damage ?? null,
        has_temperature_alert: row.has_temperature_alert ?? null,
      }),
    );

  const getPhotoPreview = async (photo: PhotoView) => {
    setGalleryError(null);

    try {
      const storagePath = photo.storage_path?.trim();
      if (!storagePath) {
        throw new Error("Photo path missing.");
      }

      const signedResult = await supabase.storage
        .from("vessel-inspection-photos")
        .createSignedUrl(storagePath, PHOTO_SIGNED_URL_TTL_SECONDS);

      const refreshedUrl =
        signedResult.data?.signedUrl ??
        supabase.storage.from("vessel-inspection-photos").getPublicUrl(storagePath).data.publicUrl;

      if (!refreshedUrl) {
        throw new Error("Unable to refresh photo URL.");
      }

      setPhotos((current) =>
        current.map((row) => (row.id === photo.id ? { ...row, previewUrl: refreshedUrl } : row)),
      );
      setSelectedPreview({ url: refreshedUrl, title: photo.file_name ?? "Inspection photo" });
    } catch (previewError) {
      if (photo.previewUrl) {
        setSelectedPreview({ url: photo.previewUrl, title: photo.file_name ?? "Inspection photo" });
        setGalleryError("Photo URL could not be refreshed, but a previous preview is available.");
        return null;
      }

      setGalleryError("Unable to open selected photo.");
    }

    return null;
  };

  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
          Loading trailer record...
        </div>
      </main>
    );
  }

  if (pageError || !profile || !trailer) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {pageError ?? "Trailer not found."}
          </div>
          <Link href="/dashboard/search" className="inline-flex rounded-2xl border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">
            Back to Search
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Ferryspeed TrailerHub</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Trailer 360°</h1>
                <p className="mt-2 text-sm text-slate-500">Single operational record for trailer {trailer.trailer_number ?? "—"}.</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${loadBadgeClass}`}>{trailer.load_status ?? "Unknown"}</span>
                <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{currentStatus}</span>
                <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{profile.fleetStatus}</span>
                <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{trailer.is_local ? "Local Trailer" : "Compound Trailer"}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/search" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Link>
              <PrintButton label="Print Trailer Record" disabled={false} />
            </div>
          </div>
        </header>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("timeline")}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === "timeline"
                  ? "bg-cyan-600 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              Timeline
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("overview")}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === "overview"
                  ? "bg-cyan-600 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              Overview
            </button>
          </div>
        </section>

        {activeTab === "timeline" ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Trailer Timeline</p>
            <p className="mt-2 text-sm text-slate-600">Audit history for trailer {trailer.trailer_number ?? "-"}.</p>
            <div className="mt-4">
              <TrailerAuditLogTable
                rows={auditRows}
                isLoading={isLoading}
                error={auditError}
                emptyLabel="No timeline events found for this trailer."
              />
            </div>
          </section>
        ) : null}

        {activeTab === "overview" ? (
          <>

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Identification</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Trailer Number</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{trailer.trailer_number ?? "—"}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Trailer Type</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{trailer.trailer_type ?? "—"}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Current Operational Status</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{currentStatus}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Load Status</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{trailer.load_status ?? "—"}</p>
              </div>
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Key Details</p>
            <div className="mt-3 space-y-3 text-sm text-slate-700">
              <div className="flex items-start justify-between gap-4 rounded-2xl bg-slate-50 p-4">
                <span>Current Location</span>
                <span className="font-semibold text-slate-950">{currentLocation}</span>
              </div>
              <div className="flex items-start justify-between gap-4 rounded-2xl bg-slate-50 p-4">
                <span>Compound Position</span>
                <span className="font-semibold text-slate-950">{trailer.compound_position ?? profile.position.compoundPosition ?? "—"}</span>
              </div>
              <div className="flex items-start justify-between gap-4 rounded-2xl bg-slate-50 p-4">
                <span>Customer</span>
                <span className="font-semibold text-slate-950">{profile.position.customer ?? trailer.customer ?? "—"}</span>
              </div>
              <div className="flex items-start justify-between gap-4 rounded-2xl bg-slate-50 p-4">
                <span>Consignee</span>
                <span className="font-semibold text-slate-950">{trailer.consignee ?? "—"}</span>
              </div>
              <div className="flex items-start justify-between gap-4 rounded-2xl bg-slate-50 p-4">
                <span>Container Number</span>
                <span className="font-semibold text-slate-950">{trailer.container_number ?? "—"}</span>
              </div>
              <div className="flex items-start justify-between gap-4 rounded-2xl bg-slate-50 p-4">
                <span>Load Description</span>
                <span className="font-semibold text-slate-950">{trailer.load_description?.trim() || "—"}</span>
              </div>
              <div className="flex items-start justify-between gap-4 rounded-2xl bg-slate-50 p-4">
                <span>Notes</span>
                <span className="font-semibold text-slate-950">{trailer.notes?.trim() || "—"}</span>
              </div>
            </div>
          </article>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Status Timeline</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Arrival Date</p>
                <p className="mt-2 text-base font-semibold text-slate-950">{formatDate(trailer.arrival_date)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Arrival Time</p>
                <p className="mt-2 text-base font-semibold text-slate-950">{trailer.arrival_date ? formatDateTime(trailer.arrival_date).split(", ").at(-1) ?? "—" : "—"}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Departure Date</p>
                <p className="mt-2 text-base font-semibold text-slate-950">{formatDate(trailer.departure_date)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Departure Time</p>
                <p className="mt-2 text-base font-semibold text-slate-950">{trailer.departure_time ?? "—"}</p>
              </div>
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Operational Status</p>
            <div className="mt-3 space-y-3 text-sm text-slate-700">
              <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-4">
                <span>Location Type</span>
                <span className="font-semibold text-slate-950">{trailer.is_local ? "Local Trailer" : profile.position.compoundPosition ? `Compound – ${profile.position.compoundPosition}` : profile.position.operationalStage === "hold" ? "Waiting for Compound" : "Operational"}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-4">
                <span>Active / Departed</span>
                <span className="font-semibold text-slate-950">{trailer.departure_date ? "Departed" : "Active"}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-4">
                <span>Waiting for Compound</span>
                <span className="font-semibold text-slate-950">{!trailer.is_local && !profile.position.compoundPosition && profile.position.operationalStage === "hold" ? "Yes" : "No"}</span>
              </div>
            </div>
          </article>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Vessel Operations</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">Latest and historical vessel links</h2>
            </div>
            <p className="text-sm text-slate-500">{profile.vesselOperationTrailers.length} related vessel trailer record{profile.vesselOperationTrailers.length === 1 ? "" : "s"}</p>
          </div>

          {vesselSectionError ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {vesselSectionError}
            </div>
          ) : null}

          {vesselOperationGroups.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No vessel operations are linked to this trailer yet.</div>
          ) : (
            <div className="mt-4 space-y-4">
              {vesselOperationGroups.map((group, index) => {
                const latestTrailer = group.latestTrailer;
                const inspectionState = latestTrailer ? getInspectionStatusLabel(latestTrailer) : "—";
                const isLatest = index === 0;

                return (
                  <article key={group.id} className={`rounded-2xl border p-5 ${isLatest ? "border-cyan-200 bg-cyan-50" : "border-slate-200 bg-slate-50"}`}>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-semibold text-slate-950">{group.vesselName}</h3>
                          {isLatest ? <span className="rounded-full border border-cyan-200 bg-white px-3 py-1 text-xs font-semibold text-cyan-700">Latest</span> : null}
                        </div>
                        <p className="mt-1 text-sm text-slate-600">{group.sailingReference ?? "—"} {group.originPort ? `• ${group.originPort}` : ""}</p>
                      </div>
                      <Link href={`/dashboard/vessel-operations/${group.id}`} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Open Vessel Operation</Link>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl bg-white p-4">
                        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Expected Arrival</p>
                        <p className="mt-2 font-semibold text-slate-950">{formatDateTime(group.expectedArrivalAt)}</p>
                      </div>
                      <div className="rounded-2xl bg-white p-4">
                        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Actual Arrival</p>
                        <p className="mt-2 font-semibold text-slate-950">{formatDateTime(group.actualArrivalAt)}</p>
                      </div>
                      <div className="rounded-2xl bg-white p-4">
                        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Vessel Status</p>
                        <p className="mt-2 font-semibold text-slate-950">{group.status}</p>
                      </div>
                      <div className="rounded-2xl bg-white p-4">
                        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Inspection Status</p>
                        <p className="mt-2 font-semibold text-slate-950">{inspectionState}</p>
                      </div>
                    </div>

                    {latestTrailer ? (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <div className="rounded-2xl bg-white p-4">
                          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Trailer Arrival Status</p>
                          <p className="mt-2 font-semibold text-slate-950">{latestTrailer.arrival_status ?? "—"}</p>
                        </div>
                        <div className="rounded-2xl bg-white p-4">
                          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Arrived At</p>
                          <p className="mt-2 font-semibold text-slate-950">{formatDateTime(latestTrailer.arrived_at ?? latestTrailer.arrival_confirmed_at)}</p>
                        </div>
                        <div className="rounded-2xl bg-white p-4">
                          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Priority</p>
                          <p className="mt-2 font-semibold text-slate-950">{latestTrailer.priority_level ?? "—"}</p>
                        </div>
                        <div className="rounded-2xl bg-white p-4">
                          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Planned Destination</p>
                          <p className="mt-2 font-semibold text-slate-950">{latestTrailer.planned_destination ?? "—"}</p>
                        </div>
                        <div className="rounded-2xl bg-white p-4">
                          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Assigned Position</p>
                          <p className="mt-2 font-semibold text-slate-950">{latestTrailer.assigned_position ?? "—"}</p>
                        </div>
                        <div className="rounded-2xl bg-white p-4">
                          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Inspection Progress</p>
                          <p className="mt-2 font-semibold text-slate-950">{getInspectionStatusLabel(latestTrailer)}</p>
                        </div>
                      </div>
                    ) : null}

                    {group.trailers.length > 1 ? (
                      <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                        <summary className="cursor-pointer text-sm font-semibold text-slate-700">Earlier records</summary>
                        <div className="mt-4 space-y-3">
                          {group.trailers.slice(1).map((row) => (
                            <div key={row.id} className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                              <p className="font-semibold text-slate-950">{row.arrival_status ?? row.status ?? "Vessel trailer"}</p>
                              <p className="mt-1">Arrival: {formatDateTime(row.arrived_at ?? row.arrival_confirmed_at)} | Position: {row.assigned_position ?? "—"} | Inspection: {getInspectionStatusLabel(row)}</p>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Export Operations</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">Current and historical export allocations</h2>
            </div>
            <p className="text-sm text-slate-500">{exportAllocations.length} export allocation{exportAllocations.length === 1 ? "" : "s"}</p>
          </div>

          {exportAllocations.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No export operations are linked to this trailer.</div>
          ) : (
            <div className="mt-4 space-y-4">
              {exportAllocations.map((allocation, index) => {
                const timeline = buildExportTimeline(allocation);
                const isLatest = index === 0;

                return (
                  <article key={allocation.id} className={`rounded-2xl border p-5 ${isLatest ? "border-orange-200 bg-orange-50" : "border-slate-200 bg-slate-50"}`}>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-semibold text-slate-950">{allocation.customer ?? allocation.booking_reference ?? "Export Allocation"}</h3>
                          {isLatest ? <span className="rounded-full border border-orange-200 bg-white px-3 py-1 text-xs font-semibold text-orange-700">Latest</span> : null}
                        </div>
                        <p className="mt-1 text-sm text-slate-600">{allocation.booking_reference ?? "—"}</p>
                      </div>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getExportAllocationStatusClasses(allocation.status)}`}>{getExportAllocationStatusLabel(allocation.status)}</span>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl bg-white p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Collection Address</p><p className="mt-2 font-semibold text-slate-950">{allocation.collection_address ?? "—"}</p></div>
                      <div className="rounded-2xl bg-white p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Haulier</p><p className="mt-2 font-semibold text-slate-950">{allocation.haulier ?? "—"}</p></div>
                      <div className="rounded-2xl bg-white p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Priority</p><p className="mt-2 font-semibold text-slate-950">{allocation.priority ?? "—"}</p></div>
                      <div className="rounded-2xl bg-white p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Expected Return</p><p className="mt-2 font-semibold text-slate-950">{formatDateTime(allocation.expected_return_at)}</p></div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <div className="rounded-2xl bg-white p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Allocated At</p><p className="mt-2 font-semibold text-slate-950">{formatDateTime(allocation.allocated_at)}</p></div>
                      <div className="rounded-2xl bg-white p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Delivered Empty</p><p className="mt-2 font-semibold text-slate-950">{formatDateTime(allocation.delivered_empty_at)}</p></div>
                      <div className="rounded-2xl bg-white p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Waiting Loading</p><p className="mt-2 font-semibold text-slate-950">{formatDateTime(allocation.waiting_loading_at)}</p></div>
                      <div className="rounded-2xl bg-white p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Collected Loaded</p><p className="mt-2 font-semibold text-slate-950">{formatDateTime(allocation.collected_loaded_at)}</p></div>
                      <div className="rounded-2xl bg-white p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Completed</p><p className="mt-2 font-semibold text-slate-950">{formatDateTime(allocation.completed_at)}</p></div>
                      <div className="rounded-2xl bg-white p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Cancelled</p><p className="mt-2 font-semibold text-slate-950">{formatDateTime(allocation.cancelled_at)}</p></div>
                    </div>

                    {allocation.notes?.trim() ? <p className="mt-4 rounded-2xl bg-white p-4 text-sm text-slate-700">{allocation.notes}</p> : null}

                    {timeline.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {timeline.map((step) => (
                          <div key={step.key} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                            {step.label}: {formatDateTime(step.value)}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Inspection Summary</p>
          {inspectionSectionError ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {inspectionSectionError}
            </div>
          ) : null}
          {!inspectionSummary ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No inspection data available yet.</div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Inspection Status</p><p className="mt-2 font-semibold text-slate-950">{inspectionSummary.statusLabel}</p></div>
              <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Inspection Started</p><p className="mt-2 font-semibold text-slate-950">{formatDateTime(inspectionSummary.startedAt)}</p></div>
              <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Inspection Completed</p><p className="mt-2 font-semibold text-slate-950">{formatDateTime(inspectionSummary.completedAt)}</p></div>
              <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Damage / Temp Alert</p><p className="mt-2 font-semibold text-slate-950">{inspectionSummary.hasDamage ? "Damage" : "No damage"} / {inspectionSummary.temperatureAlert ? "Alert" : "Clear"}</p></div>
              <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Damage Count</p><p className="mt-2 font-semibold text-slate-950">{inspectionSummary.damageCount}</p></div>
              <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Photo Count</p><p className="mt-2 font-semibold text-slate-950">{inspectionSummary.photoCount}</p></div>
              <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Front Temperature</p><p className="mt-2 font-semibold text-slate-950">{formatTemperature(inspectionSummary.frontReading?.temperature_value, inspectionSummary.frontReading?.temperature_unit)}</p></div>
              <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Rear Temperature</p><p className="mt-2 font-semibold text-slate-950">{formatTemperature(inspectionSummary.rearReading?.temperature_value, inspectionSummary.rearReading?.temperature_unit)}</p></div>
            </div>
          )}

          {inspectionSummary?.damages.length ? (
            <div className="mt-5">
              <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Damage Records</h3>
              <div className="mt-3 space-y-3">
                {inspectionSummary.damages.map((damage) => (
                  <div key={damage.id} className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                    <p className="font-semibold text-slate-950">{damage.damage_type ?? "Damage"}</p>
                    <p className="mt-1">Location: {damage.damage_location ?? "—"} | Severity: {damage.severity ?? "—"}</p>
                    <p className="mt-1">{damage.description ?? "—"}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">Recorded {formatDateTime(damage.recorded_at)}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {inspectionSummary?.temperatures.length ? (
            <div className="mt-5">
              <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Temperature Records</h3>
              <div className="mt-3 space-y-3">
                {inspectionSummary.temperatures.map((temperature) => (
                  <div key={temperature.id} className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                    <p className="font-semibold text-slate-950">{temperature.reading_point ?? "Reading"} - {formatTemperature(temperature.temperature_value, temperature.temperature_unit)}</p>
                    <p className="mt-1">Out of range: {temperature.is_out_of_range ? "Yes" : "No"}</p>
                    <p className="mt-1">Notes: {temperature.notes?.trim() || "—"}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">Recorded {formatDateTime(temperature.recorded_at)}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Photo Gallery</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">Inspection photos</h2>
            </div>
            <p className="text-sm text-slate-500">{photos.length} photo{photos.length === 1 ? "" : "s"}</p>
          </div>

          {galleryError ? <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{galleryError}</div> : null}

          {photos.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No inspection photos are available for this trailer.</div>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {photos.map((photo) => (
                <button key={photo.id} type="button" onClick={() => void getPhotoPreview(photo)} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <div className="relative aspect-square w-full bg-slate-100">
                    {photo.previewUrl ? <Image src={photo.previewUrl} alt={photo.file_name ?? "Inspection photo"} fill className="object-cover" /> : null}
                  </div>
                  <div className="space-y-1 p-4 text-xs text-slate-600">
                    <p className="text-sm font-semibold text-slate-950">{photo.file_name ?? photo.category ?? "Photo"}</p>
                    <p>{photo.category ?? "Saved"}</p>
                    <p>{photo.description?.trim() || "No description"}</p>
                    <p>{formatDateTime(photo.uploaded_at)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <TrailerTimeline events={profile.events} />

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Full History</p>
          <div className="mt-3 text-sm text-slate-600">
            Combined trailer events, vessel milestones, export milestones, inspection findings and departure records are shown in the timeline above.
          </div>
        </section>
          </>
        ) : null}

        {selectedPreview ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true" onClick={() => setSelectedPreview(null)}>
            <div className="max-h-[90vh] max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-950">{selectedPreview.title}</p>
                <button type="button" onClick={() => setSelectedPreview(null)} className="rounded-2xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">Close</button>
              </div>
              <div className="relative h-[70vh] w-[85vw] max-w-5xl bg-slate-100">
                <Image src={selectedPreview.url} alt={selectedPreview.title} fill className="object-contain" />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
