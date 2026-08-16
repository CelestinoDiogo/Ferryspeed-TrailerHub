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
  ChevronDown,
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
      { label: "Master Mobile", href: "/dashboard/mobile", icon: Bot, moduleKey: "dashboard" },
      { label: "Driver Mobile", href: "/dashboard/driver", icon: Truck, moduleKey: "dashboard" },
      { label: "Driver Communications", href: "/dashboard/driver-communications", icon: Truck, moduleKey: "dashboard" },
      { label: "Arrivals", href: "/dashboard/search?filter=arrivals_today", icon: MapPin, moduleKey: "arrivals" },
      { label: "Export Operations", href: "/dashboard/export-operations", icon: Upload, moduleKey: "export_operations" },
      { label: "Deliveries", href: "/dashboard/deliveries", icon: Truck, moduleKey: "arrivals" },
      { label: "Collections", href: "/dashboard/collections", icon: ClipboardList, moduleKey: "dashboard" },
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
      { label: "Automation Centre", href: "/dashboard/settings/automation", icon: Settings, moduleKey: "settings" },
      { label: "Operations Centre", href: "/dashboard/operations-command-centre", icon: Settings, moduleKey: "settings" },
    ],
  },
];

const historyReportItems: MenuItem[] = [
  { label: "Reports Hub", href: "/dashboard/reports", icon: FileBarChart2, moduleKey: "reports" },
  { label: "Export Operations Report", href: "/dashboard/export-operations", icon: Upload, moduleKey: "export_operations" },
  { label: "Arrivals Report", href: "/dashboard/arrivals", icon: MapPin, moduleKey: "arrivals" },
  { label: "Departures Report", href: "/dashboard/departures", icon: LogOut, moduleKey: "departures" },
  { label: "Deliveries Report", href: "/dashboard/deliveries/history", icon: Truck, moduleKey: "arrivals" },
  { label: "Compound Snapshot", href: "/dashboard/compound/snapshot", icon: Warehouse, moduleKey: "compound" },
  { label: "Compound Activity", href: "/dashboard/compound/history", icon: ClipboardList, moduleKey: "compound" },
  { label: "AI Reports", href: "/dashboard/vessel-operations?report=ai", icon: FileText, moduleKey: "reports" },
  { label: "Print Reports", href: "/dashboard/vessel-operations?report=print", icon: Printer, moduleKey: "reports" },
];

export function Sidebar({ onNavigate, mobile = false }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { roleKey } = useCurrentUser();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isHistoryReportsOpen, setIsHistoryReportsOpen] = useState(false);

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
      items: group.items.filter((item) => (roleKey ? canAccessModule(roleKey, item.moduleKey) : false)),
    }))
    .filter((group) => group.items.length > 0);

  const canSeeDashboardItem = roleKey ? canAccessModule(roleKey, dashboardItem.moduleKey) : false;
  const filteredHistoryReportItems = historyReportItems.filter((item) => (roleKey ? canAccessModule(roleKey, item.moduleKey) : false));
  const isHistoryReportActive = filteredHistoryReportItems.some((item) => isItemActive(item.href));

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
              {group.title === "INTELLIGENCE & REPORTS" && filteredHistoryReportItems.length > 0 ? (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    aria-expanded={isHistoryReportsOpen || isHistoryReportActive}
                    onClick={() => setIsHistoryReportsOpen((current) => !current)}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${isHistoryReportActive ? "bg-emerald-500/20 text-white ring-1 ring-emerald-400/35" : "text-white/70 hover:bg-white/8 hover:text-white"}`}
                  >
                    <span className="flex items-center gap-3"><FileBarChart2 className="h-[18px] w-[18px]" /><span>History &amp; Reports</span></span>
                    <ChevronDown className={`h-4 w-4 text-white/45 transition-transform ${isHistoryReportsOpen || isHistoryReportActive ? "rotate-180" : ""}`} />
                  </button>
                  {isHistoryReportsOpen || isHistoryReportActive ? (
                    <div className="ml-3 space-y-1 border-l border-white/10 pl-2">
                      {filteredHistoryReportItems.map((item) => <SidebarItem key={item.href + item.label} {...item} active={isItemActive(item.href)} onNavigate={onNavigate} />)}
                    </div>
                  ) : null}
                </div>
              ) : null}
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
