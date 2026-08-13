import type { DriverMobileTask, DriverTaskAction } from "@/lib/driver-mobile-service";
import { classifyActionFailure, getMaxRetryCount, getRetryBackoffMs } from "@/lib/mobile/mobile-action-queue";

export type DriverMobileQueuedActionState = "pending" | "syncing" | "failed" | "conflict";

export type DriverMobileQueuedAction = {
  id: string;
  bookingId: string;
  action: DriverTaskAction;
  linkedInstructionIds: string[];
  temperatureC: number | null;
  createdAt: string;
  retryCount: number;
  state: DriverMobileQueuedActionState;
  lastError: string | null;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
};

const STORAGE_KEY = "trailerhub.driver-mobile.action-queue.v1";
const MAX_ITEMS = 20;

const isBrowser = () => typeof window !== "undefined";

const toIsoString = (value: unknown, fallback: string) => {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed.toISOString();
};

const toStringOrNull = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toRetryCount = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.floor(value);
};

const toState = (value: unknown): DriverMobileQueuedActionState => {
  if (value === "pending" || value === "syncing" || value === "failed" || value === "conflict") {
    return value;
  }

  return "pending";
};

const normalizeStatus = (value?: string | null) => value?.trim().toLowerCase() ?? "";

export const getDriverQueuedActionKey = (input: Pick<DriverMobileQueuedAction, "bookingId" | "action">) => {
  return `${input.bookingId}::${input.action}`;
};

export const coerceDriverMobileQueuedAction = (value: unknown): DriverMobileQueuedAction | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  const action = row.action;

  if (action !== "ACKNOWLEDGED" && action !== "COLLECTED" && action !== "DELIVERED") {
    return null;
  }

  const bookingId = toStringOrNull(row.bookingId);
  if (!bookingId) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const temperatureC = typeof row.temperatureC === "number" && Number.isFinite(row.temperatureC)
    ? row.temperatureC
    : null;
  const linkedInstructionIds = Array.isArray(row.linkedInstructionIds)
    ? row.linkedInstructionIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  return {
    id: toStringOrNull(row.id) ?? `driver-mobile-action-${nowIso}-${Math.random().toString(16).slice(2)}`,
    bookingId,
    action,
    linkedInstructionIds,
    temperatureC,
    createdAt: toIsoString(row.createdAt, nowIso),
    retryCount: toRetryCount(row.retryCount),
    state: toState(row.state),
    lastError: toStringOrNull(row.lastError),
    lastAttemptAt: toStringOrNull(row.lastAttemptAt),
    nextRetryAt: toStringOrNull(row.nextRetryAt),
  };
};

export const createDriverMobileQueuedAction = (input: {
  bookingId: string;
  action: DriverTaskAction;
  linkedInstructionIds?: string[];
  temperatureC?: number | null;
}): DriverMobileQueuedAction => {
  const nowIso = new Date().toISOString();

  return {
    id: globalThis.crypto?.randomUUID?.() ?? `driver-mobile-action-${nowIso}-${Math.random().toString(16).slice(2)}`,
    bookingId: input.bookingId,
    action: input.action,
    linkedInstructionIds: (input.linkedInstructionIds ?? []).filter((item) => item.trim().length > 0),
    temperatureC: typeof input.temperatureC === "number" && Number.isFinite(input.temperatureC) ? input.temperatureC : null,
    createdAt: nowIso,
    retryCount: 0,
    state: "syncing",
    lastError: null,
    lastAttemptAt: nowIso,
    nextRetryAt: null,
  };
};

const safeParse = (value: string | null) => {
  if (!value) {
    return [] as DriverMobileQueuedAction[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [] as DriverMobileQueuedAction[];
    }

    return parsed
      .map((item) => coerceDriverMobileQueuedAction(item))
      .filter((item): item is DriverMobileQueuedAction => Boolean(item));
  } catch {
    return [] as DriverMobileQueuedAction[];
  }
};

export const loadDriverMobileActionQueue = () => {
  if (!isBrowser()) {
    return [] as DriverMobileQueuedAction[];
  }

  return safeParse(window.localStorage.getItem(STORAGE_KEY)).slice(0, MAX_ITEMS);
};

export const saveDriverMobileActionQueue = (items: DriverMobileQueuedAction[]) => {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
};

export const upsertDriverMobileQueuedAction = (items: DriverMobileQueuedAction[], item: DriverMobileQueuedAction) => {
  const key = getDriverQueuedActionKey(item);
  const next = items.filter((current) => getDriverQueuedActionKey(current) !== key);
  return [item, ...next].slice(0, MAX_ITEMS);
};

export const updateDriverMobileQueuedAction = (
  items: DriverMobileQueuedAction[],
  itemId: string,
  patch: Partial<Pick<DriverMobileQueuedAction, "state" | "retryCount" | "lastError" | "lastAttemptAt" | "nextRetryAt">>,
) => {
  return items.map((item) =>
    item.id === itemId
      ? {
          ...item,
          ...patch,
          lastAttemptAt: patch.lastAttemptAt ?? item.lastAttemptAt ?? new Date().toISOString(),
        }
      : item,
  );
};

export const removeDriverMobileQueuedAction = (items: DriverMobileQueuedAction[], itemId: string) => {
  return items.filter((item) => item.id !== itemId);
};

