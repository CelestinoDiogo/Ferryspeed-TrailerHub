import type { ReactNode } from "react";

type KpiCardProps = {
  label: string;
  value: string;
  supportingText: string;
  accentClass?: string;
  icon?: ReactNode;
};

export function KpiCard({ label, value, supportingText, accentClass = "bg-[var(--fs-green)]", icon }: KpiCardProps) {
  return (
    <article className="fs-panel-card fs-fade-up rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--fs-text-muted)]">{label}</p>
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--fs-text)] ${accentClass}`} aria-hidden="true">
          {icon ?? <span className="text-xs">•</span>}
        </span>
      </div>
      <p className="text-3xl font-bold leading-none text-[var(--fs-text)] sm:text-[2rem]">{value}</p>
      <p className="mt-2 text-sm text-[var(--fs-text-muted)]">{supportingText}</p>
    </article>
  );
}
