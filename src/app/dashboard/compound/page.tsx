"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type TrailerRecord = {
  id: string;
  trailer_number: string | null;
  load_status?: string | null;
  customer?: string | null;
  consignee?: string | null;
  container_number?: string | null;
  compound_position?: string | null;
};

const COMPOUND_POSITIONS = Array.from({ length: 50 }, (_, index) => `P${String(index + 1).padStart(2, "0")}`);

const normalizeCompoundPosition = (value?: string | null) => {
  const trimmed = value?.trim().toUpperCase();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(P|A)?0*(\d{1,2})$/);
  if (!match) {
    return null;
  }

  const numericValue = Number(match[2]);
  if (numericValue < 1 || numericValue > 50) {
    return null;
  }

  return `P${numericValue.toString().padStart(2, "0")}`;
};

const getStatusTone = (trailer?: TrailerRecord | null) => {
  if (!trailer) {
    return "border-slate-700 bg-slate-800/80 text-slate-300";
  }

  const normalized = trailer.load_status?.trim().toLowerCase();

  if (normalized === "empty") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  }

  if (normalized === "loaded") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  }

  return "border-slate-600 bg-slate-800/80 text-slate-300";
};

export default function CompoundPage() {
  const [trailers, setTrailers] = useState<TrailerRecord[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadActiveTrailers = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error: supabaseError } = await supabase
          .from("trailers")
          .select("id, trailer_number, load_status, customer, consignee, container_number, compound_position")
          .is("departure_date", null)
          .order("compound_position", { ascending: true });

        if (supabaseError) {
          throw supabaseError;
        }

        console.log("[Compound] Fetched active trailers", data ?? []);
        setTrailers((data ?? []) as TrailerRecord[]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to load compound positions.";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    void loadActiveTrailers();
  }, []);

  const filteredTrailers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return trailers;
    }

    return trailers.filter((trailer) => {
      const haystack = [
        trailer.trailer_number,
        trailer.container_number,
        trailer.customer,
        trailer.consignee,
        trailer.compound_position,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(term);
    });
  }, [search, trailers]);

  const positions = useMemo(() => {
    const byPosition = new Map<string, TrailerRecord>();

    filteredTrailers.forEach((trailer) => {
      const normalizedPosition = normalizeCompoundPosition(trailer.compound_position);
      if (normalizedPosition && COMPOUND_POSITIONS.includes(normalizedPosition)) {
        byPosition.set(normalizedPosition, trailer);
      }
    });

    return COMPOUND_POSITIONS.map((position) => ({
      position,
      trailer: byPosition.get(position) ?? null,
    }));
  }, [filteredTrailers]);

  const unassignedTrailers = useMemo(() => {
    return filteredTrailers.filter((trailer) => {
      const normalizedPosition = normalizeCompoundPosition(trailer.compound_position);
      return !normalizedPosition || !COMPOUND_POSITIONS.includes(normalizedPosition);
    });
  }, [filteredTrailers]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Compound</h1>
          <p className="mt-2 text-sm text-slate-300 sm:text-base">
            Monitor trailer placement across the compound with a fast, mobile-friendly occupancy view.
          </p>
        </header>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
          <label className="mb-2 block text-sm font-medium text-slate-200">Search trailers</label>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by trailer, container, customer, consignee or position"
            className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
          />
        </section>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400 shadow-lg shadow-black/20 backdrop-blur">
            Loading compound positions...
          </div>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
              {positions.map(({ position, trailer }) => (
                <article key={position} className={`rounded-3xl border p-4 shadow-lg shadow-black/20 ${getStatusTone(trailer)}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold uppercase tracking-[0.25em]">{position}</p>
                    <span className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em]">
                      {trailer ? "Occupied" : "Available"}
                    </span>
                  </div>

                  {trailer ? (
                    <div className="mt-4 space-y-2 text-sm">
                      <div>
                        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Trailer</p>
                        <p className="mt-1 font-semibold">{trailer.trailer_number ?? "Unnamed trailer"}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Load</p>
                        <p className="mt-1">{trailer.load_status ?? "Unknown"}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Customer</p>
                        <p className="mt-1">{trailer.customer ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Consignee</p>
                        <p className="mt-1">{trailer.consignee ?? "—"}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-black/10 p-3 text-sm text-slate-300">
                      Available
                    </div>
                  )}
                </article>
              ))}
            </section>

            {unassignedTrailers.length > 0 ? (
              <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-white">Unassigned trailers</h2>
                  <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-sm text-amber-200">
                    {unassignedTrailers.length}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {unassignedTrailers.map((trailer) => (
                    <article key={trailer.id} className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                      <p className="text-sm font-semibold text-white">{trailer.trailer_number ?? "Unnamed trailer"}</p>
                      <p className="mt-2 text-sm text-slate-400">Position: {trailer.compound_position ?? "—"}</p>
                      <p className="mt-1 text-sm text-slate-400">Load: {trailer.load_status ?? "Unknown"}</p>
                      <p className="mt-1 text-sm text-slate-400">Customer: {trailer.customer ?? "—"}</p>
                      <p className="mt-1 text-sm text-slate-400">Consignee: {trailer.consignee ?? "—"}</p>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
