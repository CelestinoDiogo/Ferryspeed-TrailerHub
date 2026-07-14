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
    <article className="group relative h-full overflow-hidden rounded-2xl border border-[var(--fs-border-strong)] bg-[var(--fs-panel)] p-4 shadow-lg shadow-black/10 transition duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-[var(--fs-panel-hover)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <p className={`text-xs font-semibold uppercase tracking-[0.08em] ${labelClass}`}>{label}</p>
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl text-[var(--fs-text)] shadow-[0_0_18px_rgba(0,0,0,0.18)] transition-transform duration-200 group-hover:scale-[1.04] ${accentClass}`} aria-hidden="true">
          {icon ?? <span className="text-xs">•</span>}
        </span>
      </div>
      <p className="text-3xl font-bold leading-none tracking-tight text-[var(--fs-text)] sm:text-4xl">{value}</p>
      <p className="mt-2 text-sm text-[var(--fs-text-muted)]">{supportingText}</p>
      <span className={`pointer-events-none absolute inset-x-0 bottom-0 h-1 opacity-90 ${accentClass}`} aria-hidden="true" />
    </article>
  );
}
