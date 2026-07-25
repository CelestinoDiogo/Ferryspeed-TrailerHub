export type MobileActionQueueSource = "home" | "operations" | "compound" | "search" | "more";

export type MobileActionQueueStatus = "pending" | "syncing" | "failed" | "conflict";

export type MobileActionQueueItem = {
  id: string;
  createdAt: string;
  updatedAt: string;
  source: MobileActionQueueSource;
  label: string;
  commandText: string;
  trailerNumber?: string | null;
  status: MobileActionQueueStatus;
  attempts: number;
  error?: string | null;
};

const STORAGE_KEY = "trailerhub.mobile.action-queue.v1";
const MAX_ITEMS = 30;

const isBrowser = () => typeof window !== "undefined";

const safeParse = (value: string | null): MobileActionQueueItem[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is MobileActionQueueItem => {
      return Boolean(
        item &&
          typeof item === "object" &&
          typeof item.id === "string" &&
          typeof item.createdAt === "string" &&
          typeof item.updatedAt === "string" &&
          typeof item.label === "string" &&
          typeof item.commandText === "string" &&
          typeof item.source === "string" &&
          typeof item.status === "string" &&
          typeof item.attempts === "number",
      );
    });
  } catch {
    return [];
  }
};

export const loadMobileActionQueue = (): MobileActionQueueItem[] => {
  if (!isBrowser()) {
    return [];
  }

  return safeParse(window.localStorage.getItem(STORAGE_KEY)).slice(0, MAX_ITEMS);
};

export const saveMobileActionQueue = (items: MobileActionQueueItem[]) => {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
};

export const createMobileActionQueueItem = (input: {
  source: MobileActionQueueSource;
  label: string;
  commandText: string;
  trailerNumber?: string | null;
}): MobileActionQueueItem => {
  const now = new Date().toISOString();

  return {
    id: globalThis.crypto?.randomUUID?.() ?? `mobile-action-${now}-${Math.random().toString(16).slice(2)}`,
    createdAt: now,
    updatedAt: now,
    source: input.source,
    label: input.label,
    commandText: input.commandText,
    trailerNumber: input.trailerNumber ?? null,
    status: "pending",
    attempts: 0,
    error: null,
  };
};

export const updateQueuedAction = (
  items: MobileActionQueueItem[],
  itemId: string,
  patch: Partial<Pick<MobileActionQueueItem, "status" | "attempts" | "error">>,
) => {
  return items.map((item) =>
    item.id === itemId
      ? {
          ...item,
          ...patch,
          updatedAt: new Date().toISOString(),
        }
      : item,
  );
};

export const removeQueuedAction = (items: MobileActionQueueItem[], itemId: string) => {
  return items.filter((item) => item.id !== itemId);
};

export const classifyActionFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Unable to sync action.";
  const normalized = message.toLowerCase();

  if (normalized.includes("conflict") || normalized.includes("already") || normalized.includes("stale") || normalized.includes("missing")) {
    return { status: "conflict" as const, message };
  }

  return { status: "failed" as const, message };
};