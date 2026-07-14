type PrintSummaryItem = {
  label: string;
  value: string | number;
};

type PrintSummaryProps = {
  items: PrintSummaryItem[];
};

export function PrintSummary({ items }: PrintSummaryProps) {
  return (
    <section className="print-summary text-slate-900">
      <div className="print-summary-grid">
        {items.map((item) => (
          <div key={item.label} className="print-summary-card rounded">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">{item.label}</p>
            <p className="mt-1 text-lg font-bold text-slate-900">{item.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}