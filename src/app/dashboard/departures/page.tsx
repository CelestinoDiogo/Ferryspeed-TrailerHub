import { Suspense } from "react";
import { HistoricalOperationsReport } from "@/components/reports/historical-operations-report";

export default function DeparturesHistoryPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading departures history...</div>}><HistoricalOperationsReport kind="departures" /></Suspense>;
}
