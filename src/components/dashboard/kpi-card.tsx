import type { ReactNode } from "react";

type KpiCardProps = {
  label: string;
  value: string;
  supportingText: string;
  accentClass?: string;
  labelClass?: string;
  icon?: ReactNode;
};

export function KpiCard({ label, value, supportingText, accentClass = "bg-[var(--fs-green)]", labelClass = "text-[var(--fs-green-light)]", icon }: KpiCardProps) {
  return (
    <article className="fs-panel-card fs-fade-up relative overflow-hidden rounded-2xl p-3.5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${labelClass}`}>{label}</p>
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--fs-text)] shadow-[0_0_20px_rgba(0,0,0,0.25)] ${accentClass}`} aria-hidden="true">
          {icon ?? <span className="text-xs">•</span>}
        </span>
      </div>
      <p className="text-3xl font-bold leading-none text-white sm:text-[1.9rem]">{value}</p>
      <p className="mt-1.5 text-xs text-[var(--fs-text-muted)]">{supportingText}</p>
      <span className={`pointer-events-none absolute inset-x-0 bottom-0 h-1 opacity-90 ${accentClass}`} aria-hidden="true" />
    </article>
  );
}
