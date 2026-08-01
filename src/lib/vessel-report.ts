import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getDefaultTemperatureToleranceSettings, isTemperatureOutOfRange } from "@/lib/temperature-tolerance";
import { getTrailerOwnershipType, normalizeTrailerNumberForOwnership } from "@/lib/trailer-ownership";
import type { TemperatureResult, VesselOperationalReportData } from "@/lib/reports/types";

type TrailerRow = Database["public"]["Tables"]["vessel_operation_trailers"]["Row"];
type MainTrailerRow = Pick<
  Database["public"]["Tables"]["trailers"]["Row"],
  | "id"
  | "trailer_number"
  | "load_status"
  | "customer"
  | "compound_position"
  | "notes"
  | "is_local"
  | "trailer_source"
  | "external_company"
  | "operational_status"
  | "arrival_date"
  | "departure_date"
>;
type DamageRow = Database["public"]["Tables"]["vessel_inspection_damages"]["Row"];
type TemperatureRow = Database["public"]["Tables"]["vessel_inspection_temperatures"]["Row"];
type PhotoRow = Database["public"]["Tables"]["vessel_inspection_photos"]["Row"];
type ExportAllocationRow = Database["public"]["Tables"]["export_allocations"]["Row"];
type OperationalAlertRow = Database["public"]["Tables"]["operational_alerts"]["Row"];
type TrailerActivityRow = Database["public"]["Tables"]["trailer_activity_log"]["Row"];

type TemperatureLimits = {
  min: number | null;
  max: number | null;
};

const PHOTO_SIGNED_URL_TTL_SECONDS = 60 * 60;
const PHOTO_BUCKET = "vessel-inspection-photos";
const PHOTO_URL_WAIT_TIMEOUT_MS = 6_000;

const normalizeTrailerNumber = (value?: string | null) => (value ?? "").trim().toUpperCase();

const parseTemperatureLimits = (value?: string | null): TemperatureLimits => {
  if (!value) {
    return { min: null, max: null };
  }

  const matches = value.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) {
    return { min: null, max: null };
  }

  const numbers = matches.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (numbers.length === 0) {
    return { min: null, max: null };
  }

  if (numbers.length === 1) {
    return { min: numbers[0], max: numbers[0] };
  }

  const sorted = [...numbers].sort((left, right) => left - right);
  return { min: sorted[0], max: sorted[1] };
};

const parseLegacyFrontExpectedTemperature = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const direct = Number(value);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const getExpectedTemperatureForReading = (trailer: TrailerRow, readingPoint?: string | null) => {
  const point = (readingPoint ?? "").trim().toLowerCase();

  if (point === "front") {
    if (typeof trailer.expected_front_temperature === "number" && Number.isFinite(trailer.expected_front_temperature)) {
      return trailer.expected_front_temperature;
    }

    return parseLegacyFrontExpectedTemperature(trailer.temperature_required);
  }

  if (point === "rear") {
    if (typeof trailer.expected_rear_temperature === "number" && Number.isFinite(trailer.expected_rear_temperature)) {
      return trailer.expected_rear_temperature;
    }

    return null;
  }

  return null;
};

const getTemperatureResult = (row: TemperatureRow, limits: TemperatureLimits, expectedTemperature: number | null): TemperatureResult => {
  const value = row.temperature_value;

  if (value === null || value === undefined) {
    return "not_assessed";
  }

  if (row.is_out_of_range === true) {
    return "fail";
  }

  if (expectedTemperature !== null) {
    const tolerance = getDefaultTemperatureToleranceSettings();
    return isTemperatureOutOfRange(value, expectedTemperature, tolerance) ? "fail" : "pass";
  }

  if (limits.min !== null && value < limits.min) {
    return "fail";
  }

  if (limits.max !== null && value > limits.max) {
    return "fail";
  }

  return "pass";
};

const toIso = (value?: string | null) => (value ? new Date(value).toISOString() : null);

const extractStoragePathFromUrl = (urlValue: string) => {
  try {
    const parsed = new URL(urlValue);
    const marker = `/${PHOTO_BUCKET}/`;
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex === -1) {
      return null;
    }

    const rawPath = parsed.pathname.slice(markerIndex + marker.length);
    if (!rawPath) {
      return null;
    }

    return decodeURIComponent(rawPath);
  } catch {
    return null;
  }
};

const normalizePhotoStoragePath = (storagePath?: string | null) => {
  const trimmed = storagePath?.trim() ?? "";
  if (!trimmed) {
    return { path: null, passthroughUrl: null };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const extractedPath = extractStoragePathFromUrl(trimmed);
    return {
      path: extractedPath,
      passthroughUrl: extractedPath ? null : trimmed,
    };
  }

  return { path: trimmed, passthroughUrl: null };
};

