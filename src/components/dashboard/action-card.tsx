import Link from "next/link";
import type { ReactNode } from "react";

type ActionCardProps = {
  href: string;
  title: string;
  description: string;
  accentClass: string;
  toneClass?: string;
  icon: ReactNode;
};

export function ActionCard({ href, title, description, accentClass, toneClass = "border-[var(--fs-border)] hover:border-[var(--fs-green)]/45", icon }: ActionCardProps) {
  return (
    <Link
      href={href}
      className={`group relative overflow-hidden rounded-2xl border bg-[linear-gradient(135deg,rgba(8,28,24,0.96),rgba(3,15,13,0.96))] p-4 transition-transform duration-200 hover:-translate-y-0.5 hover:bg-[var(--fs-panel-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fs-green-light)] ${toneClass}`}
    >
      <span className={`pointer-events-none absolute left-0 top-0 h-0.5 w-full opacity-80 ${accentClass}`} aria-hidden="true" />
      <div className="flex items-start gap-3">
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--fs-text)] shadow-[0_0_0_1px_rgba(255,255,255,0.05)] ${accentClass}`} aria-hidden="true">
          {icon}
        </span>
        <div>
          <p className="font-semibold text-[var(--fs-text)]">{title}</p>
          <p className="mt-1 text-sm text-[var(--fs-text-muted)]">{description}</p>
        </div>
      </div>
    </Link>
  );
}
