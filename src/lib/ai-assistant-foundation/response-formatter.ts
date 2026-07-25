import type { AiAssistantResponse } from "@/lib/ai-assistant-types";
import type { AssistantQueryResult } from "@/lib/ai-assistant-foundation/types";

export const formatAssistantResponse = (result: AssistantQueryResult): AiAssistantResponse => {
  const items = result.items ?? [];
  const actions = result.actions ?? [];

  return {
    intent: result.intent,
    title: result.title,
    summary: result.summary,
    count: typeof result.count === "number" ? result.count : items.length,
    items,
    actions,
    sourceModules: result.sourceModules,
    queriedAt: new Date().toISOString(),
    // Legacy fields for existing consumers.
    answer: result.summary,
    resultType: items.length <= 1 ? "trailer" : "trailer_list",
    data: items as Array<Record<string, unknown>>,
    links: actions.map((action) => ({ label: action.label, href: action.route })),
  };
};
