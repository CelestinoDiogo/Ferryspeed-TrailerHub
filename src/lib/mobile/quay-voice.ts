import { normalizeTrailerNumber, normalizeVoiceText } from "@/lib/voice/normalizer";

export type QuayVoiceIntent = "lookup" | "mark_arrived" | "unknown";
export type QuayVoiceConfidence = "high" | "medium" | "low";
export type QuayVoiceLanguage = "en-GB" | "pt-PT";

export type QuayVoiceParsedCommand = {
  recognizedText: string;
  normalizedText: string;
  intent: QuayVoiceIntent;
  trailerNumber: string | null;
  confidence: QuayVoiceConfidence;
  clarification: string | null;
};

export type QuayVoiceTrailerRecord = {
  id: string;
  vesselOperationId: string;
  trailerNumber: string;
  customer: string | null;
  arrivalStatus: string | null;
  priorityLevel: string | null;
  temperatureRequired: string | null;
  expectedFrontTemperature: number | null;
  expectedRearTemperature: number | null;
  expectedTemperatureUnit: string | null;
  inspectionCompletedAt: string | null;
  hasTemperatureAlert: boolean | null;
  hasDamage: boolean | null;
};

export type QuayVoiceTrailerMeta = {
  trailerNumber: string;
  customer: string | null;
  compoundPosition: string | null;
  operationalStatus: string | null;
};

export type QuayVoiceLookupResolution =
  | {
      status: "resolved_in_selected_vessel";
      trailer: QuayVoiceTrailerRecord;
      normalizedTrailerNumber: string;
    }
  | {
      status: "resolved_outside_selected_vessel";
      trailer: QuayVoiceTrailerRecord;
      normalizedTrailerNumber: string;
    }
  | {
      status: "ambiguous";
      matches: QuayVoiceTrailerRecord[];
      normalizedTrailerNumber: string;
    }
  | {
      status: "not_found";
      normalizedTrailerNumber: string;
    };

export type QuayVoiceCommandResult = {
  status: "success" | "error";
  recognizedText: string;
  trailerNumber: string | null;
  responseText: string;
  speakText: string;
  details: string | null;
  actionExecuted: boolean;
};

const ARRIVED_TERMS = [
  "arrived",
  "mark arrived",
  "confirm arrival",
  "chegou",
  "marcar chegada",
  "marca chegada",
] as const;

const LOOKUP_TERMS = [
  "what is",
  "tell me about",
  "show",
  "where is",
  "qual e",
  "mostra",
  "diz me",
  "diz-me",
] as const;

const compactTrailerNumber = (value?: string | null) => {
  const normalized = normalizeTrailerNumber(value);
  if (!normalized) {
    return null;
  }

  const compact = normalized.replace(/[^A-Z0-9]/g, "");
  return compact.length > 0 ? compact : null;
};

const extractTrailerNumber = (input: string) => {
  const directMatch = input.match(/\b([a-z]{2,5}\d{1,6})\b/i);
  if (directMatch?.[1]) {
    return compactTrailerNumber(directMatch[1]);
  }

  const splitMatch = input.match(/\b([a-z]{2,5})[\s-]*(\d{1,6})\b/i);
  if (splitMatch?.[1] && splitMatch?.[2]) {
    return compactTrailerNumber(`${splitMatch[1]}${splitMatch[2]}`);
  }

  return null;
};

const includesAnyTerm = (source: string, terms: readonly string[]) => {
  return terms.some((term) => source.includes(term));
};

const buildCustomerSegment = (customer: string, language: QuayVoiceLanguage) => {
  return language === "pt-PT" ? `Cliente ${customer}` : `Customer ${customer}`;
};

const buildTemperatureSegment = (trailer: QuayVoiceTrailerRecord, language: QuayVoiceLanguage) => {
  const hasExpected = trailer.expectedFrontTemperature !== null || trailer.expectedRearTemperature !== null;
  const hasRequired = (trailer.temperatureRequired ?? "").trim().length > 0;

  if (!hasExpected && !hasRequired) {
    return null;
  }

  if (trailer.hasTemperatureAlert) {
    return language === "pt-PT" ? "Alerta de temperatura" : "Temperature alert";
  }

  return language === "pt-PT" ? "Temperatura requerida" : "Temperature required";
};