const resolvePhotoUrl = async (supabase: SupabaseClient<Database>, storagePath?: string | null) => {
  const normalized = normalizePhotoStoragePath(storagePath);
  if (normalized.passthroughUrl) {
    return normalized.passthroughUrl;
  }

  if (!normalized.path) {
    return null;
  }

  try {
    const signedResult = await Promise.race([
      supabase.storage.from(PHOTO_BUCKET).createSignedUrl(normalized.path, PHOTO_SIGNED_URL_TTL_SECONDS),
      new Promise<{ data: { signedUrl?: string | null } | null; error: Error }>((resolve) => {
        setTimeout(() => resolve({ data: null, error: new Error("Timed out while signing photo URL.") }), PHOTO_URL_WAIT_TIMEOUT_MS);
      }),
    ]);

    if (signedResult.data?.signedUrl) {
      return signedResult.data.signedUrl;
    }
  } catch {
    return null;
  }

  const publicUrl = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(normalized.path).data.publicUrl;
  return publicUrl || null;
};

const buildPhotoLookup = (rows: PhotoRow[]) => {
  const byVesselTrailerId = new Map<string, PhotoRow[]>();
  const byTrailerId = new Map<string, PhotoRow[]>();
  const byTrailerNumber = new Map<string, PhotoRow[]>();

  rows.forEach((row) => {
    if (row.vessel_trailer_id) {
      const existing = byVesselTrailerId.get(row.vessel_trailer_id) ?? [];
      existing.push(row);
      byVesselTrailerId.set(row.vessel_trailer_id, existing);
    }

    if (row.trailer_id) {
      const existing = byTrailerId.get(row.trailer_id) ?? [];
      existing.push(row);
      byTrailerId.set(row.trailer_id, existing);
    }

    const trailerNumber = normalizeTrailerNumberForOwnership(row.trailer_number);
    if (trailerNumber) {
      const existing = byTrailerNumber.get(trailerNumber) ?? [];
      existing.push(row);
      byTrailerNumber.set(trailerNumber, existing);
    }
  });

  return { byVesselTrailerId, byTrailerId, byTrailerNumber };
};

const collectPhotosForTrailer = (
  lookup: ReturnType<typeof buildPhotoLookup>,
  trailer: Pick<TrailerRow, "id" | "trailer_id" | "arrival_record_id" | "trailer_number">,
  mainTrailer: MainTrailerRow | null,
) => {
  const trailerNumber = normalizeTrailerNumberForOwnership(mainTrailer?.trailer_number ?? trailer.trailer_number);
  const trailerIdCandidates = new Set(
    [trailer.trailer_id, trailer.arrival_record_id].filter((value): value is string => Boolean(value)),
  );

  const isEligibleForTrailerIdFallback = (row: PhotoRow) => {
    if (row.vessel_trailer_id && row.vessel_trailer_id !== trailer.id) {
      return false;
    }

    return true;
  };

  const isEligibleForTrailerNumberFallback = (row: PhotoRow) => {
    if (row.vessel_trailer_id && row.vessel_trailer_id !== trailer.id) {
      return false;
    }

    if (row.trailer_id && !trailerIdCandidates.has(row.trailer_id)) {
      return false;
    }

    return true;
  };

  const candidateRows = [
    ...(trailer.id ? lookup.byVesselTrailerId.get(trailer.id) ?? [] : []),
    ...(trailer.trailer_id ? (lookup.byTrailerId.get(trailer.trailer_id) ?? []).filter(isEligibleForTrailerIdFallback) : []),
    ...(trailer.arrival_record_id ? (lookup.byTrailerId.get(trailer.arrival_record_id) ?? []).filter(isEligibleForTrailerIdFallback) : []),
    ...(trailerNumber ? (lookup.byTrailerNumber.get(trailerNumber) ?? []).filter(isEligibleForTrailerNumberFallback) : []),
  ];

  const deduped = new Map<string, PhotoRow>();
  candidateRows.forEach((row) => {
    if (!deduped.has(row.id)) {
      deduped.set(row.id, row);
    }
  });

  return Array.from(deduped.values()).sort((left, right) => {
    const leftTime = new Date(left.uploaded_at ?? 0).getTime();
    const rightTime = new Date(right.uploaded_at ?? 0).getTime();
    return leftTime - rightTime;
  });
};

const formatArrivalStatus = (value?: string | null) => {
  if (value === "not_discharged") return "Not Discharged";
  if (value === "cancelled") return "Cancelled";
  if (value === "no_show") return "No Show";
  if (value === "available_for_arrival" || value === "expected") return "Pending";
  if (value === "arrived") return "Arrived";
  if (value === "not_arrived") return "Not Arrived";
  return value ?? "Unknown";
};

const formatReceptionStatus = (trailer: TrailerRow, mainTrailer?: MainTrailerRow | null) => {
  if (mainTrailer?.is_local === true) {
    return "Local Trailer";
  }

  if (mainTrailer?.compound_position?.trim() || trailer.assigned_position?.trim()) {
    return "Received in Compound";
  }

  if (trailer.arrival_record_id || trailer.trailer_id) {
    return "Received";
  }

  if (trailer.arrival_status === "arrived") {
    return "Awaiting Reception";
  }

  return "Pending Reception";
};

