import Link from "next/link";
import type { ReactNode } from "react";

type ActionCardProps = {
  href: string;
  title: string;
  description: string;
  accentClass: string;
  icon: ReactNode;
};

export function ActionCard({ href, title, description, accentClass, icon }: ActionCardProps) {
  return (
    <Link
      href={href}
      className="fs-panel-card group rounded-2xl border p-4 transition-transform duration-200 hover:-translate-y-0.5 hover:bg-[var(--fs-panel-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fs-green-light)]"
    >
      <div className="flex items-start gap-3">
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--fs-text)] ${accentClass}`} aria-hidden="true">
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
