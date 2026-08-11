"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { toRoleLabel, type RoleKey } from "@/lib/auth/roles";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSessionToken, SESSION_EXPIRED_MESSAGE } from "@/lib/voice/session";
import type { DriverMobileTask, DriverTaskAction } from "@/lib/driver-mobile-service";

type DriverTaskResponse = {
  driver: {
    id: string;
    display_name: string;
    user_id: string;
  } | null;
  tasks: DriverMobileTask[];
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

const toActionLabel = (action: DriverTaskAction) => (action === "COLLECTED" ? "Mark Collected" : "Mark Delivered");

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

const groupOrder: Array<"current" | "upcoming" | "completed"> = ["current", "upcoming", "completed"];

const groupTitles: Record<(typeof groupOrder)[number], string> = {
  current: "Current",
  upcoming: "Upcoming",
  completed: "Completed",
};

export function DriverMobileDashboard() {
  const { roleKey, fullName, email, isLoading } = useCurrentUser();
  const [driver, setDriver] = useState<DriverTaskResponse["driver"]>(null);
  const [tasks, setTasks] = useState<DriverMobileTask[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rowActionBookingId, setRowActionBookingId] = useState<string | null>(null);
  const [temperatureByBookingId, setTemperatureByBookingId] = useState<Record<string, string>>({});

  const mobileRoleKey = roleKey as RoleKey | null;
  const roleLabel = toRoleLabel(mobileRoleKey);
  const userLabel = fullName ?? email ?? "Authenticated Driver";

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

  useEffect(() => {
    // Initial fetch runs once on mount to populate the driver's task board.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTasks();
  }, [loadTasks]);

  const groupedTasks = useMemo(() => {
    return groupOrder.map((group) => ({
      key: group,
      title: groupTitles[group],
      items: tasks.filter((task) => task.group === group),
    }));
  }, [tasks]);

  const handleAction = useCallback(
    async (task: DriverMobileTask) => {
      if (!task.nextAction || rowActionBookingId) {
        return;
      }

      const temperatureInput = temperatureByBookingId[task.bookingId] ?? "";
      const parsedTemperature = parseTemperature(temperatureInput);
      const requiresCollectionTemperature = task.temperature.required && task.nextAction === "COLLECTED";

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

  return (
    <PermissionGuard roleKey={mobileRoleKey} moduleKey="driver_mobile" action="view" allowWhenRoleMissing={false}>
      <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-3 py-4 text-slate-900 sm:px-4">
        <div className="mx-auto w-full max-w-2xl">
          <header className="rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700">Ferryspeed Driver Mobile</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">Assigned Delivery Tasks</h1>
            <p className="mt-1 text-sm text-slate-600">{userLabel} • {roleLabel}</p>
            {driver ? <p className="mt-2 text-sm text-slate-700">Driver profile: {driver.display_name}</p> : null}
          </header>

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
              {groupedTasks.map((group) => (
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
                                <h3 className="text-base font-semibold text-slate-900">{task.trailerNumber}</h3>
                                <p className="text-sm text-slate-600">{task.customer || "No customer name"}</p>
                              </div>
                              <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-slate-700">{toStatusLabel(task.status)}</span>
                            </div>

                            <dl className="mt-3 grid grid-cols-1 gap-1 text-sm text-slate-700">
                              <div>
                                <dt className="inline font-medium">Delivery:</dt> <dd className="inline">{formatDeliveryDate(task.deliveryDate, task.deliveryTime)}</dd>
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

                            <div className="mt-3 flex justify-end">
                              {task.nextAction ? (
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
