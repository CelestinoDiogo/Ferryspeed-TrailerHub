"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavItemActive, navItems, type NavItem } from "@/components/layout/navigation";

type SidebarProps = {
  onNavigate?: () => void;
  mobile?: boolean;
};

const NavIcon = ({ icon }: { icon: NavItem["icon"] }) => {
  const classes = "h-4 w-4 stroke-current";

  switch (icon) {
    case "dashboard":
      return <svg viewBox="0 0 24 24" fill="none" className={classes}><path d="M3 4h8v8H3V4Zm10 0h8v5h-8V4ZM3 14h8v6H3v-6Zm10-3h8v9h-8v-9Z" strokeWidth="1.6" /></svg>;
    case "arrival":
      return <svg viewBox="0 0 24 24" fill="none" className={classes}><path d="M12 4v13m0 0-4-4m4 4 4-4M4 20h16" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "departure":
      return <svg viewBox="0 0 24 24" fill="none" className={classes}><path d="M12 20V7m0 0-4 4m4-4 4 4M4 4h16" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "search":
      return <svg viewBox="0 0 24 24" fill="none" className={classes}><circle cx="11" cy="11" r="6" strokeWidth="1.6" /><path d="m16 16 5 5" strokeWidth="1.6" strokeLinecap="round" /></svg>;
    case "compound":
      return <svg viewBox="0 0 24 24" fill="none" className={classes}><path d="M4 7h16M4 12h16M4 17h16" strokeWidth="1.6" strokeLinecap="round" /><path d="M7 4v16M12 4v16M17 4v16" strokeWidth="1.6" strokeLinecap="round" /></svg>;
    case "load":
      return <svg viewBox="0 0 24 24" fill="none" className={classes}><path d="M3 12h13m0 0-3-3m3 3-3 3m5 1h3v4h-3m-15 0h12" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "edit":
      return <svg viewBox="0 0 24 24" fill="none" className={classes}><path d="M4 20h4l10-10-4-4L4 16v4Zm9-12 4 4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "deliveries":
      return <svg viewBox="0 0 24 24" fill="none" className={classes}><path d="M3 7h12v9H3V7Zm12 3h3l3 3v3h-6v-6Zm-8 8a1.5 1.5 0 1 0 0 .01Zm11 0a1.5 1.5 0 1 0 0 .01Z" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "waiting":
      return <svg viewBox="0 0 24 24" fill="none" className={classes}><circle cx="12" cy="12" r="8" strokeWidth="1.6" /><path d="M12 8v5l3 2" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "calendar":
      return <svg viewBox="0 0 24 24" fill="none" className={classes}><path d="M6 4v3m12-3v3M4 9h16M5 7h14v13H5V7Z" strokeWidth="1.6" strokeLinecap="round" /><path d="M8 13h3v3H8z" strokeWidth="1.6" /></svg>;
    case "fleet":
      return <svg viewBox="0 0 24 24" fill="none" className={classes}><path d="M4 8h16v7H4V8Zm2 7v3m12-3v3M7 19a1.5 1.5 0 1 0 0 .01Zm10 0a1.5 1.5 0 1 0 0 .01Z" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "operations":
      return <svg viewBox="0 0 24 24" fill="none" className={classes}><path d="M4 18h4v-6H4v6Zm6 0h4V6h-4v12Zm6 0h4v-9h-4v9Z" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "opsCentre":
      return <svg viewBox="0 0 24 24" fill="none" className={classes}><circle cx="12" cy="12" r="8" strokeWidth="1.6" /><path d="M12 12 16 9m-4 3-5 4" strokeWidth="1.6" strokeLinecap="round" /></svg>;
    default:
      return null;
  }
};

export function Sidebar({ onNavigate, mobile = false }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className={mobile ? "h-full w-full" : "sticky top-0 h-screen w-[240px] shrink-0 border-r border-[var(--fs-border)] bg-[var(--fs-sidebar)]/95"}>
      <div className="flex h-full flex-col p-4">
        <Link href="/dashboard" className="rounded-xl p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fs-green-light)]" onClick={onNavigate}>
          <Image src="/branding/ferryspeed logo.png" alt="Ferryspeed logo" width={170} height={40} priority className="h-10 w-auto" />
        </Link>

        <nav className="mt-4 flex-1 space-y-1 overflow-y-auto pr-1">
          {navItems.map((item) => {
            const active = isNavItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fs-green-light)] ${
                  active
                    ? "bg-[color:var(--fs-green)]/25 text-[var(--fs-text)]"
                    : "text-[var(--fs-text-muted)] hover:bg-white/5 hover:text-[var(--fs-text)]"
                }`}
              >
                <span className={active ? "text-[var(--fs-green-light)]" : "text-[var(--fs-text-muted)]"} aria-hidden="true">
                  <NavIcon icon={item.icon} />
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="rounded-xl border border-[var(--fs-border)] bg-white/5 px-3 py-3">
          <p className="text-sm font-semibold text-[var(--fs-text)]">Ferryspeed</p>
          <p className="text-xs text-[var(--fs-text-muted)]">Moving with confidence</p>
        </div>
      </div>
    </aside>
  );
}