const buildPrioritySegment = (value: string | null, language: QuayVoiceLanguage) => {
  if (normalizePriorityLabel(value) !== "priority") {
    return null;
  }

  return language === "pt-PT" ? "Prioridade" : "Priority";
};

const buildStateSegment = (trailer: QuayVoiceTrailerRecord, fallbackOperationalStatus: string | null, language: QuayVoiceLanguage) => {
  const arrivalState = normalizeArrivalState(trailer.arrivalStatus);
  if (arrivalState === "arrived") {
    if (trailer.inspectionCompletedAt) {
      return language === "pt-PT" ? "Chegou, inspeção concluída" : "Arrived, inspection complete";
    }

    return language === "pt-PT" ? "Chegou, inspeção pendente" : "Arrived, inspection pending";
  }

  if (arrivalState === "expected" || arrivalState === "available_for_arrival") {
    return language === "pt-PT" ? "Pendente de chegada" : "Pending arrival";
  }

  const fallback = fallbackOperationalStatus?.trim();
  if (fallback) {
    return fallback;
  }

  return language === "pt-PT" ? "Estado indisponível" : "State unavailable";
};

const buildNotOnSelectedVesselPrefix = (language: QuayVoiceLanguage) => {
  return language === "pt-PT" ? "Não está na embarcação selecionada." : "Not on selected vessel.";
};

const buildArrivedSuccessText = (trailerNumber: string, language: QuayVoiceLanguage) => {
  return language === "pt-PT" ? `${trailerNumber} marcada como chegada.` : `${trailerNumber} marked arrived.`;
};

export const parseQuayVoiceCommand = (recognizedText: string): QuayVoiceParsedCommand => {
  const normalizedText = normalizeVoiceText(recognizedText);
  if (!normalizedText) {
    return {
      recognizedText,
      normalizedText,
      intent: "unknown",
      trailerNumber: null,
      confidence: "low",
      clarification: "No speech was detected. Please try again.",
    };
  }

  const trailerNumber = extractTrailerNumber(normalizedText);
  const wantsArrived = includesAnyTerm(normalizedText, ARRIVED_TERMS);
  const wantsLookup = includesAnyTerm(normalizedText, LOOKUP_TERMS);

  if (wantsArrived) {
    if (!trailerNumber) {
      return {
        recognizedText,
        normalizedText,
        intent: "mark_arrived",
        trailerNumber: null,
        confidence: "medium",
        clarification: "Please say the trailer number for the arrived command.",
      };
    }

    return {
      recognizedText,
      normalizedText,
      intent: "mark_arrived",
      trailerNumber,
      confidence: "high",
      clarification: null,
    };
  }

  if (trailerNumber) {
    return {
      recognizedText,
      normalizedText,
      intent: wantsLookup ? "lookup" : "lookup",
      trailerNumber,
      confidence: wantsLookup ? "high" : "medium",
      clarification: null,
    };
  }

  return {
    recognizedText,
    normalizedText,
    intent: "unknown",
    trailerNumber: null,
    confidence: "low",
    clarification: "Unable to identify a trailer number. Use a short phrase like 'PFC 12'.",
  };
};

const normalizeArrivalState = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const isEligibleForArrived = (trailer: QuayVoiceTrailerRecord) => {
  const state = normalizeArrivalState(trailer.arrivalStatus);
  return state === "expected" || state === "available_for_arrival";
};

const normalizePriorityLabel = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === "priority") {
    return "priority";
  }

  return "normal priority";
};

