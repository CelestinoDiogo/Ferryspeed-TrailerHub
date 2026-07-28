import { aiAssistantIntentSchema, type AiAssistantContext, type AiAssistantIntent } from "@/lib/ai-assistant-types";
import { normalizeTrailerNumber } from "@/lib/vessel-operations";

const DEFAULT_LIMIT = 20;

const normalizeText = (value: string) => value.trim().toLowerCase();

const sanitizeLimit = (value?: number) => {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(50, Math.trunc(value)));
};

export const normalizeAssistantTrailerNumber = (value?: string | null) => {
  const normalized = normalizeTrailerNumber(value);
  return normalized.replace(/[\s\-_/]+/g, "").toUpperCase();
};

const extractTrailerNumber = (question: string) => {
  const compact = question.toUpperCase();
  const fullMatch = compact.match(/\b([A-Z]{2,5})[\s\-_/]*(\d{1,6})\b/);
  if (!fullMatch) {
    return null;
  }

  return normalizeAssistantTrailerNumber(`${fullMatch[1]}${fullMatch[2]}`);
};

const extractCustomer = (question: string) => {
  const match = question.match(/\b(?:for|by)\s+customer\s+([A-Za-z0-9&'"().,\-\s]{2,80})/i)
    ?? question.match(/\bdepartures\s+for\s+([A-Za-z0-9&'"().,\-\s]{2,80})/i);
  return match?.[1]?.trim() || undefined;
};

const extractHours = (question: string) => {
  const match = question.match(/(\d{1,3})\s*(?:h|hr|hrs|hour|hours)/i);
  if (!match?.[1]) {
    return undefined;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(1, Math.min(24 * 30, Math.trunc(value)));
};

const inferScope = (normalized: string): "today" | "all" | "latest" | undefined => {
  if (normalized.includes("today") || normalized.includes("now")) {
    return "today";
  }

  if (normalized.includes("latest")) {
    return "latest";
  }

  if (normalized.includes("all")) {
    return "all";
  }

  return undefined;
};

const inferPriorityOnly = (normalized: string) => {
  return /\bpriority\b/.test(normalized) || /\bhigh priority\b/.test(normalized);
};

const parseFromContext = (normalized: string, context?: AiAssistantContext): AiAssistantIntent | null => {
  if (!context) {
    return null;
  }

  if (/which\s+ones\s+are\s+still\s+missing|what\s+is\s+still\s+missing/.test(normalized) && context.activeVesselOperationId) {
    return {
      intent: "list_expected_trailers",
      vesselOperationId: context.activeVesselOperationId,
      scope: "today",
      limit: DEFAULT_LIMIT,
    };
  }

  return null;
};

export const detectIntent = (question: string, context?: AiAssistantContext): AiAssistantIntent => {
  const normalized = normalizeText(question);
  const trailerNumber = extractTrailerNumber(question);
  const customer = extractCustomer(question);
  const minHours = extractHours(question) ?? 48;
  const scope = inferScope(normalized);
  const priorityOnly = inferPriorityOnly(normalized);

  const contextIntent = parseFromContext(normalized, context);
  if (contextIntent) {
    return aiAssistantIntentSchema.parse(contextIntent);
  }

  if (trailerNumber && /\bwhere\b|\blocation\b|\bin the compound\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({
      intent: "trailer_location",
      trailerNumber,
      limit: 1,
      scope,
    });
  }

  if (trailerNumber && /\bstatus\b|\bcurrent\b|\bis .* in the compound\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({
      intent: "trailer_current_status",
      trailerNumber,
      limit: 1,
      scope,
    });
  }

  if (trailerNumber && /\bopen\b.*\btrailer\b|\bshow\b.*\btrailer\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({
      intent: "find_trailer",
      trailerNumber,
      limit: 1,
      scope,
    });
  }

  if (/\bshow\b.*\bwaiting trailers?\b|\bwaiting position\b|\btrailers? waiting\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "list_waiting_compound", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bshow\b.*\bpriority\b|\bpriority trailers?\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "list_priority_trailers", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bshow\b.*\bdepartures\b|\bdepartures\b.*\btoday\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "departures_today", scope: "today", limit: DEFAULT_LIMIT });
  }

  if (/\bshow\b.*\barrivals\b|\barrivals\b.*\btoday\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "arrivals_today", scope: "today", limit: DEFAULT_LIMIT });
  }

  if (/\bshow\b.*\binspections\b|\binspection queue\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "list_pending_inspections", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bshow\b.*\bexport allocations\b|\bexport operations\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "export_allocated", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bshow\b.*\bdamaged trailers?\b|\bdamage alerts?\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "trailers_with_damage", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bshow\b.*\btemperature alerts?\b|\btemperature alerts?\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "trailers_with_temperature_alert", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bshow\b.*\bcompound occupancy\b|\bcompound occupancy\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "compound_summary", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bsummarise\b.*\btoday\b|\bsummarize\b.*\btoday\b|\bdaily operations summary\b|\bexplain today'?s delays\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "operations_summary_today", scope: "today", limit: 1 });
  }

  if (trailerNumber && /\bwhy\b.*\bstill waiting\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "trailer_current_status", trailerNumber, limit: 1, scope });
  }

  if (trailerNumber && /\bwhy\b.*\bnot\b.*\bcompound\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "trailer_location", trailerNumber, limit: 1, scope });
  }

  if (trailerNumber) {
    return aiAssistantIntentSchema.parse({
      intent: "find_trailer",
      trailerNumber,
      limit: 5,
      scope,
    });
  }

  if (/\bpriority\b.*\bwaiting\b.*\binspection\b|\bwaiting\b.*\binspection\b.*\bpriority\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({
      intent: "list_pending_inspections",
      priorityOnly: true,
      scope,
      limit: DEFAULT_LIMIT,
    });
  }

  if (/\bexpected trailers\b|\bstill missing\b|\bnot arrived\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "list_expected_trailers", scope, limit: DEFAULT_LIMIT });
  }

  if (/\barrived trailers\b|\barrived\b/.test(normalized) && /\blist\b|\bshow\b|\bwhich\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "list_arrived_trailers", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bpending inspections?\b|\bwaiting for inspection\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({
      intent: "list_pending_inspections",
      priorityOnly,
      scope,
      limit: DEFAULT_LIMIT,
    });
  }

  if (/\binspections? in progress\b|\binspection in progress\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "list_inspections_in_progress", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bcompleted inspections?\b|\binspection complete\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "list_completed_inspections", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bpriority trailers\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "list_priority_trailers", scope, limit: DEFAULT_LIMIT });
  }

  if (/\btemperature alerts?\b|\bshow temperature\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "list_temperature_alerts", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bmissing photos\b|\binspections?.*photos\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "list_missing_photos", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bcompound occupancy\b|\bcompound summary\b|\bhow full\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "compound_summary", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bempty trailers\b.*\bcompound\b|\bcompound empty trailers\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "compound_empty_trailers", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bloaded trailers\b.*\bcompound\b|\bcompound loaded trailers\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "compound_loaded_trailers", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bavailable trailers\b.*\bcompound\b|\bcompound available trailers\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "compound_available_trailers", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bfree positions\b|\bavailable positions\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "compound_free_positions", scope, limit: 50 });
  }

  if (/\bmore than\b.*\bcompound\b|\bin the compound for\b|\blong dwell\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "compound_long_dwell", minHours, scope, limit: DEFAULT_LIMIT });
  }

  if (/\bexports?\b.*\ballocated\b|\bexport allocated\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "export_allocated", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bexports?\b.*\bwaiting loading\b|\bwaiting for loading\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "export_waiting_loading", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bexports?\b.*\bwaiting collection\b|\bwaiting for collection\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "export_waiting_collection", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bexports?\b.*\boverdue\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "export_overdue", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bdeparted today\b|\bwhat departed today\b|\bdepartures today\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "departures_today", scope: "today", limit: DEFAULT_LIMIT });
  }

  if (customer && /\bdepartures\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "departures_by_customer", customer, scope: "today", limit: DEFAULT_LIMIT });
  }

  if (/\boperational alerts\b|\bunresolved alerts\b|\bexceptions\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "unresolved_operational_alerts", scope, limit: DEFAULT_LIMIT });
  }

  if (/\bstock check discrepancies\b|\bdiscrepancies\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "stock_check_discrepancies", scope: "latest", limit: DEFAULT_LIMIT });
  }

  if (/\bwhat needs attention\b|\boperational summary\b|\bcurrent operational summary\b/.test(normalized)) {
    return aiAssistantIntentSchema.parse({ intent: "current_operational_summary", scope: "today", limit: DEFAULT_LIMIT });
  }

  return aiAssistantIntentSchema.parse({ intent: "unknown", limit: sanitizeLimit(DEFAULT_LIMIT) });
};
