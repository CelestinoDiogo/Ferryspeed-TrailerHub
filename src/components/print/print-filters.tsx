type PrintFilterItem = {
  label: string;
  value: string;
};

type PrintFiltersProps = {
  items: PrintFilterItem[];
};

export function PrintFilters({ items }: PrintFiltersProps) {
  const visibleItems = items.filter((item) => item.value.trim());
  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <section className="print-filters">
      <div className="print-filters-grid">
        {visibleItems.map((item) => (
          <div key={item.label} className="print-filter-card rounded">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">{item.label}</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{item.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}