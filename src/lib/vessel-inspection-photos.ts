import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { normalizeTrailerNumber } from "@/lib/vessel-operations";

const ACCEPTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;

export const VESSEL_INSPECTION_PHOTO_BUCKET = "vessel-inspection-photos";
export const VESSEL_INSPECTION_PHOTO_INPUT_ACCEPT = "image/jpeg,image/png,image/webp";

export const VESSEL_INSPECTION_PHOTO_DB_CATEGORIES = [
  "Boat Check",
  "Damage",
  "Temperature",
  "Seal",
  "Other",
] as const;

export const VESSEL_INSPECTION_PHOTO_UI_CATEGORIES = [
  "General",
  "Damage",
  "Temperature",
  "Seal",
  "Other",
] as const;

export type VesselInspectionPhotoDbCategory = (typeof VESSEL_INSPECTION_PHOTO_DB_CATEGORIES)[number];

const UI_TO_DB_CATEGORY: Record<string, VesselInspectionPhotoDbCategory> = {
  "boat check": "Boat Check",
  general: "Boat Check",
  damage: "Damage",
  temperature: "Temperature",
  seal: "Seal",
  other: "Other",
};

const normalizeMimeType = (value?: string | null) => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "image/jpg") {
    return "image/jpeg";
  }
  return normalized;
};

const sanitizeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

const getFileExtension = (file: File) => {
  const fromName = file.name.split(".").pop()?.trim().toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName)) {
    return fromName;
  }

  const mime = normalizeMimeType(file.type);
  if (mime === "image/jpeg") {
    return "jpg";
  }
  if (mime === "image/png") {
    return "png";
  }
  if (mime === "image/webp") {
    return "webp";
  }

  return "jpg";
};

const resolveCategory = (value: string): VesselInspectionPhotoDbCategory | null => {
  const normalized = value.trim().toLowerCase();
  return UI_TO_DB_CATEGORY[normalized] ?? null;
};

const isUuidLike = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export type SaveVesselInspectionPhotoInput = {
  vesselTrailerId: string;
  vesselOperationId: string;
  trailerId?: string | null;
  trailerNumber: string;
  file: File;
  category: string;
  description?: string | null;
  uploadedBy?: string | null;
};

export type SavedVesselInspectionPhoto = {
  row: Pick<
    Database["public"]["Tables"]["vessel_inspection_photos"]["Row"],
    "id" | "trailer_id" | "trailer_number" | "vessel_operation_id" | "category" | "storage_path" | "file_name" | "description" | "uploaded_at" | "uploaded_by"
  >;
  storagePath: string;
};

export const saveVesselInspectionPhoto = async (
  input: SaveVesselInspectionPhotoInput,
): Promise<SavedVesselInspectionPhoto> => {
  const vesselTrailerId = input.vesselTrailerId.trim();
  const vesselOperationId = input.vesselOperationId.trim();

  if (!isUuidLike(vesselTrailerId) || !isUuidLike(vesselOperationId)) {
    throw new Error("Photo upload requires a valid vessel trailer and vessel operation reference.");
  }

  const normalizedTrailerNumber = normalizeTrailerNumber(input.trailerNumber);
  if (!normalizedTrailerNumber) {
    throw new Error("Trailer number is required before uploading photos.");
  }

  const normalizedMime = normalizeMimeType(input.file.type);
  if (!ACCEPTED_MIME_TYPES.has(normalizedMime)) {
    throw new Error("Only JPEG, PNG, or WebP files are supported.");
  }

  if (input.file.size > MAX_PHOTO_SIZE_BYTES) {
    throw new Error("Photo size must be 10 MB or less.");
  }

  const resolvedCategory = resolveCategory(input.category);
  if (!resolvedCategory) {
    throw new Error("Unsupported photo category for vessel inspection.");
  }

  const safeBaseName = sanitizeFileName(input.file.name || "photo") || "photo";
  const extension = getFileExtension(input.file);
  const uniqueToken = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const storagePath = `vessel-inspections/${vesselOperationId}/${vesselTrailerId}/${Date.now()}-${uniqueToken}.${extension}`;

  const { error: uploadError } = await supabase.storage.from(VESSEL_INSPECTION_PHOTO_BUCKET).upload(storagePath, input.file, {
    cacheControl: "3600",
    upsert: false,
    contentType: normalizedMime,
  });

  if (uploadError) {
    throw new Error(uploadError.message || "Unable to upload inspection photo.");
  }

  const nowIso = new Date().toISOString();
  const fileName = `${safeBaseName}.${extension}`;

  const payload = {
    vessel_trailer_id: vesselTrailerId,
    vessel_operation_id: vesselOperationId,
    trailer_id: input.trailerId ?? null,
    trailer_number: normalizedTrailerNumber,
    category: resolvedCategory,
    storage_path: storagePath,
    file_name: fileName,
    description: input.description?.trim() || null,
    uploaded_at: nowIso,
    uploaded_by: input.uploadedBy?.trim() || "TrailerHub User",
  };

  const { data, error: insertError } = await supabase
    .from("vessel_inspection_photos")
    .insert(payload as never)
    .select("id, trailer_id, trailer_number, vessel_operation_id, category, storage_path, file_name, description, uploaded_at, uploaded_by")
    .single();

  if (insertError || !data) {
    const { error: cleanupError } = await supabase.storage.from(VESSEL_INSPECTION_PHOTO_BUCKET).remove([storagePath]);
    if (cleanupError) {
      throw new Error(
        `${insertError?.message || "Unable to save photo metadata."} Cleanup failed: ${cleanupError.message || "Unable to remove orphaned file."}`,
      );
    }
    throw new Error(insertError?.message || "Unable to save photo metadata.");
  }

  return {
    row: data as SavedVesselInspectionPhoto["row"],
    storagePath,
  };
};
