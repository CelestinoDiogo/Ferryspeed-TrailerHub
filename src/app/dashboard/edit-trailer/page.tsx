"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  notes?: string | null;
  departure_date?: string | null;
  trailer_source?: "company" | "outsourced" | null;
  external_company?: string | null;
  external_reference?: string | null;
  is_local?: boolean | null;
};

type TrailerFormValues = {
  trailerType: string;
  loadStatus: string;
  loadDescription: string;
  customer: string;
  consignee: string;
  containerNumber: string;
  compoundPosition: string;
  notes: string;
  trailerSource: "company" | "outsourced";
  externalCompany: string;
  externalReference: string;
  isLocal: boolean;
};

const trailerTypes = ["Dry Van", "Reefer", "Flatbed", "Tank", "Container"];

const initialFormValues: TrailerFormValues = {
  trailerType: "Dry Van",
  loadStatus: "Empty",
  loadDescription: "",
  customer: "",
  consignee: "",
  containerNumber: "",
  compoundPosition: "",
  notes: "",
  trailerSource: "company",
  externalCompany: "",
  externalReference: "",
  isLocal: false,
};

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

const isActiveTrailer = (trailer: TrailerRecord) => {
  const departureDate = trailer.departure_date;
  return departureDate === null || departureDate === undefined || departureDate === "";
};

const getCompoundPositionState = async (currentTrailerId?: string) => {
  const query = supabase
    .from("trailers")
    .select("id, compound_position")
    .is("departure_date", null)
    .neq("is_local", true);

  const { data, error } = currentTrailerId ? await query.neq("id", currentTrailerId) : await query;

  if (error) {
    throw error;
  }

  const occupiedPositions = new Set<string>();
  (data ?? []).forEach((item) => {
    const normalizedPosition = normalizeCompoundPosition(item.compound_position as string | null | undefined);
    if (normalizedPosition) {
      occupiedPositions.add(normalizedPosition);
    }
  });

  const firstAvailable = Array.from({ length: 50 }, (_, index) => `P${String(index + 1).padStart(2, "0")}`).find(
    (position) => !occupiedPositions.has(position),
  );

  return { occupiedPositions, firstAvailable };
};

