import "server-only";
import { z } from "zod";
import type { VesselOperationalReportData, VesselOperationAiReportDraft, VesselOperationAiReportSections } from "@/lib/reports/types";
import {
  buildDeterministicVesselOperationAiReportDraft as buildDeterministicVesselOperationAiReportDraftShared,
  buildDeterministicVesselOperationAiReportSections as buildDeterministicVesselOperationAiReportSectionsShared,
  buildVesselOperationAiReportBody as buildVesselOperationAiReportBodyShared,
  buildVesselOperationAiReportSubject as buildVesselOperationAiReportSubjectShared,
} from "@/lib/reports/vessel-operation-ai-report-shared";

const aiSectionsSchema = z.object({
  operationOverview: z.string().trim().min(1),
  trailerDischargeSummary: z.string().trim().min(1),
  inspectionSummary: z.string().trim().min(1),
  damageFindings: z.string().trim().min(1),
  temperatureFindings: z.string().trim().min(1),
  outstandingItems: z.string().trim().min(1),
  finalOperationalStatus: z.string().trim().min(1),
});

const modelName = process.env.OPENAI_MODEL || "gpt-4o-mini";

export function buildDeterministicVesselOperationAiReportSections(data: VesselOperationalReportData): VesselOperationAiReportSections {
  return buildDeterministicVesselOperationAiReportSectionsShared(data);
}

export function buildVesselOperationAiReportSubject(data: VesselOperationalReportData): string {
  return buildVesselOperationAiReportSubjectShared(data);
}

export function buildVesselOperationAiReportBody(sections: VesselOperationAiReportSections): string {
  return buildVesselOperationAiReportBodyShared(sections);
}

export function buildDeterministicVesselOperationAiReportDraft(data: VesselOperationalReportData): VesselOperationAiReportDraft {
  return buildDeterministicVesselOperationAiReportDraftShared(data);
}

export async function generateVesselOperationAiSections(data: VesselOperationalReportData): Promise<{ sections: VesselOperationAiReportSections; model: string }> {
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
        content: [
          "You are an operational reporting assistant for a professional freight and ferry operations company.",
          "Write in professional British English.",
          "Use only the facts supplied in the structured operation data.",
          "Never invent trailer numbers, customer names, bookings, incidents, times, quantities, temperatures, causes of damage, actions taken, or conclusions not supported by the data.",
          "Never use hyphen placeholders in prose such as from - to berth -, actual arrival was -, customer -, or expected temperature -.",
          "When a field is missing, omit that phrase or write a clear sentence such as Actual arrival was not recorded.",
          "Use natural grammar and correct pluralisation: 1 trailer vs 2 trailers, 1 inspection vs 2 inspections, 1 damage record vs 2 damage records, 1 temperature alert vs 2 temperature alerts.",
          "For long trailer lists, show at most 10 trailer numbers in prose and then state how many additional trailers exist.",
          "Provide concise professional language and avoid robotic metric strings.",
          "The first paragraph in operationOverview must be a short executive summary and must not include a full trailer list.",
          "For damageFindings, return exactly No damage was recorded for this vessel operation. when there are no damages.",
          "For outstandingItems, include only non-zero pending items. If none exist, return exactly All expected trailers have been accounted for and no inspection items remain outstanding.",
          "For temperatureFindings, do not claim alerts when expected temperatures are not defined.",
          "Use compact markdown tables in inspectionSummary, damageFindings, and temperatureFindings when helpful.",
          "Do not claim damage occurred unless explicitly recorded in the data.",
          "Do not claim temperature compliance or non-compliance unless the data supports it.",
          "Clearly state when no damage or alert exists.",
          "Mention not-discharged trailers by number, damaged trailers by number, and temperature-alert trailers by number.",
          "Use front and rear temperature readings separately.",
          "Avoid exaggerated language.",
          "Return JSON with these keys only: operationOverview, trailerDischargeSummary, inspectionSummary, damageFindings, temperatureFindings, outstandingItems, finalOperationalStatus.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          instruction: "Generate the full operational report sections from the live vessel operation data.",
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

  const responseData = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  const rawContent = responseData.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("OpenAI API returned empty response content.");
  }

  const parsedJson = JSON.parse(rawContent) as unknown;
  const validated = aiSectionsSchema.parse(parsedJson);

  return {
    sections: validated,
    model: modelName,
  };
}