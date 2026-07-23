"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { logTrailerEvent, resolveAuditOperatorName } from "@/lib/trailer-audit-log";
import { supabase } from "@/lib/supabase";
import { EXPORT_ACTIVE_STATUS_QUERY_VALUES } from "@/lib/export-allocation";

type Trailer = {
  id: string;
  trailer_number: string | null;
  load_status: string | null;
  compound_position: string | null;
  customer: string | null;
  consignee: string | null;
  container_number: string | null;
  load_description: string | null;
};

export default function LoadTrailerPage() {
  const router = useRouter();
  const [trailers, setTrailers] = useState<Trailer[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [requestedTrailerId, setRequestedTrailerId] = useState<string | null>(null);
  const [requestedTrailerNumber, setRequestedTrailerNumber] = useState<string | null>(null);
  const [requestedLoadStatus, setRequestedLoadStatus] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [customer, setCustomer] = useState("");
  const [consignee, setConsignee] = useState("");
  const [containerNumber, setContainerNumber] = useState("");
  const [loadDescription, setLoadDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRequestedTrailerId(params.get("trailerId"));
    setRequestedTrailerNumber(params.get("trailer"));
    setRequestedLoadStatus(params.get("loadStatus"));
  }, []);

  useEffect(() => {
    async function loadEmptyTrailers() {
      setLoading(true);

      const activeStatuses = [...EXPORT_ACTIVE_STATUS_QUERY_VALUES];

      const [{ data, error }, { data: activeAllocations, error: allocationError }] = await Promise.all([
        supabase
          .from("trailers")
          .select(
            "id, trailer_number, load_status, compound_position, customer, consignee, container_number, load_description"
          )
          .is("departure_date", null)
          .ilike("load_status", "Empty")
          .order("compound_position", { ascending: true }),
        supabase
          .from("export_allocations")
          .select("trailer_id, status")
          .in("status", activeStatuses),
      ]);

      if (error || allocationError) {
        setError(error?.message || allocationError?.message || "Unable to load trailers.");
      } else {
        const blockedTrailerIds = new Set<string>();
        (activeAllocations ?? []).forEach((row) => {
          const trailerId = (row as { trailer_id?: string | null }).trailer_id;
          if (trailerId) {
            blockedTrailerIds.add(trailerId);
          }
        });

        const available = ((data ?? []) as Trailer[]).filter((item) => !blockedTrailerIds.has(item.id));
        setTrailers(available);

        if (!selectedId && available.length > 0) {
          const requestedById = requestedTrailerId
            ? available.find((item) => item.id === requestedTrailerId)
            : null;
          const requestedByNumber = requestedTrailerNumber
            ? available.find(
                (item) => item.trailer_number?.trim().toUpperCase() === requestedTrailerNumber.trim().toUpperCase(),
              )
            : null;
          const target = requestedById ?? requestedByNumber ?? available[0];
          setSelectedId(target.id);
          setSearch(target.trailer_number ?? "");
        }
      }

      setLoading(false);
    }

    void loadEmptyTrailers();
  }, [requestedTrailerId, requestedTrailerNumber, selectedId]);

  useEffect(() => {
    if (!requestedLoadStatus) {
      return;
    }

    if (requestedLoadStatus.trim().toLowerCase() !== "loaded") {
      return;
    }

    setLoadDescription((current) => current || "Voice operation request");
  }, [requestedLoadStatus]);

  const filteredTrailers = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return trailers;

    return trailers.filter((trailer) =>
      [
        trailer.trailer_number,
        trailer.compound_position,
        trailer.customer,
        trailer.consignee,
        trailer.container_number,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term))
    );
  }, [trailers, search]);

  const selectedTrailer = trailers.find((trailer) => trailer.id === selectedId);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedTrailer) {
      alert("Select an empty trailer first.");
      return;
    }

    if (!customer.trim()) {
      alert("Customer is required.");
      return;
    }

    setSaving(true);
    setError("");

    const { data: currentTrailer, error: currentTrailerError } = await supabase
      .from("trailers")
      .select("id, trailer_number, load_status, customer, consignee, container_number, load_description, notes")
      .eq("id", selectedTrailer.id)
      .single();

    if (currentTrailerError || !currentTrailer) {
      setSaving(false);
      const message = currentTrailerError?.message || "Unable to load current trailer state before loading.";
      setError(message);
      alert(message);
      return;
    }

    const updatePayload = {
      load_status: "Loaded",
      customer: customer.trim(),
      consignee: consignee.trim() || null,
      container_number: containerNumber.trim() || null,
      load_description: loadDescription.trim() || null,
      notes: notes.trim() || null,
    };

    const { data, error } = await supabase
      .from("trailers")
      .update(updatePayload)
      .eq("id", selectedTrailer.id)
      .select();

    setSaving(false);

    if (error) {
      setError(error.message);
      alert(error.message);
      return;
    }

    if (!data || data.length === 0) {
      alert("No trailer was updated.");
      return;
    }

    const { error: eventError } = await supabase.from("trailer_events").insert({
      trailer_id: currentTrailer.id,
      trailer_number: currentTrailer.trailer_number,
      event_type: "trailer_loaded",
      event_description: "Trailer marked as loaded.",
      old_value: {
        load_status: currentTrailer.load_status ?? null,
        customer: currentTrailer.customer ?? null,
        consignee: currentTrailer.consignee ?? null,
        container_number: currentTrailer.container_number ?? null,
        load_description: currentTrailer.load_description ?? null,
        notes: currentTrailer.notes ?? null,
      },
      new_value: {
        load_status: updatePayload.load_status,
        customer: updatePayload.customer,
        consignee: updatePayload.consignee,
        container_number: updatePayload.container_number,
        load_description: updatePayload.load_description,
        notes: updatePayload.notes,
      },
    });

    if (eventError) {
      console.error("Load update saved but trailer event creation failed:", eventError);
      alert("Trailer updated, but history event could not be recorded.");
    }

    const operatorName = await resolveAuditOperatorName();
    await logTrailerEvent({
      trailerId: currentTrailer.id,
      trailerNumber: currentTrailer.trailer_number,
      eventType: "load_status_changed",
      description: "Trailer marked as loaded.",
      previousValue: {
        load_status: currentTrailer.load_status ?? null,
        customer: currentTrailer.customer ?? null,
        consignee: currentTrailer.consignee ?? null,
        container_number: currentTrailer.container_number ?? null,
        load_description: currentTrailer.load_description ?? null,
        notes: currentTrailer.notes ?? null,
      },
      newValue: {
        load_status: updatePayload.load_status,
        customer: updatePayload.customer,
        consignee: updatePayload.consignee,
        container_number: updatePayload.container_number,
        load_description: updatePayload.load_description,
        notes: updatePayload.notes,
      },
      sourceModule: "compound",
      performedBy: operatorName,
    });

    router.push("/dashboard?saved=1");
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900 p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">
            Ferryspeed TrailerHub
          </p>
          <h1 className="mt-2 text-3xl font-bold">Load Trailer</h1>
          <p className="mt-2 text-slate-300">
            Select an empty trailer in the compound and assign it to a customer/load.
          </p>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-3xl border border-white/10 bg-slate-900 p-5">
            <h2 className="text-lg font-semibold">Empty trailers available</h2>

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search trailer or position..."
              className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 outline-none"
            />

            <div className="mt-4 space-y-3">
              {loading ? (
                <p className="text-slate-400">Loading empty trailers...</p>
              ) : filteredTrailers.length === 0 ? (
                <p className="text-slate-400">No empty trailers available.</p>
              ) : (
                filteredTrailers.map((trailer) => (
                  <button
                    key={trailer.id}
                    type="button"
                    onClick={() => setSelectedId(trailer.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      selectedId === trailer.id
                        ? "border-cyan-400 bg-cyan-500/10"
                        : "border-white/10 bg-slate-950 hover:bg-slate-800"
                    }`}
                  >
                    <p className="font-semibold">{trailer.trailer_number}</p>
                    <p className="text-sm text-slate-400">
                      Position: {trailer.compound_position ?? "—"}
                    </p>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-900 p-5">
            <h2 className="text-lg font-semibold">Load details</h2>

            {selectedTrailer ? (
              <p className="mt-2 text-sm text-cyan-300">
                Selected: {selectedTrailer.trailer_number} — {selectedTrailer.compound_position ?? "No position"}
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-400">Select a trailer first.</p>
            )}

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <input
                value={customer}
                onChange={(event) => setCustomer(event.target.value)}
                placeholder="Customer"
                className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 outline-none"
              />

              <input
                value={consignee}
                onChange={(event) => setConsignee(event.target.value)}
                placeholder="Consignee"
                className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 outline-none"
              />

              <input
                value={containerNumber}
                onChange={(event) => setContainerNumber(event.target.value)}
                placeholder="Container number"
                className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 outline-none"
              />

              <textarea
                value={loadDescription}
                onChange={(event) => setLoadDescription(event.target.value)}
                placeholder="Load description"
                className="min-h-24 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 outline-none"
              />

              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Notes"
                className="min-h-20 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 outline-none"
              />

              <button
                type="submit"
                disabled={saving || !selectedTrailer}
                className="w-full rounded-2xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Mark as Loaded"}
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}