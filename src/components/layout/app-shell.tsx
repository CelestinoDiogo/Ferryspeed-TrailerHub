"use client";

import Image from "next/image";
import { Suspense, useState } from "react";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { TopHeader } from "@/components/layout/top-header";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="relative min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,#f5f7fb_100%)] text-slate-900 print:bg-white print:text-black">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 select-none overflow-hidden print:hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.05),transparent_34%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.05),transparent_28%)]" />
      </div>

      <div className="relative z-10 flex min-h-screen">
        <div className="hidden md:block print:hidden">
          <Suspense fallback={<div className="h-screen w-[290px] border-r border-slate-900 bg-[linear-gradient(180deg,#111827_0%,#0b1220_100%)]" />}>
            <Sidebar />
          </Suspense>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopHeader
            title="FERRYSPEED TRAILERHUB"
            subtitle="Enterprise Operations Control Centre"
            onMenuClick={() => setMobileOpen(true)}
          />
          <main className="relative z-10 flex-1 p-4 print:bg-white print:p-0 md:p-6">
            <div className="mx-auto w-full max-w-[1600px] print:mx-0 print:w-full print:max-w-none">{children}</div>
          </main>
        </div>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 bg-black/50 md:hidden print:hidden" role="dialog" aria-modal="true">
          <div className="h-full w-[84vw] max-w-[340px] border-r border-slate-900/80 bg-[linear-gradient(180deg,#07111f_0%,#030812_100%)] p-2">
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white"
                aria-label="Close navigation"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <Suspense fallback={<div className="h-full w-full" />}>
              <Sidebar mobile onNavigate={() => setMobileOpen(false)} />
            </Suspense>
          </div>
        </div>
      ) : null}
    </div>
  );
}
