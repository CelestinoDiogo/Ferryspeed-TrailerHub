"use client";

import { useEffect, useState } from "react";
import { Bell, CalendarDays, Clock3, Menu, Search, Settings, UserCircle2 } from "lucide-react";
import { OperationsToolsButton } from "@/components/layout/operations-tools-button";
import { OperationsToolsDrawer } from "@/components/layout/operations-tools-drawer";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

type TopHeaderProps = {
  title: string;
  subtitle: string;
  onMenuClick: () => void;
};

const jerseyDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const jerseyTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function TopHeader({ title, subtitle: _subtitle, onMenuClick }: TopHeaderProps) {
  const [dateText, setDateText] = useState("--");
  const [timeText, setTimeText] = useState("--:--:--");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [userName, setUserName] = useState("Authenticated User");
  const [userRole, setUserRole] = useState("Unassigned role");
  const [titleLeft, ...titleRest] = title.split(" ");
  const titleRight = titleRest.join(" ");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setDateText(jerseyDateFormatter.format(now));
      setTimeText(jerseyTimeFormatter.format(now));
    };

    update();
    const intervalId = window.setInterval(update, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let active = true;

    const resolveRoleLabel = (roleKey?: string | null) => {
      if (!roleKey) {
        return "Unassigned role";
      }

      return roleKey
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    };

    const loadUser = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!active || error || !data.user) {
        return;
      }

      const metadata = data.user.user_metadata;
      const fullName = typeof metadata?.full_name === "string" ? metadata.full_name.trim() : "";
      const name = typeof metadata?.name === "string" ? metadata.name.trim() : "";
      const fallback = data.user.email ?? "Authenticated User";
      setUserName(fullName || name || fallback);

      const { data: roleRows } = await supabase
        .from("app_user_roles")
        .select("role_key")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (!active) {
        return;
      }

      const roleRow = roleRows as Pick<Database["public"]["Tables"]["app_user_roles"]["Row"], "role_key"> | null;
      setUserRole(resolveRoleLabel(roleRow?.role_key));
    };

    void loadUser();

    return () => {
      active = false;
    };
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-[rgba(255,255,255,0.92)] px-4 py-3 backdrop-blur-xl print:hidden md:px-6">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm md:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
              <span className="text-slate-900">{titleLeft}</span> {titleRight}
            </p>
            <p className="truncate text-sm text-slate-500">Welcome to Ferryspeed TrailerHub</p>
          </div>
        </div>

        <div className="hidden items-center gap-3 lg:flex">
          <OperationsToolsButton onClick={() => setToolsOpen(true)} />
          <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-700 shadow-sm">
            <CalendarDays className="h-4 w-4" />
            <span className="text-sm font-medium">{dateText}</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-700 shadow-sm">
            <Clock3 className="h-4 w-4" />
            <span className="text-sm font-medium">{timeText}</span>
          </div>
          <button className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50" aria-label="Search">
            <Search className="h-5 w-5" />
          </button>
          <button className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50" aria-label="Notifications">
            <Bell className="h-5 w-5" />
          </button>
          <button className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50" aria-label="Settings">
            <Settings className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <UserCircle2 className="h-6 w-6 text-cyan-600" />
            <div className="text-left">
              <p className="text-sm font-semibold text-slate-900">{userName}</p>
              <p className="text-xs text-slate-500">{userRole}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <OperationsToolsButton onClick={() => setToolsOpen(true)} />
        </div>
      </div>

      <OperationsToolsDrawer open={toolsOpen} onClose={() => setToolsOpen(false)} />
    </header>
  );
}