export const resolveQuayVoiceTrailer = (input: {
  trailerNumber: string;
  selectedVesselId: string | null;
  selectedVesselRows: QuayVoiceTrailerRecord[];
  allRows: QuayVoiceTrailerRecord[];
}): QuayVoiceLookupResolution => {
  const normalizedTrailerNumber = compactTrailerNumber(input.trailerNumber);
  if (!normalizedTrailerNumber) {
    return {
      status: "not_found",
      normalizedTrailerNumber: input.trailerNumber,
    };
  }

  const selectedMatches = input.selectedVesselRows.filter((row) => compactTrailerNumber(row.trailerNumber) === normalizedTrailerNumber);
  if (selectedMatches.length === 1) {
    return {
      status: "resolved_in_selected_vessel",
      trailer: selectedMatches[0],
      normalizedTrailerNumber,
    };
  }

  if (selectedMatches.length > 1) {
    return {
      status: "ambiguous",
      matches: selectedMatches,
      normalizedTrailerNumber,
    };
  }

  const allMatches = input.allRows.filter((row) => compactTrailerNumber(row.trailerNumber) === normalizedTrailerNumber);
  if (allMatches.length === 1) {
    return {
      status: "resolved_outside_selected_vessel",
      trailer: allMatches[0],
      normalizedTrailerNumber,
    };
  }

  if (allMatches.length > 1) {
    return {
      status: "ambiguous",
      matches: allMatches,
      normalizedTrailerNumber,
    };
  }

  return {
    status: "not_found",
    normalizedTrailerNumber,
  };
};

