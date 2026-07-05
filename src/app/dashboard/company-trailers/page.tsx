"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type CompanyTrailer = {
  id: string;
  trailer_number: string;
  trailer_type?: string | null;
  notes?: string | null;
  active?: boolean | null;
  created_at?: string | null;
};

export default function CompanyTrailersPage() {
  const [trailers, setTrailers] = useState<CompanyTrailer[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ trailerNumber: "", trailerType: "", notes: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadTrailers = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .from("company_trailers")
        .select("id, trailer_number, trailer_type, notes, active, created_at")
        .order("created_at", { ascending: false });

      if (supabaseError) {
        throw supabaseError;
      }

      setTrailers((data ?? []) as CompanyTrailer[]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load company trailers.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadTrailers();
  }, []);

  const filteredTrailers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return trailers;
    }

    return trailers.filter((trailer) => {
      const haystack = [trailer.trailer_number, trailer.trailer_type, trailer.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(term);
    });
  }, [search, trailers]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = {
        trailer_number: form.trailerNumber.trim(),
        trailer_type: form.trailerType.trim() || null,
        notes: form.notes.trim() || null,
        active: true,
      };

      const { error: insertError } = await supabase.from("company_trailers").insert([payload]);

      if (insertError) {
        throw insertError;
      }

      setForm({ trailerNumber: "", trailerType: "", notes: "" });
      setSuccess("Trailer added successfully.");
      await loadTrailers();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to add trailer.";
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Company Trailers</h1>
          <p className="mt-2 text-sm text-slate-300 sm:text-base">
            Maintain the master list of company trailers and keep the fleet inventory organised.
          </p>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {success}
          </div>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <form onSubmit={handleSubmit} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
            <h2 className="text-lg font-semibold text-white">Add trailer</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-200">Trailer Number</label>
                <input
                  value={form.trailerNumber}
                  onChange={(event) => setForm((current) => ({ ...current, trailerNumber: event.target.value }))}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                  placeholder="e.g. TR-1001"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-200">Trailer Type</label>
                <input
                  value={form.trailerType}
                  onChange={(event) => setForm((current) => ({ ...current, trailerType: event.target.value }))}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                  placeholder="Dry Van"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-200">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  rows={4}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                  placeholder="Optional notes"
                />
              </div>

              <button
                type="submit"
                disabled={isSaving}
                className="w-full rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Add Trailer"}
              </button>
            </div>
          </form>

          <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Company trailer list</h2>
                <p className="mt-1 text-sm text-slate-400">Search by trailer number or trailer type.</p>
              </div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search trailers"
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none sm:w-64"
              />
            </div>

            <div className="mt-4 space-y-3">
              {isLoading ? (
                <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-sm text-slate-400">
                  Loading company trailers...
                </div>
              ) : filteredTrailers.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-sm text-slate-400">
                  No trailers found.
                </div>
              ) : (
                filteredTrailers.map((trailer) => (
                  <article key={trailer.id} className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{trailer.trailer_number}</p>
                        <p className="mt-1 text-sm text-slate-400">{trailer.trailer_type ?? "No type"}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${trailer.active ? "bg-emerald-500/10 text-emerald-200" : "bg-slate-700/70 text-slate-300"}`}>
                        {trailer.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    {trailer.notes ? <p className="mt-3 text-sm text-slate-400">{trailer.notes}</p> : null}
                  </article>
                ))
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
