"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type CompanyTrailer = {
  id: string;
  trailer_number: string;
  prefix: string | null;
  numeric_part: number | null;
  trailer_type: string | null;
  notes: string | null;
  original_value: string | null;
  active: boolean | null;
};

type ActiveTrailer = {
  id: string;
  trailer_number: string | null;
  load_status: string | null;
  customer: string | null;
  consignee: string | null;
  container_number: string | null;
  compound_position: string | null;
  arrival_date: string | null;
  departure_date: string | null;
};

type FleetRow = CompanyTrailer & {
  currentMovement?: ActiveTrailer;
};

const normalize = (value?: string | null) => value?.trim().toLowerCase() ?? "";

export default function CompanyTrailersPage() {
  const [companyTrailers, setCompanyTrailers] = useState<CompanyTrailer[]>([]);
  const [activeTrailers, setActiveTrailers] = useState<ActiveTrailer[]>([]);
  const [search, setSearch] = useState("");
  const [prefixFilter, setPrefixFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loadFilter, setLoadFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadFleet() {
      setLoading(true);
      setError(null);

      try {
        const [{ data: fleetData, error: fleetError }, { data: activeData, error: activeError }] =
          await Promise.all([
            supabase
              .from("company_trailers")
              .select("id, trailer_number, prefix, numeric_part, trailer_type, notes, original_value, active")
              .order("prefix", { ascending: true })
              .order("numeric_part", { ascending: true }),

            supabase
              .from("trailers")
              .select(
                "id, trailer_number, load_status, customer, consignee, container_number, compound_position, arrival_date, departure_date"
              )
              .is("departure_date", null),
          ]);

        if (fleetError) throw fleetError;
        if (activeError) throw activeError;

        setCompanyTrailers((fleetData ?? []) as CompanyTrailer[]);
        setActiveTrailers((activeData ?? []) as ActiveTrailer[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load fleet.");
      } finally {
        setLoading(false);
      }
    }

    void loadFleet();
  }, []);

  const activeByTrailerNumber = useMemo(() => {
    const map = new Map<string, ActiveTrailer>();

    activeTrailers.forEach((item) => {
      if (item.trailer_number) {
        map.set(normalize(item.trailer_number), item);
      }
    });

    return map;
  }, [activeTrailers]);

  const rows: FleetRow[] = useMemo(() => {
    return companyTrailers.map((trailer) => ({
      ...trailer,
      currentMovement: activeByTrailerNumber.get(normalize(trailer.trailer_number)),
    }));
  }, [companyTrailers, activeByTrailerNumber]);

  const prefixes = useMemo(() => {
    return Array.from(new Set(companyTrailers.map((item) => item.prefix).filter(Boolean) as string[])).sort();
  }, [companyTrailers]);

  const filteredRows = useMemo(() => {
    const term = normalize(search);

    return rows.filter((row) => {
      const movement = row.currentMovement;
      const isInCompound = Boolean(movement);

      const matchesSearch =
        !term ||
        normalize(row.trailer_number).includes(term) ||
        normalize(row.prefix).includes(term) ||
        normalize(row.trailer_type).includes(term) ||
        normalize(movement?.customer).includes(term) ||
        normalize(movement?.consignee).includes(term) ||
        normalize(movement?.container_number).includes(term) ||
        normalize(movement?.compound_position).includes(term);

      const matchesPrefix = prefixFilter === "ALL" || row.prefix === prefixFilter;

      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "IN" && isInCompound) ||
        (statusFilter === "OUT" && !isInCompound);

      const loadStatus = normalize(movement?.load_status);
      const matchesLoad =
        loadFilter === "ALL" ||
        (loadFilter === "EMPTY" && loadStatus === "empty") ||
        (loadFilter === "LOADED" && loadStatus === "loaded");

      return matchesSearch && matchesPrefix && matchesStatus && matchesLoad;
    });
  }, [rows, search, prefixFilter, statusFilter, loadFilter]);

  const inCompound = rows.filter((row) => row.currentMovement).length;
  const loaded = rows.filter((row) => normalize(row.currentMovement?.load_status) === "loaded").length;
  const empty = rows.filter((row) => normalize(row.currentMovement?.load_status) === "empty").length;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900 p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">
            Ferryspeed TrailerHub
          </p>
          <h1 className="mt-2 text-3xl font-bold">Company Trailers</h1>
          <p className="mt-2 text-slate-300">
            Master fleet list with live compound status.
          </p>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-200">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard label="Total Fleet" value={companyTrailers.length} />
          <SummaryCard label="In Compound" value={inCompound} />
          <SummaryCard label="Out of Compound" value={companyTrailers.length - inCompound} />
          <SummaryCard label="Loaded" value={loaded} />
          <SummaryCard label="Empty" value={empty} />
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900 p-4">
          <div className="grid gap-3 lg:grid-cols-4">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search trailer, prefix, customer, container..."
              className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 outline-none"
            />

            <select
              value={prefixFilter}
              onChange={(event) => setPrefixFilter(event.target.value)}
              className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 outline-none"
            >
              <option value="ALL">All prefixes</option>
              {prefixes.map((prefix) => (
                <option key={prefix} value={prefix}>
                  {prefix}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 outline-none"
            >
              <option value="ALL">All status</option>
              <option value="IN">In Compound</option>
              <option value="OUT">Out of Compound</option>
            </select>

            <select
              value={loadFilter}
              onChange={(event) => setLoadFilter(event.target.value)}
              className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 outline-none"
            >
              <option value="ALL">All loads</option>
              <option value="EMPTY">Empty</option>
              <option value="LOADED">Loaded</option>
            </select>
          </div>

          <p className="mt-4 text-sm text-slate-400">
            Showing {filteredRows.length} trailer{filteredRows.length === 1 ? "" : "s"}.
          </p>
        </section>

        <section className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900">
          {loading ? (
            <div className="p-6 text-slate-300">Loading fleet...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-950 text-xs uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Trailer</th>
                    <th className="px-4 py-3">Prefix</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Position</th>
                    <th className="px-4 py-3">Load</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Container</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {filteredRows.map((row) => {
                    const movement = row.currentMovement;

                    return (
                      <tr key={row.id} className="hover:bg-white/5">
                        <td className="px-4 py-3 font-semibold text-white">{row.trailer_number}</td>
                        <td className="px-4 py-3 text-slate-300">{row.prefix ?? "—"}</td>
                        <td className="px-4 py-3">
                          {movement ? (
                            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300">
                              In Compound
                            </span>
                          ) : (
                            <span className="rounded-full bg-slate-700 px-3 py-1 text-xs text-slate-300">
                              Out
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">{movement?.compound_position ?? "—"}</td>
                        <td className="px-4 py-3">{movement?.load_status ?? "—"}</td>
                        <td className="px-4 py-3">{movement?.customer ?? "—"}</td>
                        <td className="px-4 py-3">{movement?.container_number ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-slate-900 p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-bold text-white">{value}</p>
    </div>
  );
}