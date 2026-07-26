"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, Upload } from "lucide-react";
import type { TrailerActivityRow } from "@/lib/trailer-activity";

export type MobileInspectionTrailer = {
  vesselTrailerId: string;
  trailerId: string | null;
  trailerNumber: string;
  operationId: string;
  status: string | null;
  arrivalStatus: string | null;
  inspectionStartedAt: string | null;
  inspectionCompletedAt: string | null;
  expectedFrontTemperature: number | null;
  expectedRearTemperature: number | null;
  expectedTemperatureUnit: string | null;
  hasDamage: boolean | null;
  hasTemperatureAlert: boolean | null;
};

export type MobileInspectionProgress = {
  frontTemperature: string;
  rearTemperature: string;
  damage: "no" | "yes";
  damageType: string;
  damageLocation: string;
  damageDescription: string;
  notes: string;
};

type UploadPhotoInput = {
  file: File;
  category: string;
  description: string | null;
};

type MobileInspectionPanelProps = {
  open: boolean;
  trailer: MobileInspectionTrailer | null;
  progress: MobileInspectionProgress;
  activityRows: TrailerActivityRow[];
  activityLoading: boolean;
  isOnline: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onProgressChange: (patch: Partial<MobileInspectionProgress>) => void;
  onStartInspection: () => void;
  onSaveProgress: () => void;
  onCompleteInspection: () => void;
  onUploadPhoto: (input: UploadPhotoInput) => Promise<void>;
};

const photoCategories = ["Boat Check", "Damage", "Temperature", "Seal", "Other"];

