import "server-only";
import type { Database } from "@/lib/database.types";
import { getSupabaseServiceClient } from "@/lib/supabase-server";
import type { TemperatureResult, VesselOperationalReportData } from "@/lib/reports/types";

type TrailerRow = Database["public"]["Tables"]["vessel_operation_trailers"]["Row"];
type DamageRow = Database["public"]["Tables"]["vessel_inspection_damages"]["Row"];
type TemperatureRow = Database["public"]["Tables"]["vessel_inspection_temperatures"]["Row"];
type PhotoRow = Database["public"]["Tables"]["vessel_inspection_photos"]["Row"];

type TemperatureLimits = {
  min: number | null;
  max: number | null;
};

const normalizeTrailerNumber = (value?: string | null) => (value ?? "").trim().toUpperCase();

const parseTemperatureLimits = (value?: string | null): TemperatureLimits => {
  if (!value) {
    return { min: null, max: null };
  }

  const matches = value.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) {
    return { min: null, max: null };
  }

  const nums = matches.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (nums.length === 0) {
    return { min: null, max: null };
  }

  if (nums.length === 1) {
    return { min: nums[0], max: nums[0] };
  }

  const sorted = [...nums].sort((a, b) => a - b);
  return { min: sorted[0], max: sorted[1] };
};

