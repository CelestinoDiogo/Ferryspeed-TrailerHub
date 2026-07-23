"use client";

import { useEffect, useMemo, useState } from "react";
import { SettingsNav } from "@/components/settings/settings-nav";
import { fetchRbacJson } from "@/lib/rbac/client-fetch";
import type { PermissionMatrixItem } from "@/lib/rbac/types";

type PermissionsResponse = {
  permissions: PermissionMatrixItem[];
};

type PermissionPutResponse = {
  permission: {
    role_key: string;
    module_key: string;
    can_view: boolean;
    can_create: boolean;
    can_edit: boolean;
    can_delete: boolean;
    can_reports: boolean;
  };
};

const actionKeys = [
  { key: "canView", label: "View" },
  { key: "canCreate", label: "Create" },
  { key: "canEdit", label: "Edit" },
  { key: "canDelete", label: "Delete" },
  { key: "canReports", label: "Reports" },
] as const;

export default function SettingsPermissionsPage() {
  const [rows, setRows] = useState<PermissionMatrixItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    const loadPermissions = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const payload = await fetchRbacJson<PermissionsResponse>("/api/settings/permissions");
        setRows(payload.permissions ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load permissions.");
      } finally {
        setIsLoading(false);
      }
    };

    void loadPermissions();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, PermissionMatrixItem[]>();

    for (const row of rows) {
      const list = map.get(row.moduleKey) ?? [];
      list.push(row);
      map.set(row.moduleKey, list);
    }

    return Array.from(map.entries()).map(([moduleKey, entries]) => ({
      moduleKey,
      moduleLabel: entries[0]?.moduleLabel ?? moduleKey,
      entries,
    }));
  }, [rows]);

  const togglePermission = async (
    row: PermissionMatrixItem,
    key: "canView" | "canCreate" | "canEdit" | "canDelete" | "canReports",
  ) => {
    const next = !row[key];
    const payloadBody = {
      roleKey: row.roleKey,
      moduleKey: row.moduleKey,
      canView: key === "canView" ? next : row.canView,
      canCreate: key === "canCreate" ? next : row.canCreate,
      canEdit: key === "canEdit" ? next : row.canEdit,
      canDelete: key === "canDelete" ? next : row.canDelete,
      canReports: key === "canReports" ? next : row.canReports,
    };

    const rowKey = `${row.roleKey}:${row.moduleKey}`;
    setSavingKey(rowKey);
    setError(null);
    setMessage(null);

    try {
      await fetchRbacJson<PermissionPutResponse>("/api/settings/permissions", {
        method: "PUT",
        body: JSON.stringify(payloadBody),
      });

      setRows((current) =>
        current.map((entry) =>
          entry.roleKey === row.roleKey && entry.moduleKey === row.moduleKey
            ? {
                ...entry,
                canView: payloadBody.canView,
                canCreate: payloadBody.canCreate,
                canEdit: payloadBody.canEdit,
                canDelete: payloadBody.canDelete,
                canReports: payloadBody.canReports,
              }
            : entry,
        ),
      );

      setMessage("Permission updated successfully.");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update permission.");
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-700">Settings</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Permissions</h1>
        <p className="mt-2 text-sm text-slate-600">Configure independent View, Create, Edit, Delete, and Reports permissions per module and role.</p>
        <div className="mt-5">
          <SettingsNav />
        </div>
      </header>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

      {isLoading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Loading permissions...</div>
      ) : (
        grouped.map((group) => (
          <section key={group.moduleKey} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <header className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-700">{group.moduleLabel}</h2>
            </header>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Role</th>
                    {actionKeys.map((action) => (
                      <th key={action.key} className="px-4 py-3 text-center font-semibold text-slate-700">
                        {action.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {group.entries.map((entry) => {
                    const rowKey = `${entry.roleKey}:${entry.moduleKey}`;
                    return (
                      <tr key={rowKey}>
                        <td className="px-4 py-3 font-medium text-slate-900">{entry.roleKey}</td>
                        {actionKeys.map((action) => {
                          const value = entry[action.key];
                          return (
                            <td key={`${rowKey}:${action.key}`} className="px-4 py-3 text-center">
                              <button
                                type="button"
                                disabled={savingKey === rowKey}
                                onClick={() => {
                                  void togglePermission(entry, action.key);
                                }}
                                className={
                                  value
                                    ? "rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                                    : "rounded-lg border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600"
                                }
                              >
                                {value ? "Yes" : "No"}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
