import { Suspense } from "react";
import { CompoundHistoricalReport } from "@/components/reports/compound-historical-report";

export default function CompoundHistoryPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading Compound history...</div>}><CompoundHistoricalReport mode="activity" /></Suspense>;
}
