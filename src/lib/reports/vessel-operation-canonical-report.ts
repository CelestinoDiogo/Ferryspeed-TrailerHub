import { z } from "zod";
import type { VesselOperationalReportData } from "@/lib/reports/types";

const photoLinkSchema = z.object({
  label: z.string().min(1),
  href: z.string().url(),
}).strict();

const damageRecordSchema = z.object({
  category: z.string().nullable(),
  damageLocation: z.string().nullable(),
  severity: z.string().nullable(),
  description: z.string(),
  photoCount: z.number().int().min(0),
}).strict();

const trailerSchema = z.object({
  trailerId: z.string().nullable(),
  trailerNumber: z.string().min(1),
  customer: z.string().nullable(),
  bookingReference: z.string().nullable(),
  loadDescription: z.string().nullable(),
  priority: z.string().min(1),
  arrivalStatus: z.string().min(1),
  arrivedAt: z.string().nullable(),
  inspectionStatus: z.string().min(1),
  compoundPosition: z.string().nullable(),
  expectedFrontTemperature: z.number().nullable(),
  expectedRearTemperature: z.number().nullable(),
  actualFrontTemperature: z.number().nullable(),
  actualRearTemperature: z.number().nullable(),
  temperatureAlert: z.boolean(),
  damages: z.array(damageRecordSchema),
  photoCount: z.number().int().min(0),
  photoCategories: z.array(z.string()).default([]),
  notes: z.string().nullable(),
  photoLinks: z.array(photoLinkSchema).default([]),
}).strict();

const canonicalReportSchema = z.object({
  operation: z.object({
    id: z.string().min(1),
    vesselName: z.string().min(1),
    voyageReference: z.string().nullable(),
    originPort: z.string().nullable(),
    berth: z.string().nullable(),
    expectedArrivalAt: z.string().nullable(),
    actualArrivalAt: z.string().nullable(),
    status: z.string().min(1),
    notes: z.string().nullable(),
  }).strict(),
  totals: z.object({
    expected: z.number().int().min(0),
    arrived: z.number().int().min(0),
    outstanding: z.number().int().min(0),
    priority: z.number().int().min(0),
    inspectionPending: z.number().int().min(0),
    inspectionInProgress: z.number().int().min(0),
    inspectionCompleted: z.number().int().min(0),
    temperatureAlerts: z.number().int().min(0),
    damageReports: z.number().int().min(0),
  }).strict(),
  trailers: z.array(trailerSchema),
}).strict();

export type VesselOperationCanonicalReport = z.infer<typeof canonicalReportSchema>;

const normalize = (value?: string | null) => (value ?? "").trim();

export function buildVesselOperationCanonicalReport(data: VesselOperationalReportData): VesselOperationCanonicalReport {
  const trailers = data.trailers.map((trailer) => {
    const damages = data.damages
      .filter((damage) => damage.trailerNumber.trim().toUpperCase() === trailer.trailerNumber.trim().toUpperCase())
      .map((damage) => ({
        category: damage.category,
        damageLocation: damage.damageLocation,
        severity: damage.severity,
        description: damage.description,
        photoCount: damage.photos.length,
      }));

    return {
      trailerId: trailer.id,
      trailerNumber: normalize(trailer.trailerNumber) || "UNKNOWN",
      customer: trailer.customer ?? null,
      bookingReference: trailer.bookingReference ?? null,
      loadDescription: trailer.loadStatus ?? null,
      priority: trailer.priority,
      arrivalStatus: trailer.arrivalStatus,
      arrivedAt: trailer.arrivedAt,
      inspectionStatus: trailer.inspectionStatus,
      compoundPosition: trailer.compoundPosition ?? null,
      expectedFrontTemperature: trailer.expectedFrontTemperature,
      expectedRearTemperature: trailer.expectedRearTemperature,
      actualFrontTemperature: trailer.frontTemperature,
      actualRearTemperature: trailer.rearTemperature,
      temperatureAlert: trailer.hasTemperatureAlert,
      damages,
      photoCount: trailer.photos.length,
      photoCategories: [...new Set(trailer.photos.map((photo) => photo.category ?? "Uncategorised").filter(Boolean))],
      notes: trailer.notes ?? trailer.receptionNotes ?? trailer.boatCheckNotes ?? null,
      photoLinks: trailer.photos
        .filter((photo) => Boolean(photo.url))
        .slice(0, 8)
        .map((photo, index) => ({
          label: photo.category ? `${photo.category} photo ${index + 1}` : `Photo ${index + 1}`,
          href: photo.url as string,
        })),
    };
  });

  const canonical = {
    operation: {
      id: data.operation.id,
      vesselName: data.operation.vesselName,
      voyageReference: data.operation.voyageReference,
      originPort: data.operation.port,
      berth: data.operation.berth,
      expectedArrivalAt: data.operation.expectedArrivalAt,
      actualArrivalAt: data.operation.actualArrivalAt,
      status: data.operation.status,
      notes: data.operation.notes,
    },
    totals: {
      expected: data.statistics.expectedTrailers,
      arrived: data.statistics.arrivedTrailers,
      outstanding: data.statistics.totalTrailers - data.statistics.arrivedTrailers,
      priority: data.statistics.priorityTrailers,
      inspectionPending: data.statistics.pendingInspections,
      inspectionInProgress: data.trailers.filter((trailer) => trailer.inspectionStatus === "in_progress").length,
      inspectionCompleted: data.statistics.inspectedTrailers,
      temperatureAlerts: data.statistics.temperatureAlertTrailers,
      damageReports: data.statistics.damagedTrailers,
    },
    trailers,
  } satisfies VesselOperationCanonicalReport;

  return canonicalReportSchema.parse(canonical);
}
