import { Suspense } from "react";
import { ExecutiveDashboard } from "@/components/dashboard/executive-dashboard";

export default function BusinessIntelligencePage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh] p-6 text-slate-600">Loading executive dashboard...</div>}>
      <ExecutiveDashboard />
    </Suspense>
  );
}