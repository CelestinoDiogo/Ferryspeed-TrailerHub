import { ReportStatusBadge } from "@/components/reports/ReportStatusBadge";

type ReportHeaderProps = {
  title: string;
  reportNumber: string | null;
  vesselName: string;
  voyageReference: string | null;
  generatedAt: string;
  status: string;
};

export function ReportHeader({
  title,
  reportNumber,
  vesselName,
  voyageReference,
  generatedAt,
  status,
}: ReportHeaderProps) {
  return (
    <header className="report-header border-b border-slate-200 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Ferryspeed TrailerHub</p>
          <h2 className="mt-2 text-xl font-bold text-slate-900">{title}</h2>
          <p className="mt-2 text-sm text-slate-600">{vesselName}{voyageReference ? ` / ${voyageReference}` : ""}</p>
        </div>

        <div className="text-right text-xs text-slate-600">
          <p><span className="font-semibold text-slate-800">Report:</span> {reportNumber ?? "Pending number"}</p>
          <p><span className="font-semibold text-slate-800">Generated:</span> {generatedAt}</p>
          <div className="mt-2">
            <ReportStatusBadge status={status} />
          </div>
        </div>
      </div>
    </header>
  );
}
