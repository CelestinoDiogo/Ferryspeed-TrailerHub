import type { ReactNode } from "react";
import { AppCard } from "@/components/layout/app-card";

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <AppCard>
      <div className="p-6 text-center">
        <p className="text-base font-semibold text-slate-950">{title}</p>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </AppCard>
  );
}