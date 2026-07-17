import type { ReactNode } from "react";

type AppCardProps = {
  children: ReactNode;
  className?: string;
};

export function AppCard({ children, className = "" }: AppCardProps) {
  return (
    <article className={`rounded-[1.6rem] border border-slate-200 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.06)] ${className}`.trim()}>
      {children}
    </article>
  );
}