export function MobileInspectionPanel({
  open,
  trailer,
  progress,
  activityRows,
  activityLoading,
  isOnline,
  isSubmitting,
  onClose,
  onProgressChange,
  onStartInspection,
  onSaveProgress,
  onCompleteInspection,
  onUploadPhoto,
}: MobileInspectionPanelProps) {
  const [uploadCategory, setUploadCategory] = useState("Boat Check");
  const [uploadDescription, setUploadDescription] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [selectedPreviewUrl, setSelectedPreviewUrl] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (!open) {
      setUploadMessage(null);
      setUploadError(null);
      setSelectedPhoto(null);
      setSelectedPreviewUrl(null);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (selectedPreviewUrl) {
        URL.revokeObjectURL(selectedPreviewUrl);
      }
    };
  }, [selectedPreviewUrl]);

  const inspectionStateLabel = useMemo(() => {
    if (!trailer) {
      return "Unknown";
    }

    if (trailer.inspectionCompletedAt) {
      return "Completed";
    }

    if (trailer.inspectionStartedAt) {
      return "In Progress";
    }

    return "Not Started";
  }, [trailer]);

  if (!open || !trailer) {
    return null;
  }

  const expectedUnit = trailer.expectedTemperatureUnit?.trim().toUpperCase() || "C";
  const frontRequired = trailer.expectedFrontTemperature !== null;
  const rearRequired = trailer.expectedRearTemperature !== null;

  return (
    <div className="fixed inset-0 z-[95] bg-slate-950/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Inspection panel">
      <div className="absolute inset-x-0 bottom-0 mx-auto max-h-[90vh] max-w-lg overflow-y-auto rounded-t-3xl border border-white/10 bg-white p-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700">Inspection</p>
            <h2 className="text-lg font-semibold text-slate-900">{trailer.trailerNumber}</h2>
            <p className="text-xs text-slate-600">State: {inspectionStateLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
          >
            Close
          </button>
        </header>

        <section className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <p>Expected front: {frontRequired ? `${trailer.expectedFrontTemperature} ${expectedUnit}` : "Not required"}</p>
          <p className="mt-1">Expected rear: {rearRequired ? `${trailer.expectedRearTemperature} ${expectedUnit}` : "Not required"}</p>
        </section>

        <section className="mt-3 space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700">Actual front ({expectedUnit})</span>
              <input
                value={progress.frontTemperature}
                onChange={(event) => onProgressChange({ frontTemperature: event.target.value })}
                inputMode="decimal"
                placeholder={frontRequired ? "Required" : "Optional"}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700">Actual rear ({expectedUnit})</span>
              <input
                value={progress.rearTemperature}
                onChange={(event) => onProgressChange({ rearTemperature: event.target.value })}
                inputMode="decimal"
                placeholder={rearRequired ? "Required" : "Optional"}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="space-y-1 text-xs">
            <span className="font-semibold text-slate-700">Damage</span>
            <select
              value={progress.damage}
              onChange={(event) => onProgressChange({ damage: event.target.value as "no" | "yes" })}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </label>

          {progress.damage === "yes" ? (
            <>
              <label className="space-y-1 text-xs">
                <span className="font-semibold text-slate-700">Damage type</span>
                <input
                  value={progress.damageType}
                  onChange={(event) => onProgressChange({ damageType: event.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-semibold text-slate-700">Damage location</span>
                <input
                  value={progress.damageLocation}
                  onChange={(event) => onProgressChange({ damageLocation: event.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-semibold text-slate-700">Damage details</span>
                <textarea
                  value={progress.damageDescription}
                  onChange={(event) => onProgressChange({ damageDescription: event.target.value })}
                  rows={2}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </>
          ) : null}

          <label className="space-y-1 text-xs">
            <span className="font-semibold text-slate-700">Notes</span>
            <textarea
              value={progress.notes}
              onChange={(event) => onProgressChange({ notes: event.target.value })}
              rows={2}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
        </section>

        <section className="mt-3 space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-600">Photo capture / upload</p>
          {!isOnline ? <p className="text-xs text-amber-700">Photo upload requires a connection.</p> : null}

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700">Category</span>
              <select
                value={uploadCategory}
                onChange={(event) => setUploadCategory(event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                {photoCategories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700">Description</span>
              <input
                value={uploadDescription}
                onChange={(event) => setUploadDescription(event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
              <Camera className="h-4 w-4" />
              Camera
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  if (!file) {
                    return;
                  }

                  if (selectedPreviewUrl) {
                    URL.revokeObjectURL(selectedPreviewUrl);
                  }

                  setSelectedPhoto(file);
                  setSelectedPreviewUrl(URL.createObjectURL(file));
                  setUploadError(null);
                  setUploadMessage(null);
                  event.target.value = "";
                }}
              />
            </label>

            <label className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
              <Upload className="h-4 w-4" />
              Gallery
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  if (!file) {
                    return;
                  }

                  if (selectedPreviewUrl) {
                    URL.revokeObjectURL(selectedPreviewUrl);
                  }

                  setSelectedPhoto(file);
                  setSelectedPreviewUrl(URL.createObjectURL(file));
                  setUploadError(null);
                  setUploadMessage(null);
                  event.target.value = "";
                }}
              />
            </label>
          </div>

          {selectedPreviewUrl ? (
            <img src={selectedPreviewUrl} alt="Selected inspection preview" className="h-28 w-full rounded-xl border border-slate-200 object-cover" />
          ) : null}

          <button
            type="button"
            disabled={!isOnline || !selectedPhoto || isUploading}
            onClick={async () => {
              if (!selectedPhoto) {
                return;
              }

              setIsUploading(true);
              setUploadError(null);
              setUploadMessage(null);

              try {
                await onUploadPhoto({
                  file: selectedPhoto,
                  category: uploadCategory,
                  description: uploadDescription.trim() || null,
                });

                setUploadMessage("Photo uploaded.");
                setSelectedPhoto(null);
                if (selectedPreviewUrl) {
                  URL.revokeObjectURL(selectedPreviewUrl);
                }
                setSelectedPreviewUrl(null);
              } catch (error) {
                setUploadError(error instanceof Error ? error.message : "Unable to upload photo.");
              } finally {
                setIsUploading(false);
              }
            }}
            className="w-full rounded-xl bg-cyan-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-cyan-300"
          >
            {isUploading ? "Uploading..." : "Upload photo"}
          </button>

          {uploadMessage ? <p className="text-xs text-emerald-700">{uploadMessage}</p> : null}
          {uploadError ? <p className="text-xs text-rose-700">{uploadError}</p> : null}
        </section>

        <section className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-600">Recent inspection activity</p>
          <div className="mt-2 space-y-2">
            {activityLoading ? <p className="text-xs text-slate-500">Loading activity...</p> : null}
            {!activityLoading && activityRows.length === 0 ? <p className="text-xs text-slate-500">No inspection activity yet.</p> : null}
            {!activityLoading
              ? activityRows.slice(0, 5).map((row) => (
                  <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs">
                    <p className="font-semibold text-slate-800">{row.event_title}</p>
                    <p className="text-slate-600">{row.event_description || row.event_type}</p>
                  </div>
                ))
              : null}
          </div>
        </section>

        <div className="mt-4 grid grid-cols-3 gap-2 pb-3">
          <button
            type="button"
            onClick={onStartInspection}
            disabled={isSubmitting}
            className="rounded-xl border border-cyan-200 bg-cyan-50 px-2 py-3 text-xs font-semibold text-cyan-800 disabled:opacity-60"
          >
            Start
          </button>
          <button
            type="button"
            onClick={onSaveProgress}
            disabled={isSubmitting}
            className="rounded-xl border border-slate-200 bg-white px-2 py-3 text-xs font-semibold text-slate-800 disabled:opacity-60"
          >
            Save Progress
          </button>
          <button
            type="button"
            onClick={onCompleteInspection}
            disabled={isSubmitting}
            className="rounded-xl bg-slate-950 px-2 py-3 text-xs font-semibold text-white disabled:bg-slate-400"
          >
            Complete
          </button>
        </div>
      </div>
    </div>
  );
}
