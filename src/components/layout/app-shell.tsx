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
    <div className="relative min-h-screen bg-fs-main text-[var(--fs-text)]">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <Image
          src="/branding/ferryspeed map.png"
          alt=""
          width={1300}
          height={900}
          className="absolute -right-28 top-10 hidden h-auto w-[58vw] max-w-[940px] opacity-[0.12] lg:block"
          priority
        />
      </div>

      <div className="relative z-10 flex min-h-screen">
        <div className="hidden md:block">
          <Sidebar />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopHeader
            title="FERRYSPEED TRAILERHUB"
            subtitle="Operational Control Centre"
            onMenuClick={() => setMobileOpen(true)}
          />
          <main className="flex-1 p-4 md:p-6">
            <div className="mx-auto w-full max-w-[1440px]">{children}</div>
          </main>
        </div>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 bg-black/50 md:hidden" role="dialog" aria-modal="true">
          <div className="h-full w-[84vw] max-w-[340px] border-r border-[var(--fs-border)] bg-[var(--fs-sidebar)] p-2">
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
