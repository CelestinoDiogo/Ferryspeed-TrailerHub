"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
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

type SidebarProps = {
  onNavigate?: () => void;
  mobile?: boolean;
};

type MenuItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

type MenuGroup = {
  title: string;
  items: MenuItem[];
};

const dashboardItem: MenuItem = {
  label: "Dashboard",
  href: "/dashboard",
  icon: LayoutDashboard,
};

const groupedItems: MenuGroup[] = [
  {
    title: "OPERATIONS",
    items: [
      { label: "Vessel Operations", href: "/dashboard/vessel-operations", icon: Ship },
      { label: "Arrivals", href: "/dashboard/search?filter=arrivals_today", icon: MapPin },
      { label: "Export Operations", href: "/dashboard/export-operations", icon: Upload },
      { label: "Deliveries", href: "/dashboard/deliveries", icon: Truck },
      { label: "Collections", href: "/dashboard/deliveries?filter=waiting", icon: ClipboardList },
      { label: "Departures", href: "/dashboard/departure", icon: LogOut },
    ],
  },
  {
    title: "YARD",
    items: [
      { label: "Compound", href: "/dashboard/compound", icon: Warehouse },
      { label: "Waiting for Compound", href: "/dashboard/compound/waiting", icon: ClipboardList },
      { label: "Local Trailers", href: "/dashboard/local-trailers", icon: Truck },
      { label: "Trailer Search", href: "/dashboard/search", icon: ScanSearch },
      { label: "Maintenance", href: "/dashboard/maintenance", icon: LifeBuoy },
    ],
  },
  {
    title: "INTELLIGENCE & REPORTS",
    items: [
      { label: "Operations Summary", href: "/dashboard/operations", icon: FileBarChart2 },
      { label: "AI Assistant", href: "/dashboard/ai-assistant", icon: Bot },
      { label: "AI Reports", href: "/dashboard/vessel-operations?report=ai", icon: FileText },
      { label: "Print Reports", href: "/dashboard/vessel-operations?report=print", icon: Printer },
    ],
  },
  {
    title: "ADMINISTRATION",
    items: [
      { label: "Manual Arrival", href: "/dashboard/new-arrival", icon: BarChart3 },
      { label: "Trailer Fleet", href: "/dashboard/company-trailers", icon: Container },
      { label: "Settings", href: "/dashboard/operations-centre", icon: Settings },
    ],
  },
];

export function Sidebar({ onNavigate, mobile = false }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
          <SidebarItem
            label={dashboardItem.label}
            href={dashboardItem.href}
            icon={dashboardItem.icon}
            active={isItemActive(dashboardItem.href)}
            onNavigate={onNavigate}
          />

          {groupedItems.map((group) => (
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
          <p className="text-sm font-semibold text-white">Ferryspeed</p>
          <p className="text-xs text-white/55">Enterprise Logistics Platform</p>
        </div>
      </div>
    </aside>
  );
}
