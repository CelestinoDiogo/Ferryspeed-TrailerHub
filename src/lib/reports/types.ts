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
    confirmedAt: string | null;
    completedAt: string | null;
    operator: string | null;
    port: string | null;
    berth: string | null;
    status: string;
    listStatus: string | null;
    listConfirmedAt: string | null;
    listConfirmedBy: string | null;
    notes: string | null;
  };
  statistics: {
    totalTrailers: number;
    expectedTrailers: number;
    arrivedTrailers: number;
    pendingTrailers: number;
    notDischargedTrailers: number;
    priorityTrailers: number;
    inspectedTrailers: number;
    pendingInspections: number;
    damagedTrailers: number;
    temperatureAlertTrailers: number;
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
    arrivalStatusRaw: string | null;
    arrivedAt: string | null;
    arrivalTime: string | null;
    inspectionStatus: string;
    inspectionCompletedAt: string | null;
    receptionStatus: string;
    compoundPosition: string | null;
    damageStatus: string | null;
    overallCondition: "good" | "attention_required";
    hasDamage: boolean;
    hasTemperatureAlert: boolean;
    temperatureResult: TemperatureResult;
    expectedFrontTemperature: number | null;
    expectedRearTemperature: number | null;
    frontTemperature: number | null;
    rearTemperature: number | null;
    temperatureUnit: string;
    operationalStatus: string;
    notes: string | null;
    boatCheckNotes: string | null;
    receptionNotes: string | null;
    damageDetails: {
      category: string | null;
      damageLocation: string | null;
      severity: string | null;
      description: string;
    } | null;
    photos: Array<{
      id: string;
      url: string | null;
      caption: string | null;
      trailerNumber: string;
      recordedAt: string | null;
      category?: string | null;
      fileName?: string | null;
    }>;
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
      url: string | null;
      caption: string | null;
      trailerNumber: string;
      recordedAt: string | null;
      category?: string | null;
      fileName?: string | null;
    }>;
  }>;
  photos: Array<{
    id: string;
    trailerId: string;
    trailerNumber: string;
    url: string | null;
    caption: string | null;
    recordedAt: string | null;
    category?: string | null;
    fileName?: string | null;
  }>;
  temperatures: Array<{
    id: string;
    trailerId: string;
    trailerNumber: string;
    readingPoint: string | null;
    expectedTemperature: number | null;
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

export type VesselOperationAiReportSections = {
  operationOverview: string;
  trailerDischargeSummary: string;
  inspectionSummary: string;
  damageFindings: string;
  temperatureFindings: string;
  outstandingItems: string;
  finalOperationalStatus: string;
};

export type VesselOperationAiReportDraft = {
  reportId: string | null;
  subject: string;
  recipients: string[];
  cc: string[];
  body: string;
  generatedContent: string;
  editedContent: string;
  sections: VesselOperationAiReportSections;
  generationMode: "ai" | "template";
  usedFallback: boolean;
  aiModel: string | null;
  generatedAt: string;
  generatedBy: string | null;
  status: "draft" | "final" | "sent";
  sentAt?: string | null;
  sentBy?: string | null;
};

export type VesselOperationAiReportHistoryItem = {
  reportId: string;
  generatedAt: string;
  generatedBy: string | null;
  subject: string;
  recipients: string[];
  cc: string[];
  generationMode: "ai" | "template";
  status: "draft" | "final" | "sent";
};

export type VesselOperationAiReportResponse = {
  report: null;
  reportData?: VesselOperationalReportData | null;
  reportDraft: VesselOperationAiReportDraft | null;
  draftHistory?: VesselOperationAiReportHistoryItem[];
  emailProviderConfigured?: boolean;
  usedFallback: boolean;
  message: string | null;
};
