"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { toRoleLabel, type RoleKey } from "@/lib/auth/roles";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { useOperationalRealtime } from "@/lib/realtime/operational-realtime";
import { supabase } from "@/lib/supabase";
import { type DriverMobileTask, type DriverTaskAction } from "@/lib/driver-mobile-service";
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

type DriverInstructionFeed = {
  unreadCount: number;
  newestUnread: DriverInstructionRecord | null;
  recent: DriverInstructionRecord[];
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

const actionLabel = (action: DriverTaskAction) => {
  if (action === "ACKNOWLEDGED") return "ACKNOWLEDGE";
  if (action === "COLLECTED") return "RECOLHIDA / COLLECTED";
  return "ENTREGUE / DELIVERED";
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
  const [isLoadingInstructions, setIsLoadingInstructions] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [instructionActionId, setInstructionActionId] = useState<string | null>(null);
  const [temperatureByBookingId, setTemperatureByBookingId] = useState<Record<string, string>>({});
  const [isOnline, setIsOnline] = useState(() => (typeof window === "undefined" ? true : window.navigator.onLine));
  const queueSyncingRef = useRef(false);
  const actionLocksRef = useRef(new Set<string>());
  const queuedActionsRef = useRef(queuedActions);
  const instructionFeedRef = useRef(instructionFeed);

  useEffect(() => {
    queuedActionsRef.current = queuedActions;
    saveDriverMobileActionQueue(queuedActions);
  }, [queuedActions]);

  useEffect(() => {
    instructionFeedRef.current = instructionFeed;
  }, [instructionFeed]);

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
      setDriver(payload.driver ?? null);
      setServerTasks(nextTasks);
      setQueuedActions((current) => reconcileDriverMobileQueuedActions(current, nextTasks));
      return nextTasks;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load assigned jobs.";
      setError(message);
      setDriver(null);
      setServerTasks([]);
      return [] as DriverMobileTask[];
    } finally {
      if (withLoading) {
        setIsLoadingTasks(false);
      }
    }
  }, []);

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
  }, []);

  useEffect(() => {
    // Initial fetch runs once on mount to populate assigned jobs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTasks();
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

  const markLinkedInstructionsRead = useCallback(async (instructionIds: string[]) => {
    for (const instructionId of instructionIds) {
      await markInstructionRead(instructionId);
    }
  }, [markInstructionRead]);

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

  const handleAction = useCallback(async (task: DriverMobileTask) => {
    if (!task.nextAction || actionLocksRef.current.has(task.bookingId) || findDriverMobileQueuedAction(queuedActionsRef.current, task.bookingId)) {
      return;
    }

    const temperatureInput = temperatureByBookingId[task.bookingId] ?? "";
    const parsedTemperature = parseTemperature(temperatureInput);
    const requiresTemperature = task.nextAction === "COLLECTED" && task.temperature.required;

    if (requiresTemperature && temperatureInput.trim().length === 0) {
      setError("Temperature reading is required before marking as collected.");
      return;
    }

    if (requiresTemperature && Number.isNaN(parsedTemperature)) {
      setError("Temperature must be a valid number.");
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
    });

    actionLocksRef.current.add(task.bookingId);
    setQueuedActions((current) => upsertDriverMobileQueuedAction(current, queuedAction));
    setError(null);
    setSuccess(null);
    setTemperatureByBookingId((current) => ({ ...current, [task.bookingId]: "" }));
    void submitQueuedAction(queuedAction, "direct");
  }, [submitQueuedAction, temperatureByBookingId]);

  const handleAcknowledgeInstruction = useCallback(async (instruction: DriverInstructionRecord) => {
    if (instructionActionId) {
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
      await markInstructionRead(instruction.id);
      setSuccess("Instruction acknowledged.");
      await loadInstructions(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to acknowledge instruction.";
      setError(message === SESSION_EXPIRED_MESSAGE ? SESSION_EXPIRED_MESSAGE : message);
    } finally {
      setInstructionActionId(null);
    }
  }, [handleAction, instructionActionId, loadInstructions, markInstructionRead, serverTasks]);

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
      queuedActions
        .filter((item) => item.action === "ACKNOWLEDGED" && (item.state === "pending" || item.state === "syncing"))
        .flatMap((item) => item.linkedInstructionIds),
    );
  }, [queuedActions]);

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
      unreadCount: recent.filter((instruction) => !instruction.readAt).length,
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

  const grouped = useMemo(() => {
    const toDo = tasks.filter((task) =>
      task.group !== "completed" && (task.nextAction === "ACKNOWLEDGED" || task.nextAction === "COLLECTED"),
    );

    const inProgress = tasks.filter((task) =>
      task.group !== "completed" && task.nextAction === "DELIVERED",
    );

    const completedToday = tasks.filter((task) => {
      if (task.group !== "completed") {
        return false;
      }

      const completedAt = task.deliveredAt ?? task.collectedAt;
      return isToday(completedAt);
    });

    return {
      toDo,
      inProgress,
      completedToday,
    };
  }, [tasks]);

  const headerName = fullName ?? email ?? "Authenticated Driver";
  const roleLabel = toRoleLabel(mobileRoleKey);

  const shellHeader = (
    <header className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700">Ferryspeed Driver Mobile</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">Assigned Jobs</h1>
          <p className="mt-1 text-sm text-slate-600">{headerName} • {roleLabel}</p>
          {driver ? <p className="mt-2 text-sm text-slate-700">Driver profile: {driver.display_name}</p> : null}
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
          {isSigningOut ? "Signing out..." : "Sign out"}
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">To Do</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{grouped.toDo.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">In Progress</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{grouped.inProgress.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Completed Today</p>
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

      {items.length === 0 ? <p className="text-sm text-slate-500">No jobs in this section.</p> : null}

      {items.length > 0 ? (
        <div className="space-y-3">
          {items.map((task) => {
            const queuedAction = queuedActionByBookingId.get(task.bookingId) ?? null;
            const isPending = queuedAction?.state === "syncing";
            const showTemperatureInput = task.nextAction === "COLLECTED" && task.temperature.required;
            const showAging = task.taskKind === "collection" && task.collectionAging !== null;
            const collectionAging = task.collectionAging;
            const completedAt = task.deliveredAt ?? task.collectedAt;
            const queueMessage = queuedActionMessage(queuedAction);
            const linkedInstructions = linkedInstructionsByBookingId.get(task.bookingId) ?? linkedInstructionsByBookingId.get(task.trailerId) ?? [];
            const activeInstruction = linkedInstructions[0] ?? null;

            return (
              <article key={task.bookingId} className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700">{task.taskKind === "collection" ? "Collection" : "Delivery"}</p>
                    <h3 className="text-lg font-bold text-slate-950">{task.trailerNumber}</h3>
                    <p className="text-sm text-slate-700">{task.customer || "No customer"}</p>
                    <p className="text-xs text-slate-500">{task.location || "No location"}</p>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-slate-700">{toStatusLabel(task.status)}</span>
                </div>

                <div className="mt-3 space-y-1 text-sm text-slate-700">
                  <p><span className="font-medium">Schedule:</span> {formatSchedule(task.deliveryDate, task.deliveryTime)}</p>
                  <p><span className="font-medium">Reference:</span> {task.bookingReference || "-"}</p>
                  <p><span className="font-medium">Acknowledged:</span> {task.driverAcknowledgedAt ? formatCompletedTime(task.driverAcknowledgedAt) : "No"}</p>
                  {completedAt ? <p><span className="font-medium">Completed:</span> {formatCompletedTime(completedAt)}</p> : null}
                </div>

                {activeInstruction ? (
                  <div className={`mt-3 rounded-xl border px-3 py-3 ${toInstructionPriorityTone(activeInstruction.priority)}`}>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">Instruction</p>
                    <p className="mt-1 text-sm font-semibold">{activeInstruction.instruction}</p>
                    <p className="mt-1 text-xs">
                      Sent {formatCompletedTime(activeInstruction.createdAt)}
                      {activeInstruction.readAt ? ` • Acknowledged ${formatCompletedTime(activeInstruction.readAt)}` : " • Acknowledge pending"}
                    </p>
                    {!activeInstruction.readAt && task.nextAction === "ACKNOWLEDGED" ? (
                      <p className="mt-2 text-xs font-medium">Acknowledge this job to confirm the instruction.</p>
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
                          {instructionActionId === activeInstruction.id ? "Acknowledging..." : "ACKNOWLEDGE"}
                        </button>
                      </div>
                    ) : null}
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
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-900">Temperature required</p>
                    <label htmlFor={`temp-${task.bookingId}`} className="mt-2 block text-xs font-medium text-cyan-900">
                      Collection reading (C)
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

                <div className="mt-3 flex justify-end">
                  {queuedAction?.state === "failed" ? (
                    <button
                      type="button"
                      onClick={() => {
                        void handleRetryQueuedAction(queuedAction);
                      }}
                      className="w-full rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white"
                    >
                      Retry
                    </button>
                  ) : task.nextAction ? (
                    <button
                      type="button"
                      disabled={Boolean(queuedAction)}
                      onClick={() => {
                        void handleAction(task);
                      }}
                      className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      {isPending ? "Sending..." : actionLabel(task.nextAction)}
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
          {!isOnline ? <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Offline. Saved actions will send when connection returns.</div> : null}

          {isLoading || isLoadingTasks ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading assigned jobs...</div>
          ) : null}

          {!isLoading && !isLoadingTasks && !driver ? (
            <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">Driver profile required</h2>
              <p className="mt-2 text-sm">This account is not linked to an active driver record. Contact operations control to complete assignment setup.</p>
            </section>
          ) : null}

          {!isLoading && !isLoadingTasks && driver ? (
            <div className="mt-4 space-y-4">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-700">Operational Instructions</h2>
                  <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-900">
                    {effectiveInstructions.unreadCount} unread
                  </span>
                </div>

                {isLoadingInstructions ? <p className="mt-3 text-sm text-slate-500">Loading instructions...</p> : null}

                {!isLoadingInstructions && standaloneInstructions.length === 0 && !effectiveInstructions.newestUnread ? (
                  <p className="mt-3 text-sm text-slate-500">No standalone instructions right now.</p>
                ) : null}

                {!isLoadingInstructions && standaloneInstructions.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {standaloneInstructions.slice(0, 4).map((instruction) => (
                      <article key={instruction.id} className={`rounded-xl border px-3 py-3 ${toInstructionPriorityTone(instruction.priority)}`}>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">Instruction Only</p>
                        <p className="mt-1 text-sm font-semibold">{instruction.instruction}</p>
                        <p className="mt-1 text-xs">
                          Sent {formatCompletedTime(instruction.createdAt)}
                          {instruction.trailerNumber ? ` • ${instruction.trailerNumber}` : ""}
                          {instruction.readAt ? ` • Acknowledged ${formatCompletedTime(instruction.readAt)}` : " • Acknowledge pending"}
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
                              {instructionActionId === instruction.id ? "Acknowledging..." : "ACKNOWLEDGE"}
                            </button>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>

              {renderSection("To Do", grouped.toDo)}
              {renderSection("In Progress", grouped.inProgress)}
              {renderSection("Completed Today", grouped.completedToday)}
            </div>
          ) : null}
        </div>
      </div>
    </PermissionGuard>
  );
}
