import type { AiAssistantContext, AiAssistantPreparedAction } from "@/lib/ai-assistant-types";
import { normalizeTrailerNumber } from "@/lib/vessel-operations";

const normalizeText = (value: string) => value.trim().toLowerCase();

const extractTrailerNumber = (question: string) => {
  const match = question.match(/\b([A-Z]{2,5})[\s\-_/]*(\d{1,6})\b/i);
  if (!match) {
    return null;
  }

  return normalizeTrailerNumber(`${match[1]}${match[2]}`);
};

const extractCompoundPosition = (question: string) => {
  const match = question.match(/\b(?:to|into|at)\s+([A-Z]\d{1,3})\b/i);
  return match?.[1]?.trim().toUpperCase() ?? null;
};

const withQuery = (basePath: string, params: Array<[string, string | null | undefined]>) => {
  const query = params
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");

  return query ? `${basePath}?${query}` : basePath;
};

export const prepareSafeActionFromQuestion = (
  question: string,
  context?: AiAssistantContext,
): AiAssistantPreparedAction[] => {
  const normalized = normalizeText(question);
  const trailerNumber = extractTrailerNumber(question) ?? context?.openedTrailerNumber ?? null;

  if (/(mark|confirm)\s+.*\barrived\b|\barrived\b.*\btrailer\b/.test(normalized)) {
    return [
      {
        id: "mark-arrived",
        label: "Prepare arrival confirmation",
        requiresConfirmation: true,
        confirmationPrompt: `Confirm arrival workflow for ${trailerNumber ?? "the selected trailer"}?`,
        moduleLabel: "Arrivals",
        moduleHref: withQuery("/dashboard/new-arrival", [["trailer", trailerNumber]]),
        safetyLevel: "high",
      },
    ];
  }

  if (/\bmove\b.*\bcompound\b|\bmove\b.*\bposition\b/.test(normalized)) {
    const position = extractCompoundPosition(question);
    return [
      {
        id: "move-compound-position",
        label: "Prepare compound move",
        requiresConfirmation: true,
        confirmationPrompt: `Confirm move ${trailerNumber ?? "selected trailer"}${position ? ` to ${position}` : ""}?`,
        moduleLabel: "Edit Trailer",
        moduleHref: withQuery("/dashboard/edit-trailer", [
          ["action", "move_to_compound"],
          ["trailer", trailerNumber],
          ["position", position],
        ]),
        safetyLevel: "high",
      },
    ];
  }

  if (/\b(set|change|update)\b.*\b(load|loaded|empty)\b/.test(normalized)) {
    const loadStatus = /\bempty\b/.test(normalized) ? "Empty" : /\bloaded\b/.test(normalized) ? "Loaded" : null;
    return [
      {
        id: "change-load-status",
        label: "Prepare load status change",
        requiresConfirmation: true,
        confirmationPrompt: `Confirm load status change for ${trailerNumber ?? "selected trailer"}${loadStatus ? ` to ${loadStatus}` : ""}?`,
        moduleLabel: "Load Trailer",
        moduleHref: withQuery("/dashboard/load-trailer", [
          ["trailer", trailerNumber],
          ["loadStatus", loadStatus],
        ]),
        safetyLevel: "high",
      },
    ];
  }

  if (/\bstart\b.*\binspection\b/.test(normalized)) {
    return [
      {
        id: "start-inspection",
        label: "Prepare inspection start",
        requiresConfirmation: true,
        confirmationPrompt: `Confirm inspection start for ${trailerNumber ?? "selected trailer"}?`,
        moduleLabel: "Vessel Operations",
        moduleHref: withQuery("/dashboard/vessel-operations", [["trailer", trailerNumber]]),
        safetyLevel: "medium",
      },
    ];
  }

  if (/\bcomplete\b.*\binspection\b/.test(normalized)) {
    return [
      {
        id: "complete-inspection",
        label: "Prepare inspection completion",
        requiresConfirmation: true,
        confirmationPrompt: `Confirm inspection completion for ${trailerNumber ?? "selected trailer"}?`,
        moduleLabel: "Vessel Operations",
        moduleHref: withQuery("/dashboard/vessel-operations", [["trailer", trailerNumber]]),
        safetyLevel: "high",
      },
    ];
  }

  return [];
};
