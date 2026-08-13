"use client";

import { DriverMobileJobsDashboard } from "@/components/mobile/driver-mobile-jobs-dashboard";
import { DriverMobilePreview } from "@/components/mobile/driver-mobile-preview";
import { useCurrentUser } from "@/lib/auth/use-current-user";

export function DriverMobileEntry() {
  const { roleKey, isLoading } = useCurrentUser();

  if (isLoading) {
    return <div className="min-h-screen bg-slate-50 p-4 text-sm text-slate-600">Loading Driver Mobile...</div>;
  }

  if (roleKey === "administrator" || roleKey === "supervisor") {
    return <DriverMobilePreview roleKey={roleKey} />;
  }

  return <DriverMobileJobsDashboard />;
}
