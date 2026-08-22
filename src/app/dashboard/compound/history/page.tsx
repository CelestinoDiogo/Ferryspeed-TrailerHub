import { Suspense } from "react";
import { HistoricalListsReport } from "@/components/reports/historical-lists-report";

export default function CompoundHistoryPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading Compound history...</div>}>
      <HistoricalListsReport lockedType="compound_events" />
    </Suspense>
  );
}
