import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { AppCard } from "@/components/layout/app-card";

type AlertCardProps = {
  title: string;
  description: string;
  tone?: "critical" | "warning" | "info";
  action?: ReactNode;
};

const toneStyles = {
  critical: "border-rose-200 bg-rose-50 text-rose-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-cyan-200 bg-cyan-50 text-cyan-900",
};

export function AlertCard({ title, description, tone = "warning", action }: AlertCardProps) {
  return (
    <AppCard className={`border ${toneStyles[tone]}`}>
      <div className="flex items-start gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-current shadow-sm">
          <TriangleAlert className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-950">{title}</p>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
    </AppCard>
  );
}