"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type TrailerRecord = {
  id: string;
  trailer_number?: string | null;
  load_status?: string | null;
  customer?: string | null;
  consignee?: string | null;
  container_number?: string | null;
  compound_position?: string | null;
  arrival_date?: string | null;
  departure_date?: string | null;
};

type CompanyTrailerRecord = {
  id: string;
  trailer_number?: string | null;
  prefix?: string | null;
  numeric_part?: number | null;
};

type SearchResultGroup = {
  id: string;
  title: string;
  description: string;
  accent: string;
  items: Array<{
    id: string;
    trailer_number?: string | null;
    load_status?: string | null;
    position?: string | null;
    customer?: string | null;
    consignee?: string | null;
    container?: string | null;
    arrival_date?: string | null;
    departure_date?: string | null;
    status: string;
    source: "trailer" | "company";
  }>;
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

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";

export default function DashboardSearchPage() {
  const [search, setSearch] = useState("");
  const [trailers, setTrailers] = useState<TrailerRecord[]>([]);
  const [companyTrailers, setCompanyTrailers] = useState<CompanyTrailerRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const [{ data: trailerData, error: trailerError }, { data: companyData, error: companyError }] = await Promise.all([
          supabase
            .from("trailers")
            .select("id, trailer_number, load_status, customer, consignee, container_number, compound_position, arrival_date, departure_date")
            .order("arrival_date", { ascending: false }),
          supabase.from("company_trailers").select("id, trailer_number, prefix, numeric_part").order("trailer_number", { ascending: true }),
        ]);

        if (trailerError) {
          throw trailerError;
        }

        if (companyError) {
          throw companyError;
        }

        if (!isMounted) {
          return;
        }

        setTrailers((trailerData ?? []) as TrailerRecord[]);
        setCompanyTrailers((companyData ?? []) as CompanyTrailerRecord[]);
      } catch (err) {
        if (!isMounted) {
          return;
        }

        const message = err instanceof Error ? err.message : "Unable to load search data.";
        setError(message);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  const searchGroups = useMemo<SearchResultGroup[]>(() => {
    const term = search.trim().toLowerCase();

    const matchesTextSearch = (values: Array<string | null | undefined>) => {
      if (!term) {
        return false;
      }

      const haystack = values
        .filter((value): value is string => Boolean(value))
        .map((value) => normalizeText(value))
        .join(" ");

      return haystack.includes(term);
    };

    const matchesTrailer = (item: TrailerRecord) => {
      return matchesTextSearch([
        item.trailer_number,
        item.container_number,
        item.customer,
        item.consignee,
        item.compound_position,
      ]);
    };

    const matchesCompanyTrailer = (item: CompanyTrailerRecord) => {
      return matchesTextSearch([
        item.trailer_number,
        item.prefix,
        item.numeric_part !== null && item.numeric_part !== undefined ? String(item.numeric_part) : null,
      ]);
    };

    const activeItems = trailers
      .filter((item) => item.departure_date === null || item.departure_date === undefined || item.departure_date === "")
      .filter((item) => (term ? matchesTrailer(item) : false))
      .map((item) => ({
        id: item.id,
        trailer_number: item.trailer_number,
        load_status: item.load_status,
        position: item.compound_position,
        customer: item.customer,
        consignee: item.consignee,
        container: item.container_number,
        arrival_date: item.arrival_date,
        departure_date: item.departure_date,
        status: "In Compound",
        source: "trailer" as const,
      }));

    const historicalItems = trailers
      .filter((item) => Boolean(item.departure_date))
      .filter((item) => (term ? matchesTrailer(item) : false))
      .map((item) => ({
        id: item.id,
        trailer_number: item.trailer_number,
        load_status: item.load_status,
        position: item.compound_position,
        customer: item.customer,
        consignee: item.consignee,
        container: item.container_number,
        arrival_date: item.arrival_date,
        departure_date: item.departure_date,
        status: "Departed",
        source: "trailer" as const,
      }));

    const companyItems = companyTrailers
      .filter((item) => (term ? matchesCompanyTrailer(item) : false))
      .map((item) => ({
        id: item.id,
        trailer_number: item.trailer_number,
        load_status: "—",
        position: "—",
        customer: "—",
        consignee: "—",
        container: "—",
        arrival_date: null,
        departure_date: null,
        status: "Fleet Record",
        source: "company" as const,
      }));

    return [
      {
        id: "active",
        title: "Active trailers in compound",
        description: "Current trailers still on site",
        accent: "from-cyan-500 to-blue-600",
        items: activeItems,
      },
      {
        id: "historical",
        title: "Historical movements",
        description: "Trailers already departed",
        accent: "from-violet-500 to-fuchsia-600",
        items: historicalItems,
      },
      {
        id: "company",
        title: "Company fleet",
        description: "Fleet records from the wider company inventory",
        accent: "from-emerald-500 to-teal-600",
        items: companyItems,
      },
    ];
  }, [companyTrailers, search, trailers]);

  const hasAnyResults = searchGroups.some((group) => group.items.length > 0);
  const totalResults = searchGroups.reduce((count, group) => count + group.items.length, 0);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Global Search</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300 sm:text-base">
                Search current compound activity and historical movements across trailers and the company fleet.
              </p>
            </div>

            <Link
              href="/dashboard"
              className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition hover:bg-cyan-500/20"
            >
              Back to dashboard
            </Link>
          </div>
        </header>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
          <label className="mb-2 block text-sm font-medium text-slate-200" htmlFor="global-search">
            Search trailers and fleet records
          </label>
          <input
            id="global-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by trailer number, container, customer, consignee, position, or prefix"
            className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none ring-0"
          />
          <p className="mt-2 text-sm text-slate-400">
            Matches are checked across the trailers and company fleet tables.
          </p>
        </section>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400 shadow-lg shadow-black/20 backdrop-blur">
            Loading search data...
          </div>
        ) : null}

        {!isLoading && !error && !search.trim() ? (
          <div className="rounded-3xl border border-dashed border-cyan-400/30 bg-slate-900/70 p-6 text-sm text-slate-300 shadow-lg shadow-black/20 backdrop-blur">
            Enter a trailer number, container, customer, consignee, position, or fleet prefix to begin searching.
          </div>
        ) : null}

        {!isLoading && !error && search.trim() && !hasAnyResults ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-300 shadow-lg shadow-black/20 backdrop-blur">
            No matches found for “{search.trim()}”. Try a different reference or prefix.
          </div>
        ) : null}

        {!isLoading && !error && hasAnyResults ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
              Showing {totalResults} result{totalResults === 1 ? "" : "s"} across {searchGroups.filter((group) => group.items.length > 0).length} group{searchGroups.filter((group) => group.items.length > 0).length === 1 ? "" : "s"}.
            </div>

            {searchGroups.map((group) => (
              <section key={group.id} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className={`h-1.5 w-20 rounded-full bg-gradient-to-r ${group.accent}`} />
                    <h2 className="mt-3 text-lg font-semibold text-white">{group.title}</h2>
                    <p className="mt-1 text-sm text-slate-400">{group.description}</p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-slate-950/80 px-3 py-1 text-sm text-slate-300">
                    {group.items.length} result{group.items.length === 1 ? "" : "s"}
                  </span>
                </div>

                {group.items.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {group.items.map((item) => (
                      <article key={item.id} className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Trailer number</p>
                            <p className="mt-1 text-lg font-semibold text-white">
                              {item.trailer_number ? (
                                <Link
                                  href={`/dashboard/trailers/${item.trailer_number}`}
                                  className="transition hover:text-cyan-300"
                                >
                                  {item.trailer_number}
                                </Link>
                              ) : (
                                "—"
                              )}
                            </p>
                          </div>
                          <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-sm text-cyan-200">
                            {item.status}
                          </span>
                        </div>

                        <dl className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-4">
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Load status</dt>
                            <dd className="mt-1">{item.load_status ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Position</dt>
                            <dd className="mt-1">{item.position ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Customer</dt>
                            <dd className="mt-1">{item.customer ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Consignee</dt>
                            <dd className="mt-1">{item.consignee ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Container</dt>
                            <dd className="mt-1">{item.container ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Arrival date</dt>
                            <dd className="mt-1">{formatDate(item.arrival_date)}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Departure date</dt>
                            <dd className="mt-1">{formatDate(item.departure_date)}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">Source</dt>
                            <dd className="mt-1">{item.source === "company" ? "Company fleet" : "Trailer record"}</dd>
                          </div>
                        </dl>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-slate-950/60 p-4 text-sm text-slate-400">
                    No matches in this group.
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}
