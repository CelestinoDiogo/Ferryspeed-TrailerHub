import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { AiAssistantResponse } from "@/lib/ai-assistant-types";

export type AssistantIntentName =
  | "where_is_trailer"
  | "show_empty_trailers"
  | "show_loaded_trailers"
  | "compound_occupancy"
  | "todays_arrivals"
  | "waiting_collection"
  | "missing_trailers"
  | "unexpected_trailers"
  | "allocated_trailers"
  | "unknown";

export type AssistantIntent = {
  intent: AssistantIntentName;
  trailerNumber?: string;
};

export type AssistantQueryResult = {
  intent: AssistantIntentName;
  title: string;
  answer: string;
  resultType: AiAssistantResponse["resultType"];
  data: Array<Record<string, unknown>>;
  summary?: AiAssistantResponse["summary"];
  links?: AiAssistantResponse["links"];
};

export type AssistantContext = {
  supabase: SupabaseClient<Database>;
  question: string;
};
