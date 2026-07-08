"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Trailer = {
  id: string;
  trailer_number?: string | null;
  compound_position?: string | null;
  load_status?: string | null;
  operational_status?: string | null;
  customer?: string | null;
  consignee?: string | null;
  container_number?: string | null;
  load_description?: string | null;
  notes?: string | null;
  arrival_date?: string | null;
  departure_date?: string | null;
  delivered_at?: string | null;
  returned_empty_at?: string | null;
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
};

const normalizeStatus = (value?: string | null) => {
  if (!value) return "Unknown";

  const normalized = value.trim().toLowerCase();

  switch (normalized) {
    case "in compound":
      return "In Compound";
    case "ready for departure":
      return "Ready for Departure";
    case "departed":
      return "Departed";
    case "on delivery":
      return "On Delivery";
    case "delivered":
      return "Delivered";
    case "returned empty":
      return "Returned Empty";
    default:
      return value;
  }
};

const getStatusColor = (status?: string | null) => {
  const label = normalizeStatus(status);

  switch (label) {
    case "In Compound":
      return "bg-slate-800 text-cyan-300 ring-cyan-500/30";
    case "Ready for Departure":
      return "bg-amber-950 text-amber-300 ring-amber-500/20";
    case "Departed":
      return "bg-rose-950 text-rose-300 ring-rose-500/20";
    case "On Delivery":
      return "bg-violet-950 text-violet-300 ring-violet-500/20";
    case "Delivered":
      return "bg-emerald-950 text-emerald-300 ring-emerald-500/20";
    case "Returned Empty":
      return "bg-slate-800 text-slate-200 ring-slate-500/20";
    default:
      return "bg-slate-800 text-slate-200 ring-slate-500/20";
  }
};

const actions = [
  "Edit Trailer",
  "Move Trailer",
  "Load Trailer",
  "Mark Empty",
  "Confirm Departure",
  "Mark On Delivery",
  "Mark Delivered",
  "Return Empty",
];

