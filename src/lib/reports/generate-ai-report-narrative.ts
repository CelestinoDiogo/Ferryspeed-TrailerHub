import "server-only";
import { z } from "zod";
import type { AIReportNarrative, VesselOperationalReportData } from "@/lib/reports/types";

const aiNarrativeSchema = z.object({
  executiveSummary: z.string().trim().min(1),
  operationalAnalysis: z.string().trim().min(1),
  recommendations: z.array(z.string().trim().min(1)).min(1),
  conclusion: z.string().trim().min(1),
});

const modelName = process.env.OPENAI_MODEL || "gpt-4o-mini";

const SYSTEM_INSTRUCTIONS = [
  "You are an operational reporting assistant for a professional freight and ferry operations company.",
  "Write in professional British English.",
  "Use only the facts supplied in the structured operation data.",
  "Never invent trailer numbers, customer names, bookings, incidents, times, quantities, temperatures, causes of damage, actions taken, or conclusions not supported by the data.",
  "Do not claim damage occurred during vessel discharge unless explicitly stated in the data.",
  "Do not claim temperature compliance or non-compliance unless deterministic input includes that result.",
  "Clearly distinguish confirmed fact, recorded observation, pending action, and recommendation.",
  "Keep the executive summary concise and management-friendly.",
  "Highlight critical exceptions without exaggeration.",
  "Do not generate markdown tables.",
  "Return JSON with these keys only: executiveSummary, operationalAnalysis, recommendations, conclusion.",
].join(" ");

export async function generateAIReportNarrative(data: VesselOperationalReportData): Promise<{ narrative: AIReportNarrative; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  const payload = {
    model: modelName,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: SYSTEM_INSTRUCTIONS,
      },
      {
        role: "user",
        content: JSON.stringify({
          instruction: "Generate the operational narrative fields only.",
          operationFacts: data,
        }),
      },
    ],
    temperature: 0.2,
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
  }

  const dataResponse = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  const rawContent = dataResponse.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("OpenAI API returned empty response content.");
  }

  const parsedJson = JSON.parse(rawContent) as unknown;
  const validated = aiNarrativeSchema.parse(parsedJson);

  return {
    narrative: validated,
    model: modelName,
  };
}
