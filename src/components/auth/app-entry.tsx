"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { resolveRoleAwareEntryPath } from "@/lib/auth/app-entry-path";
import { isStandaloneDisplay } from "@/lib/pwa/install-state";
import { supabase } from "@/lib/supabase";

export function AppEntry() {
  const router = useRouter();
  const hasRoutedRef = useRef(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let active = true;

    const routeToExperience = async () => {
      if (hasRoutedRef.current) {
        return;
      }

      try {
        const { data, error } = await supabase.auth.getSession();
        if (!active) {
          return;
        }

        const standalone = isStandaloneDisplay({
          matchMediaStandalone: typeof window.matchMedia === "function"
            ? window.matchMedia("(display-mode: standalone)").matches
            : false,
          navigatorStandalone: (window.navigator as Navigator & { standalone?: boolean }).standalone,
        });

        if (error || !data.session?.access_token || !data.session.user?.id) {
          hasRoutedRef.current = true;
          router.replace("/login");
          return;
        }

        const { data: roleRow } = await supabase
          .from("app_user_roles")
          .select("role_key, is_active")
          .eq("user_id", data.session.user.id)
          .maybeSingle();

        if (!active) {
          return;
        }

        const targetPath = resolveRoleAwareEntryPath({
          roleKey: typeof roleRow?.role_key === "string" ? roleRow.role_key : null,
          isActive: typeof roleRow?.is_active === "boolean" ? roleRow.is_active : null,
          returnTo: null,
          standalone,
        });

        hasRoutedRef.current = true;
        router.replace(targetPath);
        router.refresh();
      } catch {
        if (active) {
          setHasError(true);
        }
      }
    };

    void routeToExperience();

    return () => {
      active = false;
    };
  }, [router]);

  if (hasError) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-xl rounded-3xl border border-rose-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-rose-700">Ferryspeed TrailerHub</p>
          <h1 className="mt-3 text-2xl font-semibold text-rose-900">Unable to open TrailerHub</h1>
          <p className="mt-3 text-sm text-rose-700">Please sign in again to continue.</p>
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
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-700">Ferryspeed TrailerHub</p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-950">Opening TrailerHub</h1>
        <p className="mt-3 text-sm text-slate-600">Checking your session and opening the right workspace.</p>
      </div>
    </main>
  );
}
