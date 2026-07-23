import type { AssistantIntent } from "@/lib/ai-assistant-foundation/types";

const normalizeText = (value: string) => value.trim().toLowerCase();
const normalizeTrailerNumber = (value: string) => value.trim().toUpperCase();
const normalizeCompoundPosition = (value: string) => value.trim().toUpperCase();

const DEFAULT_LIMIT = 12;

const extractTrailerNumber = (question: string) => {
  const match = question.match(/\b([A-Za-z]{2,5}\d{3,8})\b/);
  return match?.[1] ? normalizeTrailerNumber(match[1]) : undefined;
};

const extractTrailerPrefix = (question: string) => {
  const match = question.match(/\b([A-Z]{2,5}\d{0,2})\b/);
  if (!match?.[1]) {
    return undefined;
  }

  const normalized = normalizeTrailerNumber(match[1]);
  if (/^[A-Z]{2,5}\d{3,8}$/.test(normalized)) {
    return undefined;
  }

  if (!/^[A-Z]{2,5}[0-9]*$/.test(normalized)) {
    return undefined;
  }

  return normalized;
};

const extractCustomer = (question: string) => {
  const match = question.match(/\bcustomer\s+([A-Za-z0-9&'"().,\-\s]{2,60})/i) ?? question.match(/\bfor\s+customer\s+([A-Za-z0-9&'"().,\-\s]{2,60})/i);
  return match?.[1]?.trim() || undefined;
};

const extractCompoundPosition = (question: string) => {
  const match = question.match(/\b(?:in|at|position)\s+(P\d{1,2})\b/i) ?? question.match(/\b(P\d{1,2})\b/i);
  return match?.[1] ? normalizeCompoundPosition(match[1]) : undefined;
};

const extractLoadStatus = (normalized: string): "empty" | "loaded" | undefined => {
  if (/\bempty\b/.test(normalized)) {
    return "empty";
  }

  if (/\bloaded\b/.test(normalized)) {
    return "loaded";
  }

  return undefined;
};

export const detectIntent = (question: string): AssistantIntent => {
  const normalized = normalizeText(question);
  const trailerNumber = extractTrailerNumber(question);
  const trailerPrefix = extractTrailerPrefix(question);
  const customer = extractCustomer(question);
  const compoundPosition = extractCompoundPosition(question);
  const loadStatus = extractLoadStatus(normalized);

  if (/\b(daily\s+operational\s+summary|today'?s\s+operations\s+summary|what\s+happened\s+today|operations\s+summary)\b/.test(normalized)) {
    return { intent: "daily_operations_summary", period: "today", limit: DEFAULT_LIMIT };
  }

  if (/\ballocated\b.*\bstill\b.*\bcompound\b|\ballocated\s+trailers\s+still\s+in\s+compound\b/.test(normalized)) {
    return { intent: "allocated_still_in_compound", limit: DEFAULT_LIMIT };
  }

  if (/\bwaiting\s+collection\b.*\boverdue\b|\boverdue\b.*\bwaiting\s+collection\b|\bwaiting\s+for\s+collection\b/.test(normalized)) {
    return { intent: "waiting_collection_overdue", limit: DEFAULT_LIMIT };
  }

  if (/\barrivals?\b.*\bpending\s+inspection\b|\bpending\s+inspection\b/.test(normalized)) {
    return { intent: "arrivals_pending_inspection", limit: DEFAULT_LIMIT };
  }

  if (/\btemperature\s+alerts?\b|\btemperature\b.*\balerts?\b/.test(normalized)) {
    return { intent: "temperature_alerts", limit: DEFAULT_LIMIT };
  }

  if (/\bdamage\s+alerts?\b|\bdamage\b.*\balerts?\b/.test(normalized)) {
    return { intent: "damage_alerts", limit: DEFAULT_LIMIT };
  }

  if (/\b(open|unresolved)\s+discrepanc/i.test(normalized) || /\bmissing\s+trailers?\b/.test(normalized)) {
    return { intent: "open_discrepancies", unresolvedOnly: true, period: "latest", limit: DEFAULT_LIMIT };
  }

  if (/\boperational\s+status\s+issues\b|\bstatus\s+issues\b|\bproblem\s+status\b/.test(normalized)) {
    return { intent: "operational_status_issues", limit: DEFAULT_LIMIT };
  }

  if (customer && /\btrailers?\b/.test(normalized)) {
    return { intent: "trailers_by_customer", customer, limit: DEFAULT_LIMIT };
  }

  if (compoundPosition && /(what\s+is\s+currently\s+in|what\s+is\s+in|who\s+is\s+in|trailer\s+in\s+p\d{1,2})/.test(normalized)) {
    return { intent: "trailer_at_position", compoundPosition, limit: DEFAULT_LIMIT };
  }

  if (/\bwhere\s+is\s+it\b|\bis\s+it\s+loaded\b|\bwhat\s+status\s+is\s+it\b/.test(normalized)) {
    return { intent: "unknown", limit: DEFAULT_LIMIT };
  }

  if (trailerNumber) {
    if (/\bwhere\s+is\b/.test(normalized)) {
      return { intent: "trailer_location", trailerNumber, limit: 1 };
    }

    if (/\bhistory\b|\btimeline\b|\bevents\b/.test(normalized)) {
      return { intent: "trailer_history_summary", trailerNumber, limit: DEFAULT_LIMIT };
    }

    if (/\bstatus\b|\bfull\s+status\b|\bempty\s+or\s+loaded\b|\bloaded\b|\bempty\b/.test(normalized)) {
      return { intent: "trailer_full_status", trailerNumber, loadStatus, limit: 1 };
    }

    return { intent: "trailer_full_status", trailerNumber, limit: 1 };
  }

  if (trailerPrefix && /\b(where\s+is|status|history)\b/.test(normalized)) {
    return { intent: "ambiguous_trailer", trailerPrefix, limit: DEFAULT_LIMIT };
  }

  return { intent: "unknown", trailerNumber, customer, compoundPosition, loadStatus, limit: DEFAULT_LIMIT };
};
