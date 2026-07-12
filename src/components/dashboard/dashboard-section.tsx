import type { ReactNode } from "react";

type DashboardSectionProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
};

export function DashboardSection({ title, subtitle, action, children }: DashboardSectionProps) {
  return (
    <section className="fs-panel-card rounded-3xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--fs-green-light)]">{title}</p>
          {subtitle ? <p className="mt-1 text-sm text-[var(--fs-text-muted)]">{subtitle}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
