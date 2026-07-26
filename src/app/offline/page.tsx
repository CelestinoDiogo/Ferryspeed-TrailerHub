"use client";

import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#0b1220_0%,#0f172a_100%)] px-4 py-10 text-slate-100">
      <div className="mx-auto flex max-w-lg flex-col gap-6 rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-[0_24px_60px_rgba(2,8,23,0.35)] backdrop-blur">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-cyan-300">Ferryspeed TrailerHub</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">You are offline</h1>
          <p className="mt-3 text-sm text-slate-300">
            The application shell is available, but live operational data cannot be refreshed right now.
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-200">
          <p>Previously loaded Master Mobile screens may still show limited local state.</p>
          <p className="mt-2">Queued actions will sync automatically when connectivity returns.</p>
          <p className="mt-2 text-slate-400">Do not assume server data shown while offline is current.</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white"
          >
            Retry
          </button>
          <Link
            href="/dashboard/mobile"
            className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-100"
          >
            Open Master Mobile
          </Link>
        </div>
      </div>
    </main>
  );
}
