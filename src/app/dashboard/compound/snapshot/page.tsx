import { Suspense } from "react";
import { HistoricalListsReport } from "@/components/reports/historical-lists-report";

export default function CompoundSnapshotPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading Compound snapshot...</div>}>
      <HistoricalListsReport lockedType="compound_snapshot" />
    </Suspense>
  );
}
