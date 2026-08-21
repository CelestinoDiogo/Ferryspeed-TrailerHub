"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { toRoleLabel, type RoleKey } from "@/lib/auth/roles";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { useOperationalRealtime } from "@/lib/realtime/operational-realtime";
import { supabase } from "@/lib/supabase";
import { type DriverMobileTask } from "@/lib/driver-mobile-service";
import {
  applyDriverMobileQueuedActions,
  createDriverMobileQueuedAction,
  findDriverMobileQueuedAction,
  getNextPendingDriverMobileQueuedAction,
  getPendingDriverMobileQueueDelayMs,
  isDriverMobileActionSatisfied,
  isDriverMobileNetworkFailure,
  loadDriverMobileActionQueue,
  reconcileDriverMobileQueuedActions,
  removeDriverMobileQueuedAction,
  saveDriverMobileActionQueue,
  toDriverMobileQueuedFailure,
  upsertDriverMobileQueuedAction,
  updateDriverMobileQueuedAction,
  type DriverMobileQueuedAction,
} from "@/lib/mobile/driver-mobile-action-queue";
import { getSessionToken, SESSION_EXPIRED_MESSAGE } from "@/lib/voice/session";
import {
  DRIVER_MOBILE_LANGUAGES,
  readDriverMobileLanguage,
  translateDriverMobile,
  writeDriverMobileLanguage,
  type DriverMobileLanguage,
  type DriverMobileTranslationKey,
} from "@/lib/mobile/driver-mobile-i18n";

type DriverTaskResponse = {
  driver: {
    id: string;
    display_name: string;
    user_id: string;
  } | null;
  tasks: DriverMobileTask[];
};

type DriverInstructionRecord = {
  id: string;
  deliveryBookingId: string | null;
  trailerId: string | null;
  trailerNumber: string | null;
  instruction: string;
  priority: "normal" | "high" | "critical";
  senderDisplayName: string | null;
  createdAt: string;
  readAt: string | null;
  isRead: boolean;
};

type DriverResponseType = "OK" | "COMPLETED" | "ARRIVED" | "DELAYED" | "PROBLEM" | "CALL_ME";

type DriverInstructionFeed = {
  unreadCount: number;
  newestUnread: DriverInstructionRecord | null;
  recent: DriverInstructionRecord[];
};

type OverlayAlertSeverity = "yellow" | "red";

type OverlayAlertCandidate = {
  key: string;
  kind: "instruction" | "task";
  severity: OverlayAlertSeverity;
  createdAt: string;
  label: "NEW INSTRUCTION" | "NEW MESSAGE" | "NEW ASSIGNMENT";
  instruction: DriverInstructionRecord | null;
  task: DriverMobileTask | null;
};

const toStatusLabel = (value: string) =>
  value
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

const formatSchedule = (date: string, time: string | null) => {
  const base = time ? `${date}T${time}` : `${date}T00:00:00`;
  const parsed = new Date(base);
  if (Number.isNaN(parsed.getTime())) {
    return `${date}${time ? ` ${time.slice(0, 5)}` : ""}`;
  }

  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const parseTemperature = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const formatCompletedTime = (value: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const isToday = (value: string | null) => {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;

  const today = new Date();
  return parsed.getFullYear() === today.getFullYear() && parsed.getMonth() === today.getMonth() && parsed.getDate() === today.getDate();
};

const toInstructionPriorityTone = (priority: DriverInstructionRecord["priority"]) => {
  if (priority === "critical") {
    return "border-rose-300 bg-rose-50 text-rose-900";
  }

  if (priority === "high") {
    return "border-amber-300 bg-amber-50 text-amber-900";
  }

  return "border-cyan-300 bg-cyan-50 text-cyan-900";
};

const matchesInstructionToTask = (instruction: DriverInstructionRecord, task: DriverMobileTask) => {
  if (instruction.deliveryBookingId && instruction.deliveryBookingId === task.bookingId) {
    return true;
  }

  if (instruction.trailerId && instruction.trailerId === task.trailerId) {
    return true;
  }

  return false;
};

const queuedActionMessage = (queuedAction: DriverMobileQueuedAction | null) => {
  if (!queuedAction) {
    return null;
  }

  if (queuedAction.state === "syncing") {
    return "Sending...";
  }

  if (queuedAction.state === "pending") {
    return "Saved - waiting for connection";
  }

  if (queuedAction.state === "failed") {
    return "Could not finish. Retry";
  }

  return "Could not finish";
};

const INSTRUCTION_ACK_QUEUE_KEY = "trailerhub.driver-mobile.instruction-ack-queue.v1";

const loadPendingInstructionAcks = () => {
  if (typeof window === "undefined") {
    return [] as string[];
  }

  const raw = window.localStorage.getItem(INSTRUCTION_ACK_QUEUE_KEY);
  if (!raw) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [] as string[];
    }

    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [] as string[];
  }
};

const savePendingInstructionAcks = (ids: string[]) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(INSTRUCTION_ACK_QUEUE_KEY, JSON.stringify(ids));
};

const supportsVibration = () => {
  if (typeof window === "undefined") {
    return false;
  }

  return typeof window.navigator?.vibrate === "function";
};

const triggerDeviceAttentionFeedback = () => {
  if (!supportsVibration()) {
    return;
  }

  window.navigator.vibrate([100, 60, 100]);
};

const agingTone = (level: DriverMobileTask["collectionAging"] extends infer T
  ? T extends { level: infer L }
    ? L
    : never
  : never) => {
  if (level === "red") {
    return "border-rose-300 bg-rose-50 text-rose-900";
  }

  if (level === "orange") {
    return "border-orange-300 bg-orange-50 text-orange-900";
  }

  return "border-emerald-300 bg-emerald-50 text-emerald-900";
};

