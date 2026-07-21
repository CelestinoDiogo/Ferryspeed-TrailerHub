"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PrintButton } from "@/components/print/print-button";
import { PrintFilters } from "@/components/print/print-filters";
import { PrintFooter } from "@/components/print/print-footer";
import { PrintHeader } from "@/components/print/print-header";
import { PrintReportLayout } from "@/components/print/print-report-layout";
import { PrintSummary } from "@/components/print/print-summary";
import { PrintTable } from "@/components/print/print-table";
import { supabase } from "@/lib/supabase";

type LocalTrailerRecord = {
  id: string;
  trailer_number?: string | null;
  trailer_source?: string | null;
  external_company?: string | null;
  load_status?: string | null;
  customer?: string | null;
  consignee?: string | null;
  container_number?: string | null;
  arrival_date?: string | null;
  notes?: string | null;
  departure_date?: string | null;
  is_local?: boolean | null;
};

const formatDate = (value?: string | null) => {
  if (!value) {
    return "—";
  }

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

const getPrintedDateTime = () =>
  new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function LocalTrailersPage() {
  const [trailers, setTrailers] = useState<LocalTrailerRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const printedAt = getPrintedDateTime();

  useEffect(() => {
    const loadLocalTrailers = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error: trailersError } = await supabase
          .from("trailers")
          .select("id, trailer_number, trailer_source, external_company, load_status, customer, consignee, container_number, arrival_date, notes, departure_date, is_local")
          .is("departure_date", null)
          .eq("is_local", true)
          .order("trailer_number", { ascending: true });

        if (trailersError) {
          throw trailersError;
        }

        setTrailers((data ?? []) as LocalTrailerRecord[]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to load local trailers.";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    void loadLocalTrailers();
  }, []);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Local Trailers</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300 sm:text-base">
                Active local trailers that are excluded from compound occupancy.
              </p>
            </div>
            <Link
              href="/dashboard"
              className="rounded-2xl border border-white/10 bg-slate-800 px-5 py-3 text-center font-semibold text-white hover:bg-slate-700"
            >
              Back to Dashboard
            </Link>
            <PrintButton label="Print / Export" disabled={isLoading || trailers.length === 0} />
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {trailers.length > 0 ? (
          <PrintReportLayout orientation="portrait">
            <PrintHeader title="Local Trailers" printedAt={printedAt} userName="Diogo Ferreira" totalRecords={trailers.length}>
              <PrintFilters items={[{ label: "View", value: "Active local trailers" }]} />
            </PrintHeader>
            <PrintSummary
              items={[
                { label: "Local Trailers", value: trailers.length },
                { label: "Outsourced", value: trailers.filter((trailer) => trailer.trailer_source === "outsourced").length },
                { label: "Loaded", value: trailers.filter((trailer) => (trailer.load_status ?? "").toLowerCase() === "loaded").length },
                { label: "Empty", value: trailers.filter((trailer) => (trailer.load_status ?? "").toLowerCase() === "empty").length },
                { label: "With Customer", value: trailers.filter((trailer) => Boolean(trailer.customer?.trim())).length },
              ]}
            />
            <PrintTable
              rows={trailers}
              columns={[
                { key: "trailer_number", header: "Trailer", render: (trailer) => trailer.trailer_number ?? "—" },
                { key: "ownership", header: "Ownership", render: (trailer) => trailer.trailer_source === "outsourced" ? "Outsourced" : "Ferryspeed Fleet" },
                { key: "external_company", header: "External Company", render: (trailer) => trailer.external_company ?? "—" },
                { key: "load_status", header: "Load Status", render: (trailer) => trailer.load_status ?? "—" },
                { key: "customer", header: "Customer", render: (trailer) => trailer.customer ?? "—" },
                { key: "arrival_date", header: "Arrival Date", render: (trailer) => formatDate(trailer.arrival_date) },
              ]}
            />
            <PrintFooter />
          </PrintReportLayout>
        ) : null}

        {isLoading ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400 shadow-lg shadow-black/20 backdrop-blur">
            Loading local trailers...
          </div>
        ) : null}

        {!isLoading && !error && trailers.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-300 shadow-lg shadow-black/20 backdrop-blur">
            No active local trailers found.
          </div>
        ) : null}

        {!isLoading && !error && trailers.length > 0 ? (
          <section className="space-y-3">
            {trailers.map((trailer) => (
              <article key={trailer.id} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
                <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Trailer Number</p>
                    <p className="mt-1 text-xl font-semibold text-white">{trailer.trailer_number ?? "—"}</p>

                    <dl className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Ownership</dt>
                        <dd className="mt-1">{trailer.trailer_source === "outsourced" ? "Outsourced" : "Ferryspeed Fleet"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">External Company</dt>
                        <dd className="mt-1">{trailer.trailer_source === "outsourced" ? trailer.external_company ?? "—" : "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Load Status</dt>
                        <dd className="mt-1">{trailer.load_status ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Customer</dt>
                        <dd className="mt-1">{trailer.customer ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Consignee</dt>
                        <dd className="mt-1">{trailer.consignee ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Container Number</dt>
                        <dd className="mt-1">{trailer.container_number ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Arrival Date</dt>
                        <dd className="mt-1">{formatDate(trailer.arrival_date)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Location Type</dt>
                        <dd className="mt-1">Local</dd>
                      </div>
                      <div className="sm:col-span-2 xl:col-span-4">
                        <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Notes</dt>
                        <dd className="mt-1">{trailer.notes?.trim() ? trailer.notes : "—"}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex flex-col gap-2 lg:min-w-52">
                    <Link
                      href={`/dashboard/trailers/${trailer.id}`}
                      className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-slate-900"
                    >
                      View History
                    </Link>
                    <Link
                      href={`/dashboard/edit-trailer?id=${trailer.id}`}
                      className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-slate-700"
                    >
                      Edit Trailer
                    </Link>
                    <Link
                      href={`/dashboard/edit-trailer?id=${trailer.id}&action=move_to_compound`}
                      className="rounded-2xl bg-cyan-500 px-4 py-2 text-center text-sm font-semibold text-slate-950 hover:bg-cyan-400"
                    >
                      Convert to Compound
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}
