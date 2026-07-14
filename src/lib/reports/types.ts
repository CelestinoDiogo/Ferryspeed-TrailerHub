import type { Json } from "@/lib/database.types";

export type TemperatureResult = "pass" | "fail" | "not_assessed";

export type VesselOperationalReportData = {
  operation: {
    id: string;
    vesselName: string;
    voyageReference: string | null;
    expectedArrivalAt: string | null;
    actualArrivalAt: string | null;
    operationStartedAt: string | null;
    operationCompletedAt: string | null;
    port: string | null;
    berth: string | null;
    status: string;
    notes: string | null;
  };
  statistics: {
    expectedTrailers: number;
    arrivedTrailers: number;
    pendingTrailers: number;
    priorityTrailers: number;
    inspectedTrailers: number;
    pendingInspections: number;
    damagedTrailers: number;
    temperatureChecks: number;
    temperatureExceptions: number;
    completionPercentage: number;
  };
  trailers: Array<{
    id: string;
    trailerNumber: string;
    customer: string | null;
    bookingReference: string | null;
    loadStatus: string | null;
    priority: string;
    arrivalStatus: string;
    arrivedAt: string | null;
    inspectionStatus: string;
    damageStatus: string | null;
    temperatureResult: TemperatureResult;
    operationalStatus: string;
    notes: string | null;
  }>;
  damages: Array<{
    id: string;
    trailerId: string;
    trailerNumber: string;
    category: string | null;
    damageLocation: string | null;
    severity: string | null;
    description: string;
    immediateAction: string | null;
    inspectedBy: string | null;
    recordedAt: string | null;
    photos: Array<{
      id: string;
      url: string;
      caption: string | null;
      trailerNumber: string;
      recordedAt: string | null;
    }>;
  }>;
  temperatures: Array<{
    id: string;
    trailerId: string;
    trailerNumber: string;
    requiredMin: number | null;
    requiredMax: number | null;
    recordedTemperature: number | null;
    unit: string;
    result: TemperatureResult;
    recordedAt: string | null;
    notes: string | null;
  }>;
  exceptions: Array<{
    type: "damage" | "temperature" | "pending_trailer" | "pending_inspection" | "other";
    severity: "info" | "warning" | "critical";
    trailerNumber: string | null;
    description: string;
  }>;
  timeline: Array<{
    timestamp: string;
    event: string;
    trailerNumber: string | null;
  }>;
};

export type AIReportNarrative = {
  executiveSummary: string;
  operationalAnalysis: string;
  recommendations: string[];
  conclusion: string;
};

export type VesselOperationReportSnapshot = {
  snapshotHash: string;
  generatedAt: string;
  data: VesselOperationalReportData;
};

export type StoredVesselOperationReport = {
  id: string;
  vessel_operation_id: string;
  report_type: string;
  report_status: string;
  report_number: string | null;
  title: string;
  executive_summary: string | null;
  operational_analysis: string | null;
  recommendations: string | null;
  conclusion: string | null;
  structured_snapshot: Json;
  generated_by_ai: boolean;
  ai_model: string | null;
  approved_at: string | null;
  approved_by: string | null;
  sent_at: string | null;
  sent_by: string | null;
  created_at: string;
  updated_at: string;
};
