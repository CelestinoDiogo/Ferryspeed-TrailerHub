import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ComponentType } from "react";

type SidebarItemProps = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
  onNavigate?: () => void;
};

export function SidebarItem({ label, href, icon: Icon, active, onNavigate }: SidebarItemProps) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`group flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
        active
          ? "bg-emerald-500/20 text-white ring-1 ring-emerald-400/35"
          : "text-white/70 hover:bg-white/8 hover:text-white"
      }`}
    >
      <span className="flex items-center gap-3">
        <Icon className="h-[18px] w-[18px]" />
        <span>{label}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-white/35" />
    </Link>
  );
}