export const buildQuayTrailerVoiceSummary = (input: {
  trailer: QuayVoiceTrailerRecord;
  trailerMeta: QuayVoiceTrailerMeta | null;
  notOnSelectedVessel: boolean;
  language?: QuayVoiceLanguage;
}) => {
  const language = input.language ?? "en-GB";
  const customer = input.trailerMeta?.customer ?? input.trailer.customer ?? null;
  const customerSegment = customer ? buildCustomerSegment(customer, language) : null;
  const temperature = buildTemperatureSegment(input.trailer, language);
  const priority = buildPrioritySegment(input.trailer.priorityLevel, language);
  const state = buildStateSegment(input.trailer, input.trailerMeta?.operationalStatus ?? null, language);
  const compoundPosition = input.trailerMeta?.compoundPosition;

  const spokenSegments = [
    input.trailer.trailerNumber,
    customerSegment,
    temperature,
    priority,
    state,
    compoundPosition ? (language === "pt-PT" ? `Posição ${compoundPosition}` : `Position ${compoundPosition}`) : null,
  ].filter((item): item is string => Boolean(item));

  const spoken = spokenSegments.join(". ") + ".";

  const details = [
    customer ? `Customer: ${customer}` : null,
    `Temperature: ${temperature}`,
    `Priority: ${priority}`,
    `State: ${state}`,
    compoundPosition ? `Compound: ${compoundPosition}` : null,
    input.notOnSelectedVessel ? "Not on the selected vessel queue." : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join(" | ");

  return {
    spoken,
    details,
  };
};

export const buildQuayArrivedVoiceText = (trailerNumber: string, language: QuayVoiceLanguage) => {
  return buildArrivedSuccessText(trailerNumber, language);
};

export const executeQuayVoiceCommand = async (input: {
  recognizedText: string;
  selectedVesselId: string | null;
  selectedVesselRows: QuayVoiceTrailerRecord[];
  allRows: QuayVoiceTrailerRecord[];
  trailerMetaByNumber: Record<string, QuayVoiceTrailerMeta>;
  canMarkArrived: boolean;
  isTrailerBusy: (trailerRowId: string) => boolean;
  onMarkArrived: (trailer: QuayVoiceTrailerRecord) => Promise<boolean>;
  language?: QuayVoiceLanguage;
}): Promise<QuayVoiceCommandResult> => {
  const language = input.language ?? "en-GB";
  const parsed = parseQuayVoiceCommand(input.recognizedText);

  if (parsed.clarification) {
    return {
      status: "error",
      recognizedText: parsed.recognizedText,
      trailerNumber: parsed.trailerNumber,
      responseText: parsed.clarification,
      speakText: parsed.clarification,
      details: null,
      actionExecuted: false,
    };
  }

  if (!parsed.trailerNumber) {
    const message = "Please say a trailer number.";
    return {
      status: "error",
      recognizedText: parsed.recognizedText,
      trailerNumber: null,
      responseText: message,
      speakText: message,
      details: null,
      actionExecuted: false,
    };
  }

  const resolution = resolveQuayVoiceTrailer({
    trailerNumber: parsed.trailerNumber,
    selectedVesselId: input.selectedVesselId,
    selectedVesselRows: input.selectedVesselRows,
    allRows: input.allRows,
  });

  if (resolution.status === "ambiguous") {
    const message = `${resolution.normalizedTrailerNumber} matched multiple records. Use touch controls for confirmation.`;
    return {
      status: "error",
      recognizedText: parsed.recognizedText,
      trailerNumber: resolution.normalizedTrailerNumber,
      responseText: message,
      speakText: message,
      details: `Matches: ${resolution.matches.map((row) => row.trailerNumber).join(", ")}`,
      actionExecuted: false,
    };
  }

  if (resolution.status === "not_found") {
    const message = language === "pt-PT"
      ? `Trela ${resolution.normalizedTrailerNumber} não encontrada.`
      : `Trailer ${resolution.normalizedTrailerNumber} not found.`;
    return {
      status: "error",
      recognizedText: parsed.recognizedText,
      trailerNumber: resolution.normalizedTrailerNumber,
      responseText: message,
      speakText: message,
      details: null,
      actionExecuted: false,
    };
  }

  const trailer = resolution.trailer;
  const normalizedTrailerNumber = compactTrailerNumber(trailer.trailerNumber) ?? trailer.trailerNumber;
  const trailerMeta = input.trailerMetaByNumber[normalizedTrailerNumber] ?? null;
  const notOnSelectedVessel = resolution.status === "resolved_outside_selected_vessel";

  if (parsed.intent === "lookup") {
    const summary = buildQuayTrailerVoiceSummary({
      trailer,
      trailerMeta,
      notOnSelectedVessel,
      language,
    });

    const responseText = notOnSelectedVessel
      ? `${buildNotOnSelectedVesselPrefix(language)} ${summary.spoken}`
      : summary.spoken;

    return {
      status: "success",
      recognizedText: parsed.recognizedText,
      trailerNumber: normalizedTrailerNumber,
      responseText,
      speakText: responseText,
      details: summary.details,
      actionExecuted: false,
    };
  }

  if (!input.canMarkArrived) {
    const message = "You do not have permission to mark arrivals.";
    return {
      status: "error",
      recognizedText: parsed.recognizedText,
      trailerNumber: normalizedTrailerNumber,
      responseText: message,
      speakText: message,
      details: null,
      actionExecuted: false,
    };
  }

  if (!isEligibleForArrived(trailer)) {
    const message = `${trailer.trailerNumber} is not eligible for arrived.`;
    return {
      status: "error",
      recognizedText: parsed.recognizedText,
      trailerNumber: normalizedTrailerNumber,
      responseText: message,
      speakText: message,
      details: null,
      actionExecuted: false,
    };
  }

  if (input.isTrailerBusy(trailer.id)) {
    const message = `${trailer.trailerNumber} is already being updated.`;
    return {
      status: "error",
      recognizedText: parsed.recognizedText,
      trailerNumber: normalizedTrailerNumber,
      responseText: message,
      speakText: message,
      details: null,
      actionExecuted: false,
    };
  }

  const succeeded = await input.onMarkArrived(trailer);
  if (!succeeded) {
    const message = `Unable to mark ${trailer.trailerNumber} arrived.`;
    return {
      status: "error",
      recognizedText: parsed.recognizedText,
      trailerNumber: normalizedTrailerNumber,
      responseText: message,
      speakText: message,
      details: null,
      actionExecuted: false,
    };
  }

  const success = buildArrivedSuccessText(trailer.trailerNumber, language);
  return {
    status: "success",
    recognizedText: parsed.recognizedText,
    trailerNumber: normalizedTrailerNumber,
    responseText: success,
    speakText: success,
    details: null,
    actionExecuted: true,
  };
};
