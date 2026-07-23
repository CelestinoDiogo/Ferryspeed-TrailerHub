"use client";

import { useEffect, useState } from "react";
import { SettingsNav } from "@/components/settings/settings-nav";
import { fetchRbacJson } from "@/lib/rbac/client-fetch";
import { roleKeys, type RoleKey } from "@/lib/rbac/constants";
import type { Database } from "@/lib/database.types";

type UserRoleRow = Database["public"]["Tables"]["app_user_roles"]["Row"];

type UsersResponse = {
  users: UserRoleRow[];
};

type UserPatchResponse = {
  user: UserRoleRow;
};

const roleLabels: Record<RoleKey, string> = {
  administrator: "Administrator",
  supervisor: "Supervisor",
  operator: "Operator",
  driver: "Driver",
};

export default function SettingsUsersPage() {
  const [users, setUsers] = useState<UserRoleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  useEffect(() => {
    const loadUsers = async () => {
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
    };

    void loadUsers();
  }, []);

  const updateRole = async (userId: string, roleKey: RoleKey) => {
    setSavingUserId(userId);
    setError(null);
    setMessage(null);

    try {
      const payload = await fetchRbacJson<UserPatchResponse>("/api/settings/users", {
        method: "PATCH",
        body: JSON.stringify({ userId, roleKey }),
      });

      setUsers((current) => current.map((row) => (row.user_id === userId ? payload.user : row)));
      setMessage("User role updated successfully.");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update user role.");
    } finally {
      setSavingUserId(null);
    }
  };

  const toggleActive = async (row: UserRoleRow) => {
    setSavingUserId(row.user_id);
    setError(null);
    setMessage(null);

    try {
      const payload = await fetchRbacJson<UserPatchResponse>("/api/settings/users", {
        method: "PATCH",
        body: JSON.stringify({ userId: row.user_id, roleKey: row.role_key, isActive: !row.is_active }),
      });

      setUsers((current) => current.map((item) => (item.user_id === row.user_id ? payload.user : item)));
      setMessage("User status updated successfully.");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update user status.");
    } finally {
      setSavingUserId(null);
    }
  };

  return (
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
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">Loading users...</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">No users assigned yet.</td>
                </tr>
              ) : (
                users.map((row) => (
                  <tr key={row.user_id}>
                    <td className="px-4 py-3 font-medium text-slate-900">{row.display_name ?? "Unknown User"}</td>
                    <td className="px-4 py-3 text-slate-600">{row.email ?? "-"}</td>
                    <td className="px-4 py-3">
                      <select
                        value={row.role_key}
                        disabled={savingUserId === row.user_id}
                        onChange={(event) => {
                          const nextRole = event.target.value as RoleKey;
                          void updateRole(row.user_id, nextRole);
                        }}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                      >
                        {roleKeys.map((roleKey) => (
                          <option key={roleKey} value={roleKey}>
                            {roleLabels[roleKey]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={savingUserId === row.user_id}
                        onClick={() => {
                          void toggleActive(row);
                        }}
                        className={
                          row.is_active
                            ? "rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"
                            : "rounded-xl border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700"
                        }
                      >
                        {row.is_active ? "Active" : "Inactive"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
