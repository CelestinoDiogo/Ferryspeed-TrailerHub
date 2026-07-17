import "server-only";
import { z } from "zod";
import type { VesselOperationalReportData, VesselOperationAiReportDraft, VesselOperationAiReportSections } from "@/lib/reports/types";

const aiSectionsSchema = z.object({
  operationOverview: z.string().trim().min(1),
  trailerDischargeSummary: z.string().trim().min(1),
  inspectionSummary: z.string().trim().min(1),
  damageFindings: z.string().trim().min(1),
  temperatureFindings: z.string().trim().min(1),
  outstandingItems: z.string().trim().min(1),
  finalOperationalStatus: z.string().trim().min(1),
});

const modelName = process.env.OPENAI_MODEL || "gpt-4o-mini";

const humanize = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatDate = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  try {
    return new Date(value).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "-";
  }
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  try {
    return new Date(value).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
};

const normalizeTrailerNumber = (value?: string | null) => (value ?? "").trim().toUpperCase() || "UNKNOWN";

const formatTemperature = (value: number | null, unit: string) => (value === null ? "not recorded" : `${value} ${unit}`);

const formatPhotoCount = (count: number) => `${count} photo${count === 1 ? "" : "s"}`;

const buildTrailerRegisterLine = (trailer: VesselOperationalReportData["trailers"][number]) => {
  const trailerNumber = trailer.trailerNumber || "UNKNOWN";
  const frontTemperature = formatTemperature(trailer.frontTemperature, trailer.temperatureUnit);
  const rearTemperature = formatTemperature(trailer.rearTemperature, trailer.temperatureUnit);
  const damageText = trailer.hasDamage
    ? trailer.damageDetails
      ? [
          `damage recorded`,
          trailer.damageDetails.category ? `type ${trailer.damageDetails.category}` : null,
          trailer.damageDetails.damageLocation ? `location ${trailer.damageDetails.damageLocation}` : null,
          trailer.damageDetails.severity ? `severity ${trailer.damageDetails.severity}` : null,
        ]
        .filter(Boolean)
        .join(", ")
      : "damage recorded"
    : "no damage recorded";
  const notesText = trailer.notes?.trim() ? trailer.notes.trim() : "no notes recorded";

  return `- Trailer ${trailerNumber}: ${trailer.arrivalStatus}; ${humanize(trailer.inspectionStatus)}; front ${frontTemperature}; rear ${rearTemperature}; ${damageText}; ${notesText}; ${formatPhotoCount(trailer.photos.length)}.`;
};

const buildOperationOverview = (data: VesselOperationalReportData) => {
  const arrivalDate = formatDate(data.operation.actualArrivalAt ?? data.operation.operationCompletedAt ?? data.operation.expectedArrivalAt);
  return [
    `Vessel ${data.operation.vesselName} operated on voyage reference ${data.operation.voyageReference ?? "-"} from ${data.operation.port ?? "-"} to berth ${data.operation.berth ?? "-"}.`,
    `The operation record covers ${data.statistics.totalTrailers} trailers, with ${data.statistics.arrivedTrailers} arrived, ${data.statistics.notDischargedTrailers} not discharged, ${data.statistics.inspectedTrailers} inspected, and ${data.statistics.pendingInspections} pending inspection.`,
    `Expected arrival was ${formatDateTime(data.operation.expectedArrivalAt)}, actual arrival was ${formatDateTime(data.operation.actualArrivalAt)}, and the report date is ${arrivalDate}.`,
  ].join(" ");
};

const buildTrailerDischargeSummary = (data: VesselOperationalReportData) => {
  const notDischargedTrailers = data.trailers.filter((trailer) => trailer.arrivalStatusRaw === "not_discharged").map((trailer) => trailer.trailerNumber);
  const arrivedTrailers = data.trailers.filter((trailer) => trailer.arrivalStatusRaw === "arrived").map((trailer) => trailer.trailerNumber);

  const notDischargedText = notDischargedTrailers.length > 0 ? notDischargedTrailers.map(normalizeTrailerNumber).join(", ") : "none";
  const arrivedText = arrivedTrailers.length > 0 ? arrivedTrailers.map(normalizeTrailerNumber).join(", ") : "none";

  return [
    `Arrivals were recorded for ${data.statistics.arrivedTrailers} trailers, including ${arrivedText}.`,
    data.statistics.notDischargedTrailers > 0
      ? `Trailers remaining not discharged are ${notDischargedText}.`
      : "No trailers remain in a not-discharged state.",
  ].join(" ");
};

const buildInspectionSummary = (data: VesselOperationalReportData) => {
  const trailerRegister = data.trailers.map(buildTrailerRegisterLine).join("\n");
  return [
    `Inspection progress is ${data.statistics.inspectedTrailers} inspected and ${data.statistics.pendingInspections} pending. Priority trailers recorded in the operation total ${data.statistics.priorityTrailers}.`,
    `Trailer register:\n${trailerRegister}`,
  ].join("\n\n");
};

