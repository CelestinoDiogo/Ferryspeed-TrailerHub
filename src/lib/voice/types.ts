import type { AssistantIntent } from "@/lib/ai-assistant-foundation/types";

export const voiceReadIntentNames = [
  "trailer_location",
  "trailer_full_status",
  "trailer_history_summary",
  "trailers_by_customer",
  "trailer_at_position",
  "allocated_still_in_compound",
  "waiting_collection_overdue",
  "arrivals_pending_inspection",
  "temperature_alerts",
  "damage_alerts",
  "open_discrepancies",
  "operational_status_issues",
  "daily_operations_summary",
] as const;

export const voiceActionIntentNames = [
  "confirm_departure",
  "change_load_status",
  "change_compound_position",
  "start_inspection",
  "complete_inspection",
  "set_priority",
  "mark_arrived",
] as const;

export type VoiceReadIntentName = (typeof voiceReadIntentNames)[number];
export type VoiceActionIntentName = (typeof voiceActionIntentNames)[number];

export type VoiceIntentName = VoiceReadIntentName | VoiceActionIntentName | "unknown";

export type VoicePriority = "high" | "normal" | "low";

export type VoiceEntities = {
  trailerNumber?: string;
  customer?: string;
  compoundPosition?: string;
  loadStatus?: "Loaded" | "Empty";
  priority?: VoicePriority;
};

export type VoiceContext = {
  lastTrailerNumber: string | null;
  lastIntent: VoiceIntentName | null;
  lastCustomer: string | null;
};

export type VoiceCommand = {
  sourceText: string;
  normalizedText: string;
  intent: VoiceIntentName;
  entities: VoiceEntities;
  requiresConfirmation: boolean;
  confidence: "high" | "medium" | "low";
  clarification: string | null;
};

export type VoiceExecutionMode = "read" | "action";

export type VoiceActionPlan = {
  intent: VoiceActionIntentName;
  confirmationText: string;
  safetyLevel: "high" | "medium";
  moduleHref: string;
  moduleLabel: string;
};

export type VoiceExecutionResponse = {
  ok: boolean;
  mode: VoiceExecutionMode;
  intent: VoiceIntentName;
  entities: VoiceEntities;
  message: string;
  actionPlan: VoiceActionPlan | null;
  assistantResult: {
    title?: string;
    answer: string;
    resultType: string;
    dataCount: number;
    links: Array<{ label: string; href: string }>;
  } | null;
  context: VoiceContext;
};

export const initialVoiceContext: VoiceContext = {
  lastTrailerNumber: null,
  lastIntent: null,
  lastCustomer: null,
};

export const isVoiceReadIntent = (intent: VoiceIntentName): intent is VoiceReadIntentName => {
  return voiceReadIntentNames.includes(intent as VoiceReadIntentName);
};

export const isVoiceActionIntent = (intent: VoiceIntentName): intent is VoiceActionIntentName => {
  return voiceActionIntentNames.includes(intent as VoiceActionIntentName);
};

export const toAssistantIntent = (intent: VoiceReadIntentName, entities: VoiceEntities): AssistantIntent => {
  switch (intent) {
    case "trailer_location":
      return { intent: "trailer_location", trailerNumber: entities.trailerNumber };
    case "trailer_full_status":
      return { intent: "trailer_full_status", trailerNumber: entities.trailerNumber };
    case "trailer_history_summary":
      return { intent: "trailer_history_summary", trailerNumber: entities.trailerNumber };
    case "trailers_by_customer":
      return { intent: "trailers_by_customer", customer: entities.customer };
    case "trailer_at_position":
      return { intent: "trailer_at_position", compoundPosition: entities.compoundPosition };
    case "allocated_still_in_compound":
      return { intent: "allocated_still_in_compound" };
    case "waiting_collection_overdue":
      return { intent: "waiting_collection_overdue" };
    case "arrivals_pending_inspection":
      return { intent: "arrivals_pending_inspection" };
    case "temperature_alerts":
      return { intent: "temperature_alerts" };
    case "damage_alerts":
      return { intent: "damage_alerts" };
    case "open_discrepancies":
      return { intent: "open_discrepancies", unresolvedOnly: true };
    case "operational_status_issues":
      return { intent: "operational_status_issues" };
    case "daily_operations_summary":
      return { intent: "daily_operations_summary" };
    default:
      return { intent: "unknown" };
  }
};
