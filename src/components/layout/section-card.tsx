import type { ReactNode } from "react";
import { AppCard } from "@/components/layout/app-card";

type SectionCardProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function SectionCard({ title, subtitle, action, children, className = "" }: SectionCardProps) {
  return (
    <AppCard className={className}>
      <div className="p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</p>
            {subtitle ? <p className="mt-2 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          {action ? <div>{action}</div> : null}
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </AppCard>
  );
}