import type { ReactNode } from "react";

type PrintReportLayoutProps = {
  orientation?: "portrait" | "landscape";
  children: ReactNode;
  className?: string;
};

export function PrintReportLayout({ orientation = "portrait", children, className = "" }: PrintReportLayoutProps) {
  return <section className={`print-only print-document ${orientation === "landscape" ? "print-landscape" : "print-portrait"} ${className}`.trim()}>{children}</section>;
}