import { Suspense } from "react";
import { HistoricalOperationsReport } from "@/components/reports/historical-operations-report";

export default function CollectionsHistoryPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading collections...</div>}><HistoricalOperationsReport kind="collections" /></Suspense>;
}
