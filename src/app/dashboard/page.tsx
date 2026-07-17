import { Suspense } from "react";
import { TrailerDashboard } from "@/components/dashboard/trailer-dashboard";

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh] p-6 text-slate-600">Loading dashboard...</div>}>
      <TrailerDashboard />
    </Suspense>
  );
}
