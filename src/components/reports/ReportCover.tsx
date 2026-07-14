import Image from "next/image";
import { ReportStatusBadge } from "@/components/reports/ReportStatusBadge";

type ReportCoverProps = {
  reportNumber: string | null;
  vesselName: string;
  voyageReference: string | null;
  operationDate: string | null;
  port: string | null;
  berth: string | null;
  generatedAt: string;
  operatorName: string | null;
  status: string;
};

export function ReportCover({
  reportNumber,
  vesselName,
  voyageReference,
  operationDate,
  port,
  berth,
  generatedAt,
  operatorName,
  status,
}: ReportCoverProps) {
  return (
    <section className="report-cover page-break-after mb-8 rounded-2xl border border-slate-200 bg-white p-8">
      <div className="flex items-center justify-between gap-4">
        <Image src="/branding/ferryspeed logo.png" alt="Ferryspeed logo" width={220} height={70} className="h-14 w-auto object-contain" priority />
        <ReportStatusBadge status={status} />
      </div>

      <div className="mt-10">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Ferryspeed TrailerHub</p>
        <h1 className="mt-3 text-4xl font-bold text-slate-900">Vessel Operations Report</h1>
      </div>

      <dl className="mt-10 grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="font-semibold text-slate-700">Report Number</dt><dd className="mt-1 text-slate-900">{reportNumber ?? "Pending number"}</dd></div>
        <div><dt className="font-semibold text-slate-700">Vessel Name</dt><dd className="mt-1 text-slate-900">{vesselName}</dd></div>
        <div><dt className="font-semibold text-slate-700">Voyage Reference</dt><dd className="mt-1 text-slate-900">{voyageReference ?? "-"}</dd></div>
        <div><dt className="font-semibold text-slate-700">Operation Date</dt><dd className="mt-1 text-slate-900">{operationDate ?? "-"}</dd></div>
        <div><dt className="font-semibold text-slate-700">Port / Berth</dt><dd className="mt-1 text-slate-900">{port ?? "-"}{berth ? ` / ${berth}` : ""}</dd></div>
        <div><dt className="font-semibold text-slate-700">Generated</dt><dd className="mt-1 text-slate-900">{generatedAt}</dd></div>
        <div><dt className="font-semibold text-slate-700">Operator</dt><dd className="mt-1 text-slate-900">{operatorName ?? "TrailerHub User"}</dd></div>
      </dl>
    </section>
  );
}
