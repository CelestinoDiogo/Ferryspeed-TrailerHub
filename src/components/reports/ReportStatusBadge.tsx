type ReportStatus = "draft" | "generated" | "approved" | "sent" | "failed" | string;

type ReportStatusBadgeProps = {
  status: ReportStatus;
};

const labels: Record<string, string> = {
  draft: "Draft",
  generated: "Generated",
  approved: "Approved",
  sent: "Sent",
  failed: "Failed",
};

export function ReportStatusBadge({ status }: ReportStatusBadgeProps) {
  const normalized = (status || "draft").toLowerCase();
  const label = labels[normalized] ?? status;

  const classes =
    normalized === "approved"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : normalized === "failed"
        ? "border-rose-300 bg-rose-50 text-rose-800"
        : normalized === "generated"
          ? "border-cyan-300 bg-cyan-50 text-cyan-800"
          : normalized === "sent"
            ? "border-slate-300 bg-slate-100 text-slate-800"
            : "border-amber-300 bg-amber-50 text-amber-900";

  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${classes}`}>{label}</span>;
}
