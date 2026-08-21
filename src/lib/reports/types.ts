import type { HistoryDateRangeValue } from "@/lib/history-date-range";
import type { TrailerOwnershipType } from "@/lib/trailer-ownership";

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
    additionalTrailers: number;
    arrivedTrailers: number;
    finalDischargedTrailers: number;
    pendingTrailers: number;
    notDischargedTrailers: number;
    cancelledTrailers: number;
    noShowTrailers: number;
    priorityTrailers: number;
    inspectedTrailers: number;
    pendingInspections: number;
    damagedTrailers: number;
    temperatureAlertTrailers: number;
    temperatureChecks: number;
    temperatureExceptions: number;
    completionPercentage: number;
  };
  performance: {
    averageInspectionTimeMinutes: number | null;
    arrivalCompletionPercent: number;
    priorityCompletionPercent: number;
    temperatureCompliancePercent: number | null;
    photosCapturedPercent: number;
    damageIncidencePercent: number;
    compoundOccupancyImpactPercent: number | null;
    exportTurnaroundHours: number | null;
  };
  trailers: Array<{
    id: string;
    trailerNumber: string;
    customer: string | null;
    bookingReference: string | null;
    loadStatus: string | null;
    priority: string;
    ownershipType: TrailerOwnershipType;
    arrivalStatus: string;
    arrivalStatusRaw: string | null;
    arrivedAt: string | null;
    arrivalTime: string | null;
    dischargedAt: string | null;
    inspectionStatus: string;
    inspectionCompletedAt: string | null;
    receptionStatus: string;
    compoundPosition: string | null;
    damageStatus: string | null;
    overallCondition: "good" | "attention_required";
    hasDamage: boolean;
    hasTemperatureAlert: boolean;
    temperatureRequired?: boolean;
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
      description?: string | null;
      uploadedBy?: string | null;
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
      description?: string | null;
      uploadedBy?: string | null;
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
    description?: string | null;
    uploadedBy?: string | null;
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
  operationalAlerts: Array<{
    id: string;
    trailerId: string | null;
    trailerNumber: string | null;
    severity: string | null;
    status: string | null;
    title: string;
    sourceModule: string | null;
    createdAt: string | null;
  }>;
  exportActivity: {
    allocationsAffected: number;
    waitingLoading: number;
    waitingCollection: number;
    overdue: number;
    completed: number;
    averageTurnaroundHours: number | null;
    sampleAllocations: Array<{
      id: string;
      trailerNumber: string | null;
      customer: string | null;
      status: string;
      updatedAt: string | null;
    }>;
  };
  timelineSummary: {
    totalEvents: number;
    firstEventAt: string | null;
    lastEventAt: string | null;
    topEventTypes: Array<{
      event: string;
      count: number;
    }>;
  };
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
  keyStatistics: string;
  priorityHandling: string;
  inspectionSummary: string;
  temperatureCompliance: string;
  damageSummary: string;
  operationalIssues: string;
  alertsGenerated: string;
  exportActivity: string;
  overallPerformance: string;
  recommendations: string;
};

export type VesselOperationAiReportDraft = {
  reportId: string | null;
  subject: string;
  recipients: string[];
  cc: string[];
  bcc: string[];
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
  bcc: string[];
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

export type VesselOperationReportLibraryItem = {
  reportId: string;
  vesselOperationId: string;
  vesselName: string | null;
  voyageReference: string | null;
  operationStatus: string | null;
  reportStatus: "draft" | "final" | "sent";
  generatedAt: string;
  generatedBy: string | null;
  subject: string;
  generationMode: "ai" | "template";
};

export type VesselOperationComparisonItem = {
  vesselOperationId: string;
  vesselName: string | null;
  voyageReference: string | null;
  operationCompletedAt: string | null;
  expectedTrailers: number;
  arrivedTrailers: number;
  inspectedTrailers: number;
  pendingInspections: number;
  damagedTrailers: number;
  temperatureAlertTrailers: number;
  completionPercentage: number;
};

export type ExecutiveDashboardTrendPoint = {
  date: string;
  label: string;
  arrivals: number;
  departures: number;
  inspections: number;
  alertsRaised: number;
  riskEvents: number;
  compoundOccupancy: number;
  netCompoundChange: number;
};

export type ExecutiveDashboardCustomerMetric = {
  customer: string;
  trailers: number;
  exportAllocations: number;
  overdueAllocations: number;
  priorityTrailers: number;
  averageCompoundDwellHours: number;
  temperatureAlerts: number;
};

export type ExecutiveDashboardVesselMetric = {
  vesselName: string;
  sailingReference: string | null;
  trailers: number;
  inspectedTrailers: number;
  temperatureAlerts: number;
  damageFlags: number;
  completionRate: number;
};

export type ExecutiveDashboardAlertItem = {
  id: string;
  title: string;
  severity: string;
  trailerNumber: string | null;
  sourceModule: string;
  createdAt: string | null;
};

export type ExecutiveDashboardReportData = {
  range: HistoryDateRangeValue;
  generatedAt: string;
  summary: {
    compoundTrailers: number;
    compoundOccupancyPercent: number;
    activeExportAllocations: number;
    todaysArrivals: number;
    todaysDepartures: number;
    inspectionCompletionRate: number;
    averageCompoundDwellHours: number;
    longestCompoundDwellHours: number;
    longestCompoundDwellTrailer: string | null;
    prioritySlaPercent: number;
    temperatureAlerts: number;
    stockCheckAccuracyPercent: number;
    waitingCollectionOverdue: number;
    activeAlerts: number;
  };
  compound: {
    availableEmptyTrailers: number;
    loadedTrailers: number;
    maintenanceTrailers: number;
    positionUtilisationPercent: number;
    dwellBands: {
      under24h: number;
      oneToThreeDays: number;
      fourToSevenDays: number;
      overSevenDays: number;
    };
    topDwellTrailers: Array<{
      trailerNumber: string;
      customer: string | null;
      compoundPosition: string | null;
      loadStatus: string | null;
      dwellHours: number;
    }>;
  };
  vessel: {
    totalOperations: number;
    activeOperations: number;
    completedOperations: number;
    inspectionPending: number;
    topOperations: ExecutiveDashboardVesselMetric[];
  };
  customers: ExecutiveDashboardCustomerMetric[];
  trends: ExecutiveDashboardTrendPoint[];
  alerts: ExecutiveDashboardAlertItem[];
  exportSla: {
    overdue: number;
    waitingLoading: number;
    collectedLoaded: number;
    deliveredEmpty: number;
  };
  stockCheck: {
    latestCheckId: string | null;
    expectedTotal: number;
    checkedTotal: number;
    discrepancyTotal: number;
    missingTotal: number;
    unexpectedTotal: number;
    wrongPositionTotal: number;
    wrongStatusTotal: number;
  };
};

export type ExecutiveDashboardResponse = {
  reportData: ExecutiveDashboardReportData;
};
