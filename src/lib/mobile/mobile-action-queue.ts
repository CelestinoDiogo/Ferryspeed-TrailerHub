import {
  coerceQueueItem,
  createMobileActionQueueItem,
  type MobileActionQueueItem,
} from "@/lib/mobile/mobile-actions";

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

    return parsed
      .map((item) => coerceQueueItem(item))
      .filter((item): item is MobileActionQueueItem => Boolean(item));
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

export { createMobileActionQueueItem };

export const updateQueuedAction = (
  items: MobileActionQueueItem[],
  itemId: string,
  patch: Partial<
    Pick<
      MobileActionQueueItem,
      "state" | "retryCount" | "lastError" | "conflict" | "lastAttemptAt" | "nextRetryAt"
    >
  >,
) => {
  return items.map((item) =>
    item.id === itemId
      ? {
          ...item,
          ...patch,
          lastAttemptAt: patch.lastAttemptAt ?? new Date().toISOString(),
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
    return { state: "conflict" as const, message, retryable: false };
  }

  if (normalized.includes("permission") || normalized.includes("unauthorized") || normalized.includes("forbidden") || normalized.includes("invalid")) {
    return { state: "failed" as const, message, retryable: false };
  }

  return { state: "failed" as const, message, retryable: true };
};

export const getRetryBackoffMs = (retryCount: number) => {
  const bounded = Math.max(0, Math.min(retryCount, 6));
  return 1000 * 2 ** bounded;
};

export const getMaxRetryCount = () => 5;