const getTemperatureResult = (
  row: TemperatureRow,
  limits: TemperatureLimits,
): TemperatureResult => {
  const value = row.temperature_value;

  if (value === null || value === undefined) {
    return "not_assessed";
  }

  if (row.out_of_range === true) {
    return "fail";
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

export async function getVesselOperationReportData(operationId: string): Promise<VesselOperationalReportData> {
  const supabase = getSupabaseServiceClient();

  const [operationResult, trailersResult, damagesResult, temperaturesResult, photosResult] = await Promise.all([
    supabase
      .from("vessel_operations")
      .select("id, vessel_name, sailing_reference, origin_port, berth, expected_arrival_at, actual_arrival_at, status, notes, created_at, updated_at")
      .eq("id", operationId)
      .single(),
    supabase
      .from("vessel_operation_trailers")
      .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, temperature_required, priority_level, planning_notes, status, arrived_at, inspection_started_at, inspection_completed_at, has_damage, has_temperature_alert")
      .eq("vessel_operation_id", operationId)
      .order("created_at", { ascending: true }),
    supabase
      .from("vessel_inspection_damages")
      .select("id, vessel_operation_trailer_id, damage_type, damage_location, severity, description, recorded_at, recorded_by")
      .eq("vessel_operation_id", operationId)
      .order("recorded_at", { ascending: true }),
    supabase
      .from("vessel_inspection_temperatures")
      .select("id, vessel_operation_trailer_id, temperature_value, unit, notes, out_of_range, recorded_at")
      .eq("vessel_operation_id", operationId)
      .order("recorded_at", { ascending: true }),
    supabase
      .from("vessel_inspection_photos")
      .select("id, vessel_operation_trailer_id, storage_path, description, uploaded_at")
      .eq("vessel_operation_id", operationId)
      .order("uploaded_at", { ascending: true }),
  ]);

  if (operationResult.error || !operationResult.data) {
    throw new Error(operationResult.error?.message || "Unable to load vessel operation.");
  }

  if (trailersResult.error) {
    throw new Error(trailersResult.error.message || "Unable to load vessel operation trailers.");
  }

  if (damagesResult.error) {
    throw new Error(damagesResult.error.message || "Unable to load vessel damages.");
  }

  if (temperaturesResult.error) {
    throw new Error(temperaturesResult.error.message || "Unable to load vessel temperatures.");
  }

  if (photosResult.error) {
    throw new Error(photosResult.error.message || "Unable to load vessel photos.");
  }

  const trailers = (trailersResult.data ?? []) as TrailerRow[];
  const damages = (damagesResult.data ?? []) as DamageRow[];
  const temperatures = (temperaturesResult.data ?? []) as TemperatureRow[];
  const photos = (photosResult.data ?? []) as PhotoRow[];

  const trailerById = new Map<string, TrailerRow>();
  trailers.forEach((row) => {
    trailerById.set(row.id, row);
  });

  const photosByTrailer = new Map<string, PhotoRow[]>();
  photos.forEach((row) => {
    const key = row.vessel_operation_trailer_id;
    if (!key) {
      return;
    }

    const existing = photosByTrailer.get(key) ?? [];
    existing.push(row);
    photosByTrailer.set(key, existing);
  });

  const damagesByTrailer = new Map<string, DamageRow[]>();
  damages.forEach((row) => {
    const key = row.vessel_operation_trailer_id;
    if (!key) {
      return;
    }

    const existing = damagesByTrailer.get(key) ?? [];
    existing.push(row);
    damagesByTrailer.set(key, existing);
  });

  const temperaturesByTrailer = new Map<string, TemperatureRow[]>();
  temperatures.forEach((row) => {
    const key = row.vessel_operation_trailer_id;
    if (!key) {
      return;
    }

    const existing = temperaturesByTrailer.get(key) ?? [];
    existing.push(row);
    temperaturesByTrailer.set(key, existing);
  });

  const damageTrailerIds = new Set<string>();
  damages.forEach((row) => {
    if (row.vessel_operation_trailer_id) {
      damageTrailerIds.add(row.vessel_operation_trailer_id);
    }
  });

  trailers.forEach((row) => {
    if (row.has_damage) {
      damageTrailerIds.add(row.id);
    }
  });

  const arrivedTrailers = trailers.filter((row) => row.status !== "expected" && row.status !== "cancelled").length;
  const expectedTrailers = trailers.filter((row) => row.status !== "cancelled").length;
  const pendingTrailers = Math.max(expectedTrailers - arrivedTrailers, 0);
  const priorityTrailers = trailers.filter((row) => row.priority_level === "priority" && row.status !== "cancelled").length;
  const inspectedTrailers = trailers.filter((row) => row.status === "inspected" || row.status === "positioned").length;
  const pendingInspections = Math.max(expectedTrailers - inspectedTrailers, 0);

  const temperatureRows = trailers.flatMap((trailer) => {
    const limits = parseTemperatureLimits(trailer.temperature_required);
    const trailerTemps = temperaturesByTrailer.get(trailer.id) ?? [];

    if (trailerTemps.length === 0) {
      return [
        {
          id: `not-assessed-${trailer.id}`,
          trailerId: trailer.id,
          trailerNumber: normalizeTrailerNumber(trailer.trailer_number) || "UNKNOWN",
          requiredMin: limits.min,
          requiredMax: limits.max,
          recordedTemperature: null,
          unit: "C",
          result: "not_assessed" as TemperatureResult,
          recordedAt: null,
          notes: null,
        },
      ];
    }

    return trailerTemps.map((temp) => ({
      id: temp.id,
      trailerId: trailer.id,
      trailerNumber: normalizeTrailerNumber(trailer.trailer_number) || "UNKNOWN",
      requiredMin: limits.min,
      requiredMax: limits.max,
      recordedTemperature: temp.temperature_value,
      unit: temp.unit || "C",
      result: getTemperatureResult(temp, limits),
      recordedAt: toIso(temp.recorded_at),
      notes: temp.notes ?? null,
    }));
  });

  const manifestRows = trailers.map((trailer) => {
    const trailerNumber = normalizeTrailerNumber(trailer.trailer_number) || "UNKNOWN";
    const trailerTemperatures = temperatureRows.filter((row) => row.trailerId === trailer.id);
    const hasTemperatureFail = trailerTemperatures.some((row) => row.result === "fail");
    const hasTemperaturePass = trailerTemperatures.some((row) => row.result === "pass");
    const temperatureResult: TemperatureResult = hasTemperatureFail
      ? "fail"
      : hasTemperaturePass
        ? "pass"
        : "not_assessed";

    const trailerDamages = damagesByTrailer.get(trailer.id) ?? [];
    const hasDamage = trailerDamages.length > 0 || trailer.has_damage === true;

    return {
      id: trailer.id,
      trailerNumber,
      customer: trailer.customer ?? null,
      bookingReference: trailer.booking_reference ?? null,
      loadStatus: trailer.load_status ?? null,
      priority: trailer.priority_level ?? "normal",
      arrivalStatus: trailer.status === "expected" ? "pending" : "arrived",
      arrivedAt: toIso(trailer.arrived_at),
      inspectionStatus: trailer.status ?? "expected",
      damageStatus: hasDamage ? "damaged" : "clear",
      temperatureResult,
      operationalStatus: trailer.status ?? "expected",
      notes: trailer.planning_notes ?? null,
    };
  });

  const bucket = "vessel-inspection-photos";
  const damageRows = damages.map((damage) => {
    const trailerId = damage.vessel_operation_trailer_id ?? "";
    const trailer = trailerById.get(trailerId);
    const trailerNumber = normalizeTrailerNumber(trailer?.trailer_number) || "UNKNOWN";

    const attachedPhotos = (photosByTrailer.get(trailerId) ?? [])
      .map((photo) => {
        if (!photo.storage_path) {
          return null;
        }

        const publicUrl = supabase.storage.from(bucket).getPublicUrl(photo.storage_path).data.publicUrl;
        if (!publicUrl) {
          return null;
        }

        return {
          id: photo.id,
          url: publicUrl,
          caption: photo.description ?? null,
          trailerNumber,
          recordedAt: toIso(photo.uploaded_at),
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

  temperatureRows
    .filter((row) => row.result === "fail")
    .forEach((row) => {
      exceptions.push({
        type: "temperature",
        severity: "critical",
        trailerNumber: row.trailerNumber,
        description: `Temperature reading out of range (${row.recordedTemperature ?? "N/A"}${row.unit}).`,
      });
    });

  manifestRows
    .filter((row) => row.arrivalStatus === "pending")
    .forEach((row) => {
      exceptions.push({
        type: "pending_trailer",
        severity: "warning",
        trailerNumber: row.trailerNumber,
        description: "Trailer is still pending arrival.",
      });
    });

  manifestRows
    .filter((row) => row.inspectionStatus !== "inspected" && row.inspectionStatus !== "positioned")
    .forEach((row) => {
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
    timeline.push({
      timestamp: new Date(operationRow.created_at).toISOString(),
      event: "Vessel operation created.",
      trailerNumber: null,
    });
  }

  if (operationRow.expected_arrival_at) {
    timeline.push({
      timestamp: new Date(operationRow.expected_arrival_at).toISOString(),
      event: "Expected vessel arrival.",
      trailerNumber: null,
    });
  }

  if (operationRow.actual_arrival_at) {
    timeline.push({
      timestamp: new Date(operationRow.actual_arrival_at).toISOString(),
      event: "Actual vessel arrival recorded.",
      trailerNumber: null,
    });
  }

  trailers.forEach((trailer) => {
    const trailerNumber = normalizeTrailerNumber(trailer.trailer_number) || null;

    if (trailer.arrived_at) {
      timeline.push({
        timestamp: new Date(trailer.arrived_at).toISOString(),
        event: "Trailer arrival confirmed.",
        trailerNumber,
      });
    }

    if (trailer.inspection_started_at) {
      timeline.push({
        timestamp: new Date(trailer.inspection_started_at).toISOString(),
        event: "Inspection started.",
        trailerNumber,
      });
    }

    if (trailer.inspection_completed_at) {
      timeline.push({
        timestamp: new Date(trailer.inspection_completed_at).toISOString(),
        event: "Inspection completed.",
        trailerNumber,
      });
    }
  });

  damages.forEach((damage) => {
    const trailerNumber = normalizeTrailerNumber(trailerById.get(damage.vessel_operation_trailer_id ?? "")?.trailer_number) || null;
    if (damage.recorded_at) {
      timeline.push({
        timestamp: new Date(damage.recorded_at).toISOString(),
        event: "Damage record created.",
        trailerNumber,
      });
    }
  });

  temperatures.forEach((temperature) => {
    const trailerNumber = normalizeTrailerNumber(trailerById.get(temperature.vessel_operation_trailer_id ?? "")?.trailer_number) || null;
    if (temperature.recorded_at) {
      timeline.push({
        timestamp: new Date(temperature.recorded_at).toISOString(),
        event: "Temperature reading recorded.",
        trailerNumber,
      });
    }
  });

  photos.forEach((photo) => {
    const trailerNumber = normalizeTrailerNumber(trailerById.get(photo.vessel_operation_trailer_id ?? "")?.trailer_number) || null;
    if (photo.uploaded_at) {
      timeline.push({
        timestamp: new Date(photo.uploaded_at).toISOString(),
        event: "Inspection photo uploaded.",
        trailerNumber,
      });
    }
  });

  timeline.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

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
      port: operationRow.origin_port ?? null,
      berth: operationRow.berth ?? null,
      status: operationRow.status,
      notes: operationRow.notes ?? null,
    },
    statistics: {
      expectedTrailers,
      arrivedTrailers,
      pendingTrailers,
      priorityTrailers,
      inspectedTrailers,
      pendingInspections,
      damagedTrailers: damageTrailerIds.size,
      temperatureChecks: temperatureRows.filter((row) => row.recordedTemperature !== null).length,
      temperatureExceptions: temperatureRows.filter((row) => row.result === "fail").length,
      completionPercentage,
    },
    trailers: manifestRows,
    damages: damageRows,
    temperatures: temperatureRows,
    exceptions,
    timeline,
  };
}
