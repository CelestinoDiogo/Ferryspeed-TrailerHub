import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type {
  AiAssistantAction,
  AiAssistantContext,
  AiAssistantIntent,
  AiAssistantIntentName,
  AiAssistantItem,
} from "@/lib/ai-assistant-types";

export type AssistantIntent = AiAssistantIntent;
export type AssistantIntentName = AiAssistantIntentName;

export type AssistantQueryResult = {
  intent: AssistantIntentName;
  title: string;
  summary: string;
  count?: number;
  items?: AiAssistantItem[];
  actions?: AiAssistantAction[];
  sourceModules: string[];
};

export type AssistantContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  question: string;
  pageContext?: AiAssistantContext;
};