export const isDriverMobileNetworkFailure = (error: unknown) => {
  if (!isBrowser()) {
    return false;
  }

  if (window.navigator.onLine === false) {
    return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("failed to fetch")
    || message.includes("networkerror")
    || message.includes("load failed")
    || message.includes("network request failed")
    || message.includes("network timeout")
    || message.includes("timeout")
    || message.includes("fetch failed");
};

export const getDriverMobileRetryAt = (retryCount: number) => {
  return new Date(Date.now() + getRetryBackoffMs(retryCount)).toISOString();
};

export const getNextPendingDriverMobileQueuedAction = (items: DriverMobileQueuedAction[]) => {
  const now = Date.now();

  return [...items]
    .filter((item) => item.state === "pending")
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .find((item) => {
      if (!item.nextRetryAt) {
        return true;
      }

      return new Date(item.nextRetryAt).getTime() <= now;
    }) ?? null;
};

export const getPendingDriverMobileQueueDelayMs = (items: DriverMobileQueuedAction[]) => {
  const pending = [...items]
    .filter((item) => item.state === "pending" && item.nextRetryAt)
    .sort((left, right) => new Date(left.nextRetryAt ?? left.createdAt).getTime() - new Date(right.nextRetryAt ?? right.createdAt).getTime())[0];

  if (!pending?.nextRetryAt) {
    return 0;
  }

  return Math.max(0, new Date(pending.nextRetryAt).getTime() - Date.now());
};

const getNextActionAfterAcknowledge = (task: DriverMobileTask): DriverTaskAction | null => {
  const normalized = normalizeStatus(task.status);

  if (normalized === "scheduled" || normalized === "ready" || normalized === "waiting_collection") {
    return "COLLECTED";
  }

  if (normalized === "on_delivery") {
    return "DELIVERED";
  }

  return task.nextAction === "ACKNOWLEDGED" ? null : task.nextAction;
};

const applyOptimisticAction = (task: DriverMobileTask, queuedAction: DriverMobileQueuedAction): DriverMobileTask => {
  const nowIso = queuedAction.lastAttemptAt ?? queuedAction.createdAt;

  if (queuedAction.action === "ACKNOWLEDGED") {
    return {
      ...task,
      driverAcknowledgedAt: task.driverAcknowledgedAt ?? nowIso,
      nextAction: getNextActionAfterAcknowledge(task),
    };
  }

  if (queuedAction.action === "COLLECTED") {
    const normalized = normalizeStatus(task.status);

    if (normalized === "waiting_collection") {
      return {
        ...task,
        status: "collected",
        group: "completed",
        nextAction: null,
        collectedAt: task.collectedAt ?? nowIso,
        collectedTemperatureC: queuedAction.temperatureC ?? task.collectedTemperatureC,
      };
    }

    return {
      ...task,
      status: "on_delivery",
      group: "current",
      nextAction: "DELIVERED",
      collectedAt: task.collectedAt ?? nowIso,
      collectedTemperatureC: queuedAction.temperatureC ?? task.collectedTemperatureC,
      driverAcknowledgedAt: task.driverAcknowledgedAt ?? nowIso,
    };
  }

  return {
    ...task,
    status: "delivered",
    group: "completed",
    nextAction: null,
    deliveredAt: task.deliveredAt ?? nowIso,
    driverAcknowledgedAt: task.driverAcknowledgedAt ?? nowIso,
  };
};

export const applyDriverMobileQueuedActions = (tasks: DriverMobileTask[], queuedActions: DriverMobileQueuedAction[]) => {
  const optimisticActions = queuedActions.filter((item) => item.state === "pending" || item.state === "syncing");

  return tasks.map((task) => {
    const queuedAction = optimisticActions.find((item) => item.bookingId === task.bookingId);
    if (!queuedAction) {
      return task;
    }

    return applyOptimisticAction(task, queuedAction);
  });
};

export const isDriverMobileActionSatisfied = (task: DriverMobileTask | null | undefined, action: DriverTaskAction) => {
  if (!task) {
    return false;
  }

  const normalized = normalizeStatus(task.status);

  if (action === "ACKNOWLEDGED") {
    return Boolean(task.driverAcknowledgedAt) || task.nextAction !== "ACKNOWLEDGED";
  }

  if (action === "COLLECTED") {
    return normalized === "on_delivery" || normalized === "collected" || normalized === "delivered";
  }

  return normalized === "delivered";
};

export const reconcileDriverMobileQueuedActions = (queuedActions: DriverMobileQueuedAction[], tasks: DriverMobileTask[]) => {
  const taskByBookingId = new Map(tasks.map((task) => [task.bookingId, task]));

  return queuedActions.filter((item) => !isDriverMobileActionSatisfied(taskByBookingId.get(item.bookingId), item.action));
};

export const findDriverMobileQueuedAction = (queuedActions: DriverMobileQueuedAction[], bookingId: string) => {
  return queuedActions.find((item) => item.bookingId === bookingId) ?? null;
};

export const toDriverMobileQueuedFailure = (error: unknown, retryCount: number) => {
  const classified = classifyActionFailure(error);
  const nextRetryCount = retryCount + 1;

  if (!classified.retryable || nextRetryCount > getMaxRetryCount()) {
    return {
      state: classified.retryable ? ("failed" as const) : (classified.state === "conflict" ? "conflict" as const : "failed" as const),
      retryCount: nextRetryCount,
      lastError: classified.message,
      nextRetryAt: null,
    };
  }

  return {
    state: "pending" as const,
    retryCount: nextRetryCount,
    lastError: classified.message,
    nextRetryAt: getDriverMobileRetryAt(nextRetryCount),
  };
};