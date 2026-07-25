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
  const trailerNumber = entities.trailerNumber?.trim();
  const customer = entities.customer?.trim();

  switch (intent) {
    case "trailer_location":
      return trailerNumber ? { intent: "trailer_location", trailerNumber } : { intent: "unknown" };
    case "trailer_full_status":
      return trailerNumber ? { intent: "trailer_current_status", trailerNumber } : { intent: "unknown" };
    case "trailer_history_summary":
      return trailerNumber ? { intent: "find_trailer", trailerNumber } : { intent: "unknown" };
    case "trailers_by_customer":
      return customer ? { intent: "departures_by_customer", customer } : { intent: "unknown" };
    case "trailer_at_position":
      return { intent: "compound_summary" };
    case "allocated_still_in_compound":
      return { intent: "export_allocated" };
    case "waiting_collection_overdue":
      return { intent: "export_overdue" };
    case "arrivals_pending_inspection":
      return { intent: "list_pending_inspections" };
    case "temperature_alerts":
      return { intent: "list_temperature_alerts" };
    case "damage_alerts":
      return { intent: "unresolved_operational_alerts" };
    case "open_discrepancies":
      return { intent: "stock_check_discrepancies" };
    case "operational_status_issues":
      return { intent: "unresolved_operational_alerts" };
    case "daily_operations_summary":
      return { intent: "current_operational_summary" };
    default:
      return { intent: "unknown" };
  }
};
