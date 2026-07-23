"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { canAccessModule } from "@/lib/auth/permissions";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { supabase } from "@/lib/supabase";

type DashboardAuthGuardProps = {
  children: ReactNode;
};

export function DashboardAuthGuard({ children }: DashboardAuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { roleKey, isLoading: isLoadingCurrentUser } = useCurrentUser();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    let active = true;

    const redirectToLogin = () => {
      router.replace("/login");
      router.refresh();
    };

    const validateSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!active) {
        return;
      }

      if (error || !data.session?.access_token) {
        redirectToLogin();
        return;
      }

      setIsChecking(false);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) {
        return;
      }

      if (event === "SIGNED_OUT" || !session?.access_token) {
        redirectToLogin();
        return;
      }

      if (event === "SIGNED_IN" && pathname?.startsWith("/dashboard")) {
        setIsChecking(false);
      }
    });

    void validateSession();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [pathname, router]);

  if (isChecking || isLoadingCurrentUser) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-700">Ferryspeed TrailerHub</p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-950">Checking Session</h1>
          <p className="mt-3 text-sm text-slate-600">Validating your session before loading the dashboard.</p>
        </div>
      </div>
    );
  }

  if (roleKey && !canAccessModule(roleKey, "dashboard")) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-xl rounded-3xl border border-rose-200 bg-rose-50 p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-rose-700">Ferryspeed TrailerHub</p>
          <h1 className="mt-3 text-2xl font-semibold text-rose-900">Access denied</h1>
          <p className="mt-3 text-sm text-rose-700">You do not have permission to access this area.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}