import type { ReactNode } from "react";

type ReportPrintLayoutProps = {
  screen: ReactNode;
  print: ReactNode;
};

export function ReportPrintLayout({ screen, print }: ReportPrintLayoutProps) {
  return (
    <>
      <div className="screen-page screen-only">{screen}</div>
      <div id="print-report-root" className="print-only">{print}</div>
    </>
  );
}
