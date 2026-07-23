"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { logTrailerEvent, resolveAuditOperatorName } from "@/lib/trailer-audit-log";
import { supabase } from "@/lib/supabase";

type TrailerRecord = {
  id: string;
  trailer_number: string | null;
  trailer_type?: string | null;
  load_status?: string | null;
  load_description?: string | null;
  customer?: string | null;
  consignee?: string | null;
  container_number?: string | null;
  compound_position?: string | null;
  arrival_date?: string | null;
  departure_date?: string | null;
  departure_time?: string | null;
  operational_status?: string | null;
  is_local?: boolean | null;
};

export default function DeparturePage() {
  const router = useRouter();
  const [trailers, setTrailers] = useState<TrailerRecord[]>([]);
  const [selectedTrailerId, setSelectedTrailerId] = useState<string | null>(null);
  const [requestedTrailerId, setRequestedTrailerId] = useState<string | null>(null);
  const [requestedTrailerNumber, setRequestedTrailerNumber] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRequestedTrailerId(params.get("trailerId"));
    setRequestedTrailerNumber(params.get("trailer"));
  }, []);

  useEffect(() => {
    const loadActiveTrailers = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error: supabaseError } = await supabase
          .from("trailers")
          .select("id, trailer_number, trailer_type, load_status, load_description, customer, consignee, container_number, compound_position, arrival_date")
          .is("departure_date", null)
          .order("arrival_date", { ascending: false });

        if (supabaseError) {
          throw supabaseError;
        }

        const loaded = (data ?? []) as TrailerRecord[];
        setTrailers(loaded);

        if (!selectedTrailerId && loaded.length > 0) {
          const targetById = requestedTrailerId ? loaded.find((row) => row.id === requestedTrailerId) : null;
          const targetByNumber = requestedTrailerNumber
            ? loaded.find(
                (row) => row.trailer_number?.trim().toUpperCase() === requestedTrailerNumber.trim().toUpperCase(),
              )
            : null;
          const target = targetById ?? targetByNumber;
          if (target) {
            setSelectedTrailerId(target.id);
            setSearch(target.trailer_number ?? "");
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to load active trailers.";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    void loadActiveTrailers();
  }, [requestedTrailerId, requestedTrailerNumber, selectedTrailerId]);

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

  const selectedTrailer = filteredTrailers.find((item) => item.id === selectedTrailerId) ?? null;

  const handleSelectTrailer = (trailerId: string) => {
    setSelectedTrailerId(trailerId);
  };

  const confirmDeparture = async () => {
    if (!selectedTrailerId || !selectedTrailer) {
      setError("Select a trailer before confirming departure.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const nowTime = now.toTimeString().slice(0, 8);

      const { data: currentTrailer, error: currentTrailerError } = await supabase
        .from("trailers")
        .select("id, trailer_number, departure_date, departure_time, compound_position, operational_status, is_local")
        .eq("id", selectedTrailerId)
        .single();

      if (currentTrailerError || !currentTrailer) {
        const message = currentTrailerError?.message || "Unable to load current trailer state before departure.";
        setError(message);
        alert(message);
        return;
      }

      const updatePayload = {
        departure_date: nowIso,
        departure_time: nowTime,
        operational_status: "Departed",
        compound_position: null,
      };

      const { data, error } = await supabase
        .from("trailers")
        .update(updatePayload)
        .eq("id", selectedTrailerId)
        .select();

      if (error) {
        const message = error.message || "Unable to confirm departure.";
        setError(message);
        alert(message);
        return;
      }

      if (!data || data.length === 0) {
        const message = "No trailer was updated.";
        setError(message);
        alert(message);
        return;
      }

      const { error: eventError } = await supabase.from("trailer_events").insert({
        trailer_id: currentTrailer.id,
        trailer_number: currentTrailer.trailer_number,
        event_type: "departure_registered",
        event_description: "Trailer departure registered.",
        old_value: {
          departure_date: currentTrailer.departure_date ?? null,
          departure_time: currentTrailer.departure_time ?? null,
          compound_position: currentTrailer.compound_position ?? null,
          operational_status: currentTrailer.operational_status ?? null,
        },
        new_value: {
          departure_date: updatePayload.departure_date,
          departure_time: updatePayload.departure_time,
          compound_position: updatePayload.compound_position,
          operational_status: updatePayload.operational_status,
        },
      });

      if (eventError) {
        console.error("Departure saved but trailer event creation failed:", eventError);
        alert("Departure saved, but history event could not be recorded.");
      }

      const operatorName = await resolveAuditOperatorName();
      await logTrailerEvent({
        trailerId: currentTrailer.id,
        trailerNumber: currentTrailer.trailer_number,
        eventType: "departure_registered",
        description: "Trailer departure registered.",
        previousValue: {
          departure_date: currentTrailer.departure_date ?? null,
          departure_time: currentTrailer.departure_time ?? null,
          compound_position: currentTrailer.compound_position ?? null,
          operational_status: currentTrailer.operational_status ?? null,
        },
        newValue: {
          departure_date: updatePayload.departure_date,
          departure_time: updatePayload.departure_time,
          compound_position: updatePayload.compound_position,
          operational_status: updatePayload.operational_status,
        },
        sourceModule: "departure",
        performedBy: operatorName,
      });

      router.push("/dashboard?saved=1");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to confirm departure.";
      setError(message);
      alert(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Departure</h1>
          <p className="mt-2 text-sm text-slate-300 sm:text-base">
            Search active trailers and confirm departures quickly and accurately.
          </p>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
            <label className="mb-2 block text-sm font-medium text-slate-200">Search trailers</label>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by trailer, container, customer, consignee or position"
              className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
            />

            <div className="mt-4 space-y-3">
              {isLoading ? (
                <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-sm text-slate-400">
                  Loading active trailers...
                </div>
              ) : filteredTrailers.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-sm text-slate-400">
                  No active trailers match your search.
                </div>
              ) : (
                filteredTrailers.map((trailer) => (
                  <button
                    key={trailer.id}
                    type="button"
                    onClick={() => handleSelectTrailer(trailer.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      selectedTrailerId === trailer.id
                        ? "border-cyan-400/50 bg-cyan-500/10"
                        : "border-white/10 bg-slate-950/80 hover:bg-slate-800"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{trailer.trailer_number ?? "Unnamed trailer"}</p>
                        <p className="mt-1 text-sm text-slate-400">{trailer.customer ?? "No customer"}</p>
                      </div>
                      <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-200">
                        {trailer.load_status ?? "Unknown"}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                      <span>Container: {trailer.container_number ?? "—"}</span>
                      <span>Position: {trailer.compound_position ?? "—"}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
            <h2 className="text-lg font-semibold text-white">Confirm departure</h2>
            <p className="mt-2 text-sm text-slate-300">
              Select a trailer from the list to confirm its departure from the compound.
            </p>

            {selectedTrailer ? (
              <div className="mt-5 space-y-4 rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Trailer</p>
                  <p className="mt-1 text-lg font-semibold text-white">{selectedTrailer.trailer_number}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Customer</p>
                    <p className="mt-1 text-sm text-slate-300">{selectedTrailer.customer ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Consignee</p>
                    <p className="mt-1 text-sm text-slate-300">{selectedTrailer.consignee ?? "—"}</p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Container</p>
                    <p className="mt-1 text-sm text-slate-300">{selectedTrailer.container_number ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Position</p>
                    <p className="mt-1 text-sm text-slate-300">{selectedTrailer.compound_position ?? "—"}</p>
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => router.push("/dashboard")}
                    className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-3 text-sm font-medium text-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDeparture}
                    disabled={isSubmitting || !selectedTrailerId}
                    className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? "Confirming..." : "Confirm Departure"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-slate-950/70 p-4 text-sm text-slate-400">
                Choose a trailer from the list to continue.
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
