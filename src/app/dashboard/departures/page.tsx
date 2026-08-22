import { Suspense } from "react";
import { HistoricalListsReport } from "@/components/reports/historical-lists-report";

export default function DeparturesHistoryPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading departures history...</div>}>
      <HistoricalListsReport lockedType="departures" />
    </Suspense>
  );
}