export async function getVesselOperationReport(
  supabase: SupabaseClient<Database>,
  vesselOperationId: string,
): Promise<VesselOperationalReportData> {
  const [operationResult, trailersResult] = await Promise.all([
    supabase
      .from("vessel_operations")
      .select("id, vessel_name, sailing_reference, origin_port, berth, expected_arrival_at, actual_arrival_at, status, list_status, list_confirmed_at, list_confirmed_by, notes, created_at, updated_at")
      .eq("id", vesselOperationId)
      .single(),
    supabase
      .from("vessel_operation_trailers")
      .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, temperature_required, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, priority_level, planning_notes, added_after_confirmation, status, arrived_at, arrival_status, arrival_confirmed_at, arrival_record_id, arrival_confirmed_by, inspection_started_at, inspection_completed_at, position_assigned_at, assigned_position, has_damage, has_temperature_alert")
      .eq("vessel_operation_id", vesselOperationId)
      .order("created_at", { ascending: true }),
  ]);

  if (operationResult.error || !operationResult.data) {
    console.error("Load vessel report failed: operation", operationResult.error);
    throw new Error("Unable to load report.");
  }

  if (trailersResult.error) {
    console.error("Load vessel report failed: trailers", trailersResult.error);
    throw new Error("Unable to load report.");
  }

  const trailers = (trailersResult.data ?? []) as TrailerRow[];
  const vesselTrailerIds = trailers.map((row) => row.id);
  const mainTrailerIds = Array.from(
    new Set(
      trailers
        .map((row) => row.arrival_record_id ?? row.trailer_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const [mainTrailersResult, photosResult, damagesResult, temperaturesResult] = await Promise.all([
    mainTrailerIds.length
      ? supabase
          .from("trailers")
          .select("id, trailer_number, load_status, customer, compound_position, notes, is_local, trailer_source, external_company, operational_status, arrival_date, departure_date")
          .in("id", mainTrailerIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("vessel_inspection_photos")
      .select("id, vessel_trailer_id, trailer_id, trailer_number, vessel_operation_id, category, storage_path, file_name, description, uploaded_at, uploaded_by")
      .eq("vessel_operation_id", vesselOperationId)
      .order("uploaded_at", { ascending: true })
      .limit(2000),
    vesselTrailerIds.length
      ? supabase
          .from("vessel_inspection_damages")
          .select("id, vessel_trailer_id, trailer_id, trailer_number, damage_type, damage_location, severity, description, recorded_at, recorded_by")
          .in("vessel_trailer_id", vesselTrailerIds)
          .order("recorded_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    vesselTrailerIds.length
      ? supabase
          .from("vessel_inspection_temperatures")
          .select("id, vessel_trailer_id, trailer_id, trailer_number, temperature_value, temperature_unit, reading_point, notes, is_out_of_range, recorded_at")
          .in("vessel_trailer_id", vesselTrailerIds)
          .order("recorded_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (mainTrailersResult.error || photosResult.error || damagesResult.error || temperaturesResult.error) {
    console.error("Load vessel report failed:", {
      mainTrailersError: mainTrailersResult.error,
      photosError: photosResult.error,
      damagesError: damagesResult.error,
      temperaturesError: temperaturesResult.error,
    });
    throw new Error("Unable to load report.");
  }

  const mainTrailers = (mainTrailersResult.data ?? []) as MainTrailerRow[];
  const damages = (damagesResult.data ?? []) as DamageRow[];
  const temperatures = (temperaturesResult.data ?? []) as TemperatureRow[];
  const photos = (photosResult.data ?? []) as PhotoRow[];
  const photoLookup = buildPhotoLookup(photos);

  const trailerNumbersForOperation = Array.from(
    new Set(
      trailers
        .map((row) => normalizeTrailerNumber(row.trailer_number))
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const [exportAllocationsResult, operationalAlertsResult, trailerActivityResult] = await Promise.all([
    trailerNumbersForOperation.length
      ? supabase
          .from("export_allocations")
          .select("id, trailer_id, trailer_number, customer, status, delivered_empty_at, waiting_loading_at, collected_loaded_at, completed_at, expected_return_at, updated_at")
          .in("trailer_number", trailerNumbersForOperation)
          .order("updated_at", { ascending: false })
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("operational_alerts")
      .select("id, trailer_id, trailer_number, severity, status, title, source_module, created_at")
      .in("trailer_number", trailerNumbersForOperation.length > 0 ? trailerNumbersForOperation : ["__none__"])
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("trailer_activity_log")
      .select("id, trailer_id, trailer_number, event_type, event_title, created_at")
      .in("trailer_number", trailerNumbersForOperation.length > 0 ? trailerNumbersForOperation : ["__none__"])
      .order("created_at", { ascending: true })
      .limit(2000),
  ]);

  if (exportAllocationsResult.error || operationalAlertsResult.error || trailerActivityResult.error) {
    console.error("Load vessel report intelligence failed:", {
      exportAllocationsError: exportAllocationsResult.error,
      operationalAlertsError: operationalAlertsResult.error,
      trailerActivityError: trailerActivityResult.error,
    });
    throw new Error("Unable to load report.");
  }

  const exportAllocations = (exportAllocationsResult.data ?? []) as ExportAllocationRow[];
  const operationalAlerts = (operationalAlertsResult.data ?? []) as OperationalAlertRow[];
  const trailerActivity = (trailerActivityResult.data ?? []) as TrailerActivityRow[];
  const photoUrlByStoragePath = new Map<string, string | null>();
  await Promise.all(
    [...new Set(photos.map((photo) => photo.storage_path).filter((value): value is string => Boolean(value)))].map(async (storagePath) => {
      photoUrlByStoragePath.set(storagePath, await resolvePhotoUrl(supabase, storagePath));
    }),
  );

  const trailerById = new Map<string, TrailerRow>();
  trailers.forEach((row) => {
    trailerById.set(row.id, row);
  });

  const mainTrailersById = new Map<string, MainTrailerRow>();
  mainTrailers.forEach((row) => {
    mainTrailersById.set(row.id, row);
  });

  const damagesByTrailer = new Map<string, DamageRow[]>();
  damages.forEach((row) => {
    const key = row.vessel_trailer_id;
    if (!key) return;
    const existing = damagesByTrailer.get(key) ?? [];
    existing.push(row);
    damagesByTrailer.set(key, existing);
  });

  const temperaturesByTrailer = new Map<string, TemperatureRow[]>();
  temperatures.forEach((row) => {
    const key = row.vessel_trailer_id;
    if (!key) return;
    const existing = temperaturesByTrailer.get(key) ?? [];
    existing.push(row);
    temperaturesByTrailer.set(key, existing);
  });

  const activeTrailers = trailers.filter(
    (row) =>
      row.status !== "cancelled" &&
      row.arrival_status !== "cancelled" &&
      row.status !== "no_show" &&
      row.arrival_status !== "no_show",
  );
  const damageTrailerIds = new Set(activeTrailers.filter((row) => row.has_damage === true).map((row) => row.id));
  const totalTrailers = activeTrailers.length;
  const arrivedTrailers = activeTrailers.filter((row) => row.arrival_status === "arrived").length;
  const expectedTrailers = totalTrailers;
  const additionalTrailers = trailers.filter((row) => row.added_after_confirmation === true).length;
  const finalDischargedTrailers = activeTrailers.filter((row) => row.arrival_status === "arrived" || row.arrival_status === "not_discharged").length;
  const pendingTrailers = activeTrailers.filter((row) => row.arrival_status === "expected" || row.arrival_status === "available_for_arrival").length;
  const notDischargedTrailers = activeTrailers.filter((row) => row.arrival_status === "not_discharged").length;
  const cancelledTrailers = trailers.filter((row) => row.arrival_status === "cancelled" || row.status === "cancelled").length;
  const noShowTrailers = trailers.filter((row) => row.arrival_status === "no_show" || row.status === "no_show").length;
  const priorityTrailers = activeTrailers.filter((row) => row.priority_level === "priority").length;
  const inspectedTrailers = activeTrailers.filter((row) => row.status === "inspected").length;
  const pendingInspections = activeTrailers.filter((row) => row.arrival_status === "arrived" && row.status !== "inspected").length;
  const temperatureAlertTrailers = activeTrailers.filter((row) => row.has_temperature_alert === true).length;

  const temperatureRows = trailers.flatMap((trailer) => {
    const limits = parseTemperatureLimits(trailer.temperature_required);
    const expectedUnit = (trailer.expected_temperature_unit ?? "C").trim() || "C";
    const trailerTemperatures = temperaturesByTrailer.get(trailer.id) ?? [];

    if (trailerTemperatures.length === 0) {
      return [{
        id: `not-assessed-${trailer.id}`,
        trailerId: trailer.id,
        trailerNumber: normalizeTrailerNumber(trailer.trailer_number) || "UNKNOWN",
        readingPoint: null,
        expectedTemperature: null,
        requiredMin: limits.min,
        requiredMax: limits.max,
        recordedTemperature: null,
        unit: expectedUnit,
        result: "not_assessed" as TemperatureResult,
        recordedAt: null,
        notes: null,
      }];
    }

    return trailerTemperatures.map((temperature) => ({
      expectedTemperature: getExpectedTemperatureForReading(trailer, temperature.reading_point),
      id: temperature.id,
      trailerId: trailer.id,
      trailerNumber: normalizeTrailerNumber(trailer.trailer_number) || "UNKNOWN",
      readingPoint: temperature.reading_point ?? null,
      requiredMin: limits.min,
      requiredMax: limits.max,
      recordedTemperature: temperature.temperature_value,
      unit: temperature.temperature_unit || expectedUnit,
      result: getTemperatureResult(temperature, limits, getExpectedTemperatureForReading(trailer, temperature.reading_point)),
      recordedAt: toIso(temperature.recorded_at),
      notes: temperature.notes ?? null,
    }));
  });

  const manifestRows = activeTrailers.map((trailer) => {
    const linkedMainTrailerId = trailer.arrival_record_id ?? trailer.trailer_id ?? null;
    const mainTrailer = linkedMainTrailerId ? mainTrailersById.get(linkedMainTrailerId) ?? null : null;
    const trailerNumber = normalizeTrailerNumber(mainTrailer?.trailer_number ?? trailer.trailer_number) || "UNKNOWN";
    const trailerTemperatures = temperatureRows.filter((row) => row.trailerId === trailer.id);
    const expectedUnit = (trailer.expected_temperature_unit ?? "C").trim() || "C";
    const frontTemperatureRow = trailerTemperatures.find((row) => row.readingPoint === "front") ?? null;
    const rearTemperatureRow = trailerTemperatures.find((row) => row.readingPoint === "rear") ?? null;
    const hasTemperatureFail = trailerTemperatures.some((row) => row.result === "fail");
    const hasTemperaturePass = trailerTemperatures.some((row) => row.result === "pass");
    const temperatureResult: TemperatureResult = hasTemperatureFail ? "fail" : hasTemperaturePass ? "pass" : "not_assessed";
    const trailerDamages = damagesByTrailer.get(trailer.id) ?? [];
    const hasDamage = trailerDamages.length > 0 || trailer.has_damage === true;
    const primaryDamage = trailerDamages.at(-1) ?? null;
    const trailerPhotos = collectPhotosForTrailer(photoLookup, trailer, mainTrailer).map((photo) => ({
      id: photo.id,
      url: photo.storage_path ? photoUrlByStoragePath.get(photo.storage_path) ?? null : null,
      caption: photo.file_name ?? photo.category ?? "Inspection photo",
      trailerNumber,
      recordedAt: toIso(photo.uploaded_at),
      category: photo.category ?? null,
      fileName: photo.file_name ?? null,
      description: photo.description ?? null,
      uploadedBy: photo.uploaded_by ?? null,
    }));

    const ownershipType = getTrailerOwnershipType({
      trailerSource: mainTrailer?.trailer_source,
      externalCompany: mainTrailer?.external_company,
      isLocal: mainTrailer?.is_local,
      trailerNumber,
    });

    return {
      id: trailer.id,
      trailerNumber,
      customer: mainTrailer?.customer ?? trailer.customer ?? null,
      bookingReference: trailer.booking_reference ?? null,
      ownershipType,
      loadStatus: mainTrailer?.load_status ?? trailer.load_status ?? null,
      priority: trailer.priority_level ?? "normal",
      arrivalStatus: formatArrivalStatus(trailer.arrival_status),
      arrivalStatusRaw: trailer.arrival_status ?? null,
      arrivedAt: toIso(trailer.arrival_confirmed_at ?? trailer.arrived_at),
      arrivalTime: toIso(trailer.arrival_confirmed_at ?? trailer.arrived_at),
      inspectionStatus: trailer.status ?? "expected",
      inspectionCompletedAt: toIso(trailer.inspection_completed_at),
      receptionStatus: formatReceptionStatus(trailer, mainTrailer),
      compoundPosition: mainTrailer?.compound_position ?? trailer.assigned_position ?? null,
      damageStatus: hasDamage ? "damaged" : "clear",
      overallCondition: (hasDamage ? "attention_required" : "good") as "attention_required" | "good",
      hasDamage,
      hasTemperatureAlert: trailer.has_temperature_alert === true,
      temperatureResult,
      expectedFrontTemperature: getExpectedTemperatureForReading(trailer, "front"),
      expectedRearTemperature: getExpectedTemperatureForReading(trailer, "rear"),
      frontTemperature: frontTemperatureRow?.recordedTemperature ?? null,
      rearTemperature: rearTemperatureRow?.recordedTemperature ?? null,
      temperatureUnit: frontTemperatureRow?.unit ?? rearTemperatureRow?.unit ?? expectedUnit,
      operationalStatus: mainTrailer?.operational_status ?? trailer.status ?? "expected",
      notes: trailer.planning_notes ?? null,
      boatCheckNotes: trailer.planning_notes ?? null,
      receptionNotes: mainTrailer?.notes ?? null,
      damageDetails: primaryDamage
        ? {
            category: primaryDamage.damage_type ?? null,
            damageLocation: primaryDamage.damage_location ?? null,
            severity: primaryDamage.severity ?? null,
            description: primaryDamage.description ?? "",
          }
        : null,
      photos: trailerPhotos,
    };
  });

  const damageRows = damages.map((damage) => {
    const trailerId = damage.vessel_trailer_id ?? "";
    const trailer = trailerById.get(trailerId);
    const linkedMainTrailerId = trailer?.arrival_record_id ?? trailer?.trailer_id ?? null;
    const mainTrailer = linkedMainTrailerId ? mainTrailersById.get(linkedMainTrailerId) ?? null : null;
    const trailerNumber = normalizeTrailerNumber(mainTrailer?.trailer_number ?? trailer?.trailer_number) || "UNKNOWN";
    const attachedPhotos = (trailer
      ? collectPhotosForTrailer(photoLookup, trailer, mainTrailer)
      : [])
      .map((photo) => {
        return {
          id: photo.id,
          url: photo.storage_path ? photoUrlByStoragePath.get(photo.storage_path) ?? null : null,
          caption: photo.file_name ?? photo.category ?? "Inspection photo",
          trailerNumber,
          recordedAt: toIso(photo.uploaded_at),
          category: photo.category ?? null,
          fileName: photo.file_name ?? null,
          description: photo.description ?? null,
          uploadedBy: photo.uploaded_by ?? null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    return {
      id: damage.id,
      trailerId,
      trailerNumber,
      category: damage.damage_type ?? null,
      damageLocation: damage.damage_location ?? null,
      severity: damage.severity ?? null,
      description: damage.description ?? "",
      immediateAction: null,
      inspectedBy: damage.recorded_by ?? null,
      recordedAt: toIso(damage.recorded_at),
      photos: attachedPhotos,
    };
  });

  const exceptions: VesselOperationalReportData["exceptions"] = [];

  damageRows.forEach((damage) => {
    exceptions.push({
      type: "damage",
      severity: damage.severity && /severe|major|critical/i.test(damage.severity) ? "critical" : "warning",
      trailerNumber: damage.trailerNumber,
      description: `Damage recorded${damage.damageLocation ? ` at ${damage.damageLocation}` : ""}.`,
    });
  });

  temperatureRows.filter((row) => row.result === "fail").forEach((row) => {
    exceptions.push({
      type: "temperature",
      severity: "critical",
      trailerNumber: row.trailerNumber,
      description: `Temperature reading out of range (${row.recordedTemperature ?? "N/A"}${row.unit}).`,
    });
  });

  manifestRows.filter((row) => row.arrivalStatusRaw === "expected" || row.arrivalStatusRaw === "available_for_arrival").forEach((row) => {
    exceptions.push({
      type: "pending_trailer",
      severity: "warning",
      trailerNumber: row.trailerNumber,
      description: "Trailer is still pending arrival.",
    });
  });

  manifestRows.filter((row) => row.inspectionStatus !== "inspected" && row.inspectionStatus !== "positioned").forEach((row) => {
    exceptions.push({
      type: "pending_inspection",
      severity: "warning",
      trailerNumber: row.trailerNumber,
      description: "Inspection has not been completed.",
    });
  });

  const timeline: VesselOperationalReportData["timeline"] = [];
  const operationRow = operationResult.data;

  if (operationRow.created_at) {
    timeline.push({ timestamp: new Date(operationRow.created_at).toISOString(), event: "Vessel operation created.", trailerNumber: null });
  }
  if (operationRow.list_confirmed_at) {
    timeline.push({ timestamp: new Date(operationRow.list_confirmed_at).toISOString(), event: "Vessel list confirmed.", trailerNumber: null });
  }
  if (operationRow.expected_arrival_at) {
    timeline.push({ timestamp: new Date(operationRow.expected_arrival_at).toISOString(), event: "Expected vessel arrival.", trailerNumber: null });
  }
  if (operationRow.actual_arrival_at) {
    timeline.push({ timestamp: new Date(operationRow.actual_arrival_at).toISOString(), event: "Actual vessel arrival recorded.", trailerNumber: null });
  }

  trailers.forEach((trailer) => {
    const trailerNumber = normalizeTrailerNumber(mainTrailersById.get(trailer.arrival_record_id ?? trailer.trailer_id ?? "")?.trailer_number ?? trailer.trailer_number) || null;
    if (trailer.arrived_at) {
      timeline.push({ timestamp: new Date(trailer.arrived_at).toISOString(), event: "Trailer arrival confirmed.", trailerNumber });
    }
    if (trailer.inspection_started_at) {
      timeline.push({ timestamp: new Date(trailer.inspection_started_at).toISOString(), event: "Inspection started.", trailerNumber });
    }
    if (trailer.inspection_completed_at) {
      timeline.push({ timestamp: new Date(trailer.inspection_completed_at).toISOString(), event: "Inspection completed.", trailerNumber });
    }
    if (trailer.position_assigned_at) {
      timeline.push({ timestamp: new Date(trailer.position_assigned_at).toISOString(), event: "Reception position assigned.", trailerNumber });
    }
  });

  damages.forEach((damage) => {
    const trailerNumber = normalizeTrailerNumber(trailerById.get(damage.vessel_trailer_id ?? "")?.trailer_number) || null;
    if (damage.recorded_at) {
      timeline.push({ timestamp: new Date(damage.recorded_at).toISOString(), event: "Damage record created.", trailerNumber });
    }
  });

  temperatures.forEach((temperature) => {
    const trailerNumber = normalizeTrailerNumber(trailerById.get(temperature.vessel_trailer_id ?? "")?.trailer_number) || null;
    if (temperature.recorded_at) {
      timeline.push({ timestamp: new Date(temperature.recorded_at).toISOString(), event: "Temperature reading recorded.", trailerNumber });
    }
  });

  photos.forEach((photo) => {
    const trailerNumber = normalizeTrailerNumber(trailerById.get(photo.vessel_trailer_id ?? "")?.trailer_number) || null;
    if (photo.uploaded_at) {
      timeline.push({ timestamp: new Date(photo.uploaded_at).toISOString(), event: "Inspection photo uploaded.", trailerNumber });
    }
  });

  trailerActivity.forEach((activity) => {
    if (!activity.created_at) {
      return;
    }

    timeline.push({
      timestamp: new Date(activity.created_at).toISOString(),
      event: activity.event_title ?? activity.event_type ?? "Operational activity",
      trailerNumber: normalizeTrailerNumber(activity.trailer_number) || null,
    });
  });

  timeline.sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  const inspectionDurationsMinutes = trailers
    .map((row) => {
      if (!row.inspection_started_at || !row.inspection_completed_at) {
        return null;
      }

      const started = new Date(row.inspection_started_at).getTime();
      const completed = new Date(row.inspection_completed_at).getTime();
      if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
        return null;
      }

      return (completed - started) / 60000;
    })
    .filter((value): value is number => typeof value === "number");

  const averageInspectionTimeMinutes = inspectionDurationsMinutes.length > 0
    ? Math.round((inspectionDurationsMinutes.reduce((sum, value) => sum + value, 0) / inspectionDurationsMinutes.length) * 10) / 10
    : null;

  const arrivalCompletionPercent = expectedTrailers > 0
    ? Math.round((arrivedTrailers / expectedTrailers) * 1000) / 10
    : 0;

  const priorityRows = activeTrailers.filter((row) => row.priority_level === "priority");
  const priorityCompleted = priorityRows.filter((row) => row.status === "inspected" || row.status === "positioned").length;
  const priorityCompletionPercent = priorityRows.length > 0
    ? Math.round((priorityCompleted / priorityRows.length) * 1000) / 10
    : 100;

  const temperatureEvaluatedRows = temperatureRows.filter((row) => row.expectedTemperature !== null);
  const temperaturePassRows = temperatureEvaluatedRows.filter((row) => row.result === "pass");
  const temperatureCompliancePercent = temperatureEvaluatedRows.length > 0
    ? Math.round((temperaturePassRows.length / temperatureEvaluatedRows.length) * 1000) / 10
    : null;

  const photosCapturedPercent = expectedTrailers > 0
    ? Math.round((manifestRows.filter((row) => row.photos.length > 0).length / expectedTrailers) * 1000) / 10
    : 0;

  const damageIncidencePercent = expectedTrailers > 0
    ? Math.round((damageTrailerIds.size / expectedTrailers) * 1000) / 10
    : 0;

  const arrivedWithCompoundPosition = manifestRows.filter((row) => row.arrivalStatusRaw === "arrived" && Boolean(row.compoundPosition)).length;
  const compoundOccupancyImpactPercent = arrivedTrailers > 0
    ? Math.round((arrivedWithCompoundPosition / arrivedTrailers) * 1000) / 10
    : null;

  const statusCounts = {
    waitingLoading: exportAllocations.filter((row) => row.status === "waiting_loading").length,
    waitingCollection: exportAllocations.filter((row) => row.status === "delivered_empty").length,
    overdue: exportAllocations.filter((row) => {
      if (!row.expected_return_at) {
        return false;
      }

      const due = new Date(row.expected_return_at).getTime();
      return Number.isFinite(due) && due < Date.now() && row.status !== "completed" && row.status !== "cancelled";
    }).length,
    completed: exportAllocations.filter((row) => row.status === "completed").length,
  };

  const turnaroundHours = exportAllocations
    .map((row) => {
      const startRaw = row.delivered_empty_at ?? row.waiting_loading_at;
      const finishRaw = row.collected_loaded_at ?? row.completed_at;
      if (!startRaw || !finishRaw) {
        return null;
      }

      const start = new Date(startRaw).getTime();
      const finish = new Date(finishRaw).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) {
        return null;
      }

      return (finish - start) / 3600000;
    })
    .filter((value): value is number => typeof value === "number");

  const averageTurnaroundHours = turnaroundHours.length > 0
    ? Math.round((turnaroundHours.reduce((sum, value) => sum + value, 0) / turnaroundHours.length) * 10) / 10
    : null;

  const timelineEventCount = new Map<string, number>();
  timeline.forEach((entry) => {
    timelineEventCount.set(entry.event, (timelineEventCount.get(entry.event) ?? 0) + 1);
  });

  const sortedTimelineTypes = [...timelineEventCount.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([event, count]) => ({ event, count }));

  const completedTrailers = trailers.filter((row) => row.status === "inspected" || row.status === "positioned").length;
  const completionPercentage = expectedTrailers === 0 ? 0 : Math.round((completedTrailers / expectedTrailers) * 100);

  return {
    operation: {
      id: operationRow.id,
      vesselName: operationRow.vessel_name ?? "Unnamed vessel",
      voyageReference: operationRow.sailing_reference ?? null,
      expectedArrivalAt: toIso(operationRow.expected_arrival_at),
      actualArrivalAt: toIso(operationRow.actual_arrival_at),
      operationStartedAt: toIso(operationRow.created_at),
      operationCompletedAt: operationRow.status === "completed" ? toIso(operationRow.updated_at) : null,
      confirmedAt: toIso(operationRow.list_confirmed_at),
      completedAt: operationRow.status === "completed" ? toIso(operationRow.updated_at) : null,
      operator: operationRow.list_confirmed_by ?? null,
      port: operationRow.origin_port ?? null,
      berth: operationRow.berth ?? null,
      status: operationRow.status,
      listStatus: operationRow.list_status ?? null,
      listConfirmedAt: toIso(operationRow.list_confirmed_at),
      listConfirmedBy: operationRow.list_confirmed_by ?? null,
      notes: operationRow.notes ?? null,
    },
    statistics: {
      totalTrailers,
      expectedTrailers,
      additionalTrailers,
      arrivedTrailers,
      finalDischargedTrailers,
      pendingTrailers,
      notDischargedTrailers,
      cancelledTrailers,
      noShowTrailers,
      priorityTrailers,
      inspectedTrailers,
      pendingInspections,
      damagedTrailers: damageTrailerIds.size,
      temperatureAlertTrailers,
      temperatureChecks: temperatureRows.filter((row) => row.recordedTemperature !== null).length,
      temperatureExceptions: temperatureRows.filter((row) => row.result === "fail").length,
      completionPercentage,
    },
    performance: {
      averageInspectionTimeMinutes,
      arrivalCompletionPercent,
      priorityCompletionPercent,
      temperatureCompliancePercent,
      photosCapturedPercent,
      damageIncidencePercent,
      compoundOccupancyImpactPercent,
      exportTurnaroundHours: averageTurnaroundHours,
    },
    trailers: manifestRows,
    damages: damageRows,
    temperatures: temperatureRows,
    photos: Array.from(new Map(photos.map((photo) => [photo.id, photo])).values()).map((photo) => {
      const trailerId = photo.vessel_trailer_id ?? "";
      const linkedTrailer = trailerById.get(trailerId);
      const linkedMainTrailerId = linkedTrailer?.arrival_record_id ?? linkedTrailer?.trailer_id ?? null;
      const mainTrailer = linkedMainTrailerId ? mainTrailersById.get(linkedMainTrailerId) ?? null : null;
      const trailerNumber = normalizeTrailerNumber(mainTrailer?.trailer_number ?? linkedTrailer?.trailer_number) || "UNKNOWN";
      return {
        id: photo.id,
        trailerId,
        trailerNumber,
        url: photo.storage_path ? photoUrlByStoragePath.get(photo.storage_path) ?? null : null,
        caption: photo.file_name ?? photo.category ?? "Inspection photo",
        recordedAt: toIso(photo.uploaded_at),
        category: photo.category ?? null,
        fileName: photo.file_name ?? null,
        description: photo.description ?? null,
        uploadedBy: photo.uploaded_by ?? null,
      };
    }),
    exceptions,
    operationalAlerts: operationalAlerts.map((alert) => ({
      id: alert.id,
      trailerId: alert.trailer_id ?? null,
      trailerNumber: alert.trailer_number ?? null,
      severity: alert.severity ?? null,
      status: alert.status ?? null,
      title: alert.title ?? "Operational alert",
      sourceModule: alert.source_module ?? null,
      createdAt: toIso(alert.created_at),
    })),
    exportActivity: {
      allocationsAffected: exportAllocations.length,
      waitingLoading: statusCounts.waitingLoading,
      waitingCollection: statusCounts.waitingCollection,
      overdue: statusCounts.overdue,
      completed: statusCounts.completed,
      averageTurnaroundHours,
      sampleAllocations: exportAllocations.slice(0, 15).map((row) => ({
        id: row.id,
        trailerNumber: row.trailer_number ?? null,
        customer: row.customer ?? null,
        status: row.status,
        updatedAt: toIso(row.updated_at),
      })),
    },
    timelineSummary: {
      totalEvents: timeline.length,
      firstEventAt: timeline[0]?.timestamp ?? null,
      lastEventAt: timeline[timeline.length - 1]?.timestamp ?? null,
      topEventTypes: sortedTimelineTypes,
    },
    timeline,
  };
}