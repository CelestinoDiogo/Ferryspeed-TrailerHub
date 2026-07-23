"use client";

import Link from "next/link";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { SettingsNav } from "@/components/settings/settings-nav";
import { useCurrentUser } from "@/lib/auth/use-current-user";

const cards = [
  {
    title: "Users",
    description: "Manage authenticated users and role assignment.",
    href: "/dashboard/settings/users",
  },
  {
    title: "Roles",
    description: "Review and update role definitions.",
    href: "/dashboard/settings/roles",
  },
  {
    title: "Permissions",
    description: "Configure module permissions by role.",
    href: "/dashboard/settings/permissions",
  },
] as const;

export default function SettingsPage() {
  const { roleKey } = useCurrentUser();

  return (
    <PermissionGuard roleKey={roleKey} moduleKey="settings" action="view">
      <div className="space-y-6">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-700">Settings</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">User Management, Roles & Permissions</h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">
          Centralized administration layer for user access control. This module is isolated from operational features and prepared for future expansion.
        </p>
        <div className="mt-5">
          <SettingsNav />
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.href} href={card.href} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-cyan-300 hover:shadow">
            <h2 className="text-lg font-semibold text-slate-900">{card.title}</h2>
            <p className="mt-2 text-sm text-slate-600">{card.description}</p>
            <p className="mt-4 text-sm font-semibold text-cyan-700">Open module</p>
          </Link>
        ))}
      </section>
      </div>
    </PermissionGuard>
  );
}
