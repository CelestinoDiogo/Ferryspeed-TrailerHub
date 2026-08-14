import { Suspense } from "react";
import { CompoundHistoricalReport } from "@/components/reports/compound-historical-report";

export default function CompoundSnapshotPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading Compound snapshot...</div>}><CompoundHistoricalReport mode="snapshot" /></Suspense>;
}
