import { AppShell } from "@/components/layout/app-shell";
import { DashboardAuthGuard } from "@/components/auth/dashboard-auth-guard";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardAuthGuard>
      <AppShell>{children}</AppShell>
    </DashboardAuthGuard>
  );
}
