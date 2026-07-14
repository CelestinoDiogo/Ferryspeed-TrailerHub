import type { ReactNode } from "react";

type DashboardSectionProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
};

export function DashboardSection({ title, subtitle, action, children }: DashboardSectionProps) {
  return (
    <section className="rounded-3xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel)] p-5 shadow-xl shadow-black/10 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-[var(--fs-text)]">{title}</p>
          {subtitle ? <p className="mt-1 text-sm text-[var(--fs-text-muted)]">{subtitle}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
