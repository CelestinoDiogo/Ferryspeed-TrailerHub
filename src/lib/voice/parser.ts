import { normalizeCompoundPosition, normalizeTrailerNumber, normalizeVoiceText } from "@/lib/voice/normalizer";
import type { VoiceCommand, VoiceContext, VoiceEntities, VoiceIntentName } from "@/lib/voice/types";

const trailerPattern = /\b([a-z]{2,5}\d{3,6})\b/i;
const positionPattern = /\b(?:p|position)\s*0*(\d{1,2})\b/i;
const customerPattern = /\bcustomer\s+([a-z0-9&'"().,\-\s]{2,40})$/i;

const withContextTrailer = (entities: VoiceEntities, context: VoiceContext) => {
  if (entities.trailerNumber) {
    return entities;
  }

  if (!context.lastTrailerNumber) {
    return entities;
  }

  return { ...entities, trailerNumber: context.lastTrailerNumber };
};

const inferIntent = (normalized: string): VoiceIntentName => {
  if (/\b(where|location|locate)\b/.test(normalized) && /\btrailer\b/.test(normalized)) {
    return "trailer_location";
  }

  if (/\bfull status|status details|complete status\b/.test(normalized)) {
    return "trailer_full_status";
  }

  if (/\bhistory|timeline\b/.test(normalized) && /\btrailer\b/.test(normalized)) {
    return "trailer_history_summary";
  }

  if (/\bcustomer\b/.test(normalized) && /\btrailers\b/.test(normalized)) {
    return "trailers_by_customer";
  }

  if (/\bposition\b/.test(normalized) && /\bwhich trailer|trailer at\b/.test(normalized)) {
    return "trailer_at_position";
  }

  if (/\ballocated\b/.test(normalized) && /\bcompound\b/.test(normalized)) {
    return "allocated_still_in_compound";
  }

  if (/\bwaiting collection|collection overdue|waiting overdue\b/.test(normalized)) {
    return "waiting_collection_overdue";
  }

  if (/\bpending inspection|arrivals pending inspection\b/.test(normalized)) {
    return "arrivals_pending_inspection";
  }

  if (/\btemperature alert|temperature alerts\b/.test(normalized)) {
    return "temperature_alerts";
  }

  if (/\bdamage alert|damage alerts|damaged trailers\b/.test(normalized)) {
    return "damage_alerts";
  }

  if (/\bdiscrepanc(y|ies)|open discrepancies\b/.test(normalized)) {
    return "open_discrepancies";
  }

  if (/\boperational status issues|status issues\b/.test(normalized)) {
    return "operational_status_issues";
  }

  if (/\bdaily summary|operations summary|operation summary\b/.test(normalized)) {
    return "daily_operations_summary";
  }

  if (/\bconfirm departed|confirm departure|mark departed\b/.test(normalized)) {
    return "confirm_departure";
  }

  if (/\bchange load|set load|mark loaded|mark empty\b/.test(normalized)) {
    return "change_load_status";
  }

  if (/\bchange position|move trailer|assign position\b/.test(normalized)) {
    return "change_compound_position";
  }

  if (/\bstart inspection\b/.test(normalized)) {
    return "start_inspection";
  }

  if (/\bcomplete inspection|finish inspection\b/.test(normalized)) {
    return "complete_inspection";
  }

  if (/\bset priority|change priority|priority high|priority normal|priority low\b/.test(normalized)) {
    return "set_priority";
  }

  if (/\bmark arrived|confirm arrival\b/.test(normalized)) {
    return "mark_arrived";
  }

  return "unknown";
};

const extractEntities = (sourceText: string): VoiceEntities => {
  const trailerMatch = sourceText.match(trailerPattern);
  const positionMatch = sourceText.match(positionPattern);
  const customerMatch = sourceText.match(customerPattern);

  const trailerNumber = normalizeTrailerNumber(trailerMatch?.[1]);
  const compoundPosition = normalizeCompoundPosition(positionMatch?.[1] ? `P${positionMatch[1]}` : null);

  let loadStatus: VoiceEntities["loadStatus"];
  if (/\bloaded\b/i.test(sourceText)) {
    loadStatus = "Loaded";
  } else if (/\bempty\b/i.test(sourceText)) {
    loadStatus = "Empty";
  }

  let priority: VoiceEntities["priority"];
  if (/\bpriority\s+high\b|\bhigh priority\b/i.test(sourceText)) {
    priority = "high";
  } else if (/\bpriority\s+low\b|\blow priority\b/i.test(sourceText)) {
    priority = "low";
  } else if (/\bpriority\s+normal\b|\bnormal priority\b/i.test(sourceText)) {
    priority = "normal";
  }

  return {
    trailerNumber: trailerNumber ?? undefined,
    compoundPosition: compoundPosition ?? undefined,
    customer: customerMatch?.[1]?.trim() || undefined,
    loadStatus,
    priority,
  };
};

const requiresTrailer = (intent: VoiceIntentName) => {
  return [
    "trailer_location",
    "trailer_full_status",
    "trailer_history_summary",
    "confirm_departure",
    "change_load_status",
    "change_compound_position",
    "start_inspection",
    "complete_inspection",
    "set_priority",
    "mark_arrived",
  ].includes(intent);
};

const requiresPosition = (intent: VoiceIntentName) => intent === "change_compound_position" || intent === "trailer_at_position";
const requiresLoadStatus = (intent: VoiceIntentName) => intent === "change_load_status";
const requiresPriority = (intent: VoiceIntentName) => intent === "set_priority";
const requiresCustomer = (intent: VoiceIntentName) => intent === "trailers_by_customer";

const requiresConfirmation = (intent: VoiceIntentName) => {
  return [
    "confirm_departure",
    "change_load_status",
    "change_compound_position",
    "start_inspection",
    "complete_inspection",
    "set_priority",
    "mark_arrived",
  ].includes(intent);
};

export const parseVoiceCommand = (input: string, context: VoiceContext): VoiceCommand => {
  const normalizedText = normalizeVoiceText(input);
  if (!normalizedText) {
    return {
      sourceText: input,
      normalizedText,
      intent: "unknown",
      entities: {},
      requiresConfirmation: false,
      confidence: "low",
      clarification: "Please say or type a command.",
    };
  }

  const intent = inferIntent(normalizedText);
  const extracted = withContextTrailer(extractEntities(input), context);

  if (intent === "unknown") {
    return {
      sourceText: input,
      normalizedText,
      intent,
      entities: extracted,
      requiresConfirmation: false,
      confidence: "low",
      clarification: "I could not identify the command. Try mentioning trailer number and operation.",
    };
  }

  if (requiresTrailer(intent) && !extracted.trailerNumber) {
    return {
      sourceText: input,
      normalizedText,
      intent,
      entities: extracted,
      requiresConfirmation: requiresConfirmation(intent),
      confidence: "medium",
      clarification: "Please provide the trailer number.",
    };
  }

  if (requiresPosition(intent) && !extracted.compoundPosition) {
    return {
      sourceText: input,
      normalizedText,
      intent,
      entities: extracted,
      requiresConfirmation: requiresConfirmation(intent),
      confidence: "medium",
      clarification: "Please provide a compound position like P12.",
    };
  }

  if (requiresLoadStatus(intent) && !extracted.loadStatus) {
    return {
      sourceText: input,
      normalizedText,
      intent,
      entities: extracted,
      requiresConfirmation: true,
      confidence: "medium",
      clarification: "Please specify load status: Loaded or Empty.",
    };
  }

  if (requiresPriority(intent) && !extracted.priority) {
    return {
      sourceText: input,
      normalizedText,
      intent,
      entities: extracted,
      requiresConfirmation: true,
      confidence: "medium",
      clarification: "Please specify priority: high, normal or low.",
    };
  }

  if (requiresCustomer(intent) && !extracted.customer) {
    return {
      sourceText: input,
      normalizedText,
      intent,
      entities: extracted,
      requiresConfirmation: false,
      confidence: "medium",
      clarification: "Please provide the customer name.",
    };
  }

  return {
    sourceText: input,
    normalizedText,
    intent,
    entities: extracted,
    requiresConfirmation: requiresConfirmation(intent),
    confidence: "high",
    clarification: null,
  };
};

export const resolveNextVoiceContext = (context: VoiceContext, command: VoiceCommand): VoiceContext => {
  return {
    lastIntent: command.intent,
    lastTrailerNumber: command.entities.trailerNumber ?? context.lastTrailerNumber,
    lastCustomer: command.entities.customer ?? context.lastCustomer,
  };
};
