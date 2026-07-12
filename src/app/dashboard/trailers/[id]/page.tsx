"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Trailer = {
  id: string;
  trailer_number?: string | null;
  trailer_type?: string | null;
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

type TrailerEvent = {
  id: string;
  trailer_id?: string | null;
  trailer_number?: string | null;
  event_type?: string | null;
  event_description?: string | null;
  old_value?: unknown;
  new_value?: unknown;
  created_at?: string | null;
  created_by?: string | null;
};

type TrailerForm = Pick<
  Trailer,
  | "trailer_number"
  | "trailer_type"
  | "compound_position"
  | "load_status"
  | "operational_status"
  | "customer"
  | "consignee"
  | "container_number"
  | "load_description"
  | "notes"
>;

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

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

const formatValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "—";
  }

  if (typeof value === "string") {
    return value.trim() || "—";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "—";
    }
  }

  return String(value);
};

const normalizeDisplayValue = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "No value";
};

const getSupabaseErrorMessage = (error: { message?: string; details?: string; hint?: string; code?: string } | null | undefined) => {
  return [error?.message, error?.details, error?.hint, error?.code ? `Code: ${error.code}` : ""]
    .filter(Boolean)
    .join(" — ");
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

const trailerTypes = ["Dry Van", "Reefer", "Flatbed", "Tank", "Container"];

export default function TrailerDetailsPage() {
  const params = useParams();
  const rawTrailerNumber = params?.id && typeof params.id === "string" ? decodeURIComponent(params.id) : undefined;
  const trailerNumber = rawTrailerNumber?.replace(/\s+/g, " ").trim();
  const identifierError = trailerNumber ? null : "Unable to identify trailer from the URL.";
  const [trailer, setTrailer] = useState<Trailer | null>(null);
  const [events, setEvents] = useState<TrailerEvent[]>([]);
  const [formState, setFormState] = useState<TrailerForm>({
    trailer_number: null,
    trailer_type: null,
    compound_position: null,
    load_status: null,
    operational_status: null,
    customer: null,
    consignee: null,
    container_number: null,
    load_description: null,
    notes: null,
  });
  const [originalForm, setOriginalForm] = useState<TrailerForm | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(trailerNumber));
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(identifierError);

  useEffect(() => {
    if (!trailerNumber) {
      return;
    }

    const loadTrailer = async () => {
      setIsLoading(true);
      setError(null);
      setSuccessMessage(null);

      try {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trailerNumber);

        let trailerRecord: Trailer | null = null;

        if (isUuid) {
          const { data, error: trailerError } = await supabase
            .from("trailers")
            .select(
              "id, trailer_number, trailer_type, compound_position, load_status, operational_status, customer, consignee, container_number, load_description, notes, arrival_date, departure_date, delivered_at, returned_empty_at"
            )
            .eq("id", trailerNumber)
            .maybeSingle();

          if (trailerError) {
            throw new Error(getSupabaseErrorMessage(trailerError) || "Unable to load trailer details.");
          }

          trailerRecord = (data as Trailer | null) ?? null;
        } else {
          const value = trailerNumber ?? "";
          const exactSearch = value;
          const wildcardSearch = `%${value}%`;

          const { data: exactData, error: exactError } = await supabase
            .from("trailers")
            .select(
              "id, trailer_number, trailer_type, compound_position, load_status, operational_status, customer, consignee, container_number, load_description, notes, arrival_date, departure_date, delivered_at, returned_empty_at"
            )
            .ilike("trailer_number", exactSearch)
            .order("departure_date", { ascending: true, nullsFirst: true })
            .order("arrival_date", { ascending: false })
            .limit(1);

          if (exactError) {
            throw new Error(getSupabaseErrorMessage(exactError) || "Unable to load trailer details.");
          }

          trailerRecord = ((exactData ?? []) as Trailer[])[0] ?? null;

          if (!trailerRecord) {
            const { data: wildcardData, error: wildcardError } = await supabase
              .from("trailers")
              .select(
                "id, trailer_number, trailer_type, compound_position, load_status, operational_status, customer, consignee, container_number, load_description, notes, arrival_date, departure_date, delivered_at, returned_empty_at"
              )
              .ilike("trailer_number", wildcardSearch)
              .order("departure_date", { ascending: true, nullsFirst: true })
              .order("arrival_date", { ascending: false })
              .limit(1);

            if (wildcardError) {
              throw new Error(getSupabaseErrorMessage(wildcardError) || "Unable to load trailer details.");
            }

            trailerRecord = ((wildcardData ?? []) as Trailer[])[0] ?? null;
          }
        }

        if (!trailerRecord) {
          setTrailer(null);
          setEvents([]);
          setError("Trailer not found.");
          return;
        }

        const { data: eventData, error: eventError } = await supabase
          .from("trailer_events")
          .select("id, trailer_id, trailer_number, event_type, event_description, old_value, new_value, created_at, created_by")
          .eq("trailer_id", trailerRecord.id)
          .order("created_at", { ascending: false });

        if (eventError) {
          throw new Error(getSupabaseErrorMessage(eventError) || "Unable to load trailer history.");
        }

        setTrailer(trailerRecord);
        setEvents((eventData ?? []) as TrailerEvent[]);
        const initialForm: TrailerForm = {
          trailer_number: trailerRecord.trailer_number ?? null,
          trailer_type: trailerRecord.trailer_type ?? null,
          compound_position: trailerRecord.compound_position ?? null,
          load_status: trailerRecord.load_status ?? null,
          operational_status: trailerRecord.operational_status ?? null,
          customer: trailerRecord.customer ?? null,
          consignee: trailerRecord.consignee ?? null,
          container_number: trailerRecord.container_number ?? null,
          load_description: trailerRecord.load_description ?? null,
          notes: trailerRecord.notes ?? null,
        };
        setFormState(initialForm);
        setOriginalForm(initialForm);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to load trailer details.";
        setTrailer(null);
        setEvents([]);
        setError(message);
      } finally {
        setIsLoading(false);
      }
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

  const refreshTrailerData = async (id: string) => {
    const { data, error } = await supabase
      .from("trailers")
      .select(
        "id, trailer_number, trailer_type, compound_position, load_status, operational_status, customer, consignee, container_number, load_description, notes, arrival_date, departure_date, delivered_at, returned_empty_at"
      )
      .eq("id", id)
      .single();

    if (error) {
      setError(error.message || "Unable to refresh trailer details.");
      return null;
    }

    return data as Trailer;
  };

  const refreshEvents = async (trailerId: string) => {
    const { data: refreshedEvents, error: refreshedEventsError } = await supabase
      .from("trailer_events")
      .select("id, trailer_id, trailer_number, event_type, event_description, old_value, new_value, created_at, created_by")
      .eq("trailer_id", trailerId)
      .order("created_at", { ascending: false });

    if (!refreshedEventsError) {
      setEvents((refreshedEvents ?? []) as TrailerEvent[]);
    }
  };

  const applyOperationalAction = async (action: string) => {
    if (!trailer) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    const oldValue = {
      id: trailer.id,
      trailer_number: trailer.trailer_number,
      compound_position: trailer.compound_position,
      load_status: trailer.load_status,
      operational_status: trailer.operational_status,
      customer: trailer.customer,
      consignee: trailer.consignee,
      container_number: trailer.container_number,
      load_description: trailer.load_description,
      notes: trailer.notes,
      arrival_date: trailer.arrival_date,
      departure_date: trailer.departure_date,
      delivered_at: trailer.delivered_at,
      returned_empty_at: trailer.returned_empty_at,
    };

    const now = new Date().toISOString();
    let updatePayload: Partial<Trailer> = {};
    let eventDescription = "";

    switch (action) {
      case "Mark Empty":
        updatePayload = {
          load_status: "Empty",
          customer: null,
          consignee: null,
          container_number: null,
          load_description: null,
          operational_status: "In Compound",
        };
        eventDescription = "Trailer marked empty and returned to compound.";
        break;
      case "Mark On Delivery":
        updatePayload = {
          operational_status: "On Delivery",
        };
        eventDescription = "Trailer marked as on delivery.";
        break;
      case "Mark Delivered":
        updatePayload = {
          operational_status: "Delivered",
          delivered_at: now,
        };
        eventDescription = "Trailer marked as delivered.";
        break;
      case "Return Empty":
        updatePayload = {
          operational_status: "Returned Empty",
          returned_empty_at: now,
          load_status: "Empty",
        };
        eventDescription = "Trailer marked returned empty.";
        break;
      default:
        setIsSaving(false);
        return;
    }

    const { error: updateError } = await supabase.from("trailers").update(updatePayload).eq("id", trailer.id);

    if (updateError) {
      setError(updateError.message || "Unable to update trailer.");
      setIsSaving(false);
      return;
    }

    const newValue = {
      ...oldValue,
      ...updatePayload,
    };

    const { error: eventError } = await supabase.from("trailer_events").insert({
      trailer_id: trailer.id,
      trailer_number: trailer.trailer_number ?? trailerNumber,
      event_type: action,
      event_description: eventDescription,
      old_value: oldValue,
      new_value: newValue,
    });

    if (eventError) {
      console.error("Failed to insert trailer event:", eventError);
    }

    const refreshedTrailer = await refreshTrailerData(trailer.id);
    if (refreshedTrailer) {
      setTrailer(refreshedTrailer);
      const refreshedForm: TrailerForm = {
        trailer_number: refreshedTrailer.trailer_number ?? null,
        trailer_type: refreshedTrailer.trailer_type ?? null,
        compound_position: refreshedTrailer.compound_position ?? null,
        load_status: refreshedTrailer.load_status ?? null,
        operational_status: refreshedTrailer.operational_status ?? null,
        customer: refreshedTrailer.customer ?? null,
        consignee: refreshedTrailer.consignee ?? null,
        container_number: refreshedTrailer.container_number ?? null,
        load_description: refreshedTrailer.load_description ?? null,
        notes: refreshedTrailer.notes ?? null,
      };
      setFormState(refreshedForm);
      setOriginalForm(refreshedForm);
      await refreshEvents(trailer.id);
    }

    setSuccessMessage(`${action} completed successfully.`);
    setIsSaving(false);
  };

  const handleAction = (label: string) => {
    if (["Mark Empty", "Mark On Delivery", "Mark Delivered", "Return Empty"].includes(label)) {
      void applyOperationalAction(label);
      return;
    }

    console.log(`Action triggered: ${label}`);
    window.alert(`Placeholder: ${label}`);
  };

  const handleFieldChange = (field: keyof TrailerForm, value: string) => {
    setFormState((current) => ({ ...current, [field]: value }));
  };

  const handleSave = async () => {
    if (!trailer) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const originalValues = {
        trailer_type: trailer.trailer_type ?? null,
        load_status: trailer.load_status ?? null,
        load_description: trailer.load_description ?? null,
        customer: trailer.customer ?? null,
        consignee: trailer.consignee ?? null,
        container_number: trailer.container_number ?? null,
        compound_position: trailer.compound_position ?? null,
        operational_status: trailer.operational_status ?? null,
        notes: trailer.notes ?? null,
      };

      const updatePayload = {
        trailer_type: formState.trailer_type,
        compound_position: formState.compound_position,
        load_status: formState.load_status,
        operational_status: formState.operational_status,
        customer: formState.customer,
        consignee: formState.consignee,
        container_number: formState.container_number,
        load_description: formState.load_description,
        notes: formState.notes,
      };

      const { data: updatedTrailer, error: updateError } = await supabase
        .from("trailers")
        .update(updatePayload)
        .eq("id", trailer.id)
        .select("id, trailer_number, trailer_type, compound_position, load_status, operational_status, customer, consignee, container_number, load_description, notes, arrival_date, departure_date, delivered_at, returned_empty_at")
        .single();

      if (updateError) {
        setError(getSupabaseErrorMessage(updateError) || "Unable to save trailer updates.");
        return;
      }

      const updatedValues = {
        trailer_type: updatedTrailer?.trailer_type ?? null,
        load_status: updatedTrailer?.load_status ?? null,
        load_description: updatedTrailer?.load_description ?? null,
        customer: updatedTrailer?.customer ?? null,
        consignee: updatedTrailer?.consignee ?? null,
        container_number: updatedTrailer?.container_number ?? null,
        compound_position: updatedTrailer?.compound_position ?? null,
        operational_status: updatedTrailer?.operational_status ?? null,
        notes: updatedTrailer?.notes ?? null,
      };

      const changeMessages: string[] = [];

      (Object.keys(updatePayload) as Array<keyof typeof updatePayload>).forEach((field) => {
        const previousValue = originalValues[field];
        const nextValue = updatedValues[field];

        if (String(previousValue ?? "") !== String(nextValue ?? "")) {
          const fromValue = normalizeDisplayValue(previousValue as string | null);
          const toValue = normalizeDisplayValue(nextValue as string | null);

          switch (field) {
            case "load_status":
              changeMessages.push(`Load status changed from ${fromValue} to ${toValue}.`);
              break;
            case "compound_position":
              changeMessages.push(`Compound position changed from ${fromValue} to ${toValue}.`);
              break;
            case "customer":
              changeMessages.push(`Customer changed from ${fromValue} to ${toValue}.`);
              break;
            case "consignee":
              changeMessages.push(`Consignee changed from ${fromValue} to ${toValue}.`);
              break;
            case "container_number":
              changeMessages.push(`Container number changed from ${fromValue} to ${toValue}.`);
              break;
            case "load_description":
              changeMessages.push(`Load description changed from ${fromValue} to ${toValue}.`);
              break;
            case "notes":
              changeMessages.push(`Notes changed from ${fromValue} to ${toValue}.`);
              break;
            case "trailer_type":
              changeMessages.push(`Trailer type changed from ${fromValue} to ${toValue}.`);
              break;
            case "operational_status":
              changeMessages.push(`Operational status changed from ${fromValue} to ${toValue}.`);
              break;
            default:
              break;
          }
        }
      });

      const { error: eventError } = await supabase.from("trailer_events").insert({
        trailer_id: trailer.id,
        trailer_number: trailer.trailer_number ?? trailerNumber,
        event_type: "trailer_updated",
        event_description: changeMessages.length > 0 ? changeMessages.join(" ") : "Trailer details updated",
        old_value: originalValues,
        new_value: updatedValues,
      });

      if (eventError) {
        console.error("Failed to insert trailer event:", eventError);
      }

      setSuccessMessage("Trailer changes saved successfully.");
      const refreshedTrailer = updatedTrailer as Trailer;
      setTrailer(refreshedTrailer);
      const refreshedForm: TrailerForm = {
        trailer_number: refreshedTrailer.trailer_number ?? null,
        trailer_type: refreshedTrailer.trailer_type ?? null,
        compound_position: refreshedTrailer.compound_position ?? null,
        load_status: refreshedTrailer.load_status ?? null,
        operational_status: refreshedTrailer.operational_status ?? null,
        customer: refreshedTrailer.customer ?? null,
        consignee: refreshedTrailer.consignee ?? null,
        container_number: refreshedTrailer.container_number ?? null,
        load_description: refreshedTrailer.load_description ?? null,
        notes: refreshedTrailer.notes ?? null,
      };
      setFormState(refreshedForm);
      setOriginalForm(refreshedForm);
      await refreshEvents(trailer.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to save trailer updates.";
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (!originalForm) {
      return;
    }

    setFormState(originalForm);
    setSuccessMessage(null);
    setError(null);
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
            {successMessage ? (
              <section className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-sm text-emerald-200">
                {successMessage}
              </section>
            ) : null}
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
                    <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Edit trailer</p>
                    <h3 className="mt-2 text-2xl font-semibold text-white">Trailer information</h3>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-3xl bg-slate-950/80 p-4">
                    <label className="text-sm uppercase tracking-[0.24em] text-slate-400">Trailer type</label>
                    <select
                      value={formState.trailer_type ?? ""}
                      onChange={(event) => handleFieldChange("trailer_type", event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-200 outline-none"
                    >
                      <option value="">Select type</option>
                      {trailerTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-3xl bg-slate-950/80 p-4">
                    <label className="text-sm uppercase tracking-[0.24em] text-slate-400">Trailer number</label>
                    <input
                      value={formState.trailer_number ?? ""}
                      disabled
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-200 outline-none disabled:cursor-not-allowed disabled:bg-slate-950"
                    />
                  </div>

                  <div className="rounded-3xl bg-slate-950/80 p-4">
                    <label className="text-sm uppercase tracking-[0.24em] text-slate-400">Compound position</label>
                    <input
                      value={formState.compound_position ?? ""}
                      onChange={(event) => handleFieldChange("compound_position", event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-200 outline-none"
                      placeholder="e.g. P01"
                    />
                  </div>

                  <div className="rounded-3xl bg-slate-950/80 p-4">
                    <label className="text-sm uppercase tracking-[0.24em] text-slate-400">Load status</label>
                    <input
                      value={formState.load_status ?? ""}
                      onChange={(event) => handleFieldChange("load_status", event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-200 outline-none"
                      placeholder="Empty / Loaded"
                    />
                  </div>

                  <div className="rounded-3xl bg-slate-950/80 p-4">
                    <label className="text-sm uppercase tracking-[0.24em] text-slate-400">Operational status</label>
                    <select
                      value={formState.operational_status ?? ""}
                      onChange={(event) => handleFieldChange("operational_status", event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-200 outline-none"
                    >
                      <option value="">Select status</option>
                      <option value="In Compound">In Compound</option>
                      <option value="Ready for Departure">Ready for Departure</option>
                      <option value="Departed">Departed</option>
                      <option value="On Delivery">On Delivery</option>
                      <option value="Delivered">Delivered</option>
                      <option value="Returned Empty">Returned Empty</option>
                    </select>
                  </div>

                  <div className="rounded-3xl bg-slate-950/80 p-4">
                    <label className="text-sm uppercase tracking-[0.24em] text-slate-400">Customer</label>
                    <input
                      value={formState.customer ?? ""}
                      onChange={(event) => handleFieldChange("customer", event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-200 outline-none"
                      placeholder="Customer name"
                    />
                  </div>

                  <div className="rounded-3xl bg-slate-950/80 p-4">
                    <label className="text-sm uppercase tracking-[0.24em] text-slate-400">Consignee</label>
                    <input
                      value={formState.consignee ?? ""}
                      onChange={(event) => handleFieldChange("consignee", event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-200 outline-none"
                      placeholder="Consignee name"
                    />
                  </div>

                  <div className="rounded-3xl bg-slate-950/80 p-4">
                    <label className="text-sm uppercase tracking-[0.24em] text-slate-400">Container number</label>
                    <input
                      value={formState.container_number ?? ""}
                      onChange={(event) => handleFieldChange("container_number", event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-200 outline-none"
                      placeholder="Container ID"
                    />
                  </div>

                  <div className="sm:col-span-2 rounded-3xl bg-slate-950/80 p-4">
                    <label className="text-sm uppercase tracking-[0.24em] text-slate-400">Load description</label>
                    <textarea
                      value={formState.load_description ?? ""}
                      onChange={(event) => handleFieldChange("load_description", event.target.value)}
                      className="mt-2 min-h-[120px] w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-200 outline-none resize-none"
                      placeholder="Describe the load"
                    />
                  </div>

                  <div className="sm:col-span-2 rounded-3xl bg-slate-950/80 p-4">
                    <label className="text-sm uppercase tracking-[0.24em] text-slate-400">Notes</label>
                    <textarea
                      value={formState.notes ?? ""}
                      onChange={(event) => handleFieldChange("notes", event.target.value)}
                      className="mt-2 min-h-[120px] w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-200 outline-none resize-none"
                      placeholder="Additional remarks"
                    />
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="rounded-2xl border border-white/10 bg-slate-800 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:border-cyan-400 hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
                  >
                    {isSaving ? "Saving..." : "Save Changes"}
                  </button>
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
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Movement history</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">Chronological timeline</h3>
                </div>
                <span className="rounded-full border border-white/10 bg-slate-950/80 px-3 py-1 text-sm text-slate-300">
                  {events.length} event{events.length === 1 ? "" : "s"}
                </span>
              </div>

              {events.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-slate-950/80 p-5 text-sm text-slate-400">
                  No history is available for this trailer yet.
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  {events.map((event) => (
                    <div key={event.id} className="flex gap-4 rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                      <div className="flex flex-col items-center">
                        <div className="mt-1 h-3 w-3 rounded-full bg-cyan-400" />
                        <div className="mt-2 h-full w-px bg-slate-700" />
                      </div>

                      <div className="flex-1">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">{event.event_type ?? "Event"}</p>
                            <p className="mt-1 text-base font-semibold text-white">{event.event_description ?? "History entry"}</p>
                          </div>
                          <p className="text-sm text-slate-400">{formatDateTime(event.created_at)}</p>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-400">
                          {event.trailer_number ? <span className="rounded-full border border-white/10 bg-slate-900/70 px-2.5 py-1">Trailer: {event.trailer_number}</span> : null}
                          {event.old_value !== undefined ? <span className="rounded-full border border-white/10 bg-slate-900/70 px-2.5 py-1">Previous: {formatValue(event.old_value)}</span> : null}
                          {event.new_value !== undefined ? <span className="rounded-full border border-white/10 bg-slate-900/70 px-2.5 py-1">New: {formatValue(event.new_value)}</span> : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

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

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/dashboard"
                  className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  Back to Dashboard
                </Link>
                <Link
                  href={`/dashboard/edit-trailer?trailerId=${trailer.id}`}
                  className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20"
                >
                  Edit Trailer Page
                </Link>
              </div>
            </section>
          </section>
        )}
      </div>
    </main>
  );
}
