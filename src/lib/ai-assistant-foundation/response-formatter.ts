import type { AiAssistantResponse } from "@/lib/ai-assistant-types";
import type { AssistantQueryResult } from "@/lib/ai-assistant-foundation/types";

export const formatAssistantResponse = (result: AssistantQueryResult): AiAssistantResponse => {
  return {
    title: result.title,
    answer: result.answer,
    resultType: result.resultType,
    data: result.data,
    summary: result.summary,
    links: result.links ?? [],
    queriedAt: new Date().toISOString(),
    truncated: result.truncated ?? false,
  };
};