export default function TrailerDetailsPage() {
  const params = useParams();
  const trailerNumber = params?.id && typeof params.id === "string" ? params.id : undefined;
  const [trailer, setTrailer] = useState<Trailer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!trailerNumber) {
      setError("Unable to identify trailer from the URL.");
      setIsLoading(false);
      return;
    }

    const loadTrailer = async () => {
      setIsLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("trailers")
        .select(
          "id, trailer_number, compound_position, load_status, operational_status, customer, consignee, container_number, load_description, notes, arrival_date, departure_date, delivered_at, returned_empty_at"
        )
        .eq("trailer_number", trailerNumber)
        .single();

      if (fetchError) {
        setTrailer(null);
        setError(
          fetchError.message?.includes("No rows found")
            ? "Trailer not found."
            : fetchError.message || "Unable to load trailer details."
        );
      } else {
        setTrailer(data as Trailer);
      }

      setIsLoading(false);
    };

    void loadTrailer();
  }, [trailerNumber]);

  const currentStatus = useMemo(
    () => normalizeStatus(trailer?.operational_status),
    [trailer?.operational_status]
  );

  const statusBadgeClass = useMemo(
    () => `${getStatusColor(trailer?.operational_status)} rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset`,
    [trailer?.operational_status]
  );

  const handleAction = (label: string) => {
    // Placeholder handler for future operational functionality.
    console.log(`Action triggered: ${label}`);
    window.alert(`Placeholder: ${label}`);
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.14),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-black/20 backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">
            Ferryspeed TrailerHub
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Trailer details
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-300 sm:text-base">
            View trailer movement details, compound status, and operational controls.
          </p>
        </header>

        {isLoading ? (
          <section className="rounded-3xl border border-white/10 bg-slate-900/80 p-6">
            <p className="text-slate-300">Loading trailer details...</p>
          </section>
        ) : error ? (
          <section className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-200">
            <p>{error}</p>
          </section>
        ) : !trailer ? (
          <section className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-100">
            <p>Trailer not found. Check the link or return to the dashboard.</p>
          </section>
        ) : (
          <section className="space-y-6">
            <div className="grid gap-6 rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-inner shadow-black/20 sm:grid-cols-[1.5fr_1fr]">
              <div className="space-y-3">
                <p className="text-sm uppercase tracking-[0.24em] text-cyan-400">Trailer overview</p>
                <h2 className="text-3xl font-semibold text-white">
                  {trailer.trailer_number ?? "Unknown trailer"}
                </h2>
                <p className="max-w-xl text-sm text-slate-300">
                  Compound position, load and operational status for this trailer.
                </p>
              </div>

              <div className="grid gap-3 rounded-3xl border border-white/5 bg-slate-950/80 p-5">
                <div className="rounded-3xl bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Current position</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {trailer.compound_position ?? "Not assigned"}
                  </p>
                </div>

                <div className="rounded-3xl bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Load status</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {trailer.load_status ?? "Unknown"}
                  </p>
                </div>

                <div className="rounded-3xl bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Operational status</p>
                  <p className="mt-2">
                    <span className={statusBadgeClass}>{currentStatus}</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <article className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-inner shadow-black/10">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Current information</p>
                    <h3 className="mt-2 text-2xl font-semibold text-white">Customer & load</h3>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-3xl bg-slate-950/80 p-4">
                    <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Customer</p>
                    <p className="mt-2 text-base font-semibold text-white">{trailer.customer ?? "—"}</p>
                  </div>
                  <div className="rounded-3xl bg-slate-950/80 p-4">
                    <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Consignee</p>
                    <p className="mt-2 text-base font-semibold text-white">{trailer.consignee ?? "—"}</p>
                  </div>
                  <div className="rounded-3xl bg-slate-950/80 p-4">
                    <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Container</p>
                    <p className="mt-2 text-base font-semibold text-white">{trailer.container_number ?? "—"}</p>
                  </div>
                  <div className="rounded-3xl bg-slate-950/80 p-4">
                    <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Load description</p>
                    <p className="mt-2 text-base font-semibold text-white">{trailer.load_description ?? "—"}</p>
                  </div>
                  <div className="sm:col-span-2 rounded-3xl bg-slate-950/80 p-4">
                    <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Notes</p>
                    <p className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-200">{trailer.notes ?? "—"}</p>
                  </div>
                </div>
              </article>

              <article className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-inner shadow-black/10">
                <div>
                  <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Dates</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">Movement timeline</h3>
                </div>

                <div className="mt-6 space-y-4">
                  <div className="rounded-3xl bg-slate-950/80 p-4">
                    <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Arrival date</p>
                    <p className="mt-2 text-base font-semibold text-white">{formatDate(trailer.arrival_date)}</p>
                  </div>
                  <div className="rounded-3xl bg-slate-950/80 p-4">
                    <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Departure date</p>
                    <p className="mt-2 text-base font-semibold text-white">{formatDate(trailer.departure_date)}</p>
                  </div>
                  <div className="rounded-3xl bg-slate-950/80 p-4">
                    <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Delivered date</p>
                    <p className="mt-2 text-base font-semibold text-white">{formatDate(trailer.delivered_at)}</p>
                  </div>
                  <div className="rounded-3xl bg-slate-950/80 p-4">
                    <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Returned empty date</p>
                    <p className="mt-2 text-base font-semibold text-white">{formatDate(trailer.returned_empty_at)}</p>
                  </div>
                </div>
              </article>
            </div>

            <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-inner shadow-black/10">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Operational controls</p>
                  <p className="mt-2 text-sm text-slate-300">
                    Placeholder actions for future trailer workflow integration.
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {actions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    onClick={() => handleAction(action)}
                    className="rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-left text-sm font-semibold text-slate-100 outline-none transition hover:border-cyan-400 hover:bg-slate-800"
                  >
                    {action}
                  </button>
                ))}
              </div>
            </section>
          </section>
        )}
      </div>
    </main>
  );
}
