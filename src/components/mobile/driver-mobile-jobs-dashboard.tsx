"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { toRoleLabel, type RoleKey } from "@/lib/auth/roles";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { supabase } from "@/lib/supabase";
import { type DriverMobileTask, type DriverTaskAction } from "@/lib/driver-mobile-service";
import { getSessionToken, SESSION_EXPIRED_MESSAGE } from "@/lib/voice/session";

type DriverTaskResponse = {
  driver: {
    id: string;
    display_name: string;
    user_id: string;
  } | null;
  tasks: DriverMobileTask[];
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
  const [tasks, setTasks] = useState<DriverMobileTask[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [actionBookingId, setActionBookingId] = useState<string | null>(null);
  const [temperatureByBookingId, setTemperatureByBookingId] = useState<Record<string, string>>({});

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

      setDriver(payload.driver ?? null);
      setTasks(Array.isArray(payload.tasks) ? payload.tasks : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load assigned jobs.";
      setError(message);
      setDriver(null);
      setTasks([]);
    } finally {
      if (withLoading) {
        setIsLoadingTasks(false);
      }
    }
  }, []);

  useEffect(() => {
    // Initial fetch runs once on mount to populate assigned jobs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTasks();
  }, [loadTasks]);

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
    if (!task.nextAction || actionBookingId) {
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

    setActionBookingId(task.bookingId);
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
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to update job status.");
      }

      setSuccess(`${task.trailerNumber} updated successfully.`);
      setTemperatureByBookingId((current) => ({ ...current, [task.bookingId]: "" }));
      await loadTasks(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update job status.";
      setError(message === SESSION_EXPIRED_MESSAGE ? SESSION_EXPIRED_MESSAGE : message);
    } finally {
      setActionBookingId(null);
    }
  }, [actionBookingId, loadTasks, temperatureByBookingId]);

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
            const isPending = actionBookingId === task.bookingId;
            const showTemperatureInput = task.nextAction === "COLLECTED" && task.temperature.required;
            const showAging = task.taskKind === "collection" && task.collectionAging !== null;
            const collectionAging = task.collectionAging;
            const completedAt = task.deliveredAt ?? task.collectedAt;

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

                <div className="mt-3 flex justify-end">
                  {task.nextAction ? (
                    <button
                      type="button"
                      disabled={isPending || Boolean(actionBookingId)}
                      onClick={() => {
                        void handleAction(task);
                      }}
                      className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      {isPending ? "Updating..." : actionLabel(task.nextAction)}
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
