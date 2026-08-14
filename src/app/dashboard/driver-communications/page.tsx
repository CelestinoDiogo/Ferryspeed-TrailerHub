"use client";

import { Suspense } from "react";
import { DriverCommunicationsPanel } from "@/components/dashboard/driver-communications-panel";

export default function DriverCommunicationsPage() {
  return (
    <Suspense fallback={<div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading Driver Communications...</div>}>
      <DriverCommunicationsPanel />
    </Suspense>
  );
}
