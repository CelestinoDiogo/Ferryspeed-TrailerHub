import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import type { AiAssistantResponse } from "@/lib/ai-assistant-types";
import { detectIntent } from "@/lib/ai-assistant-foundation/intent-detection";
import { runIntentQuery } from "@/lib/ai-assistant-foundation/query-service";
import { formatAssistantResponse } from "@/lib/ai-assistant-foundation/response-formatter";

const promptRequestSchema = z.object({
  question: z.string().trim().min(1).max(300),
});

const writeIntentPattern = /\b(update|edit|change|delete|remove|insert|create|set|mark|assign|allocate|move)\b/i;
const sqlPattern = /\b(select|update|delete|insert|drop|alter|truncate)\b[\s\S]*\bfrom\b/i;

const containsWriteIntent = (question: string) => writeIntentPattern.test(question);
const looksLikeSql = (question: string) => sqlPattern.test(question);

export async function runAiAssistantFoundationQuery(
  supabase: SupabaseClient<Database>,
  question: string,
): Promise<AiAssistantResponse> {
  const parsed = promptRequestSchema.parse({ question });
  const normalizedQuestion = parsed.question.trim();

  if (containsWriteIntent(normalizedQuestion) || looksLikeSql(normalizedQuestion)) {
    return {
      title: "Read-only assistant",
      answer: "The AI Assistant is currently read-only. Please use the relevant operational module to make changes.",
      resultType: "text",
      data: [],
      summary: [{ label: "Access", value: "Read-only" }],
      links: [],
      queriedAt: new Date().toISOString(),
      truncated: false,
    };
  }

  const intent = detectIntent(normalizedQuestion);
  const result = await runIntentQuery({ supabase, question: normalizedQuestion }, intent);
  return formatAssistantResponse(result);
}
