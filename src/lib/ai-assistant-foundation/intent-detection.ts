import type { AssistantIntent } from "@/lib/ai-assistant-foundation/types";

const normalizeText = (value: string) => value.trim().toLowerCase();
const normalizeTrailerNumber = (value: string) => value.trim().toUpperCase();

const extractTrailerNumber = (question: string) => {
  const match = question.match(/\b([A-Za-z]{2,5}\d{3,8})\b/);
  return match?.[1] ? normalizeTrailerNumber(match[1]) : undefined;
};

export const detectIntent = (question: string): AssistantIntent => {
  const normalized = normalizeText(question);
  const trailerNumber = extractTrailerNumber(question);

  if ((/where\s+is\s+trailer|where\s+is/.test(normalized) || normalized.startsWith("trailer ")) && trailerNumber) {
    return { intent: "where_is_trailer", trailerNumber };
  }

  if (/show\s+empty\s+trailers|empty\s+trailers/.test(normalized)) {
    return { intent: "show_empty_trailers" };
  }

  if (/show\s+loaded\s+trailers|loaded\s+trailers/.test(normalized)) {
    return { intent: "show_loaded_trailers" };
  }

  if (/compound\s+occupancy|occupancy\s+of\s+compound|how\s+full\s+is\s+compound/.test(normalized)) {
    return { intent: "compound_occupancy" };
  }

  if (/today'?s\s+arrivals|arrivals\s+today|what\s+arrived\s+today/.test(normalized)) {
    return { intent: "todays_arrivals" };
  }

  if (/waiting\s+collection|waiting\s+for\s+collection/.test(normalized)) {
    return { intent: "waiting_collection" };
  }

  if (/missing\s+trailers|missing\s+from\s+stock\s+check/.test(normalized)) {
    return { intent: "missing_trailers" };
  }

  if (/unexpected\s+trailers|unexpected\s+in\s+stock\s+check/.test(normalized)) {
    return { intent: "unexpected_trailers" };
  }

  if (/allocated\s+trailers|show\s+allocated/.test(normalized)) {
    return { intent: "allocated_trailers" };
  }

  return { intent: "unknown", trailerNumber };
};
