import { describe, expect, it } from "vitest";
import { buildDeterministicVesselOperationAiReportDraft } from "@/lib/reports/vessel-operation-ai-report-shared";
import { buildVesselOperationCanonicalReport } from "@/lib/reports/vessel-operation-canonical-report";
import type { VesselOperationalReportData } from "@/lib/reports/types";

const makeReportData = (): VesselOperationalReportData => ({
  operation: {
    id: "11111111-1111-4111-8111-111111111111",
    vesselName: "MV Test Vessel",
    voyageReference: "VY-123",
    expectedArrivalAt: "2026-07-25T08:00:00.000Z",
    actualArrivalAt: "2026-07-25T08:12:00.000Z",
    operationStartedAt: "2026-07-25T07:30:00.000Z",
    operationCompletedAt: "2026-07-25T10:00:00.000Z",
    confirmedAt: "2026-07-25T07:45:00.000Z",
    completedAt: "2026-07-25T10:00:00.000Z",
    operator: "Operator One",
    port: "Dover",
    berth: "Berth 4",
    status: "completed",
    listStatus: "confirmed",
    listConfirmedAt: "2026-07-25T07:45:00.000Z",
    listConfirmedBy: "Operator One",
    notes: "Completed with one outstanding trailer.",
  },
  statistics: {
    totalTrailers: 3,
    expectedTrailers: 3,
    additionalTrailers: 0,
    arrivedTrailers: 2,
    finalDischargedTrailers: 2,
    pendingTrailers: 1,
    notDischargedTrailers: 0,
    cancelledTrailers: 0,
    noShowTrailers: 0,
    priorityTrailers: 1,
    inspectedTrailers: 1,
    pendingInspections: 1,
    damagedTrailers: 1,
    temperatureAlertTrailers: 1,
    temperatureChecks: 2,
    temperatureExceptions: 1,
    completionPercentage: 33,
  },
  performance: {
    averageInspectionTimeMinutes: 42,
    arrivalCompletionPercent: 66.7,
    priorityCompletionPercent: 100,
    temperatureCompliancePercent: 50,
    photosCapturedPercent: 33.3,
    damageIncidencePercent: 33.3,
    compoundOccupancyImpactPercent: 50,
    exportTurnaroundHours: 12,
  },
  trailers: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      trailerNumber: "PRO810",
      customer: "Acme Foods",
      bookingReference: "BKG-1",
      loadStatus: "Loaded",
      priority: "priority",
      ownershipType: "company",
      arrivalStatus: "Arrived",
      arrivalStatusRaw: "arrived",
      arrivedAt: "2026-07-25T08:10:00.000Z",
      arrivalTime: "2026-07-25T08:10:00.000Z",
      inspectionStatus: "inspected",
      inspectionCompletedAt: "2026-07-25T09:00:00.000Z",
      receptionStatus: "Received in Compound",
      compoundPosition: "P01",
      damageStatus: "clear",
      overallCondition: "good",
      hasDamage: false,
      hasTemperatureAlert: false,
      temperatureResult: "pass",
      expectedFrontTemperature: 2,
      expectedRearTemperature: 3,
      frontTemperature: 2,
      rearTemperature: 3,
      temperatureUnit: "C",
      operationalStatus: "inspected",
      notes: "Check seals",
      boatCheckNotes: "Check seals",
      receptionNotes: "Stored safely",
      damageDetails: null,
      photos: [
        {
          id: "photo-1",
          url: "https://example.com/photo-1.jpg",
          caption: "Front photo",
          trailerNumber: "PRO810",
          recordedAt: "2026-07-25T08:20:00.000Z",
          category: "damage",
          fileName: "photo-1.jpg",
        },
      ],
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      trailerNumber: "PRO811",
      customer: "Acme Foods",
      bookingReference: "BKG-2",
      loadStatus: "Loaded",
      priority: "normal",
      ownershipType: "outsourcing",
      arrivalStatus: "Arrived",
      arrivalStatusRaw: "arrived",
      arrivedAt: "2026-07-25T08:20:00.000Z",
      arrivalTime: "2026-07-25T08:20:00.000Z",
      inspectionStatus: "in_progress",
      inspectionCompletedAt: null,
      receptionStatus: "Awaiting Reception",
      compoundPosition: null,
      damageStatus: "damaged",
      overallCondition: "attention_required",
      hasDamage: true,
      hasTemperatureAlert: true,
      temperatureResult: "fail",
      expectedFrontTemperature: 1,
      expectedRearTemperature: null,
      frontTemperature: 6,
      rearTemperature: null,
      temperatureUnit: "C",
      operationalStatus: "in_progress",
      notes: null,
      boatCheckNotes: null,
      receptionNotes: null,
      damageDetails: {
        category: "Scratch",
        damageLocation: "Left Side",
        severity: "Moderate",
        description: "Scratch along left side",
      },
      photos: [],
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      trailerNumber: "PRO812",
      customer: null,
      bookingReference: null,
      loadStatus: "Empty",
      priority: "normal",
      ownershipType: "unknown",
      arrivalStatus: "Expected",
      arrivalStatusRaw: "expected",
      arrivedAt: null,
      arrivalTime: null,
      inspectionStatus: "expected",
      inspectionCompletedAt: null,
      receptionStatus: "Pending Reception",
      compoundPosition: null,
      damageStatus: "clear",
      overallCondition: "good",
      hasDamage: false,
      hasTemperatureAlert: false,
      temperatureResult: "not_assessed",
      expectedFrontTemperature: null,
      expectedRearTemperature: null,
      frontTemperature: null,
      rearTemperature: null,
      temperatureUnit: "C",
      operationalStatus: "expected",
      notes: null,
      boatCheckNotes: null,
      receptionNotes: null,
      damageDetails: null,
      photos: [],
    },
  ],
  damages: [
    {
      id: "damage-1",
      trailerId: "33333333-3333-4333-8333-333333333333",
      trailerNumber: "PRO811",
      category: "Scratch",
      damageLocation: "Left Side",
      severity: "Moderate",
      description: "Scratch along left side",
      immediateAction: null,
      inspectedBy: "Inspector A",
      recordedAt: "2026-07-25T08:45:00.000Z",
      photos: [],
    },
  ],
  photos: [
    {
      id: "photo-1",
      trailerId: "22222222-2222-4222-8222-222222222222",
      trailerNumber: "PRO810",
      url: "https://example.com/photo-1.jpg",
      caption: "Front photo",
      recordedAt: "2026-07-25T08:20:00.000Z",
      category: "damage",
      fileName: "photo-1.jpg",
    },
  ],
  temperatures: [
    {
      id: "temp-1",
      trailerId: "22222222-2222-4222-8222-222222222222",
      trailerNumber: "PRO810",
      readingPoint: "front",
      expectedTemperature: 2,
      requiredMin: 1,
      requiredMax: 3,
      recordedTemperature: 2,
      unit: "C",
      result: "pass",
      recordedAt: "2026-07-25T08:30:00.000Z",
      notes: null,
    },
    {
      id: "temp-2",
      trailerId: "33333333-3333-4333-8333-333333333333",
      trailerNumber: "PRO811",
      readingPoint: "front",
      expectedTemperature: 1,
      requiredMin: 0,
      requiredMax: 2,
      recordedTemperature: 6,
      unit: "C",
      result: "fail",
      recordedAt: "2026-07-25T08:50:00.000Z",
      notes: "Out of range",
    },
  ],
  exceptions: [
    {
      type: "damage",
      severity: "warning",
      trailerNumber: "PRO811",
      description: "Damage recorded at Left Side.",
    },
  ],
  operationalAlerts: [
    {
      id: "alert-1",
      trailerId: "33333333-3333-4333-8333-333333333333",
      trailerNumber: "PRO811",
      severity: "warning",
      status: "active",
      title: "Temperature variance",
      sourceModule: "vessel_operations",
      createdAt: "2026-07-25T08:55:00.000Z",
    },
  ],
  exportActivity: {
    allocationsAffected: 1,
    waitingLoading: 0,
    waitingCollection: 1,
    overdue: 0,
    completed: 0,
    averageTurnaroundHours: 12,
    sampleAllocations: [
      {
        id: "alloc-1",
        trailerNumber: "PRO811",
        customer: "Acme Foods",
        status: "delivered_empty",
        updatedAt: "2026-07-25T09:10:00.000Z",
      },
    ],
  },
  timelineSummary: {
    totalEvents: 1,
    firstEventAt: "2026-07-25T08:10:00.000Z",
    lastEventAt: "2026-07-25T08:10:00.000Z",
    topEventTypes: [
      {
        event: "Trailer arrival confirmed.",
        count: 1,
      },
    ],
  },
  timeline: [
    {
      timestamp: "2026-07-25T08:10:00.000Z",
      event: "Trailer arrival confirmed.",
      trailerNumber: "PRO810",
    },
  ],
});

