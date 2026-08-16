"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { toRoleLabel, type RoleKey } from "@/lib/auth/roles";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { supabase } from "@/lib/supabase";
import { getSessionToken, SESSION_EXPIRED_MESSAGE } from "@/lib/voice/session";
import type { DriverMobileTask, DriverTaskAction, DriverTaskKind } from "@/lib/driver-mobile-service";
import { useOperationalRealtime } from "@/lib/realtime/operational-realtime";

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
  latestResponse: {
    id: string;
    responseType: "ok" | "completed" | "arrived" | "delayed" | "problem" | "call_me";
    message: string | null;
    createdAt: string;
    isException: boolean;
  } | null;
  responseHistory: Array<{
    id: string;
    responseType: "ok" | "completed" | "arrived" | "delayed" | "problem" | "call_me";
    message: string | null;
    createdAt: string;
    isException: boolean;
  }>;
};

type DriverInstructionResponse = {
  unreadCount: number;
  newestUnread: DriverInstructionRecord | null;
  recent: DriverInstructionRecord[];
};

const normalizeStatus = (value: string) => value.trim().toLowerCase();

const toStatusLabel = (value: string) => {
  const normalized = normalizeStatus(value);

  if (normalized === "on_delivery") return "On Delivery";
  if (normalized === "waiting_collection") return "Waiting Collection";

  return value
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

const toActionLabel = (action: DriverTaskAction) => {
  if (action === "ACKNOWLEDGED") {
    return "Acknowledge / Read";
  }

  return action === "COLLECTED" ? "Mark Collected" : "Mark Delivered";
};

const formatDeliveryDate = (date: string, time: string | null) => {
  const value = time ? `${date}T${time}` : `${date}T00:00:00`;
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatTimestamp = (value: string | null) => {
  if (!value) {
    return "No";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
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
  if (!Number.isFinite(parsed)) {
    return Number.NaN;
  }

  return parsed;
};

const toTaskKindLabel = (taskKind: DriverTaskKind) => {
  return taskKind === "collection" ? "Collection" : "Delivery";
};

const toResponseLabel = (value: "ok" | "completed" | "arrived" | "delayed" | "problem" | "call_me") => {
  if (value === "call_me") {
    return "CALL ME";
  }

  return value.toUpperCase();
};

const toResponseTone = (value: "ok" | "completed" | "arrived" | "delayed" | "problem" | "call_me") => {
  if (value === "ok" || value === "completed" || value === "arrived") {
    return "text-emerald-800";
  }

  return "text-rose-800";
};

const toScheduleLabel = (taskKind: DriverTaskKind) => {
  return taskKind === "collection" ? "Collection" : "Delivery";
};

export function DriverMobileDashboard() {
  const router = useRouter();
  const { roleKey, fullName, email, isLoading } = useCurrentUser();
  const [driver, setDriver] = useState<DriverTaskResponse["driver"]>(null);
  const [tasks, setTasks] = useState<DriverMobileTask[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rowActionBookingId, setRowActionBookingId] = useState<string | null>(null);
  const [temperatureByBookingId, setTemperatureByBookingId] = useState<Record<string, string>>({});
  const [instructionFeed, setInstructionFeed] = useState<DriverInstructionResponse>({
    unreadCount: 0,
    newestUnread: null,
    recent: [],
  });
  const [isLoadingInstructions, setIsLoadingInstructions] = useState(true);
  const [instructionActionId, setInstructionActionId] = useState<string | null>(null);
  const [responseActionInstructionId, setResponseActionInstructionId] = useState<string | null>(null);
  const [exceptionDraftByInstructionId, setExceptionDraftByInstructionId] = useState<Record<string, "DELAYED" | "PROBLEM" | null>>({});
  const [responseNoteByInstructionId, setResponseNoteByInstructionId] = useState<Record<string, string>>({});
  const [isSigningOut, setIsSigningOut] = useState(false);

  const mobileRoleKey = roleKey as RoleKey | null;
  const roleLabel = toRoleLabel(mobileRoleKey);
  const userLabel = fullName ?? email ?? "Authenticated Driver";

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

  const loadTasks = useCallback(async (options?: { withLoading?: boolean }) => {
    const withLoading = options?.withLoading ?? true;

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
        throw new Error(payload.error || "Unable to load assigned tasks.");
      }

      setDriver(payload.driver ?? null);
      setTasks(Array.isArray(payload.tasks) ? payload.tasks : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load assigned tasks.";
      setError(message);
      setDriver(null);
      setTasks([]);
    } finally {
      if (withLoading) {
        setIsLoadingTasks(false);
      }
    }
  }, []);

  const loadInstructions = useCallback(async (options?: { withLoading?: boolean }) => {
    const withLoading = options?.withLoading ?? true;

    if (withLoading) {
      setIsLoadingInstructions(true);
    }

    try {
      const token = await getSessionToken();
      const response = await fetch("/api/driver-mobile/instructions?limit=40", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as Partial<DriverInstructionResponse> & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to load operational instructions.");
      }

      setInstructionFeed({
        unreadCount: typeof payload.unreadCount === "number" ? payload.unreadCount : 0,
        newestUnread: payload.newestUnread ?? null,
        recent: Array.isArray(payload.recent) ? payload.recent : [],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load operational instructions.";
      setError(message);
    } finally {
      if (withLoading) {
        setIsLoadingInstructions(false);
      }
    }
  }, []);

  useEffect(() => {
    // Initial fetch runs once on mount to populate the driver's task board.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    // Initial instruction fetch mirrors task bootstrap pattern and avoids synchronous effect-state writes.
    const timeoutId = window.setTimeout(() => {
      void loadInstructions();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadInstructions]);

  useOperationalRealtime(["dashboard"], () => {
    void loadTasks({ withLoading: false });
    void loadInstructions({ withLoading: false });
  }, { debounceMs: 700 });

  const workSections = useMemo(() => {
    return [
      {
        key: "delivery" as const,
        title: "Deliveries",
        items: tasks.filter((task) => task.taskKind === "delivery"),
      },
      {
        key: "collection" as const,
        title: "Collections",
        items: tasks.filter((task) => task.taskKind === "collection"),
      },
    ];
  }, [tasks]);

  const activeDeliveryCount = useMemo(
    () => tasks.filter((task) => task.taskKind === "delivery" && task.group !== "completed").length,
    [tasks],
  );

  const activeCollectionCount = useMemo(
    () => tasks.filter((task) => task.taskKind === "collection" && task.group !== "completed").length,
    [tasks],
  );

  const handleAction = useCallback(
    async (task: DriverMobileTask, resultingLoadStatus?: "Empty" | "Loaded") => {
      if (!task.nextAction || rowActionBookingId) {
        return;
      }

      const temperatureInput = temperatureByBookingId[task.bookingId] ?? "";
      const parsedTemperature = parseTemperature(temperatureInput);
      const requiresCollectionTemperature = task.temperature.required && task.nextAction === "COLLECTED";
      const requiresPhysicalOutcome = task.taskKind === "collection" && task.nextAction === "COLLECTED";

      if (requiresPhysicalOutcome && !resultingLoadStatus) {
        setError("Choose Collected Loaded or Collected Empty.");
        return;
      }

      if (requiresCollectionTemperature && temperatureInput.trim().length === 0) {
        setError("Temperature reading is required before marking this task as collected.");
        return;
      }

      if (requiresCollectionTemperature && Number.isNaN(parsedTemperature)) {
        setError("Temperature must be a valid number.");
        return;
      }

      setRowActionBookingId(task.bookingId);
      setError(null);
      setSuccess(null);

      try {
        const token = await getSessionToken();

        const response = await fetch("/api/driver-mobile/tasks/action", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            bookingId: task.bookingId,
            action: task.nextAction,
            temperatureC: Number.isFinite(parsedTemperature) ? parsedTemperature : undefined,
            resultingLoadStatus,
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || "Unable to update task status.");
        }

        setSuccess(`${task.trailerNumber} updated successfully.`);
        await loadTasks({ withLoading: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to update task status.";
        setError(message === SESSION_EXPIRED_MESSAGE ? SESSION_EXPIRED_MESSAGE : message);
      } finally {
        setRowActionBookingId(null);
      }
    },
    [loadTasks, rowActionBookingId, temperatureByBookingId],
  );

  const handleMarkInstructionRead = useCallback(async (instructionId: string) => {
    if (instructionActionId) {
      return;
    }

    setInstructionActionId(instructionId);
    setError(null);

    try {
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
        throw new Error(payload.error || "Unable to mark instruction as read.");
      }

      await loadInstructions({ withLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to mark instruction as read.";
      setError(message);
    } finally {
      setInstructionActionId(null);
    }
  }, [instructionActionId, loadInstructions]);

  const sendQuickResponse = useCallback(async (
    instruction: DriverInstructionRecord,
    responseType: "OK" | "COMPLETED" | "ARRIVED" | "DELAYED" | "PROBLEM" | "CALL_ME",
    note?: string,
  ) => {
    if (responseActionInstructionId) {
      return;
    }

    setResponseActionInstructionId(instruction.id);
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
          instructionId: instruction.id,
          responseType,
          note: note?.trim() ? note.trim() : undefined,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to send quick response.");
      }

      setExceptionDraftByInstructionId((current) => ({
        ...current,
        [instruction.id]: null,
      }));
      setResponseNoteByInstructionId((current) => ({
        ...current,
        [instruction.id]: "",
      }));
      setSuccess(`Response sent: ${responseType.replace("_", " ")}.`);
      await loadInstructions({ withLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to send quick response.";
      setError(message);
    } finally {
      setResponseActionInstructionId(null);
    }
  }, [loadInstructions, responseActionInstructionId]);

  const shellHeader = (
    <header className="rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700">Ferryspeed Driver Mobile</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">My Work</h1>
          <p className="mt-1 text-sm text-slate-600">{userLabel} • {roleLabel}</p>
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Deliveries</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{activeDeliveryCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Collections</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{activeCollectionCount}</p>
        </div>
        <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-800">Messages</p>
          <p className="mt-1 text-lg font-semibold text-cyan-950">{instructionFeed.unreadCount}</p>
        </div>
      </div>
    </header>
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

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
          ) : null}

          {success ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div>
          ) : null}

          {isLoading || isLoadingTasks ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading assigned tasks...</div>
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
                  <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-700">Messages / Instructions</h2>
                  <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-900">
                    {instructionFeed.unreadCount} unread
                  </span>
                </div>

                {isLoadingInstructions ? (
                  <p className="mt-3 text-sm text-slate-500">Loading instructions...</p>
                ) : null}

                {!isLoadingInstructions && instructionFeed.newestUnread ? (
                    <article className={`mt-3 rounded-xl border p-3 ${instructionFeed.newestUnread.priority === "critical" ? "border-rose-400 bg-rose-50" : instructionFeed.newestUnread.priority === "high" ? "border-amber-400 bg-amber-50" : "border-cyan-200 bg-cyan-50"}`}>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-900">New Instruction</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{instructionFeed.newestUnread.instruction}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {formatTimestamp(instructionFeed.newestUnread.createdAt)}
                      {instructionFeed.newestUnread.trailerNumber ? ` • ${instructionFeed.newestUnread.trailerNumber}` : ""}
                    </p>
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleMarkInstructionRead(instructionFeed.newestUnread?.id ?? "")}
                        disabled={instructionActionId === instructionFeed.newestUnread.id}
                        className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-400"
                      >
                        {instructionActionId === instructionFeed.newestUnread.id ? "Marking..." : "Mark Read"}
                      </button>
                    </div>
                  </article>
                ) : null}

                {!isLoadingInstructions && !instructionFeed.newestUnread ? (
                  <p className="mt-3 text-sm text-slate-500">No unread instructions.</p>
                ) : null}

                <div className="mt-3 border-t border-slate-200 pt-3">
                  {instructionFeed.recent[0] ? (
                    <article className={`mb-3 rounded-xl border p-3 ${instructionFeed.recent[0].priority === "critical" ? "border-rose-400 bg-rose-50" : instructionFeed.recent[0].priority === "high" ? "border-amber-400 bg-amber-50" : "border-slate-300 bg-white"}`}>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">Quick Response</p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">{instructionFeed.recent[0].instruction}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {formatTimestamp(instructionFeed.recent[0].createdAt)}
                        {instructionFeed.recent[0].trailerNumber ? ` • ${instructionFeed.recent[0].trailerNumber}` : ""}
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={responseActionInstructionId === instructionFeed.recent[0].id}
                          onClick={() => {
                            void sendQuickResponse(instructionFeed.recent[0], "OK");
                          }}
                          className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-900 disabled:opacity-60"
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          disabled={responseActionInstructionId === instructionFeed.recent[0].id}
                          onClick={() => void sendQuickResponse(instructionFeed.recent[0], "COMPLETED")}
                          className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-900 disabled:opacity-60"
                        >
                          COMPLETED
                        </button>
                        <button
                          type="button"
                          disabled={responseActionInstructionId === instructionFeed.recent[0].id}
                          onClick={() => {
                            void sendQuickResponse(instructionFeed.recent[0], "ARRIVED");
                          }}
                          className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-900 disabled:opacity-60"
                        >
                          ARRIVED
                        </button>
                        <button
                          type="button"
                          disabled={responseActionInstructionId === instructionFeed.recent[0].id}
                          onClick={() => {
                            setExceptionDraftByInstructionId((current) => ({ ...current, [instructionFeed.recent[0].id]: "DELAYED" }));
                          }}
                          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm font-semibold text-amber-900 disabled:opacity-60"
                        >
                          DELAYED
                        </button>
                        <button
                          type="button"
                          disabled={responseActionInstructionId === instructionFeed.recent[0].id}
                          onClick={() => {
                            setExceptionDraftByInstructionId((current) => ({ ...current, [instructionFeed.recent[0].id]: "PROBLEM" }));
                          }}
                          className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-3 text-sm font-semibold text-rose-900 disabled:opacity-60"
                        >
                          PROBLEM
                        </button>
                        <button
                          type="button"
                          disabled={responseActionInstructionId === instructionFeed.recent[0].id}
                          onClick={() => {
                            void sendQuickResponse(instructionFeed.recent[0], "CALL_ME");
                          }}
                          className="col-span-2 rounded-xl border border-rose-400 bg-rose-100 px-3 py-3 text-sm font-semibold text-rose-900 disabled:opacity-60"
                        >
                          CALL ME
                        </button>
                      </div>

                      {exceptionDraftByInstructionId[instructionFeed.recent[0].id] ? (
                        <div className="mt-3 rounded-xl border border-slate-300 bg-slate-50 p-3">
                          <p className="text-xs font-semibold text-slate-700">
                            {exceptionDraftByInstructionId[instructionFeed.recent[0].id]} selected. Add optional note.
                          </p>
                          <input
                            type="text"
                            maxLength={120}
                            value={responseNoteByInstructionId[instructionFeed.recent[0].id] ?? ""}
                            onChange={(event) => {
                              const { value } = event.target;
                              setResponseNoteByInstructionId((current) => ({
                                ...current,
                                [instructionFeed.recent[0].id]: value,
                              }));
                            }}
                            placeholder="Optional note"
                            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900"
                          />
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const choice = exceptionDraftByInstructionId[instructionFeed.recent[0].id];
                                if (!choice) return;
                                void sendQuickResponse(
                                  instructionFeed.recent[0],
                                  choice,
                                  responseNoteByInstructionId[instructionFeed.recent[0].id],
                                );
                              }}
                              disabled={responseActionInstructionId === instructionFeed.recent[0].id}
                              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              {responseActionInstructionId === instructionFeed.recent[0].id ? "Sending..." : "Send"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setExceptionDraftByInstructionId((current) => ({ ...current, [instructionFeed.recent[0].id]: null }));
                              }}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {instructionFeed.recent[0].latestResponse ? (
                        <p className={`mt-3 text-xs font-semibold ${toResponseTone(instructionFeed.recent[0].latestResponse.responseType)}`}>
                          Last response: {toResponseLabel(instructionFeed.recent[0].latestResponse.responseType)}
                          {instructionFeed.recent[0].latestResponse.message
                            ? ` - ${instructionFeed.recent[0].latestResponse.message}`
                            : ""}
                          {` • ${formatTimestamp(instructionFeed.recent[0].latestResponse.createdAt)}`}
                        </p>
                      ) : null}
                    </article>
                  ) : null}

                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Recent History</p>
                  {instructionFeed.recent.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">No instruction history yet.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {instructionFeed.recent.slice(0, 6).map((item) => (
                        <article key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                          <p className="text-sm text-slate-900">{item.instruction}</p>
                          <p className={`mt-1 text-[11px] font-bold uppercase ${item.priority === "critical" ? "text-rose-700" : item.priority === "high" ? "text-amber-700" : "text-slate-600"}`}>
                            {item.priority === "high" ? "ATTENTION" : item.priority}
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            {formatTimestamp(item.createdAt)} • {item.readAt ? `Read ${formatTimestamp(item.readAt)}` : "Unread"}
                          </p>
                          {item.latestResponse ? (
                            <p className={`mt-1 text-xs font-semibold ${toResponseTone(item.latestResponse.responseType)}`}>
                              Driver: {toResponseLabel(item.latestResponse.responseType)}
                              {item.latestResponse.message ? ` - ${item.latestResponse.message}` : ""}
                            </p>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              {workSections.map((group) => (
                <section key={group.key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-700">{group.title}</h2>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{group.items.length}</span>
                  </div>

                  {group.items.length === 0 ? (
                    <p className="text-sm text-slate-500">No tasks in this section.</p>
                  ) : (
                    <div className="space-y-3">
                      {group.items.map((task) => {
                        const isPending = rowActionBookingId === task.bookingId;

                        return (
                          <article key={task.bookingId} className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700">{toTaskKindLabel(task.taskKind)}</p>
                                <h3 className="text-base font-semibold text-slate-900">{task.trailerNumber}</h3>
                                <p className="text-sm text-slate-600">{task.customer || "No customer name"}</p>
                                {task.consignee ? <p className="text-xs text-slate-500">Consignee: {task.consignee}</p> : null}
                              </div>
                              <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-slate-700">{toStatusLabel(task.status)}</span>
                            </div>

                            <dl className="mt-3 grid grid-cols-1 gap-1 text-sm text-slate-700">
                              <div>
                                <dt className="inline font-medium">{toScheduleLabel(task.taskKind)}:</dt> <dd className="inline">{formatDeliveryDate(task.deliveryDate, task.deliveryTime)}</dd>
                              </div>
                              <div>
                                <dt className="inline font-medium">Acknowledged:</dt>{" "}
                                <dd className="inline">{formatTimestamp(task.driverAcknowledgedAt)}</dd>
                              </div>
                              <div>
                                <dt className="inline font-medium">Location:</dt> <dd className="inline">{task.location || "-"}</dd>
                              </div>
                              <div>
                                <dt className="inline font-medium">Reference:</dt> <dd className="inline">{task.bookingReference || "-"}</dd>
                              </div>
                            </dl>

                            {task.temperature.required && task.nextAction === "COLLECTED" ? (
                              <div className="mt-3 rounded-xl border border-cyan-200 bg-cyan-50 p-2">
                                <p className="text-xs font-medium uppercase tracking-[0.16em] text-cyan-800">Temperature controlled</p>
                                <label className="mt-2 block text-xs font-medium text-cyan-900" htmlFor={`temp-${task.bookingId}`}>
                                  Collection reading (C)
                                </label>
                                <input
                                  id={`temp-${task.bookingId}`}
                                  type="number"
                                  inputMode="decimal"
                                  step="0.1"
                                  className="mt-1 w-full rounded-lg border border-cyan-300 bg-white px-2 py-1 text-sm text-slate-900"
                                  value={temperatureByBookingId[task.bookingId] ?? ""}
                                  onChange={(event) => {
                                    const { value } = event.target;
                                    setTemperatureByBookingId((current) => ({ ...current, [task.bookingId]: value }));
                                  }}
                                />
                              </div>
                            ) : null}

                            {task.notes ? <p className="mt-2 text-sm text-slate-600">{task.notes}</p> : null}

                            <div className="mt-3 flex justify-end gap-2">
                              {task.taskKind === "collection" && task.nextAction === "COLLECTED" ? (
                                <>
                                  <button type="button" disabled={isPending || Boolean(rowActionBookingId)} onClick={() => void handleAction(task, "Empty")} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50">
                                    Collected Empty
                                  </button>
                                  <button type="button" disabled={isPending || Boolean(rowActionBookingId)} onClick={() => void handleAction(task, "Loaded")} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-400">
                                    Collected Loaded
                                  </button>
                                </>
                              ) : task.nextAction ? (
                                <button
                                  type="button"
                                  disabled={isPending || Boolean(rowActionBookingId)}
                                  onClick={() => {
                                    void handleAction(task);
                                  }}
                                  className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                                >
                                  {isPending ? "Updating..." : toActionLabel(task.nextAction)}
                                </button>
                              ) : (
                                <span className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">No action required</span>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </PermissionGuard>
  );
}