export default function EditTrailerPage() {
  const [trailers, setTrailers] = useState<TrailerRecord[]>([]);
  const [selectedTrailerId, setSelectedTrailerId] = useState("");
  const [requestedTrailerId, setRequestedTrailerId] = useState<string | null>(null);
  const [requestedAction, setRequestedAction] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<TrailerFormValues>(initialFormValues);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const idFromQuery = params.get("id") || params.get("trailerId");
    const actionFromQuery = params.get("action");

    setRequestedTrailerId(idFromQuery);
    setRequestedAction(actionFromQuery);
  }, []);

  useEffect(() => {
    const loadTrailers = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error: supabaseError } = await supabase
          .from("trailers")
          .select("id, trailer_number, trailer_type, load_status, load_description, customer, consignee, container_number, compound_position, notes, departure_date, trailer_source, external_company, external_reference, is_local")
          .is("departure_date", null)
          .order("trailer_number", { ascending: true });

        if (supabaseError) {
          throw supabaseError;
        }

        const availableTrailers = ((data ?? []) as TrailerRecord[])
          .filter(isActiveTrailer)
          .sort((left, right) => {
            const leftNumber = left.trailer_number?.trim().toLowerCase() ?? "";
            const rightNumber = right.trailer_number?.trim().toLowerCase() ?? "";
            return leftNumber.localeCompare(rightNumber);
          });

        setTrailers(availableTrailers);
        if (availableTrailers.length > 0) {
          const requestedTrailer = requestedTrailerId
            ? availableTrailers.find((trailer) => trailer.id === requestedTrailerId)
            : null;
          const initialTrailer = requestedTrailer ?? availableTrailers[0];
          setSelectedTrailerId((current) => current || initialTrailer.id);
          setFormValues({
            trailerType: initialTrailer.trailer_type?.trim() || "Dry Van",
            loadStatus: initialTrailer.load_status?.trim() || "Empty",
            loadDescription: initialTrailer.load_description ?? "",
            customer: initialTrailer.customer ?? "",
            consignee: initialTrailer.consignee ?? "",
            containerNumber: initialTrailer.container_number ?? "",
            compoundPosition: initialTrailer.compound_position ?? "",
            notes: initialTrailer.notes ?? "",
            trailerSource: initialTrailer.trailer_source === "outsourced" ? "outsourced" : "company",
            externalCompany: initialTrailer.external_company ?? "",
            externalReference: initialTrailer.external_reference ?? "",
            isLocal: initialTrailer.is_local === true,
          });

          if (requestedAction === "move_to_compound") {
            setFormValues((current) => ({ ...current, isLocal: false }));
            setNotice("Move to compound requested. Please assign or confirm a compound position and save.");
          }
        } else {
          setSelectedTrailerId("");
          setFormValues(initialFormValues);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to load active trailers.";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    void loadTrailers();
  }, [requestedAction, requestedTrailerId]);

  const applyTrailerToForm = (trailerId: string) => {
    const trailer = trailers.find((item) => item.id === trailerId) ?? null;
    if (!trailer) {
      return;
    }

    setFormValues({
      trailerType: trailer.trailer_type?.trim() || "Dry Van",
      loadStatus: trailer.load_status?.trim() || "Empty",
      loadDescription: trailer.load_description ?? "",
      customer: trailer.customer ?? "",
      consignee: trailer.consignee ?? "",
      containerNumber: trailer.container_number ?? "",
      compoundPosition: trailer.compound_position ?? "",
      notes: trailer.notes ?? "",
      trailerSource: trailer.trailer_source === "outsourced" ? "outsourced" : "company",
      externalCompany: trailer.external_company ?? "",
      externalReference: trailer.external_reference ?? "",
      isLocal: trailer.is_local === true,
    });
  };

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selectedTrailer = useMemo(
    () => trailers.find((trailer) => trailer.id === selectedTrailerId) ?? null,
    [selectedTrailerId, trailers]
  );

  const handleChange = (field: keyof TrailerFormValues, value: string | boolean) => {
    setFormValues((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedTrailer) {
      setError("Select a trailer before saving changes.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      const { data: currentTrailerSnapshot, error: currentTrailerError } = await supabase
        .from("trailers")
        .select("id, trailer_number, trailer_type, load_status, load_description, customer, consignee, container_number, compound_position, notes, trailer_source, external_company, external_reference, is_local")
        .eq("id", selectedTrailer.id)
        .single();

      if (currentTrailerError || !currentTrailerSnapshot) {
        setError(currentTrailerError?.message || "Unable to load current trailer state before save.");
        return;
      }

      if (formValues.trailerSource === "outsourced" && !formValues.externalCompany.trim()) {
        setError("External Company is required for outsourced trailers.");
        return;
      }

      const normalizedPosition = normalizeCompoundPosition(formValues.compoundPosition);
      const targetIsLocal = formValues.isLocal === true;
      let finalPosition = normalizedPosition;
      let hasPositionConflict = false;

      if (!targetIsLocal && !finalPosition) {
        const { firstAvailable } = await getCompoundPositionState(selectedTrailer.id);
        if (!firstAvailable) {
          setError("No compound positions available for this trailer.");
          return;
        }

        finalPosition = firstAvailable;
      }

      if (!targetIsLocal && finalPosition) {
        const { data: occupiedTrailers, error: positionError } = await supabase
          .from("trailers")
          .select("id, trailer_number, compound_position")
          .is("departure_date", null)
          .neq("is_local", true)
          .eq("compound_position", finalPosition)
          .neq("id", selectedTrailer.id)
          .limit(1);

        if (positionError) {
          console.error("Compound position validation error:", {
            message: positionError.message,
            details: positionError.details,
            hint: positionError.hint,
            code: positionError.code,
          });

          throw new Error(
            [
              positionError.message,
              positionError.details,
              positionError.hint,
              positionError.code ? `Code: ${positionError.code}` : "",
            ]
              .filter(Boolean)
              .join(" — ")
          );
        }

        hasPositionConflict = (occupiedTrailers ?? []).length > 0;
      }

      if (hasPositionConflict) {
        const message = `Compound position ${finalPosition} is already occupied by another active trailer.`;
        setError(message);
        return;
      }

      const updatePayload = {
        trailer_type: formValues.trailerType.trim() || null,
        load_status: formValues.loadStatus.trim() || null,
        load_description: formValues.loadDescription.trim() || null,
        customer: formValues.customer.trim() || null,
        consignee: formValues.consignee.trim() || null,
        container_number: formValues.containerNumber.trim() || null,
        compound_position: targetIsLocal ? null : finalPosition,
        notes: formValues.notes.trim() || null,
        trailer_source: formValues.trailerSource,
        external_company: formValues.trailerSource === "outsourced" ? formValues.externalCompany.trim() || null : null,
        external_reference: formValues.trailerSource === "outsourced" ? formValues.externalReference.trim() || null : null,
        is_local: targetIsLocal,
      };

      const { data, error: updateError } = await supabase
        .from("trailers")
        .update(updatePayload)
        .eq("id", selectedTrailer.id)
        .select()
        .single();

      if (updateError) {
        console.error("Supabase update error:", {
          message: updateError.message,
          details: updateError.details,
          hint: updateError.hint,
          code: updateError.code,
        });

        setError(
          [
            updateError.message,
            updateError.details,
            updateError.hint,
            updateError.code ? `Code: ${updateError.code}` : "",
          ]
            .filter(Boolean)
            .join(" — ")
        );

        return;
      }

      const eventInserts: Array<{
        trailer_id: string;
        trailer_number: string | null;
        event_type: string;
        event_description: string;
        old_value: Record<string, unknown>;
        new_value: Record<string, unknown>;
      }> = [];

      eventInserts.push({
        trailer_id: selectedTrailer.id,
        trailer_number: selectedTrailer.trailer_number ?? null,
        event_type: "trailer_updated",
        event_description: "Trailer details updated.",
        old_value: {
          trailer_type: currentTrailerSnapshot.trailer_type ?? null,
          load_status: currentTrailerSnapshot.load_status ?? null,
          load_description: currentTrailerSnapshot.load_description ?? null,
          customer: currentTrailerSnapshot.customer ?? null,
          consignee: currentTrailerSnapshot.consignee ?? null,
          container_number: currentTrailerSnapshot.container_number ?? null,
          compound_position: currentTrailerSnapshot.compound_position ?? null,
          notes: currentTrailerSnapshot.notes ?? null,
          trailer_source: currentTrailerSnapshot.trailer_source ?? "company",
          external_company: currentTrailerSnapshot.external_company ?? null,
          external_reference: currentTrailerSnapshot.external_reference ?? null,
          is_local: currentTrailerSnapshot.is_local === true,
        },
        new_value: {
          trailer_type: updatePayload.trailer_type,
          load_status: updatePayload.load_status,
          load_description: updatePayload.load_description,
          customer: updatePayload.customer,
          consignee: updatePayload.consignee,
          container_number: updatePayload.container_number,
          compound_position: updatePayload.compound_position,
          notes: updatePayload.notes,
          trailer_source: updatePayload.trailer_source,
          external_company: updatePayload.external_company,
          external_reference: updatePayload.external_reference,
          is_local: updatePayload.is_local,
        },
      });

      if ((currentTrailerSnapshot.trailer_source ?? "company") !== updatePayload.trailer_source) {
        eventInserts.push({
          trailer_id: selectedTrailer.id,
          trailer_number: selectedTrailer.trailer_number ?? null,
          event_type: "trailer_source_changed",
          event_description: "Trailer ownership source updated.",
          old_value: { trailer_source: currentTrailerSnapshot.trailer_source ?? "company" },
          new_value: { trailer_source: updatePayload.trailer_source },
        });
      }

      if ((currentTrailerSnapshot.is_local === true) !== (updatePayload.is_local === true)) {
        eventInserts.push({
          trailer_id: selectedTrailer.id,
          trailer_number: selectedTrailer.trailer_number ?? null,
          event_type: "trailer_location_changed",
          event_description: "Trailer location type updated between compound and local.",
          old_value: { is_local: currentTrailerSnapshot.is_local === true },
          new_value: { is_local: updatePayload.is_local === true },
        });
      }

      if ((currentTrailerSnapshot.external_company ?? "") !== (updatePayload.external_company ?? "")) {
        eventInserts.push({
          trailer_id: selectedTrailer.id,
          trailer_number: selectedTrailer.trailer_number ?? null,
          event_type: "external_company_changed",
          event_description: "External company assignment updated.",
          old_value: { external_company: currentTrailerSnapshot.external_company ?? null },
          new_value: { external_company: updatePayload.external_company ?? null },
        });
      }

      if ((currentTrailerSnapshot.compound_position ?? "") !== (updatePayload.compound_position ?? "")) {
        eventInserts.push({
          trailer_id: selectedTrailer.id,
          trailer_number: selectedTrailer.trailer_number ?? null,
          event_type: "compound_position_changed",
          event_description: "Compound position updated.",
          old_value: { compound_position: currentTrailerSnapshot.compound_position ?? null },
          new_value: { compound_position: updatePayload.compound_position ?? null },
        });
      }

      if (eventInserts.length > 0) {
        const { error: eventError } = await supabase.from("trailer_events").insert(eventInserts);
        if (eventError) {
          console.error("Failed to save edit trailer events:", eventError);
        }
      }

      setTrailers((current) =>
        current.map((trailer) => (trailer.id === selectedTrailer.id ? { ...trailer, ...(data as TrailerRecord) } : trailer))
      );
      const savedTrailer = data as TrailerRecord;
      setFormValues({
        trailerType: savedTrailer.trailer_type?.trim() || "Dry Van",
        loadStatus: savedTrailer.load_status?.trim() || "Empty",
        loadDescription: savedTrailer.load_description ?? "",
        customer: savedTrailer.customer ?? "",
        consignee: savedTrailer.consignee ?? "",
        containerNumber: savedTrailer.container_number ?? "",
        compoundPosition: savedTrailer.compound_position ?? "",
        notes: savedTrailer.notes ?? "",
        trailerSource: savedTrailer.trailer_source === "outsourced" ? "outsourced" : "company",
        externalCompany: savedTrailer.external_company ?? "",
        externalReference: savedTrailer.external_reference ?? "",
        isLocal: savedTrailer.is_local === true,
      });
      setNotice("Trailer updated successfully.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update the trailer.";
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Edit Trailer</h1>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">
                Update an active trailer&apos;s details without changing the database layout.
              </p>
            </div>
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-slate-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              Back to Dashboard
            </Link>
          </div>
        </header>

        {notice ? (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {notice}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <label className="mb-2 block text-sm font-medium text-slate-200">Select active trailer</label>
          {isLoading ? (
            <p className="text-sm text-slate-400">Loading active trailers...</p>
          ) : trailers.length === 0 ? (
            <p className="text-sm text-slate-400">No active trailers are available for editing right now.</p>
          ) : (
            <select
              value={selectedTrailerId}
              onChange={(event) => {
                const trailerId = event.target.value;
                setSelectedTrailerId(trailerId);
                applyTrailerToForm(trailerId);
              }}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
            >
              {trailers.map((trailer) => (
                <option key={trailer.id} value={trailer.id}>
                  {trailer.trailer_number ?? "Unnamed trailer"}
                </option>
              ))}
            </select>
          )}

          {selectedTrailer ? (
            <p className="mt-3 text-sm text-cyan-300">
              Editing {selectedTrailer.trailer_number ?? "selected trailer"}. Update the fields below and save when ready.
            </p>
          ) : null}
        </section>

        <form
          onSubmit={handleSubmit}
          className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-black/20 backdrop-blur sm:p-6"
        >
          <section className="mb-5 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <p className="text-sm font-semibold text-white">Trailer Ownership</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleChange("trailerSource", "company")}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                  formValues.trailerSource === "company"
                    ? "bg-cyan-500 text-slate-950"
                    : "border border-white/10 bg-slate-900 text-slate-200 hover:bg-slate-800"
                }`}
              >
                Ferryspeed Fleet
              </button>
              <button
                type="button"
                onClick={() => handleChange("trailerSource", "outsourced")}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                  formValues.trailerSource === "outsourced"
                    ? "bg-cyan-500 text-slate-950"
                    : "border border-white/10 bg-slate-900 text-slate-200 hover:bg-slate-800"
                }`}
              >
                Outsourced / External
              </button>
            </div>
          </section>

          <section className="mb-5 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <p className="text-sm font-semibold text-white">Trailer Location</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleChange("isLocal", false)}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                  !formValues.isLocal
                    ? "bg-cyan-500 text-slate-950"
                    : "border border-white/10 bg-slate-900 text-slate-200 hover:bg-slate-800"
                }`}
              >
                Compound Trailer
              </button>
              <button
                type="button"
                onClick={() => {
                  handleChange("isLocal", true);
                  handleChange("compoundPosition", "");
                }}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                  formValues.isLocal
                    ? "bg-cyan-500 text-slate-950"
                    : "border border-white/10 bg-slate-900 text-slate-200 hover:bg-slate-800"
                }`}
              >
                Local Trailer
              </button>
            </div>
            {formValues.isLocal ? (
              <p className="mt-3 text-sm text-indigo-200">
                Local trailers do not occupy a compound position and are excluded from compound occupancy.
              </p>
            ) : null}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Trailer Type</label>
              <select
                value={formValues.trailerType}
                onChange={(event) => handleChange("trailerType", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
              >
                {trailerTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Load Status</label>
              <select
                value={formValues.loadStatus}
                onChange={(event) => handleChange("loadStatus", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
              >
                <option value="Empty">Empty</option>
                <option value="Loaded">Loaded</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-200">Load Description</label>
              <input
                value={formValues.loadDescription}
                onChange={(event) => handleChange("loadDescription", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Describe the load"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Customer</label>
              <input
                value={formValues.customer}
                onChange={(event) => handleChange("customer", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Customer"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Consignee</label>
              <input
                value={formValues.consignee}
                onChange={(event) => handleChange("consignee", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Consignee"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Container Number</label>
              <input
                value={formValues.containerNumber}
                onChange={(event) => handleChange("containerNumber", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Container number"
              />
            </div>

            {formValues.trailerSource === "outsourced" ? (
              <>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">External Company *</label>
                  <input
                    value={formValues.externalCompany}
                    onChange={(event) => handleChange("externalCompany", event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    placeholder="External company"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">External Reference</label>
                  <input
                    value={formValues.externalReference}
                    onChange={(event) => handleChange("externalReference", event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    placeholder="Optional reference"
                  />
                </div>
              </>
            ) : null}

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Compound Position</label>
              <input
                value={formValues.compoundPosition}
                onChange={(event) => handleChange("compoundPosition", event.target.value)}
                disabled={formValues.isLocal}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="P01"
              />
              <p className="mt-2 text-sm text-slate-400">
                {formValues.isLocal
                  ? "Local trailer selected. Compound position will be cleared on save."
                  : "Use a value like P01 to P50. Occupied positions are blocked. If left empty, first available position is assigned."}
              </p>
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-200">Notes</label>
              <textarea
                value={formValues.notes}
                onChange={(event) => handleChange("notes", event.target.value)}
                className="min-h-24 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Internal notes"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSaving || !selectedTrailer}
            className="mt-6 w-full rounded-2xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? "Saving changes..." : "Save Changes"}
          </button>
        </form>
      </div>
    </main>
  );
}