const buildDamageFindings = (data: VesselOperationalReportData) => {
  const damagedTrailers = data.trailers.filter((trailer) => trailer.hasDamage);

  if (damagedTrailers.length === 0) {
    return "No damage was recorded for any trailer in this operation.";
  }

  return [
    `Damage was recorded for ${damagedTrailers.length} trailer${damagedTrailers.length === 1 ? "" : "s"}: ${damagedTrailers.map((trailer) => normalizeTrailerNumber(trailer.trailerNumber)).join(", ")}.`,
    ...damagedTrailers.map((trailer) => {
      const parts = [
        `Trailer ${normalizeTrailerNumber(trailer.trailerNumber)}`,
        trailer.damageDetails?.category ? `type ${trailer.damageDetails.category}` : "type not stated",
        trailer.damageDetails?.damageLocation ? `location ${trailer.damageDetails.damageLocation}` : "location not stated",
        trailer.damageDetails?.severity ? `severity ${trailer.damageDetails.severity}` : "severity not stated",
        trailer.damageDetails?.description ? `description ${trailer.damageDetails.description}` : "description not stated",
        `photos ${formatPhotoCount(trailer.photos.length)}`,
      ];

      return `- ${parts.join(", ")}.`;
    }),
  ].join("\n");
};

const buildTemperatureFindings = (data: VesselOperationalReportData) => {
  const alertTrailers = data.trailers.filter((trailer) => trailer.hasTemperatureAlert);

  if (alertTrailers.length === 0) {
    return "No temperature alerts were recorded for any trailer in this operation.";
  }

  return [
    `Temperature alerts were recorded for ${alertTrailers.length} trailer${alertTrailers.length === 1 ? "" : "s"}: ${alertTrailers.map((trailer) => normalizeTrailerNumber(trailer.trailerNumber)).join(", ")}.`,
    ...alertTrailers.map((trailer) => `- Trailer ${normalizeTrailerNumber(trailer.trailerNumber)}: front ${formatTemperature(trailer.frontTemperature, trailer.temperatureUnit)}, rear ${formatTemperature(trailer.rearTemperature, trailer.temperatureUnit)}.`),
  ].join("\n");
};

const buildOutstandingItems = (data: VesselOperationalReportData) => {
  const notDischargedTrailers = data.trailers.filter((trailer) => trailer.arrivalStatusRaw === "not_discharged").map((trailer) => normalizeTrailerNumber(trailer.trailerNumber));
  const pendingInspections = data.trailers.filter((trailer) => trailer.arrivalStatusRaw === "arrived" && trailer.inspectionStatus !== "inspected").map((trailer) => normalizeTrailerNumber(trailer.trailerNumber));

  const items: string[] = [];

  if (notDischargedTrailers.length > 0) {
    items.push(`Not-discharged trailers remain: ${notDischargedTrailers.join(", ")}.`);
  } else {
    items.push("No trailers remain in a not-discharged state.");
  }

  if (pendingInspections.length > 0) {
    items.push(`Pending inspections remain for trailers: ${pendingInspections.join(", ")}.`);
  } else {
    items.push("No pending inspections remain.");
  }

  if (data.operation.notes?.trim()) {
    items.push(`Operation notes were recorded: ${data.operation.notes.trim()}.`);
  } else {
    items.push("No additional operation notes were recorded.");
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

  return {
    reportId: null,
    subject: buildVesselOperationAiReportSubject(data),
    body: buildVesselOperationAiReportBody(sections),
    sections,
    generationMode: "template",
    usedFallback: true,
    aiModel: null,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateVesselOperationAiSections(data: VesselOperationalReportData): Promise<{ sections: VesselOperationAiReportSections; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  const payload = {
    model: modelName,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You are an operational reporting assistant for a professional freight and ferry operations company.",
          "Write in professional British English.",
          "Use only the facts supplied in the structured operation data.",
          "Never invent trailer numbers, customer names, bookings, incidents, times, quantities, temperatures, causes of damage, actions taken, or conclusions not supported by the data.",
          "Do not claim damage occurred unless explicitly recorded in the data.",
          "Do not claim temperature compliance or non-compliance unless the data supports it.",
          "Clearly state when no damage or alert exists.",
          "Mention not-discharged trailers by number, damaged trailers by number, and temperature-alert trailers by number.",
          "Use front and rear temperature readings separately.",
          "Avoid exaggerated language.",
          "Return JSON with these keys only: operationOverview, trailerDischargeSummary, inspectionSummary, damageFindings, temperatureFindings, outstandingItems, finalOperationalStatus.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          instruction: "Generate the full operational report sections from the live vessel operation data.",
          operationFacts: data,
        }),
      },
    ],
    temperature: 0.2,
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
  }

  const responseData = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  const rawContent = responseData.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("OpenAI API returned empty response content.");
  }

  const parsedJson = JSON.parse(rawContent) as unknown;
  const validated = aiSectionsSchema.parse(parsedJson);

  return {
    sections: validated,
    model: modelName,
  };
}