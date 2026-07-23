"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CircleDot, Clock3, Users } from "lucide-react";
import { canAccessModule } from "@/lib/auth/permissions";
import type { RoleKey } from "@/lib/auth/roles";
import { useOperationalRealtime } from "@/lib/realtime/operational-realtime";
import { useOnlineUsers } from "@/lib/realtime/online-users";
import { loadTrailerAuditLog, type TrailerAuditRow } from "@/lib/trailer-audit-log";

type RealtimeOperationsCenterProps = {
  roleKey: RoleKey | null;
  userId: string | null;
  userName: string;
  roleLabel: string;
};

type NotificationItem = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  severity: "neutral" | "warning" | "critical";
};

const LAST_SEEN_KEY = "trailerhub.notification-center.last-seen";

const toNotification = (row: TrailerAuditRow): NotificationItem => {
  const eventType = row.event_type?.trim().toLowerCase() ?? "event";
  const description = row.description?.trim() || "Operational update received.";

  const severity: NotificationItem["severity"] =
    eventType.includes("damage") || eventType.includes("missing")
      ? "critical"
      : eventType.includes("temperature") || eventType.includes("hold") || eventType.includes("overdue")
        ? "warning"
        : "neutral";

  return {
    id: row.id,
    title: `${eventType.replace(/_/g, " ")} · ${row.trailer_number ?? "trailer"}`,
    description,
    createdAt: row.performed_at ?? row.created_at ?? new Date().toISOString(),
    severity,
  };
};

const formatDateTime = (value: string) => {
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

export function RealtimeOperationsCenter({ roleKey, userId, userName, roleLabel }: RealtimeOperationsCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [rows, setRows] = useState<TrailerAuditRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const canViewTimeline = roleKey ? canAccessModule(roleKey, "timeline") : false;
  const { onlineUsers, isConnected } = useOnlineUsers(userId, userName, roleLabel);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const saved = window.localStorage.getItem(LAST_SEEN_KEY);
    setLastSeenAt(saved);
  }, []);

  const loadData = useCallback(async () => {
    if (!canViewTimeline) {
      setRows([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await loadTrailerAuditLog({
        timeFilter: "last_7_days",
        limit: 40,
      });

      setRows(data);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load live operational updates.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [canViewTimeline]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useOperationalRealtime(["notifications", "activity"], () => {
    void loadData();
  }, { enabled: canViewTimeline, debounceMs: 550 });

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") {
      return;
    }

    const value = new Date().toISOString();
    window.localStorage.setItem(LAST_SEEN_KEY, value);
    setLastSeenAt(value);
  }, [isOpen]);

  const notifications = useMemo(() => rows.slice(0, 12).map(toNotification), [rows]);
  const activityFeed = useMemo(() => rows.slice(0, 20), [rows]);

  const unreadCount = useMemo(() => {
    if (!lastSeenAt) {
      return notifications.length;
    }

    const seenAt = new Date(lastSeenAt).getTime();
    if (Number.isNaN(seenAt)) {
      return 0;
    }

    return notifications.filter((item) => new Date(item.createdAt).getTime() > seenAt).length;
  }, [lastSeenAt, notifications]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50"
        aria-label="Notifications and activity"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div className="absolute right-0 mt-3 w-[min(92vw,460px)] rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-700">Notification Center</h3>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-xl border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600"
            >
              Close
            </button>
          </div>

          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                <Users className="h-4 w-4" />
                Online Users
              </p>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${isConnected ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                <CircleDot className="h-3 w-3" />
                {isConnected ? "Live" : "Offline"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {onlineUsers.length === 0 ? (
                <p className="text-xs text-slate-500">No online users detected.</p>
              ) : (
                onlineUsers.map((user) => (
                  <span key={user.userId} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700">
                    {user.name}
                  </span>
                ))
              )}
            </div>
          </div>

          <section className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">Live Notifications</h4>
            <div className="mt-2 max-h-44 space-y-2 overflow-y-auto pr-1">
              {isLoading ? (
                <p className="text-xs text-slate-500">Loading notifications...</p>
              ) : error ? (
                <p className="text-xs text-rose-600">{error}</p>
              ) : notifications.length === 0 ? (
                <p className="text-xs text-slate-500">No notifications yet.</p>
              ) : (
                notifications.map((item) => (
                  <article key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-800">{item.title}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.severity === "critical" ? "bg-rose-100 text-rose-700" : item.severity === "warning" ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-700"}`}>
                        {item.severity}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{item.description}</p>
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500">
                      <Clock3 className="h-3 w-3" /> {formatDateTime(item.createdAt)}
                    </p>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">Activity Feed</h4>
            <div className="mt-2 max-h-52 space-y-2 overflow-y-auto pr-1">
              {activityFeed.length === 0 ? (
                <p className="text-xs text-slate-500">No recent activity.</p>
              ) : (
                activityFeed.map((row) => (
                  <article key={`activity-${row.id}`} className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                    <p className="text-xs font-semibold text-slate-800">
                      {(row.event_type ?? "event").replace(/_/g, " ")} · {row.trailer_number ?? "trailer"}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">{row.description ?? "Operational activity logged."}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{formatDateTime(row.performed_at ?? row.created_at ?? "")}</p>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
