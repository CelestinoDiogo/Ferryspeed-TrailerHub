type ExecutiveSummaryProps = {
  text: string;
};

export function ExecutiveSummary({ text }: ExecutiveSummaryProps) {
  return (
    <section className="report-section avoid-page-break rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="text-lg font-semibold text-slate-900">Executive Summary</h3>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-800">{text || "No executive summary available."}</p>
    </section>
  );
}
