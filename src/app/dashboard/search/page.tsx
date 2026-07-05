import Link from "next/link";

export default function DashboardSearchPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-4xl rounded-3xl border border-white/10 bg-slate-900/80 p-8 shadow-2xl shadow-black/20">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
            <h1 className="mt-2 text-2xl font-semibold">Search trailers</h1>
            <p className="mt-2 text-sm text-slate-400">Find trailers by reference, customer, or position.</p>
          </div>
          <Link href="/dashboard" className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition hover:bg-cyan-500/20">
            Back to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
