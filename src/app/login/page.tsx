"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    let active = true;

    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) {
        return;
      }

      if (data.session?.access_token) {
        router.replace("/dashboard");
      }
    };

    void checkSession();

    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-700">Ferryspeed TrailerHub</p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-950">Sign In Required</h1>
        <p className="mt-3 text-sm text-slate-600">
          Your session is not available for this page. Sign in with your existing organization access flow,
          then continue to the dashboard.
        </p>
        <div className="mt-6">
          <Link href="/dashboard" className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            Go to Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
