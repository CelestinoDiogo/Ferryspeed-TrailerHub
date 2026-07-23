"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { label: "Users", href: "/dashboard/settings/users" },
  { label: "Roles", href: "/dashboard/settings/roles" },
  { label: "Permissions", href: "/dashboard/settings/permissions" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              active
                ? "rounded-xl border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-800"
                : "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
