import { Suspense } from "react";
import { OperationalSummaryReport } from "@/components/reports/operational-summary-report";

export default function OperationalSummaryPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading operational summary...</div>}>
      <OperationalSummaryReport />
    </Suspense>
  );
}