export function DriverMobileJobsDashboard() {
  const router = useRouter();
  const { roleKey, fullName, email, isLoading } = useCurrentUser();
  const mobileRoleKey = roleKey as RoleKey | null;

  const [driver, setDriver] = useState<DriverTaskResponse["driver"]>(null);
  const [serverTasks, setServerTasks] = useState<DriverMobileTask[]>([]);
  const [queuedActions, setQueuedActions] = useState<DriverMobileQueuedAction[]>(() => loadDriverMobileActionQueue());
  const [isLoadingTasks, setIsLoadingTasks] = useState(true);
  const [instructionFeed, setInstructionFeed] = useState<DriverInstructionFeed>({
    unreadCount: 0,
    newestUnread: null,
    recent: [],
  });
  const [driverProfileRequired, setDriverProfileRequired] = useState(false);
  const [isLoadingInstructions, setIsLoadingInstructions] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [attentionAlert, setAttentionAlert] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [instructionActionId, setInstructionActionId] = useState<string | null>(null);
  const [responseActionId, setResponseActionId] = useState<string | null>(null);
  const [responseNoteInstructionId, setResponseNoteInstructionId] = useState<string | null>(null);
  const [responseNoteByInstructionId, setResponseNoteByInstructionId] = useState<Record<string, string>>({});
  const [language, setLanguage] = useState<DriverMobileLanguage>("en");
  const [pendingInstructionAckIds, setPendingInstructionAckIds] = useState<string[]>(() => loadPendingInstructionAcks());
  const [failedInstructionAckIds, setFailedInstructionAckIds] = useState<string[]>([]);
  const [temperatureByBookingId, setTemperatureByBookingId] = useState<Record<string, string>>({});
  const [isOnline, setIsOnline] = useState(() => (typeof window === "undefined" ? true : window.navigator.onLine));
  const queueSyncingRef = useRef(false);
  const actionLocksRef = useRef(new Set<string>());
  const queuedActionsRef = useRef(queuedActions);
  const instructionFeedRef = useRef(instructionFeed);
  const knownTaskIdsRef = useRef(new Set<string>());
  const knownUnreadInstructionIdsRef = useRef(new Set<string>());
  const alertedSignalsRef = useRef(new Set<string>());
  const hasHydratedTaskIdsRef = useRef(false);
  const hasHydratedInstructionIdsRef = useRef(false);
  const attentionAlertTimeoutRef = useRef<number | null>(null);
  const t = useCallback((key: DriverMobileTranslationKey) => translateDriverMobile(language, key), [language]);

  useEffect(() => {
    if (!driver?.id) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setLanguage(readDriverMobileLanguage(driver.id));
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [driver]);

  const changeLanguage = useCallback((nextLanguage: DriverMobileLanguage) => {
    setLanguage(nextLanguage);
    if (driver?.id) {
      writeDriverMobileLanguage(driver.id, nextLanguage);
    }
  }, [driver]);

  useEffect(() => {
    queuedActionsRef.current = queuedActions;
    saveDriverMobileActionQueue(queuedActions);
  }, [queuedActions]);

  useEffect(() => {
    savePendingInstructionAcks(pendingInstructionAckIds);
  }, [pendingInstructionAckIds]);

  useEffect(() => {
    instructionFeedRef.current = instructionFeed;
  }, [instructionFeed]);

  useEffect(() => {
    return () => {
      if (attentionAlertTimeoutRef.current !== null) {
        window.clearTimeout(attentionAlertTimeoutRef.current);
      }
    };
  }, []);

  const raiseAttentionAlert = useCallback((message: string, signalKey: string) => {
    if (alertedSignalsRef.current.has(signalKey)) {
      return;
    }

    alertedSignalsRef.current.add(signalKey);
    setAttentionAlert(message);
    triggerDeviceAttentionFeedback();

    if (attentionAlertTimeoutRef.current !== null) {
      window.clearTimeout(attentionAlertTimeoutRef.current);
    }

    attentionAlertTimeoutRef.current = window.setTimeout(() => {
      setAttentionAlert((current) => (current === message ? null : current));
    }, 5000);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const loadTasks = useCallback(async (withLoading = true) => {
    if (withLoading) {
      setIsLoadingTasks(true);
    }
    setError(null);

    try {
      const token = await getSessionToken();
      const response = await fetch("/api/driver-mobile/tasks", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as Partial<DriverTaskResponse> & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to load assigned jobs.");
      }

      const nextTasks = Array.isArray(payload.tasks) ? payload.tasks : [];
      const resolvedDriver = payload.driver ?? null;

      const nextTaskIds = new Set(nextTasks.map((task) => task.bookingId));
      if (!hasHydratedTaskIdsRef.current) {
        knownTaskIdsRef.current = nextTaskIds;
        hasHydratedTaskIdsRef.current = true;
      } else {
        const previousTaskIds = knownTaskIdsRef.current;
        const newTask = nextTasks.find((task) => !previousTaskIds.has(task.bookingId));
        knownTaskIdsRef.current = nextTaskIds;

        if (newTask) {
          const label = newTask.bookingReference?.trim() || newTask.trailerNumber || newTask.bookingId.slice(0, 8).toUpperCase();
          raiseAttentionAlert(`New job assigned - ${label}`, `task:${newTask.bookingId}`);
        }
      }

      setDriver(resolvedDriver);
      setDriverProfileRequired(!resolvedDriver);
      setServerTasks(nextTasks);
      setQueuedActions((current) => reconcileDriverMobileQueuedActions(current, nextTasks));
      return nextTasks;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load assigned jobs.";
      setError(message);
      setDriverProfileRequired(false);
      setDriver(null);
      setServerTasks([]);
      return [] as DriverMobileTask[];
    } finally {
      if (withLoading) {
        setIsLoadingTasks(false);
      }
    }
  }, [raiseAttentionAlert]);

  const loadInstructions = useCallback(async (withLoading = true) => {
    if (withLoading) {
      setIsLoadingInstructions(true);
    }

    try {
      const token = await getSessionToken();
      const response = await fetch("/api/driver-mobile/instructions?limit=20", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as Partial<DriverInstructionFeed> & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to load operational instructions.");
      }

      const recent = Array.isArray(payload.recent) ? payload.recent : [];
      const unreadRecent = recent.filter((item) => !item.readAt);
      const unreadIds = new Set(unreadRecent.map((item) => item.id));

      if (!hasHydratedInstructionIdsRef.current) {
        knownUnreadInstructionIdsRef.current = unreadIds;
        hasHydratedInstructionIdsRef.current = true;
      } else {
        const previousUnreadIds = knownUnreadInstructionIdsRef.current;
        const newUnreadInstruction = unreadRecent.find((item) => !previousUnreadIds.has(item.id));
        knownUnreadInstructionIdsRef.current = unreadIds;

        if (newUnreadInstruction) {
          const label = newUnreadInstruction.trailerNumber?.trim() || newUnreadInstruction.instruction.slice(0, 24);
          raiseAttentionAlert(`New instruction - ${label}`, `instruction:${newUnreadInstruction.id}`);
        }
      }

      setInstructionFeed({
        unreadCount: typeof payload.unreadCount === "number" ? payload.unreadCount : recent.filter((item) => !item.readAt).length,
        newestUnread: payload.newestUnread ?? recent.find((item) => !item.readAt) ?? null,
        recent,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load operational instructions.";
      setError(message === SESSION_EXPIRED_MESSAGE ? SESSION_EXPIRED_MESSAGE : message);
      setInstructionFeed({
        unreadCount: 0,
        newestUnread: null,
        recent: [],
      });
    } finally {
      if (withLoading) {
        setIsLoadingInstructions(false);
      }
    }
  }, [raiseAttentionAlert]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadTasks();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadTasks]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadInstructions();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadInstructions]);

  useOperationalRealtime(["dashboard"], () => {
    void loadTasks(false);
    void loadInstructions(false);
  }, { debounceMs: 700 });

  const clearActionLock = useCallback((bookingId: string) => {
    actionLocksRef.current.delete(bookingId);
  }, []);

  const postAction = useCallback(async (queuedAction: DriverMobileQueuedAction) => {
    const token = await getSessionToken();
    const response = await fetch("/api/driver-mobile/tasks/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        bookingId: queuedAction.bookingId,
        action: queuedAction.action,
        temperatureC: typeof queuedAction.temperatureC === "number" ? queuedAction.temperatureC : undefined,
        resultingLoadStatus: queuedAction.resultingLoadStatus ?? undefined,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || "Unable to update job status.");
    }

    return payload;
  }, []);

  const markInstructionRead = useCallback(async (instructionId: string) => {
    const token = await getSessionToken();
    const response = await fetch("/api/driver-mobile/instructions/read", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ instructionId }),
    });

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || "Unable to acknowledge instruction.");
    }
  }, []);

  const sendInstructionResponse = useCallback(async (instructionId: string, responseType: DriverResponseType) => {
    if (responseActionId) {
      return;
    }

    setResponseActionId(instructionId);
    setError(null);
    setSuccess(null);

    try {
      const token = await getSessionToken();
      const response = await fetch("/api/driver-mobile/instructions/respond", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          instructionId,
          responseType,
          note: responseNoteByInstructionId[instructionId]?.trim() || undefined,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || t("unableToSendResponse"));
      }

      setResponseNoteInstructionId(null);
      setResponseNoteByInstructionId((current) => ({ ...current, [instructionId]: "" }));
      setSuccess(`${t("responseSent")}: ${responseType === "CALL_ME" ? t("callMe") : responseType}.`);
      await loadInstructions(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("unableToSendResponse");
      setError(message === SESSION_EXPIRED_MESSAGE ? SESSION_EXPIRED_MESSAGE : message);
    } finally {
      setResponseActionId(null);
    }
  }, [loadInstructions, responseActionId, responseNoteByInstructionId, t]);

  const markLinkedInstructionsRead = useCallback(async (instructionIds: string[]) => {
    for (const instructionId of instructionIds) {
      await markInstructionRead(instructionId);
    }
  }, [markInstructionRead]);

  const upsertPendingInstructionAck = useCallback((instructionId: string) => {
    setPendingInstructionAckIds((current) => (current.includes(instructionId) ? current : [...current, instructionId]));
    setFailedInstructionAckIds((current) => current.filter((item) => item !== instructionId));
  }, []);

  const clearPendingInstructionAck = useCallback((instructionId: string) => {
    setPendingInstructionAckIds((current) => current.filter((item) => item !== instructionId));
    setFailedInstructionAckIds((current) => current.filter((item) => item !== instructionId));
  }, []);

  const submitQueuedAction = useCallback(async (queuedAction: DriverMobileQueuedAction, source: "direct" | "queue") => {
    if (source === "queue") {
      if (queueSyncingRef.current) {
        return;
      }

      queueSyncingRef.current = true;
    }

    const attemptAt = new Date().toISOString();

    setQueuedActions((current) => updateDriverMobileQueuedAction(current, queuedAction.id, {
      state: "syncing",
      lastError: null,
      lastAttemptAt: attemptAt,
      nextRetryAt: null,
    }));

    try {
      await postAction({
        ...queuedAction,
        state: "syncing",
        lastAttemptAt: attemptAt,
        nextRetryAt: null,
      });

      if (queuedAction.action === "ACKNOWLEDGED" && queuedAction.linkedInstructionIds.length > 0) {
        await markLinkedInstructionsRead(queuedAction.linkedInstructionIds);
      }

      setQueuedActions((current) => removeDriverMobileQueuedAction(current, queuedAction.id));
      setSuccess(`${source === "queue" ? "Completed" : `${queuedAction.action === "ACKNOWLEDGED" ? "Acknowledged" : "Updated"}`} - ${queuedAction.bookingId.slice(0, 8)}`);
      setError(null);
      clearActionLock(queuedAction.bookingId);
      await loadTasks(false);
      await loadInstructions(false);
    } catch (err) {
      if (isDriverMobileNetworkFailure(err)) {
        const nextRetryCount = queuedAction.retryCount + 1;
        setQueuedActions((current) => updateDriverMobileQueuedAction(current, queuedAction.id, {
          state: "pending",
          retryCount: nextRetryCount,
          lastError: null,
          lastAttemptAt: attemptAt,
          nextRetryAt: isOnline ? new Date(Date.now() + Math.max(1000, nextRetryCount * 1000)).toISOString() : null,
        }));
        setSuccess("Saved - waiting for connection");
        setError(null);
        clearActionLock(queuedAction.bookingId);
        return;
      }

      const refreshedTasks = await loadTasks(false);
      const refreshedTask = refreshedTasks.find((task) => task.bookingId === queuedAction.bookingId) ?? null;

      if (source === "queue" && isDriverMobileActionSatisfied(refreshedTask, queuedAction.action)) {
        setQueuedActions((current) => removeDriverMobileQueuedAction(current, queuedAction.id));
        setSuccess("Completed");
        setError(null);
        clearActionLock(queuedAction.bookingId);
        return;
      }

      if (source === "queue") {
        const failure = toDriverMobileQueuedFailure(err, queuedAction.retryCount);
        setQueuedActions((current) => updateDriverMobileQueuedAction(current, queuedAction.id, {
          state: failure.state,
          retryCount: failure.retryCount,
          lastError: failure.lastError,
          lastAttemptAt: attemptAt,
          nextRetryAt: failure.nextRetryAt,
        }));
      } else {
        setQueuedActions((current) => removeDriverMobileQueuedAction(current, queuedAction.id));
      }

      const message = err instanceof Error ? err.message : "Unable to update job status.";
      setSuccess(null);
      setError(message === SESSION_EXPIRED_MESSAGE ? SESSION_EXPIRED_MESSAGE : message);
      clearActionLock(queuedAction.bookingId);
    } finally {
      if (source === "queue") {
        queueSyncingRef.current = false;
      }
    }
  }, [clearActionLock, isOnline, loadInstructions, loadTasks, markLinkedInstructionsRead, postAction]);

  useEffect(() => {
    if (!isOnline) {
      return;
    }

    const nextQueuedAction = getNextPendingDriverMobileQueuedAction(queuedActions);
    if (!nextQueuedAction) {
      return;
    }

    const retryDelayMs = getPendingDriverMobileQueueDelayMs(queuedActions);
    const timeoutId = window.setTimeout(() => {
      void submitQueuedAction(nextQueuedAction, "queue");
    }, retryDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [isOnline, queuedActions, submitQueuedAction]);

  useEffect(() => {
    if (!isOnline || pendingInstructionAckIds.length === 0) {
      return;
    }

    const nextInstructionId = pendingInstructionAckIds[0];
    let cancelled = false;

    const syncInstructionAck = async () => {
      try {
        await markInstructionRead(nextInstructionId);

        if (cancelled) {
          return;
        }

        clearPendingInstructionAck(nextInstructionId);
        await loadInstructions(false);
      } catch (err) {
        if (cancelled) {
          return;
        }

        if (isDriverMobileNetworkFailure(err)) {
          return;
        }

        setPendingInstructionAckIds((current) => current.filter((item) => item !== nextInstructionId));
        setFailedInstructionAckIds((current) => (current.includes(nextInstructionId) ? current : [...current, nextInstructionId]));
        const message = err instanceof Error ? err.message : "Unable to acknowledge instruction.";
        setError(message === SESSION_EXPIRED_MESSAGE ? SESSION_EXPIRED_MESSAGE : message);
      }
    };

    void syncInstructionAck();

    return () => {
      cancelled = true;
    };
  }, [clearPendingInstructionAck, isOnline, loadInstructions, markInstructionRead, pendingInstructionAckIds]);

  const handleSignOut = useCallback(async () => {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
    setIsSigningOut(false);
  }, [isSigningOut, router]);

  const handleAction = useCallback(async (task: DriverMobileTask, resultingLoadStatus?: "Empty" | "Loaded") => {
    if (!task.nextAction || actionLocksRef.current.has(task.bookingId) || findDriverMobileQueuedAction(queuedActionsRef.current, task.bookingId)) {
      return;
    }

    const temperatureInput = temperatureByBookingId[task.bookingId] ?? "";
    const parsedTemperature = parseTemperature(temperatureInput);
    const requiresTemperature = task.nextAction === "COLLECTED" && task.temperature.required;
    const requiresPhysicalOutcome = task.taskKind === "collection" && task.nextAction === "COLLECTED";

    if (requiresPhysicalOutcome && !resultingLoadStatus) {
      setError("Choose Collected Loaded or Collected Empty.");
      return;
    }

    if (requiresTemperature && temperatureInput.trim().length === 0) {
      setError(t("temperatureReadingRequired"));
      return;
    }

    if (requiresTemperature && Number.isNaN(parsedTemperature)) {
      setError(t("temperatureValidNumber"));
      return;
    }

    const linkedInstructionIds = instructionFeedRef.current.recent
      .filter((instruction) => matchesInstructionToTask(instruction, task) && !instruction.readAt)
      .map((instruction) => instruction.id);

    const queuedAction = createDriverMobileQueuedAction({
      bookingId: task.bookingId,
      action: task.nextAction,
      linkedInstructionIds,
      temperatureC: requiresTemperature && Number.isFinite(parsedTemperature) ? parsedTemperature : null,
      resultingLoadStatus: resultingLoadStatus ?? null,
    });

    actionLocksRef.current.add(task.bookingId);
    setQueuedActions((current) => upsertDriverMobileQueuedAction(current, queuedAction));
    setError(null);
    setSuccess(null);
    setTemperatureByBookingId((current) => ({ ...current, [task.bookingId]: "" }));
    void submitQueuedAction(queuedAction, "direct");
  }, [submitQueuedAction, t, temperatureByBookingId]);

  const handleAcknowledgeInstruction = useCallback(async (instruction: DriverInstructionRecord) => {
    if (instructionActionId) {
      return;
    }

    if (pendingInstructionAckIds.includes(instruction.id)) {
      return;
    }

    const linkedTask = serverTasks.find((task) => matchesInstructionToTask(instruction, task)) ?? null;
    if (linkedTask && linkedTask.nextAction === "ACKNOWLEDGED") {
      await handleAction(linkedTask);
      return;
    }

    setInstructionActionId(instruction.id);
    setError(null);
    setSuccess(null);

    try {
      if (!isOnline) {
        upsertPendingInstructionAck(instruction.id);
        setSuccess(t("savedWaitingConnection"));
        return;
      }

      await markInstructionRead(instruction.id);
      setSuccess(language === "en" ? "Instruction acknowledged." : `${t("acknowledged")}.`);
      clearPendingInstructionAck(instruction.id);
      await loadInstructions(false);
    } catch (err) {
      if (isDriverMobileNetworkFailure(err)) {
        upsertPendingInstructionAck(instruction.id);
        setSuccess(t("savedWaitingConnection"));
        setError(null);
        return;
      }

      const message = err instanceof Error ? err.message : t("unableToAcknowledge");
      setFailedInstructionAckIds((current) => (current.includes(instruction.id) ? current : [...current, instruction.id]));
      setError(message === SESSION_EXPIRED_MESSAGE ? SESSION_EXPIRED_MESSAGE : message);
    } finally {
      setInstructionActionId(null);
    }
  }, [clearPendingInstructionAck, handleAction, instructionActionId, isOnline, language, loadInstructions, markInstructionRead, pendingInstructionAckIds, serverTasks, t, upsertPendingInstructionAck]);

  const handleRetryInstructionAcknowledge = useCallback((instructionId: string) => {
    if (!isOnline) {
      setError(t("connectionProblem"));
      return;
    }

    upsertPendingInstructionAck(instructionId);
    setSuccess(`${t("retry")}...`);
    setError(null);
  }, [isOnline, t, upsertPendingInstructionAck]);

  const renderInstructionResponses = (instruction: DriverInstructionRecord) => (
    <div className="mt-3 border-t border-current/20 pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">{t("respondToOperations")}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(["OK", "COMPLETED", "ARRIVED", "DELAYED", "PROBLEM", "CALL_ME"] as DriverResponseType[]).map((responseType) => (
          <button
            key={responseType}
            type="button"
            disabled={responseActionId === instruction.id}
            onClick={() => {
              void sendInstructionResponse(instruction.id, responseType);
            }}
            className="rounded-lg border border-current/30 bg-white/70 px-2 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {responseType === "OK" ? t("ok") : responseType === "COMPLETED" ? language === "en" ? "COMPLETED" : t("completed") : responseType === "ARRIVED" ? t("arrived") : responseType === "DELAYED" ? t("delayed") : responseType === "PROBLEM" ? t("problem") : t("callMe")}
          </button>
        ))}
      </div>
      {responseNoteInstructionId === instruction.id ? (
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            maxLength={120}
            value={responseNoteByInstructionId[instruction.id] ?? ""}
            onChange={(event) => {
              const { value } = event.target;
              setResponseNoteByInstructionId((current) => ({ ...current, [instruction.id]: value }));
            }}
            placeholder={t("optionalNote")}
            className="min-w-0 flex-1 rounded-lg border border-current/30 bg-white px-2 py-2 text-xs text-slate-900"
          />
          <button
            type="button"
            onClick={() => setResponseNoteInstructionId(null)}
            className="rounded-lg border border-current/30 bg-white/70 px-2 py-2 text-xs font-semibold"
          >
            {t("cancel")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setResponseNoteInstructionId(instruction.id)}
          className="mt-2 rounded-lg border border-current/30 bg-white/70 px-2 py-1.5 text-xs font-semibold"
        >
          {t("addNote")}
        </button>
      )}
    </div>
  );

  const handleRetryQueuedAction = useCallback(async (queuedAction: DriverMobileQueuedAction) => {
    if (actionLocksRef.current.has(queuedAction.bookingId)) {
      return;
    }

    if (!isOnline) {
      setError("Connection is still unavailable.");
      return;
    }

    actionLocksRef.current.add(queuedAction.bookingId);
    setQueuedActions((current) => updateDriverMobileQueuedAction(current, queuedAction.id, {
      state: "pending",
      lastError: null,
      nextRetryAt: null,
    }));
    await submitQueuedAction({
      ...queuedAction,
      state: "pending",
      lastError: null,
      nextRetryAt: null,
    }, "queue");
  }, [isOnline, submitQueuedAction]);

  const tasks = useMemo(() => applyDriverMobileQueuedActions(serverTasks, queuedActions), [queuedActions, serverTasks]);

  const acknowledgedInstructionIds = useMemo(() => {
    return new Set(
      [
        ...queuedActions
          .filter((item) => item.action === "ACKNOWLEDGED" && (item.state === "pending" || item.state === "syncing"))
          .flatMap((item) => item.linkedInstructionIds),
        ...pendingInstructionAckIds,
      ],
    );
  }, [pendingInstructionAckIds, queuedActions]);

  const effectiveInstructions = useMemo<DriverInstructionFeed>(() => {
    const recent = instructionFeed.recent.map((instruction) => {
      if (!instruction.readAt && acknowledgedInstructionIds.has(instruction.id)) {
        return {
          ...instruction,
          readAt: new Date().toISOString(),
          isRead: true,
        };
      }

      return {
        ...instruction,
        isRead: Boolean(instruction.readAt),
      };
    });

    return {
      unreadCount: Math.max(
        0,
        instructionFeed.unreadCount - instructionFeed.recent.filter((instruction) => !instruction.readAt && acknowledgedInstructionIds.has(instruction.id)).length,
      ),
      newestUnread: recent.find((instruction) => !instruction.readAt) ?? null,
      recent,
    };
  }, [acknowledgedInstructionIds, instructionFeed]);

  const queuedActionByBookingId = useMemo(() => {
    return new Map(queuedActions.map((item) => [item.bookingId, item]));
  }, [queuedActions]);

  const linkedInstructionsByBookingId = useMemo(() => {
    const map = new Map<string, DriverInstructionRecord[]>();

    effectiveInstructions.recent.forEach((instruction) => {
      const key = instruction.deliveryBookingId ?? instruction.trailerId;
      if (!key) {
        return;
      }

      const current = map.get(key) ?? [];
      current.push(instruction);
      map.set(key, current);
    });

    map.forEach((items, key) => {
      map.set(key, [...items].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()));
    });

    return map;
  }, [effectiveInstructions]);

  const standaloneInstructions = useMemo(() => {
    return effectiveInstructions.recent
      .filter((instruction) => !instruction.deliveryBookingId)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }, [effectiveInstructions]);

  const taskAttentionMeta = useMemo(() => {
    return tasks.map((task) => {
      const queuedAction = queuedActionByBookingId.get(task.bookingId) ?? null;
      const linkedInstructions = linkedInstructionsByBookingId.get(task.bookingId) ?? linkedInstructionsByBookingId.get(task.trailerId) ?? [];
      const activeInstruction = linkedInstructions[0] ?? null;
      const hasUnreadInstruction = linkedInstructions.some((instruction) => !instruction.readAt);
      const isNewJob = task.nextAction === "ACKNOWLEDGED" && !task.driverAcknowledgedAt;
      const isPriority = activeInstruction?.priority === "high" || activeInstruction?.priority === "critical";
      const isUrgentPriority = activeInstruction?.priority === "critical";
      const collectionAgingLevel = task.collectionAging?.level ?? null;
      const isAgingAttention = task.taskKind === "collection" && collectionAgingLevel !== null && collectionAgingLevel !== "green";
      const requiresRetry = queuedAction?.state === "failed" || queuedAction?.state === "conflict";
      const offlinePending = queuedAction?.state === "pending";
      const needsAttention = isNewJob || hasUnreadInstruction || isPriority || isAgingAttention || Boolean(requiresRetry) || Boolean(offlinePending);

      let sortBucket = 7;

      if (requiresRetry) {
        sortBucket = 1;
      } else if (isNewJob && isUrgentPriority) {
        sortBucket = 2;
      } else if (isPriority) {
        sortBucket = 3;
      } else if (isAgingAttention) {
        sortBucket = 4;
      } else if (task.group !== "completed" && (task.nextAction === "ACKNOWLEDGED" || task.nextAction === "COLLECTED")) {
        sortBucket = 5;
      } else if (task.group !== "completed" && task.nextAction === "DELIVERED") {
        sortBucket = 6;
      }

      return {
        task,
        queuedAction,
        linkedInstructions,
        activeInstruction,
        hasUnreadInstruction,
        isNewJob,
        isPriority,
        isAgingAttention,
        requiresRetry,
        offlinePending,
        needsAttention,
        sortBucket,
      };
    });
  }, [linkedInstructionsByBookingId, queuedActionByBookingId, tasks]);

  const overlayAlertCandidates = useMemo<OverlayAlertCandidate[]>(() => {
    const candidates: OverlayAlertCandidate[] = [];

    const unreadInstructions = effectiveInstructions.recent
      .filter((instruction) => !instruction.readAt)
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

    unreadInstructions.forEach((instruction) => {
      const linkedTask = tasks.find((task) => matchesInstructionToTask(instruction, task)) ?? null;

      // Defensive UI scoping: ignore unread instruction payloads bound to unknown task context.
      if (!linkedTask && (instruction.deliveryBookingId || instruction.trailerId)) {
        return;
      }

      const severity: OverlayAlertSeverity = instruction.priority === "high" || instruction.priority === "critical" ? "red" : "yellow";
      candidates.push({
        key: `instruction:${instruction.id}`,
        kind: "instruction",
        severity,
        createdAt: instruction.createdAt,
        label: linkedTask ? "NEW INSTRUCTION" : "NEW MESSAGE",
        instruction,
        task: linkedTask,
      });
    });

    tasks
      .filter((task) => task.nextAction === "ACKNOWLEDGED" && !task.driverAcknowledgedAt)
      .forEach((task) => {
        const hasUnreadInstruction = unreadInstructions.some((instruction) => matchesInstructionToTask(instruction, task));
        if (hasUnreadInstruction) {
          return;
        }

        candidates.push({
          key: `task:${task.bookingId}`,
          kind: "task",
          severity: "yellow",
          createdAt: `${task.deliveryDate}T${task.deliveryTime ?? "00:00:00"}`,
          label: "NEW ASSIGNMENT",
          instruction: null,
          task,
        });
      });

    return candidates.sort((left, right) => {
      const severityRank = (value: OverlayAlertSeverity) => (value === "red" ? 0 : 1);
      const severityDiff = severityRank(left.severity) - severityRank(right.severity);
      if (severityDiff !== 0) {
        return severityDiff;
      }

      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
  }, [effectiveInstructions.recent, tasks]);

  const activeOverlayAlert = overlayAlertCandidates[0] ?? null;
  const remainingOverlayAlerts = Math.max(0, overlayAlertCandidates.length - 1);

  const grouped = useMemo(() => {
    const sorted = [...taskAttentionMeta].sort((left, right) => {
      if (left.sortBucket !== right.sortBucket) {
        return left.sortBucket - right.sortBucket;
      }

      const leftSchedule = new Date(`${left.task.deliveryDate}T${left.task.deliveryTime ?? "00:00:00"}`).getTime();
      const rightSchedule = new Date(`${right.task.deliveryDate}T${right.task.deliveryTime ?? "00:00:00"}`).getTime();
      return leftSchedule - rightSchedule;
    });

    const attention = sorted.filter((item) => item.needsAttention).map((item) => item.task);
    const toDo = sorted.filter((item) =>
      !item.needsAttention
      && item.task.group !== "completed"
      && (item.task.nextAction === "ACKNOWLEDGED" || item.task.nextAction === "COLLECTED"),
    ).map((item) => item.task);

    const inProgress = sorted.filter((item) =>
      !item.needsAttention
      && item.task.group !== "completed"
      && item.task.nextAction === "DELIVERED",
    ).map((item) => item.task);

    const completedToday = sorted.filter((item) => {
      if (item.task.group !== "completed") {
        return false;
      }

      const completedAt = item.task.deliveredAt ?? item.task.collectedAt;
      return isToday(completedAt);
    }).map((item) => item.task);

    return {
      attention,
      toDo,
      inProgress,
      completedToday,
    };
  }, [taskAttentionMeta]);

  const attentionSummary = useMemo(() => {
    const pendingOfflineActions = queuedActions.filter((item) => item.state === "pending").length;
    const failedQueuedActions = queuedActions.filter((item) => item.state === "failed" || item.state === "conflict").length;
    const newJobsCount = taskAttentionMeta.filter((item) => item.isNewJob).length;
    const overdueCollectionsCount = taskAttentionMeta.filter((item) => item.isAgingAttention).length;
    const standaloneUnreadCount = standaloneInstructions.filter((instruction) => !instruction.readAt).length;
    const totalAttention = grouped.attention.length + standaloneUnreadCount;

    return {
      totalAttention,
      newItemsCount: newJobsCount + standaloneUnreadCount,
      overdueCollectionsCount,
      offlineActionsCount: pendingOfflineActions + failedQueuedActions,
    };
  }, [grouped.attention.length, queuedActions, standaloneInstructions, taskAttentionMeta]);

  const headerName = fullName ?? email ?? "Authenticated Driver";
  const roleLabel = toRoleLabel(mobileRoleKey);

  const shellHeader = (
    <header className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700">{t("driverMobile")}</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">{t("myJobs")}</h1>
          <p className="mt-1 text-sm text-slate-600">{headerName} • {roleLabel}</p>
          {driver ? <p className="mt-2 text-sm text-slate-700">Driver profile: {driver.display_name}</p> : null}
          <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-600" htmlFor="driver-mobile-language">
            Language
            <select
              id="driver-mobile-language"
              value={language}
              onChange={(event) => changeLanguage(event.target.value as DriverMobileLanguage)}
              className="ml-2 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold normal-case tracking-normal text-slate-900"
            >
              {DRIVER_MOBILE_LANGUAGES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <button
          type="button"
          disabled={isSigningOut}
          onClick={() => {
            void handleSignOut();
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" />
          {isSigningOut ? t("sending") : t("signOut")}
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t("toDo")}</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{grouped.toDo.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t("inProgress")}</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{grouped.inProgress.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t("completedToday")}</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{grouped.completedToday.length}</p>
        </div>
      </div>
    </header>
  );

  const renderSection = (title: string, items: DriverMobileTask[]) => (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-700">{title}</h2>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{items.length}</span>
      </div>

      {items.length === 0 ? <p className="text-sm text-slate-500">{t("noJobs")}</p> : null}

      {items.length > 0 ? (
        <div className="space-y-3">
          {items.map((task) => {
            const attentionMeta = taskAttentionMeta.find((item) => item.task.bookingId === task.bookingId) ?? null;
            const queuedAction = attentionMeta?.queuedAction ?? queuedActionByBookingId.get(task.bookingId) ?? null;
            const isPending = queuedAction?.state === "syncing";
            const showTemperatureInput = task.nextAction === "COLLECTED" && task.temperature.required;
            const showAging = task.taskKind === "collection" && task.collectionAging !== null;
            const collectionAging = task.collectionAging;
            const completedAt = task.deliveredAt ?? task.collectedAt;
            const queueMessage = queuedActionMessage(queuedAction);
            const linkedInstructions = attentionMeta?.linkedInstructions ?? linkedInstructionsByBookingId.get(task.bookingId) ?? linkedInstructionsByBookingId.get(task.trailerId) ?? [];
            const activeInstruction = attentionMeta?.activeInstruction ?? linkedInstructions[0] ?? null;

            return (
              <article key={task.bookingId} className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700">{task.taskKind === "collection" ? t("collection") : t("delivery")}</p>
                    <h3 className="text-lg font-bold text-slate-950">{task.trailerNumber}</h3>
                    <p className="text-sm text-slate-700">{task.customer || "No customer"}</p>
                    <p className="text-xs text-slate-500">{task.location || "No location"}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-slate-700">{toStatusLabel(task.status)}</span>
                    {attentionMeta?.isNewJob ? (
                      <span className="rounded-full border border-cyan-300 bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-cyan-800">NEW</span>
                    ) : null}
                    {attentionMeta?.requiresRetry ? (
                      <span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-rose-800">RETRY NEEDED</span>
                    ) : null}
                    {attentionMeta?.offlinePending ? (
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-amber-900">OFFLINE PENDING</span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 space-y-1 text-sm text-slate-700">
                  <p><span className="font-medium">{t("schedule")}:</span> {formatSchedule(task.deliveryDate, task.deliveryTime)}</p>
                  <p><span className="font-medium">{t("reference")}:</span> {task.bookingReference || "-"}</p>
                  <p><span className="font-medium">{t("acknowledgedLabel")}:</span> {task.driverAcknowledgedAt ? formatCompletedTime(task.driverAcknowledgedAt) : "No"}</p>
                  {completedAt ? <p><span className="font-medium">{t("completed")}:</span> {formatCompletedTime(completedAt)}</p> : null}
                </div>

                {activeInstruction ? (
                  <div className={`mt-3 rounded-xl border px-3 py-3 ${toInstructionPriorityTone(activeInstruction.priority)}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">Instruction</p>
                      {activeInstruction.priority !== "normal" ? (
                        <span className="rounded-full border border-current px-2 py-0.5 text-[10px] font-bold tracking-[0.08em]">
                          {activeInstruction.priority === "critical" ? t("critical") : activeInstruction.priority === "high" ? t("attention") : t("normal")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm font-semibold">{activeInstruction.instruction}</p>
                    <p className="mt-1 text-xs">
                      {t("sent")} {formatCompletedTime(activeInstruction.createdAt)}
                      {activeInstruction.readAt ? ` • ${t("acknowledged")} ${formatCompletedTime(activeInstruction.readAt)}` : ` • ${t("acknowledgePending")}`}
                    </p>
                    {!activeInstruction.readAt && task.nextAction === "ACKNOWLEDGED" ? (
                      <p className="mt-2 text-xs font-medium">{t("acknowledgeThisJob")}</p>
                    ) : null}
                    {!activeInstruction.readAt && task.nextAction !== "ACKNOWLEDGED" ? (
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          disabled={instructionActionId === activeInstruction.id}
                          onClick={() => {
                            void handleAcknowledgeInstruction(activeInstruction);
                          }}
                          className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-400"
                        >
                            {instructionActionId === activeInstruction.id ? t("sending") : language === "en" ? "ACKNOWLEDGE" : t("acknowledged")}
                        </button>
                      </div>
                    ) : null}
                    {renderInstructionResponses(activeInstruction)}
                  </div>
                ) : null}

                {showAging && collectionAging ? (
                  <div className={`mt-3 rounded-xl border px-3 py-2 text-xs font-semibold ${agingTone(collectionAging.level)}`}>
                    {collectionAging.label} • {Math.floor(collectionAging.waitingHours)}h pending
                    {collectionAging.isOverdue && collectionAging.overdueDays !== null ? ` • ${collectionAging.overdueDays}d overdue` : ""}
                  </div>
                ) : null}

                {showTemperatureInput ? (
                  <div className="mt-3 rounded-xl border border-cyan-200 bg-cyan-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-900">{t("temperatureRequired")}</p>
                    <label htmlFor={`temp-${task.bookingId}`} className="mt-2 block text-xs font-medium text-cyan-900">
                      {t("collectionReading")}
                    </label>
                    <input
                      id={`temp-${task.bookingId}`}
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      className="mt-1 w-full rounded-lg border border-cyan-300 bg-white px-2 py-2 text-sm text-slate-900"
                      value={temperatureByBookingId[task.bookingId] ?? ""}
                      onChange={(event) => {
                        const { value } = event.target;
                        setTemperatureByBookingId((current) => ({ ...current, [task.bookingId]: value }));
                      }}
                    />
                  </div>
                ) : null}

                {task.notes ? <p className="mt-2 text-sm text-slate-600">{task.notes}</p> : null}

                {queueMessage ? (
                  <div className={`mt-3 rounded-xl border px-3 py-2 text-xs font-semibold ${queuedAction?.state === "failed" || queuedAction?.state === "conflict" ? "border-rose-200 bg-rose-50 text-rose-800" : queuedAction?.state === "pending" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-cyan-200 bg-cyan-50 text-cyan-900"}`}>
                    {queueMessage}
                  </div>
                ) : null}

                <div className="mt-3 flex justify-end gap-2">
                  {queuedAction?.state === "failed" ? (
                    <button
                      type="button"
                      onClick={() => {
                        void handleRetryQueuedAction(queuedAction);
                      }}
                      className="w-full rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white"
                    >
                      {t("retry")}
                    </button>
                  ) : task.taskKind === "collection" && task.nextAction === "COLLECTED" ? (
                    <>
                      <button type="button" disabled={Boolean(queuedAction)} onClick={() => void handleAction(task, "Empty")} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-slate-900 disabled:opacity-50">
                        Collected Empty
                      </button>
                      <button type="button" disabled={Boolean(queuedAction)} onClick={() => void handleAction(task, "Loaded")} className="w-full rounded-xl bg-slate-900 px-3 py-3 text-sm font-semibold text-white disabled:bg-slate-400">
                        Collected Loaded
                      </button>
                    </>
                  ) : task.nextAction ? (
                    <button
                      type="button"
                      disabled={Boolean(queuedAction)}
                      onClick={() => {
                        void handleAction(task);
                      }}
                      className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      {isPending ? t("sending") : task.nextAction === "ACKNOWLEDGED" ? language === "en" ? "ACKNOWLEDGE" : t("acknowledged") : task.nextAction === "COLLECTED" ? t("collected") : t("delivered")}
                    </button>
                  ) : (
                    <span className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">No action required</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );

  const overlayInstruction = activeOverlayAlert?.instruction ?? null;
  const overlayTask = activeOverlayAlert?.task ?? null;
  const isOverlayInstructionPending = overlayInstruction ? pendingInstructionAckIds.includes(overlayInstruction.id) : false;
  const isOverlayInstructionRetry = overlayInstruction ? failedInstructionAckIds.includes(overlayInstruction.id) : false;

  const overlayTone = activeOverlayAlert?.severity === "red"
    ? {
        backdrop: "bg-rose-950/82",
        panel: "border-rose-400 bg-rose-100 text-rose-950",
        badge: "border-rose-700 bg-rose-600 text-white",
        watermark: "text-rose-300/30",
        title: "CRITICAL",
      }
    : {
        backdrop: "bg-slate-950/72",
        panel: "border-amber-300 bg-amber-50 text-amber-950",
        badge: "border-amber-600 bg-amber-500 text-slate-950",
        watermark: "text-amber-300/30",
        title: "ATTENTION",
      };

  const handleOverlayAcknowledge = useCallback(async () => {
    if (!activeOverlayAlert) {
      return;
    }

    if (activeOverlayAlert.kind === "task" && activeOverlayAlert.task) {
      await handleAction(activeOverlayAlert.task);
      return;
    }

    if (!activeOverlayAlert.instruction) {
      return;
    }

    if (isOverlayInstructionRetry) {
      handleRetryInstructionAcknowledge(activeOverlayAlert.instruction.id);
      return;
    }

    await handleAcknowledgeInstruction(activeOverlayAlert.instruction);
  }, [activeOverlayAlert, handleAction, handleAcknowledgeInstruction, handleRetryInstructionAcknowledge, isOverlayInstructionRetry]);

  return (
    <PermissionGuard
      roleKey={mobileRoleKey}
      moduleKey="driver_mobile"
      action="view"
      allowWhenRoleMissing={false}
      fallback={
        <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-3 py-4 text-slate-900 sm:px-4">
          <div className="mx-auto w-full max-w-2xl">
            {shellHeader}
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              You do not have permission to access Driver Mobile.
            </div>
          </div>
        </div>
      }
    >
      <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-3 py-4 text-slate-900 sm:px-4">
        <div className="mx-auto w-full max-w-2xl">
          {shellHeader}

          {error ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}
          {success ? <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div> : null}
          {attentionAlert ? <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-semibold text-cyan-900">{attentionAlert}</div> : null}
          {!isOnline ? <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{t("offline")}</div> : null}

          {isLoading || isLoadingTasks ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading assigned jobs...</div>
          ) : null}

          {!isLoading && !isLoadingTasks && !driver && driverProfileRequired ? (
            <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">Driver profile required</h2>
              <p className="mt-2 text-sm">This account is not linked to an active driver record. Contact operations control to complete assignment setup.</p>
            </section>
          ) : null}

          {!isLoading && !isLoadingTasks && driver ? (
            <div className="mt-4 space-y-4">
              {attentionSummary.totalAttention > 0 || attentionSummary.offlineActionsCount > 0 || attentionSummary.overdueCollectionsCount > 0 ? (
                <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-900">{t("needsAttention")}</p>
                  <p className="mt-2 text-xl font-bold text-amber-950">{attentionSummary.totalAttention} NEED ATTENTION</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-amber-900">
                    {attentionSummary.newItemsCount > 0 ? <span className="rounded-full border border-amber-300 bg-white px-2 py-1">{attentionSummary.newItemsCount} {t("new")}</span> : null}
                    {attentionSummary.overdueCollectionsCount > 0 ? <span className="rounded-full border border-amber-300 bg-white px-2 py-1">{attentionSummary.overdueCollectionsCount} {t("overdue")}</span> : null}
                    {attentionSummary.offlineActionsCount > 0 ? <span className="rounded-full border border-amber-300 bg-white px-2 py-1">{attentionSummary.offlineActionsCount} {t("offlineAction")}</span> : null}
                  </div>
                </section>
              ) : null}

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-700">{t("operationalInstructions")}</h2>
                  <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-900">
                    {effectiveInstructions.unreadCount} {t("unread")}
                  </span>
                </div>

                {isLoadingInstructions ? <p className="mt-3 text-sm text-slate-500">{t("loadingInstructions")}</p> : null}

                {!isLoadingInstructions && standaloneInstructions.length === 0 && !effectiveInstructions.newestUnread ? (
                  <p className="mt-3 text-sm text-slate-500">{t("noStandaloneInstructions")}</p>
                ) : null}

                {!isLoadingInstructions && standaloneInstructions.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {standaloneInstructions.slice(0, 4).map((instruction) => (
                      <article key={instruction.id} className={`rounded-xl border px-3 py-3 ${toInstructionPriorityTone(instruction.priority)}`}>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">{t("instructionOnly")}</p>
                        <p className="mt-1 text-sm font-semibold">{instruction.instruction}</p>
                        <p className="mt-1 text-xs">
                          {t("sent")} {formatCompletedTime(instruction.createdAt)}
                          {instruction.trailerNumber ? ` • ${instruction.trailerNumber}` : ""}
                          {instruction.readAt ? ` • ${t("acknowledged")} ${formatCompletedTime(instruction.readAt)}` : ` • ${t("acknowledgePending")}`}
                        </p>
                        {!instruction.readAt ? (
                          <div className="mt-3 flex justify-end">
                            <button
                              type="button"
                              disabled={instructionActionId === instruction.id}
                              onClick={() => {
                                void handleAcknowledgeInstruction(instruction);
                              }}
                              className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-400"
                            >
                              {instructionActionId === instruction.id ? t("sending") : language === "en" ? "ACKNOWLEDGE" : t("acknowledged")}
                            </button>
                          </div>
                        ) : null}
                        {renderInstructionResponses(instruction)}
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>

              {renderSection(t("needsAttention"), grouped.attention)}
              {renderSection(t("toDo"), grouped.toDo)}
              {renderSection(t("inProgress"), grouped.inProgress)}
              {renderSection(t("completedToday"), grouped.completedToday)}
            </div>
          ) : null}

          {!isLoading && !isLoadingTasks && driver && activeOverlayAlert && overlayTone ? (
            <div className={`fixed inset-0 z-[95] flex items-center justify-center px-4 py-6 ${overlayTone.backdrop}`} role="dialog" aria-modal="true" aria-label="Operational alert overlay">
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className={`select-none text-[min(26vw,11rem)] font-black uppercase tracking-[0.14em] ${overlayTone.watermark} rotate-[-18deg]`}>
                  {overlayTone.title}
                </p>
              </div>

              <section className={`relative w-full max-w-lg rounded-3xl border-2 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.48)] ${overlayTone.panel}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${overlayTone.badge}`}>
                      {overlayTone.title}
                    </p>
                    <h2 className="mt-3 text-2xl font-black uppercase tracking-[0.12em]">{activeOverlayAlert.label}</h2>
                  </div>
                  {remainingOverlayAlerts > 0 ? (
                    <span className="rounded-full border border-current/30 px-2 py-1 text-xs font-semibold">
                      {remainingOverlayAlerts} more alerts
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 space-y-2 text-sm">
                  {overlayInstruction ? <p className="text-base font-bold">{overlayInstruction.instruction}</p> : <p className="text-base font-bold">New assignment requires acknowledgement.</p>}
                  {overlayTask ? <p><span className="font-semibold">Trailer:</span> {overlayTask.trailerNumber}</p> : null}
                  {overlayTask?.bookingReference ? <p><span className="font-semibold">Reference:</span> {overlayTask.bookingReference}</p> : null}
                  {overlayTask?.location ? <p><span className="font-semibold">Location:</span> {overlayTask.location}</p> : null}
                  {overlayInstruction ? <p><span className="font-semibold">Received:</span> {formatCompletedTime(overlayInstruction.createdAt)}</p> : null}
                </div>

                {isOverlayInstructionPending ? (
                  <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-100 px-3 py-2 text-sm font-semibold">
                    ACKNOWLEDGED - WAITING FOR CONNECTION
                  </div>
                ) : null}

                {isOverlayInstructionRetry ? (
                  <div className="mt-4 rounded-2xl border border-rose-300 bg-rose-100 px-3 py-2 text-sm font-semibold">
                    Could not confirm acknowledgement. RETRY required.
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => {
                    void handleOverlayAcknowledge();
                  }}
                  disabled={isOverlayInstructionPending || (overlayTask ? Boolean(queuedActionByBookingId.get(overlayTask.bookingId)) : false)}
                  className="mt-5 w-full rounded-2xl bg-slate-950 px-4 py-4 text-base font-black uppercase tracking-[0.12em] text-white disabled:cursor-not-allowed disabled:bg-slate-500"
                >
                  {isOverlayInstructionRetry ? "RETRY" : "OPEN / ACKNOWLEDGE"}
                </button>
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </PermissionGuard>
  );
}
