"use client";

import Image from "next/image";
import { useState } from "react";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { TopHeader } from "@/components/layout/top-header";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="relative min-h-screen bg-fs-main text-[var(--fs-text)] print:bg-white print:text-black">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 select-none overflow-hidden print:hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-[rgba(11,18,32,0.74)] via-[rgba(12,22,39,0.44)] to-[rgba(12,22,39,0.18)]" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Image
            src="/branding/ferryspeed logo.png"
            alt=""
            width={1180}
            height={320}
            className="h-auto w-[min(82vw,980px)] opacity-[0.07] [filter:brightness(1.18)_saturate(0.88)]"
            priority
          />
        </div>
        <Image
          src="/branding/ferryspeed map.png"
          alt=""
          width={1300}
          height={900}
          className="absolute -right-28 top-10 hidden h-auto w-[58vw] max-w-[960px] opacity-[0.18] [filter:saturate(0.84)_brightness(0.82)] lg:block"
          priority
        />
      </div>

      <div className="relative z-10 flex min-h-screen">
        <div className="hidden md:block print:hidden">
          <Sidebar />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopHeader
            title="FERRYSPEED TRAILERHUB"
            subtitle="Operational Control Centre"
            onMenuClick={() => setMobileOpen(true)}
          />
          <main className="relative z-10 flex-1 p-4 print:bg-white print:p-0 md:p-6">
            <div className="mx-auto w-full max-w-[1440px] print:mx-0 print:w-full print:max-w-none">{children}</div>
          </main>
        </div>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 bg-black/50 md:hidden print:hidden" role="dialog" aria-modal="true">
          <div className="h-full w-[84vw] max-w-[340px] border-r border-[var(--fs-border)] bg-[linear-gradient(180deg,#020908_0%,#03110e_100%)] p-2">
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--fs-border)] bg-[var(--fs-panel)]"
                aria-label="Close navigation"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <Sidebar mobile onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
