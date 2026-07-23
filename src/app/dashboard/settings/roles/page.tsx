"use client";

import { useEffect, useState } from "react";
import { SettingsNav } from "@/components/settings/settings-nav";
import { fetchRbacJson } from "@/lib/rbac/client-fetch";
import type { Database } from "@/lib/database.types";

type RoleRow = Database["public"]["Tables"]["app_roles"]["Row"];

type RolesResponse = {
  roles: RoleRow[];
};

type RolePatchResponse = {
  role: RoleRow;
};

export default function SettingsRolesPage() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<string | null>(null);

  useEffect(() => {
    const loadRoles = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const payload = await fetchRbacJson<RolesResponse>("/api/settings/roles");
        setRoles(payload.roles ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load roles.");
      } finally {
        setIsLoading(false);
      }
    };

    void loadRoles();
  }, []);

  const updateRole = async (row: RoleRow) => {
    setSavingRole(row.role_key);
    setError(null);
    setMessage(null);

    try {
      const payload = await fetchRbacJson<RolePatchResponse>("/api/settings/roles", {
        method: "PATCH",
        body: JSON.stringify({
          roleKey: row.role_key,
          label: row.label,
          description: row.description,
        }),
      });

      setRoles((current) => current.map((item) => (item.role_key === row.role_key ? payload.role : item)));
      setMessage("Role updated successfully.");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update role.");
    } finally {
      setSavingRole(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-700">Settings</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Roles</h1>
        <p className="mt-2 text-sm text-slate-600">Update role labels and descriptions while preserving the fixed system role keys.</p>
        <div className="mt-5">
          <SettingsNav />
        </div>
      </header>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

      <section className="grid gap-4 lg:grid-cols-2">
        {isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Loading roles...</div>
        ) : (
          roles.map((role) => (
            <article key={role.role_key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{role.role_key}</p>
              <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Role Label</label>
              <input
                value={role.label}
                onChange={(event) => {
                  const next = event.target.value;
                  setRoles((current) => current.map((item) => (item.role_key === role.role_key ? { ...item, label: next } : item)));
                }}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              />

              <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Description</label>
              <textarea
                value={role.description ?? ""}
                onChange={(event) => {
                  const next = event.target.value;
                  setRoles((current) => current.map((item) => (item.role_key === role.role_key ? { ...item, description: next } : item)));
                }}
                rows={3}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              />

              <button
                type="button"
                disabled={savingRole === role.role_key}
                onClick={() => {
                  void updateRole(role);
                }}
                className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-100 disabled:opacity-60"
              >
                {savingRole === role.role_key ? "Saving..." : "Save Role"}
              </button>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
