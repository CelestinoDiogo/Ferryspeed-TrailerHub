import { Suspense } from "react";
import { HistoricalListsReport } from "@/components/reports/historical-lists-report";

export default function DeliveriesHistoryPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading deliveries history...</div>}>
      <HistoricalListsReport lockedType="deliveries" />
    </Suspense>
  );
}
