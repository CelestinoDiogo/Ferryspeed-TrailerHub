"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { ComponentType } from "react";
import {
  BarChart3,
  Bot,
  ClipboardList,
  Container,
  FileBarChart2,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  MapPin,
  Printer,
  ScanSearch,
  Settings,
  Ship,
  Truck,
  Upload,
  Warehouse,
} from "lucide-react";
import { isNavItemActive } from "@/components/layout/navigation";
import { SidebarItem } from "@/components/layout/sidebar-item";
import { SidebarSection } from "@/components/layout/sidebar-section";
import { canAccessModule, type PermissionModuleKey } from "@/lib/auth/permissions";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { supabase } from "@/lib/supabase";

type SidebarProps = {
  onNavigate?: () => void;
  mobile?: boolean;
};

type MenuItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  moduleKey: PermissionModuleKey;
};

type MenuGroup = {
  title: string;
  items: MenuItem[];
};

const dashboardItem: MenuItem = {
  label: "Dashboard",
  href: "/dashboard",
  icon: LayoutDashboard,
  moduleKey: "dashboard",
};

const groupedItems: MenuGroup[] = [
  {
    title: "OPERATIONS",
    items: [
      { label: "Vessel Operations", href: "/dashboard/vessel-operations", icon: Ship, moduleKey: "vessel_operations" },
      { label: "Arrivals", href: "/dashboard/search?filter=arrivals_today", icon: MapPin, moduleKey: "arrivals" },
      { label: "Export Operations", href: "/dashboard/export-operations", icon: Upload, moduleKey: "export_operations" },
      { label: "Deliveries", href: "/dashboard/deliveries", icon: Truck, moduleKey: "arrivals" },
      { label: "Collections", href: "/dashboard/deliveries?filter=waiting", icon: ClipboardList, moduleKey: "arrivals" },
      { label: "Departures", href: "/dashboard/departure", icon: LogOut, moduleKey: "departures" },
    ],
  },
  {
    title: "YARD",
    items: [
      { label: "Compound", href: "/dashboard/compound", icon: Warehouse, moduleKey: "compound" },
      { label: "Stock Check", href: "/dashboard/compound/stock-check", icon: ClipboardList, moduleKey: "stock_check" },
      { label: "Review Discrepancies", href: "/dashboard/compound/review-discrepancies", icon: ScanSearch, moduleKey: "reconciliation" },
      { label: "Waiting for Compound", href: "/dashboard/compound/waiting", icon: ClipboardList, moduleKey: "compound" },
      { label: "Local Trailers", href: "/dashboard/local-trailers", icon: Truck, moduleKey: "compound" },
      { label: "Trailer Search", href: "/dashboard/search", icon: ScanSearch, moduleKey: "arrivals" },
      { label: "Maintenance", href: "/dashboard/maintenance", icon: LifeBuoy, moduleKey: "compound" },
    ],
  },
  {
    title: "INTELLIGENCE & REPORTS",
    items: [
      { label: "Operations Summary", href: "/dashboard/operations", icon: FileBarChart2, moduleKey: "reports" },
      { label: "Trailer Timeline", href: "/dashboard/trailer-timeline", icon: ClipboardList, moduleKey: "timeline" },
      { label: "AI Assistant", href: "/dashboard/ai-assistant", icon: Bot, moduleKey: "ai_assistant" },
      { label: "AI Reports", href: "/dashboard/vessel-operations?report=ai", icon: FileText, moduleKey: "reports" },
      { label: "Print Reports", href: "/dashboard/vessel-operations?report=print", icon: Printer, moduleKey: "reports" },
    ],
  },
  {
    title: "ADMINISTRATION",
    items: [
      { label: "Manual Arrival", href: "/dashboard/new-arrival", icon: BarChart3, moduleKey: "arrivals" },
      { label: "Trailer Fleet", href: "/dashboard/company-trailers", icon: Container, moduleKey: "compound" },
      { label: "Settings", href: "/dashboard/settings", icon: Settings, moduleKey: "settings" },
      { label: "Users", href: "/dashboard/settings/users", icon: Settings, moduleKey: "user_management" },
      { label: "Roles", href: "/dashboard/settings/roles", icon: Settings, moduleKey: "settings" },
      { label: "Permissions", href: "/dashboard/settings/permissions", icon: Settings, moduleKey: "settings" },
      { label: "Operations Centre", href: "/dashboard/operations-centre", icon: Settings, moduleKey: "settings" },
    ],
  },
];

export function Sidebar({ onNavigate, mobile = false }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { roleKey } = useCurrentUser();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  const isItemActive = (href: string) => {
    const [baseHref, queryString] = href.split("?");
    if (!isNavItemActive(pathname, baseHref)) return false;
    if (!queryString) return true;

    const expected = new URLSearchParams(queryString);
    for (const [key, value] of expected.entries()) {
      if (searchParams.get(key) !== value) return false;
    }
    return true;
  };

  const filteredGroups = groupedItems
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => (roleKey ? canAccessModule(roleKey, item.moduleKey) : true)),
    }))
    .filter((group) => group.items.length > 0);

  const canSeeDashboardItem = roleKey ? canAccessModule(roleKey, dashboardItem.moduleKey) : true;

  return (
    <aside
      className={
        mobile
          ? "h-full w-full print:hidden"
          : "sticky top-0 h-screen w-[290px] shrink-0 border-r border-slate-900 bg-[linear-gradient(180deg,#111827_0%,#0b1220_100%)] text-white print:hidden"
      }
    >
      <div className="flex h-full flex-col px-4 py-5">
        <Link
          href="/dashboard"
          className="mb-5 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
          onClick={onNavigate}
        >
          <div className="flex items-center gap-3">
            <Image src="/branding/ferryspeed logo.png" alt="Ferryspeed logo" width={144} height={44} priority className="h-10 w-auto" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-300/80">Enterprise</p>
              <p className="text-sm text-white/70">TrailerHub</p>
            </div>
          </div>
        </Link>

        <nav className="flex-1 space-y-4 overflow-y-auto pr-1">
          {canSeeDashboardItem ? (
            <SidebarItem
              label={dashboardItem.label}
              href={dashboardItem.href}
              icon={dashboardItem.icon}
              active={isItemActive(dashboardItem.href)}
              onNavigate={onNavigate}
            />
          ) : null}

          {filteredGroups.map((group) => (
            <SidebarSection key={group.title} title={group.title}>
              {group.items.map((item) => {
                const active = isItemActive(item.href);
                return (
                  <SidebarItem
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    active={active}
                    onNavigate={onNavigate}
                  />
                );
              })}
            </SidebarSection>
          ))}
        </nav>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3">
          <button
            type="button"
            onClick={() => {
              void handleSignOut();
            }}
            disabled={isSigningOut}
            className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" />
            {isSigningOut ? "Signing out..." : "Sign Out"}
          </button>
          <p className="text-sm font-semibold text-white">Ferryspeed</p>
          <p className="text-xs text-white/55">Enterprise Logistics Platform</p>
        </div>
      </div>
    </aside>
  );
}
