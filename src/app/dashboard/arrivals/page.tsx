import { Suspense } from "react";
import { HistoricalOperationsReport } from "@/components/reports/historical-operations-report";

export default function ArrivalsHistoryPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading arrivals history...</div>}><HistoricalOperationsReport kind="arrivals" /></Suspense>;
}
