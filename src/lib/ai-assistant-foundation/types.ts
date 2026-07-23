import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { AiAssistantResponse } from "@/lib/ai-assistant-types";

export type AssistantIntentName =
  | "trailer_full_status"
  | "trailer_location"
  | "trailer_history_summary"
  | "trailers_by_customer"
  | "trailer_at_position"
  | "allocated_still_in_compound"
  | "waiting_collection_overdue"
  | "arrivals_pending_inspection"
  | "temperature_alerts"
  | "damage_alerts"
  | "open_discrepancies"
  | "operational_status_issues"
  | "daily_operations_summary"
  | "ambiguous_trailer"
  | "unknown";

export type AssistantIntent = {
  intent: AssistantIntentName;
  trailerNumber?: string;
  trailerPrefix?: string;
  customer?: string;
  compoundPosition?: string;
  operationalStatus?: string;
  loadStatus?: "empty" | "loaded";
  priority?: "high" | "normal" | "low";
  period?: "today" | "latest";
  unresolvedOnly?: boolean;
  limit?: number;
};

export type AssistantQueryResult = {
  intent: AssistantIntentName;
  title: string;
  answer: string;
  resultType: AiAssistantResponse["resultType"];
  data: Array<Record<string, unknown>>;
  summary?: AiAssistantResponse["summary"];
  links?: AiAssistantResponse["links"];
  truncated?: boolean;
};

export type AssistantContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  question: string;
};
