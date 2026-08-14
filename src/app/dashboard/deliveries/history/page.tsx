import { Suspense } from "react";
import { HistoricalOperationsReport } from "@/components/reports/historical-operations-report";

export default function DeliveriesHistoryPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading deliveries history...</div>}><HistoricalOperationsReport kind="deliveries" /></Suspense>;
}