describe("vessel operation report model", () => {
  it("builds a canonical report with totals and trailer detail", () => {
    const report = buildVesselOperationCanonicalReport(makeReportData());

    expect(report.operation.vesselName).toBe("MV Test Vessel");
    expect(report.totals.expected).toBe(3);
    expect(report.totals.arrived).toBe(2);
    expect(report.totals.outstanding).toBe(1);
    expect(report.totals.priority).toBe(1);
    expect(report.totals.temperatureAlerts).toBe(1);
    expect(report.totals.damageReports).toBe(1);
    expect(report.trailers).toHaveLength(3);
    expect(report.trailers[0].photoCount).toBe(1);
    expect(report.trailers[1].damages).toHaveLength(1);
    expect(report.trailers[1].temperatureAlert).toBe(true);
  });

  it("associates damage by operation trailer id rather than repeated trailer number", () => {
    const source = makeReportData();
    const repeated = {
      ...source.trailers[0],
      id: "vt-second",
      trailerNumber: source.trailers[1].trailerNumber,
      hasDamage: false,
      damageDetails: null,
    };
    const report = buildVesselOperationCanonicalReport({ ...source, trailers: [...source.trailers, repeated] });

    expect(report.trailers[1].damages).toHaveLength(1);
    expect(report.trailers[3].damages).toHaveLength(0);
  });

  it("creates a deterministic fallback draft from the same operational data", () => {
    const draft = buildDeterministicVesselOperationAiReportDraft(makeReportData());

    expect(draft.generationMode).toBe("template");
    expect(draft.usedFallback).toBe(true);
    expect(draft.bcc).toEqual([]);
    expect(draft.body).toContain("Operation Overview");
    expect(draft.body).toContain("Recommendations");
  });
});
