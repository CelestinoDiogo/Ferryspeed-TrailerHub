import { z } from "zod";

export const aiAssistantIntents = [
  "find_trailer",
  "count_compound",
  "list_compound",
  "count_empty",
  "list_empty",
  "count_loaded",
  "list_loaded",
  "list_waiting_compound",
  "arrivals_today",
  "departures_today",
  "vessel_operations_today",
  "export_by_status",
  "trailers_by_customer",
  "trailers_with_damage",
  "trailers_with_temperature_alert",
  "latest_inspection",
  "trailer_history",
  "unknown",
] as const;

export const allowedExportStatuses = [
  "allocated",
  "delivered_empty",
  "waiting_loading",
  "collected_loaded",
  "completed",
  "cancelled",
] as const;

export const aiAssistantIntentSchema = z.object({
  intent: z.enum(aiAssistantIntents),
  trailerNumber: z.string().trim().optional(),
  customer: z.string().trim().optional(),
  status: z.enum(allowedExportStatuses).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export type AiAssistantIntent = z.infer<typeof aiAssistantIntentSchema>;
export type AiAssistantIntentName = AiAssistantIntent["intent"];

export type AiAssistantLink = {
  label: string;
  href: string;
};

export type AiAssistantRecord = Record<string, unknown>;

export type AiAssistantResponse = {
  answer: string;
  resultType: AiAssistantIntentName;
  intent: AiAssistantIntentName;
  data: AiAssistantRecord[];
  summary: Record<string, unknown> | null;
  links: AiAssistantLink[];
  timestamp: string;
  truncated: boolean;
  provider: "openai" | "rules";
  usedFallback: boolean;
  notice?: string | null;
};
