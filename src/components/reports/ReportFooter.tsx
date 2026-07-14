type ReportFooterProps = {
  reportNumber: string | null;
  vesselName: string;
};

export function ReportFooter({ reportNumber, vesselName }: ReportFooterProps) {
  return (
    <footer className="report-footer mt-8 border-t border-slate-300 pt-3 text-[10px] text-slate-600">
      <div className="flex items-center justify-between gap-3">
        <p>Ferryspeed TrailerHub</p>
        <p>{reportNumber ?? "Unnumbered report"} / {vesselName}</p>
        <p className="font-medium">Confidential / internal operational document.</p>
      </div>
    </footer>
  );
}
