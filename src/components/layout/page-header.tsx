import type { ReactNode } from "react";
import { AppCard } from "@/components/layout/app-card";

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, action }: PageHeaderProps) {
  return (
    <AppCard className="overflow-hidden">
      <div className="relative bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.08),_transparent_34%),linear-gradient(135deg,#ffffff,#f8fafc)] p-6 md:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">{eyebrow}</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 md:text-5xl">{title}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">{description}</p>
          </div>
          {action ? <div>{action}</div> : null}
        </div>
      </div>
    </AppCard>
  );
}