import type { VesselOperationalReportData, VesselOperationAiReportDraft, VesselOperationAiReportSections } from "@/lib/reports/types";
import { getAcceptedTemperatureRange, getDefaultTemperatureToleranceSettings, isTemperatureOutOfRange } from "@/lib/temperature-tolerance";

const humanize = (value?: string | null) => {
  if (!value) return "Unknown";

  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatDate = (value?: string | null) => {
  if (!value) return null;

  try {
    return new Date(value).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return null;
  }
};

const formatDateTime = (value?: string | null) => {
  if (!value) return null;

  try {
    return new Date(value).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
};

const normalizeTrailerNumber = (value?: string | null) => (value ?? "").trim().toUpperCase() || "UNKNOWN";

const formatTemperature = (value: number | null, unit: string) => (value === null ? "Not recorded" : `${value} ${unit}`);

const pluralize = (count: number, singular: string, plural?: string) => `${count} ${count === 1 ? singular : plural ?? `${singular}s`}`;

const summarizeTrailerList = (trailers: string[], limit = 10) => {
  const normalized = [...new Set(trailers.map(normalizeTrailerNumber))];
  if (normalized.length <= limit) {
    return normalized.join(", ");
  }

  const shown = normalized.slice(0, limit).join(", ");
  const remaining = normalized.length - limit;
  return `${shown}, and ${remaining} additional trailer${remaining === 1 ? "" : "s"}`;
};

const countOutstandingTrailers = (data: VesselOperationalReportData) => {
  return data.trailers.filter((trailer) => trailer.arrivalStatusRaw !== "arrived").length;
};

const buildCompactTrailerTable = (data: VesselOperationalReportData) => {
  const rows = data.trailers.map((trailer) => {
    const temperatureState = trailer.hasTemperatureAlert ? "Alert" : trailer.frontTemperature === null && trailer.rearTemperature === null ? "Not recorded" : "Recorded";
    const position = trailer.compoundPosition?.trim() ? trailer.compoundPosition.trim() : "Not assigned";

    return `| ${normalizeTrailerNumber(trailer.trailerNumber)} | ${trailer.arrivalStatus} | ${humanize(trailer.inspectionStatus)} | ${trailer.hasDamage ? "Yes" : "No"} | ${temperatureState} | ${position} |`;
  });

  return [
    "| Trailer | Arrival | Inspection | Damage | Temperature | Position |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
};

const buildTemperatureRows = (data: VesselOperationalReportData) => {
  const tolerance = getDefaultTemperatureToleranceSettings();

  return data.trailers.map((trailer) => {
    const expectedFront = trailer.expectedFrontTemperature;
    const expectedRear = trailer.expectedRearTemperature;
    const measuredFront = trailer.frontTemperature;
    const measuredRear = trailer.rearTemperature;
    const unit = trailer.temperatureUnit || "C";

    const frontRange = expectedFront === null ? null : getAcceptedTemperatureRange(expectedFront, tolerance);
    const rearRange = expectedRear === null ? null : getAcceptedTemperatureRange(expectedRear, tolerance);

    const hasExpected = expectedFront !== null || expectedRear !== null;
    const frontOut = expectedFront === null ? false : isTemperatureOutOfRange(measuredFront, expectedFront, tolerance);
    const rearOut = expectedRear === null ? false : isTemperatureOutOfRange(measuredRear, expectedRear, tolerance);

    let result = "Not assessed";
    if (!hasExpected) {
      result = "No expected temperature recorded";
    } else if (frontOut || rearOut) {
      result = "Out of accepted range";
    } else if ((expectedFront !== null && measuredFront === null) || (expectedRear !== null && measuredRear === null)) {
      result = "Pending measurement";
    } else {
      result = "Within accepted range";
    }

    const acceptedRange = [
      frontRange ? `Front ${frontRange.minimumAcceptedTemperature} to ${frontRange.maximumAcceptedTemperature} ${unit}` : null,
      rearRange ? `Rear ${rearRange.minimumAcceptedTemperature} to ${rearRange.maximumAcceptedTemperature} ${unit}` : null,
    ]
      .filter(Boolean)
      .join("; ");

    return {
      trailerNumber: normalizeTrailerNumber(trailer.trailerNumber),
      expectedFront: expectedFront === null ? "Not recorded" : `${expectedFront} ${unit}`,
      measuredFront: formatTemperature(measuredFront, unit),
      expectedRear: expectedRear === null ? "Not recorded" : `${expectedRear} ${unit}`,
      measuredRear: formatTemperature(measuredRear, unit),
      acceptedRange: acceptedRange || "Not applicable",
      result,
      hasExpected,
      outOfRange: frontOut || rearOut,
    };
  });
};

const buildExecutiveSummary = (data: VesselOperationalReportData) => {
  const reportDate = formatDate(data.operation.operationCompletedAt ?? data.operation.actualArrivalAt ?? data.operation.expectedArrivalAt) ?? "the report date";
  const vessel = data.operation.vesselName;
  const voyageText = data.operation.voyageReference?.trim() ? ` under voyage reference ${data.operation.voyageReference.trim()}` : "";
  const expected = data.statistics.expectedTrailers;
  const arrived = data.statistics.arrivedTrailers;
  const outstanding = countOutstandingTrailers(data);

  let arrivalsSentence = "";
  if (expected > 0 && arrived === expected && outstanding === 0) {
    arrivalsSentence = `All ${expected} expected trailers arrived.`;
  } else if (expected > 0) {
    arrivalsSentence = `Of the ${expected} expected trailers, ${arrived} arrived and ${outstanding} remain outstanding.`;
  } else {
    arrivalsSentence = "No expected trailer count was recorded.";
  }

  let inspectionSentence = "";
  if (data.statistics.inspectedTrailers === expected && expected > 0) {
    inspectionSentence = `All ${expected} expected trailers completed inspection.`;
  } else {
    inspectionSentence = `${pluralize(data.statistics.inspectedTrailers, "inspection")} completed and ${pluralize(data.statistics.pendingInspections, "inspection")} remain pending.`;
  }

  const outstandingSentence = data.statistics.notDischargedTrailers > 0
    ? `${pluralize(data.statistics.notDischargedTrailers, "trailer")} remain not discharged.`
    : "No outstanding discharge items were recorded.";

  return `Vessel ${vessel} operated${voyageText} on ${reportDate}. ${arrivalsSentence} ${inspectionSentence} ${outstandingSentence}`;
};

const buildOperationOverview = (data: VesselOperationalReportData) => {
  const rows = [
    { label: "Vessel", value: data.operation.vesselName?.trim() || null },
    { label: "Voyage / Sailing Reference", value: data.operation.voyageReference?.trim() || null },
    { label: "Origin Port", value: data.operation.port?.trim() || null },
    { label: "Berth", value: data.operation.berth?.trim() || null },
    { label: "Expected Arrival", value: formatDateTime(data.operation.expectedArrivalAt) },
    { label: "Actual Arrival", value: formatDateTime(data.operation.actualArrivalAt) },
    { label: "Status", value: humanize(data.operation.status) },
    { label: "Report Date", value: formatDate(data.operation.operationCompletedAt ?? data.operation.actualArrivalAt ?? data.operation.expectedArrivalAt) },
  ].filter((item) => item.value);

  const details = rows.map((item) => `- ${item.label}: ${item.value}`).join("\n");
  return `${buildExecutiveSummary(data)}\n\nOperation Details\n${details}`;
};

const buildTrailerDischargeSummary = (data: VesselOperationalReportData) => {
  const notDischargedTrailers = data.trailers.filter((trailer) => trailer.arrivalStatusRaw === "not_discharged").map((trailer) => trailer.trailerNumber);
  const expected = data.statistics.expectedTrailers;
  const arrived = data.statistics.arrivedTrailers;
  const outstanding = countOutstandingTrailers(data);

  const summary = expected > 0 && arrived === expected && outstanding === 0
    ? `All ${expected} expected trailers arrived.`
    : expected > 0
      ? `Of the ${expected} expected trailers, ${arrived} arrived and ${outstanding} remain outstanding.`
      : `${pluralize(arrived, "trailer")} arrived.`;

  if (notDischargedTrailers.length === 0) {
    return `${summary} No trailers remain in a not-discharged state.`;
  }

  return `${summary} Not discharged trailers: ${summarizeTrailerList(notDischargedTrailers)}.`;
};

const buildInspectionSummary = (data: VesselOperationalReportData) => {
  const summary = `${pluralize(data.statistics.inspectedTrailers, "trailer")} inspected. ${pluralize(data.statistics.pendingInspections, "inspection")} pending. ${pluralize(data.statistics.priorityTrailers, "priority trailer")} flagged in planning.`;
  return `${summary}\n\nTrailer Status Table\n${buildCompactTrailerTable(data)}`;
};

const buildDamageFindings = (data: VesselOperationalReportData) => {
  const damagedTrailers = data.trailers.filter((trailer) => trailer.hasDamage);

  if (damagedTrailers.length === 0) {
    return "No damage was recorded for this vessel operation.";
  }

  const trailerNumbers = damagedTrailers.map((trailer) => trailer.trailerNumber);
  const summary = `Damage was recorded for ${pluralize(damagedTrailers.length, "trailer")}: ${summarizeTrailerList(trailerNumbers)}.`;
  const rows = damagedTrailers.map((trailer) => {
    const details = trailer.damageDetails;
    return `| ${normalizeTrailerNumber(trailer.trailerNumber)} | ${details?.category ?? "Recorded"} | ${details?.damageLocation ?? "Recorded"} | ${details?.severity ?? "Recorded"} | ${(details?.description || "No description provided").replace(/\|/g, "\\|")} |`;
  });

  return [
    summary,
    "",
    "Damage Table",
    "| Trailer | Type | Location | Severity | Description |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
};

const buildTemperatureFindings = (data: VesselOperationalReportData) => {
  const temperatureRows = buildTemperatureRows(data);
  const evaluatedRows = temperatureRows.filter((row) => row.hasExpected);
  const alertRows = temperatureRows.filter((row) => row.hasExpected && row.outOfRange);

  if (evaluatedRows.length === 0) {
    return "No expected temperature settings were recorded for this vessel operation.";
  }

  const rows = temperatureRows.map((row) => {
    return `| ${row.trailerNumber} | ${row.expectedFront} | ${row.measuredFront} | ${row.expectedRear} | ${row.measuredRear} | ${row.acceptedRange} | ${row.result} |`;
  });

  const summary = alertRows.length > 0
    ? `${pluralize(alertRows.length, "temperature alert")} recorded where expected temperatures were defined.`
    : "No temperature exceptions were recorded where expected temperatures were defined.";

  return [
    summary,
    "",
    "Temperature Table",
    "| Trailer | Expected Front | Measured Front | Expected Rear | Measured Rear | Accepted Range | Result |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
};

const buildOutstandingItems = (data: VesselOperationalReportData) => {
  const items: string[] = [];
  const notDischargedTrailers = data.trailers.filter((trailer) => trailer.arrivalStatusRaw === "not_discharged").map((trailer) => trailer.trailerNumber);
  const pendingInspections = data.trailers.filter((trailer) => trailer.arrivalStatusRaw === "arrived" && trailer.inspectionStatus !== "inspected").map((trailer) => trailer.trailerNumber);
  const waitingArrival = data.trailers.filter((trailer) => trailer.arrivalStatusRaw !== "arrived").map((trailer) => trailer.trailerNumber);

  if (waitingArrival.length > 0) {
    items.push(`${pluralize(waitingArrival.length, "trailer")} are still outstanding for arrival: ${summarizeTrailerList(waitingArrival)}.`);
  }

  if (notDischargedTrailers.length > 0) {
    items.push(`${pluralize(notDischargedTrailers.length, "trailer")} remain not discharged: ${summarizeTrailerList(notDischargedTrailers)}.`);
  }

  if (pendingInspections.length > 0) {
    items.push(`${pluralize(pendingInspections.length, "inspection")} remain pending: ${summarizeTrailerList(pendingInspections)}.`);
  }

  if (items.length === 0) {
    return "All expected trailers have been accounted for and no inspection items remain outstanding.";
  }

  return items.join(" ");
};

const buildFinalOperationalStatus = (data: VesselOperationalReportData) => {
  if (data.operation.status === "completed") {
    return "The vessel operation is recorded as completed and the report reflects the current live operational data.";
  }

  return `The vessel operation remains in ${humanize(data.operation.status)} status and the report reflects the current live operational data.`;
};

export function buildDeterministicVesselOperationAiReportSections(data: VesselOperationalReportData): VesselOperationAiReportSections {
  return {
    operationOverview: buildOperationOverview(data),
    trailerDischargeSummary: buildTrailerDischargeSummary(data),
    inspectionSummary: buildInspectionSummary(data),
    damageFindings: buildDamageFindings(data),
    temperatureFindings: buildTemperatureFindings(data),
    outstandingItems: buildOutstandingItems(data),
    finalOperationalStatus: buildFinalOperationalStatus(data),
  };
}

export function buildVesselOperationAiReportSubject(data: VesselOperationalReportData): string {
  return `Vessel Operations Report - ${data.operation.vesselName} - ${formatDate(data.operation.operationCompletedAt ?? data.operation.actualArrivalAt ?? new Date().toISOString())}`;
}

export function buildVesselOperationAiReportBody(sections: VesselOperationAiReportSections): string {
  return [
    "Operation Overview",
    sections.operationOverview,
    "",
    "Trailer Discharge Summary",
    sections.trailerDischargeSummary,
    "",
    "Inspection Summary",
    sections.inspectionSummary,
    "",
    "Damage Findings",
    sections.damageFindings,
    "",
    "Temperature Findings",
    sections.temperatureFindings,
    "",
    "Outstanding Items",
    sections.outstandingItems,
    "",
    "Final Operational Status",
    sections.finalOperationalStatus,
  ].join("\n");
}

export function buildDeterministicVesselOperationAiReportDraft(data: VesselOperationalReportData): VesselOperationAiReportDraft {
  const sections = buildDeterministicVesselOperationAiReportSections(data);
  const body = buildVesselOperationAiReportBody(sections);

  return {
    reportId: null,
    subject: buildVesselOperationAiReportSubject(data),
    recipients: [],
    cc: [],
    body,
    generatedContent: body,
    editedContent: body,
    sections,
    generationMode: "template",
    usedFallback: true,
    aiModel: null,
    generatedAt: new Date().toISOString(),
    generatedBy: null,
    status: "draft",
  };
}