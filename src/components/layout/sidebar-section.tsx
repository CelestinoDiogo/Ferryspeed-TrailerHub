import type { ReactNode } from "react";

type SidebarSectionProps = {
  title: string;
  children: ReactNode;
};

export function SidebarSection({ title, children }: SidebarSectionProps) {
  return (
    <section className="space-y-1.5">
      <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-white/35">{title}</p>
      {children}
    </section>
  );
}