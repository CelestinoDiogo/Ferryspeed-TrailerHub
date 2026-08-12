"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { canAccessModule } from "@/lib/auth/permissions";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { supabase } from "@/lib/supabase";

type DashboardAuthGuardProps = {
  children: ReactNode;
};

const AUTH_GUARD_TIMEOUT_MS = 10_000;
const isDev = process.env.NODE_ENV !== "production";
const shouldLogDashboardTiming = isDev || process.env.NEXT_PUBLIC_DASHBOARD_TIMING === "1";

const withTimeout = async <T,>(promise: PromiseLike<T>, timeoutMs: number, label: string): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
    }),
  ]);
};

export function DashboardAuthGuard({ children }: DashboardAuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { userId, roleKey, loadError, isLoading: isLoadingCurrentUser } = useCurrentUser();
  const [isChecking, setIsChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const hasRedirectedRef = useRef(false);
  const isDriverMobileRoute = pathname === "/dashboard/driver" || pathname?.startsWith("/dashboard/driver/");

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }, [router]);

  const redirectToLogin = useCallback(() => {
    if (hasRedirectedRef.current) {
      return;
    }

    hasRedirectedRef.current = true;
    if (isDev) {
      console.info("[auth] redirecting to login", { pathname });
    }
    const returnTo = pathname?.startsWith("/") ? pathname : "/dashboard";
    router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }, [pathname, router]);

  useEffect(() => {
    let active = true;
    if (isDev) {
      console.info("[auth] dashboard mounted", { pathname });
    }

    const validateSession = async () => {
      const authPhaseStart = typeof performance !== "undefined" ? performance.now() : Date.now();
      try {
        const { data, error } = await withTimeout(supabase.auth.getSession(), AUTH_GUARD_TIMEOUT_MS, "Supabase auth.getSession");
        if (shouldLogDashboardTiming) {
          const authPhaseEnd = typeof performance !== "undefined" ? performance.now() : Date.now();
          console.info("[dashboard-timing] phase=auth duration_ms=" + Math.round(authPhaseEnd - authPhaseStart), {
            hasSession: Boolean(data.session?.access_token),
            hasError: Boolean(error),
          });
        }

        if (!active) {
          return;
        }

        if (isDev) {
          console.info("[auth] session loaded", {
            hasSession: Boolean(data.session?.access_token),
            userId: data.session?.user?.id ?? null,
            hasError: Boolean(error),
            errorMessage: error?.message ?? null,
          });
        }

        if (error || !data.session?.access_token) {
          setIsChecking(false);
          redirectToLogin();
          return;
        }

        setIsChecking(false);
      } catch (error) {
        if (shouldLogDashboardTiming) {
          const authPhaseEnd = typeof performance !== "undefined" ? performance.now() : Date.now();
          console.info("[dashboard-timing] phase=auth duration_ms=" + Math.round(authPhaseEnd - authPhaseStart), {
            hasSession: false,
            hasError: true,
          });
        }

        if (!active) {
          return;
        }

        if (isDev) {
          console.error("[auth] dashboard session validation failed", error);
        }
        setIsChecking(false);
        redirectToLogin();
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) {
        return;
      }

      if (isDev) {
        console.info("[auth] auth state", {
          event,
          userId: session?.user?.id ?? null,
          hasSession: Boolean(session?.access_token),
        });
      }

      if (event === "SIGNED_OUT" || !session?.access_token) {
        setIsChecking(false);
        redirectToLogin();
        return;
      }

      if (event === "SIGNED_IN" && pathname?.startsWith("/dashboard")) {
        setAuthError(null);
        setIsChecking(false);
      }
    });

    void validateSession();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [pathname, redirectToLogin]);

  useEffect(() => {
    if (!isChecking && !isLoadingCurrentUser && isDev) {
      console.info("[auth] loading finished", {
        userId,
        roleKey,
        loadError,
        hasError: Boolean(authError),
      });
    }
  }, [authError, isChecking, isLoadingCurrentUser, loadError, roleKey, userId]);

  useEffect(() => {
    if (!loadError || isLoadingCurrentUser) {
      return;
    }

    redirectToLogin();
  }, [isLoadingCurrentUser, loadError, redirectToLogin]);

  if (authError) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-xl rounded-3xl border border-rose-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-rose-700">Ferryspeed TrailerHub</p>
          <h1 className="mt-3 text-2xl font-semibold text-rose-900">Session validation failed</h1>
          <p className="mt-3 text-sm text-rose-700">{authError}</p>
          <div className="mt-6">
            <button
              type="button"
              onClick={() => router.replace("/login")}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Go to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

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

  const hasRouteAccess = roleKey
    ? canAccessModule(roleKey, isDriverMobileRoute ? "driver_mobile" : "dashboard")
    : true;

  if (!hasRouteAccess) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-xl rounded-3xl border border-rose-200 bg-rose-50 p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-rose-700">Ferryspeed TrailerHub</p>
          <h1 className="mt-3 text-2xl font-semibold text-rose-900">Access denied</h1>
          <p className="mt-3 text-sm text-rose-700">You do not have permission to access this area.</p>
          <div className="mt-6">
            <button
              type="button"
              onClick={() => {
                void handleSignOut();
              }}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}