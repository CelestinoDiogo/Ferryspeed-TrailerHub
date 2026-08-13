"use client";

import { useCallback, useEffect, useState } from "react";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { SettingsNav } from "@/components/settings/settings-nav";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { fetchRbacJson } from "@/lib/rbac/client-fetch";
import { roleKeys, type RoleKey } from "@/lib/rbac/constants";
import type { SettingsUserListItem } from "@/lib/rbac/types";

type UsersResponse = {
  users: SettingsUserListItem[];
};

type UserPatchResponse = {
  user: {
    user_id: string;
    role_key: RoleKey;
    is_active: boolean;
  };
};

const roleLabels: Record<RoleKey, string> = {
  administrator: "Administrator",
  supervisor: "Supervisor",
  operator: "Operator",
  driver: "Driver",
};

export default function SettingsUsersPage() {
  const { roleKey: currentRoleKey } = useCurrentUser();
  const [users, setUsers] = useState<SettingsUserListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const payload = await fetchRbacJson<UsersResponse>("/api/settings/users");
      setUsers(payload.users ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load users.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadUsers();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadUsers]);

  const updateRole = async (userId: string, roleKey: RoleKey) => {
    setSavingUserId(userId);
    setError(null);
    setMessage(null);

    try {
      const payload = await fetchRbacJson<UserPatchResponse>("/api/settings/users", {
        method: "PATCH",
        body: JSON.stringify({ userId, roleKey }),
      });

      await loadUsers();
      void payload;
      setMessage("User role updated successfully.");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update user role.");
    } finally {
      setSavingUserId(null);
    }
  };

  const toggleActive = async (row: SettingsUserListItem) => {
    if (!row.roleKey || typeof row.isActive !== "boolean") {
      return;
    }

    setSavingUserId(row.userId);
    setError(null);
    setMessage(null);

    try {
      const payload = await fetchRbacJson<UserPatchResponse>("/api/settings/users", {
        method: "PATCH",
        body: JSON.stringify({ userId: row.userId, roleKey: row.roleKey, isActive: !row.isActive }),
      });

      await loadUsers();
      void payload;
      setMessage("User status updated successfully.");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update user status.");
    } finally {
      setSavingUserId(null);
    }
  };

  const linkDriverProfile = async (row: SettingsUserListItem) => {
    if (row.driverLinked || !row.roleKey) {
      return;
    }

    setSavingUserId(row.userId);
    setError(null);
    setMessage(null);

    try {
      const payload = await fetchRbacJson<UserPatchResponse>("/api/settings/users", {
        method: "PATCH",
        body: JSON.stringify({
          userId: row.userId,
          roleKey: row.roleKey,
          isActive: typeof row.isActive === "boolean" ? row.isActive : true,
          linkDriverProfile: true,
        }),
      });

      await loadUsers();
      void payload;
      setMessage("Driver profile linked successfully.");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to link driver profile.");
    } finally {
      setSavingUserId(null);
    }
  };

  const formatLastSignIn = (lastSignInAt: string | null) => {
    if (!lastSignInAt) {
      return "-";
    }

    const parsed = new Date(lastSignInAt);
    if (Number.isNaN(parsed.getTime())) {
      return "-";
    }

    return parsed.toLocaleString();
  };

  return (
    <PermissionGuard roleKey={currentRoleKey} moduleKey="user_management" action="view">
      <div className="space-y-6">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-700">Settings</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Users</h1>
        <p className="mt-2 text-sm text-slate-600">Manage authenticated users and assign one of the system roles.</p>
        <div className="mt-5">
          <SettingsNav />
        </div>
      </header>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">User</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Email</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Role</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Driver profile</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Active</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Last sign-in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading users...</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">No authenticated users found.</td>
                </tr>
              ) : (
                users.map((row) => (
                  <tr key={row.userId}>
                    <td className="px-4 py-3 font-medium text-slate-900">{row.displayName ?? "Unknown User"}</td>
                    <td className="px-4 py-3 text-slate-600">{row.email ?? "-"}</td>
                    <td className="px-4 py-3">
                      <select
                        value={row.roleKey ?? ""}
                        disabled={savingUserId === row.userId}
                        onChange={(event) => {
                          const nextRole = event.target.value;
                          if (!nextRole) {
                            return;
                          }

                          void updateRole(row.userId, nextRole as RoleKey);
                        }}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                      >
                        <option value="" disabled>
                          Unassigned
                        </option>
                        {roleKeys.map((roleKey) => (
                          <option key={roleKey} value={roleKey}>
                            {roleLabels[roleKey]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            row.driverLinked
                              ? "rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700"
                              : "rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700"
                          }
                        >
                          {row.driverLinked ? "Linked" : "Not linked"}
                        </span>
                        <button
                          type="button"
                          disabled={savingUserId === row.userId || row.driverLinked || !row.roleKey}
                          onClick={() => {
                            void linkDriverProfile(row);
                          }}
                          className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          {row.driverLinked ? "Linked" : "Link profile"}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={savingUserId === row.userId || !row.roleKey || typeof row.isActive !== "boolean"}
                        onClick={() => {
                          void toggleActive(row);
                        }}
                        className={
                          row.isActive
                            ? "rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"
                            : row.roleKey
                              ? "rounded-xl border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700"
                              : "rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500"
                        }
                      >
                        {typeof row.isActive === "boolean" ? (row.isActive ? "Active" : "Inactive") : "Not assigned"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatLastSignIn(row.lastSignInAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      </div>
    </PermissionGuard>
  );
}
