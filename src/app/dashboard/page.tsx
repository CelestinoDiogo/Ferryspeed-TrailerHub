import { Suspense } from "react";
import { TrailerDashboard } from "@/components/dashboard/trailer-dashboard";

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 p-6 text-slate-200">Loading dashboard...</div>}>
      <TrailerDashboard />
    </Suspense>
  );
}
