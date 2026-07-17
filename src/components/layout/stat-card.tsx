import type { ReactNode } from "react";
import { AppCard } from "@/components/layout/app-card";

type StatCardProps = {
  label: string;
  value: string;
  detail?: string;
  icon?: ReactNode;
  accentClassName?: string;
};

export function StatCard({ label, value, detail, icon, accentClassName = "from-cyan-400/24 to-emerald-400/8" }: StatCardProps) {
  return (
    <AppCard className="relative overflow-hidden">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accentClassName}`} aria-hidden="true" />
      <div className="flex h-full flex-col justify-between p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
          {icon ? <div className="text-cyan-700">{icon}</div> : null}
        </div>
        <div className="mt-5">
          <p className="text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
          {detail ? <p className="mt-2 text-sm text-slate-500">{detail}</p> : null}
        </div>
      </div>
    </AppCard>
  );
}