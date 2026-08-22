import { Suspense } from "react";
import { StoppedTrailersReport } from "@/components/reports/stopped-trailers-report";

export default function StoppedTrailersPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading stopped trailers...</div>}>
      <StoppedTrailersReport />
    </Suspense>
  );
}
