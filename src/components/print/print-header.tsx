import Image from "next/image";
import type { ReactNode } from "react";

type PrintHeaderProps = {
  title: string;
  subtitle?: string;
  printedAt?: string;
  userName?: string | null;
  totalRecords?: number;
  children?: ReactNode;
};

export function PrintHeader({ title, subtitle, printedAt, userName, totalRecords, children }: PrintHeaderProps) {
  return (
    <header className="print-header text-slate-900">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Image src="/branding/ferryspeed logo.png" alt="Ferryspeed logo" width={180} height={60} className="h-14 w-auto object-contain" priority />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-slate-600">Ferryspeed TrailerHub</p>
            <h1 className="mt-2 text-2xl font-bold uppercase tracking-[0.12em] text-slate-900">{title}</h1>
            {subtitle ? <p className="mt-2 text-sm text-slate-700">{subtitle}</p> : null}
          </div>
        </div>

        <div className="text-right text-[11px] leading-5 text-slate-700">
          {printedAt ? <p><span className="font-semibold text-slate-900">Printed:</span> {printedAt}</p> : null}
          {userName ? <p><span className="font-semibold text-slate-900">User:</span> {userName}</p> : null}
          {typeof totalRecords === "number" ? <p><span className="font-semibold text-slate-900">Records:</span> {totalRecords}</p> : null}
        </div>
      </div>

      {children}
    </header>
  );
}