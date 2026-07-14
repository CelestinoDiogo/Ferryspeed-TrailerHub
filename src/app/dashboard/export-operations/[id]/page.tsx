"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { Database } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import {
  EXPORT_ACTIVE_STATUS_QUERY_VALUES,
  getAdvanceStatusActionLabel,
  getExportAllocationPriorityClasses,
  getExportAllocationPriorityLabel,
  getExportAllocationStatusClasses,
  getExportAllocationStatusLabel,
  getExportAllocationTimestampField,
  getNextExportAllocationStatus,
  isExportAllocationOverdue,
  isTrailerAvailableForExportAllocation,
  normalizeExportAllocationRecord,
  type ExportAllocationPriority,
  type ExportAllocationRecord,
  type ExportAllocationStatus,
} from "@/lib/export-allocation";

type TrailerOption = {
  id: string;
  trailer_number?: string | null;
  load_status?: string | null;
  departure_date?: string | null;
  compound_position?: string | null;
  trailer_source?: string | null;
  is_local?: boolean | null;
  operational_status?: string | null;
  customer?: string | null;
  load_description?: string | null;
};

type EditableFields = {
  trailer_id: string;
  customer: string;
  collection_address: string;
  haulier: string;
  booking_reference: string;
  load_type: string;
  collection_date: string;
  collection_time: string;
  expected_return_at: string;
  priority: ExportAllocationPriority;
  notes: string;
};

const STATUS_TIMELINE: ExportAllocationStatus[] = [
  "allocated",
  "delivered_empty",
  "waiting_loading",
  "collected_loaded",
  "completed",
];

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "-";
  }
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
};

const toDateTimeLocalValue = (iso?: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const formatTrailerOption = (trailer: TrailerOption) => {
  const ownership = trailer.trailer_source === "outsourced" ? "Outsourced" : "Ferryspeed";
  const location = trailer.is_local ? "Local" : "Compound";
  const position = trailer.is_local ? "" : trailer.compound_position?.trim() ? ` - Position ${trailer.compound_position.trim()}` : " - Position Unassigned";
  return `${trailer.trailer_number ?? "Unknown"} - ${ownership} - ${location}${position}`;
};

function ExportAllocationDetailsContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const allocationId = typeof params?.id === "string" ? params.id : "";
  const editMode = searchParams.get("edit") === "1";

  const [allocation, setAllocation] = useState<ExportAllocationRecord | null>(null);
  const [formState, setFormState] = useState<EditableFields | null>(null);
  const [availableTrailers, setAvailableTrailers] = useState<TrailerOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadAllocation = useCallback(async () => {
    if (!allocationId) {
      setError("Invalid export allocation id.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: loadError } = await supabase
        .from("export_allocations")
        .select(
          "id, trailer_id, trailer_number, customer, collection_address, haulier, booking_reference, load_type, collection_date, collection_time, expected_return_at, priority, status, notes, allocated_at, delivered_empty_at, waiting_loading_at, collected_loaded_at, completed_at, cancelled_at, collected_by_haulier_at, loading_started_at, loaded_at, returned_at, shipped_at, created_at, updated_at",
        )
        .eq("id", allocationId)
        .single();

      if (loadError || !data) {
        throw new Error(loadError?.message || "Unable to load export allocation.");
      }

      const row = normalizeExportAllocationRecord(data as ExportAllocationRecord);
      setAllocation(row);
      setFormState({
        trailer_id: row.trailer_id,
        customer: row.customer ?? "",
        collection_address: row.collection_address ?? "",
        haulier: row.haulier ?? "",
        booking_reference: row.booking_reference ?? "",
        load_type: row.load_type ?? "",
        collection_date: row.collection_date ?? "",
        collection_time: row.collection_time ?? "",
        expected_return_at: toDateTimeLocalValue(row.expected_return_at),
        priority: row.priority,
        notes: row.notes ?? "",
      });
    } catch (loadErr) {
      setError(loadErr instanceof Error ? loadErr.message : "Unable to load export allocation.");
    } finally {
      setIsLoading(false);
    }
  }, [allocationId]);

  const loadTrailerChoices = useCallback(async (currentTrailerId: string) => {
    try {
      const activeStatuses = [...EXPORT_ACTIVE_STATUS_QUERY_VALUES];
      const [{ data: trailerData, error: trailerError }, { data: activeAllocations, error: allocationsError }] = await Promise.all([
        supabase
          .from("trailers")
          .select("id, trailer_number, load_status, departure_date, compound_position, trailer_source, is_local, operational_status")
          .is("departure_date", null)
          .order("trailer_number", { ascending: true }),
        supabase
          .from("export_allocations")
          .select("trailer_id, status")
          .in("status", activeStatuses),
      ]);

      if (trailerError || allocationsError) {
        throw trailerError || allocationsError;
      }

      const activeTrailerIds = new Set<string>();
      (activeAllocations ?? []).forEach((row) => {
        const trailerId = (row as { trailer_id?: string | null }).trailer_id;
        if (trailerId && trailerId !== currentTrailerId) {
          activeTrailerIds.add(trailerId);
        }
      });

      const trailers = (trailerData ?? []) as TrailerOption[];
      const filtered = trailers
        .filter((trailer) => trailer.id === currentTrailerId || isTrailerAvailableForExportAllocation(trailer, activeTrailerIds.has(trailer.id)))
        .sort((a, b) => (a.trailer_number ?? "").localeCompare(b.trailer_number ?? ""));

      setAvailableTrailers(filtered);
    } catch (trailerErr) {
      console.error("Unable to load trailer options for edit:", trailerErr);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAllocation();
  }, [loadAllocation]);

  useEffect(() => {
    if (!allocation || allocation.status !== "allocated" || !editMode) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTrailerChoices(allocation.trailer_id);
  }, [allocation, editMode, loadTrailerChoices]);

  const handleFieldChange = <K extends keyof EditableFields>(field: K, value: EditableFields[K]) => {
    setFormState((current) => (current ? { ...current, [field]: value } : current));
  };

  const updateTrailerWhenLoaded = async (row: ExportAllocationRecord) => {
    const { data: trailerData, error: trailerError } = await supabase
      .from("trailers")
      .select("id, trailer_number, load_status, customer, load_description")
      .eq("id", row.trailer_id)
      .single();

    if (trailerError || !trailerData) {
      throw new Error(trailerError?.message || "Unable to load trailer before marking allocation loaded.");
    }

    const trailer = trailerData as TrailerOption;
    const oldValue = {
      load_status: trailer.load_status ?? null,
      customer: trailer.customer ?? null,
      load_description: trailer.load_description ?? null,
    };

    const updatePayload = {
      load_status: "Loaded",
      customer: row.customer?.trim() ? row.customer.trim() : trailer.customer ?? null,
      load_description: row.load_type?.trim() ? row.load_type.trim() : trailer.load_description ?? null,
    };

    const hasChange =
      (trailer.load_status ?? null) !== updatePayload.load_status ||
      (trailer.customer ?? null) !== updatePayload.customer ||
      (trailer.load_description ?? null) !== updatePayload.load_description;

    if (!hasChange) {
      return;
    }

    const { error: updateError } = await supabase.from("trailers").update(updatePayload).eq("id", row.trailer_id);
    if (updateError) {
      throw new Error(updateError.message || "Unable to update trailer load data.");
    }

    const { error: eventError } = await supabase.from("trailer_events").insert({
      trailer_id: row.trailer_id,
      trailer_number: row.trailer_number,
      event_type: "trailer_loaded",
      event_description: "Loaded trailer collected from customer via export allocation.",
      old_value: oldValue,
      new_value: {
        load_status: updatePayload.load_status,
        customer: updatePayload.customer,
        load_description: updatePayload.load_description,
      },
    });

    if (eventError) {
      console.error("Failed to create trailer_loaded event:", eventError);
    }
  };

  const createStatusEvent = async (
    row: ExportAllocationRecord,
    oldStatus: ExportAllocationStatus,
    newStatus: ExportAllocationStatus,
  ) => {
    const customer = row.customer?.trim() ? row.customer.trim() : "customer";
    let eventType = "export_allocation_status_changed";
    let eventDescription = `Export allocation status changed from ${getExportAllocationStatusLabel(oldStatus)} to ${getExportAllocationStatusLabel(newStatus)}.`;

    if (newStatus === "delivered_empty") {
      eventDescription = `Empty trailer delivered to ${customer}.`;
    } else if (newStatus === "waiting_loading") {
      eventDescription = `Trailer waiting for loading at ${customer}.`;
    } else if (newStatus === "collected_loaded") {
      eventDescription = `Loaded trailer collected from ${customer}.`;
    } else if (newStatus === "completed") {
      eventType = "export_allocation_completed";
      eventDescription = "Export allocation completed.";
    } else if (newStatus === "cancelled") {
      eventType = "export_allocation_cancelled";
      eventDescription = "Export allocation cancelled.";
    }

    const { error: eventError } = await supabase.from("trailer_events").insert({
      trailer_id: row.trailer_id,
      trailer_number: row.trailer_number,
      event_type: eventType,
      event_description: eventDescription,
      old_value: {
        export_allocation_id: row.id,
        status: oldStatus,
      },
      new_value: {
        export_allocation_id: row.id,
        status: newStatus,
      },
    });

    if (eventError) {
      console.error("Failed to create export_allocation_status_changed event:", eventError);
    }
  };

  const handleAdvance = async () => {
    if (!allocation) {
      return;
    }

    const next = getNextExportAllocationStatus(allocation.status);
    if (!next) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (next === "collected_loaded") {
        await updateTrailerWhenLoaded(allocation);
      }

      const nowIso = new Date().toISOString();
      const timestampField = getExportAllocationTimestampField(next);
      const updatePayload: Database["public"]["Tables"]["export_allocations"]["Update"] = {
        status: next,
        updated_at: nowIso,
      };

      if (timestampField) {
        updatePayload[timestampField] = nowIso;
      }

      const { error: updateError } = await supabase
        .from("export_allocations")
        .update(updatePayload)
        .eq("id", allocation.id);

      if (updateError) {
        throw new Error(updateError.message || "Unable to update status.");
      }

      await createStatusEvent(allocation, allocation.status, next);
      setSuccess(`Status updated to ${getExportAllocationStatusLabel(next)}.`);
      await loadAllocation();
    } catch (advanceErr) {
      setError(advanceErr instanceof Error ? advanceErr.message : "Unable to advance status.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!allocation || allocation.status === "completed" || allocation.status === "cancelled") {
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const nowIso = new Date().toISOString();
      const { error: cancelError } = await supabase
        .from("export_allocations")
        .update({
          status: "cancelled",
          cancelled_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", allocation.id);

      if (cancelError) {
        throw new Error(cancelError.message || "Unable to cancel allocation.");
      }

      await createStatusEvent(allocation, allocation.status, "cancelled");
      setSuccess("Allocation cancelled.");
      await loadAllocation();
    } catch (cancelErr) {
      setError(cancelErr instanceof Error ? cancelErr.message : "Unable to cancel allocation.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!allocation || !formState) {
      return;
    }

    if (!formState.customer.trim() || !formState.collection_date) {
      setError("Customer and Collection Date are required.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      let trailerNumber = allocation.trailer_number ?? null;
      if (allocation.status !== "allocated" && formState.trailer_id !== allocation.trailer_id) {
        throw new Error("Trailer cannot be changed after status progressed beyond allocated.");
      }

      if (formState.trailer_id !== allocation.trailer_id) {
        const activeStatuses = [...EXPORT_ACTIVE_STATUS_QUERY_VALUES];
        const [{ data: trailerData, error: trailerError }, { data: activeForTrailer, error: activeError }] = await Promise.all([
          supabase
            .from("trailers")
            .select("id, trailer_number, load_status, departure_date, compound_position, trailer_source, is_local, operational_status")
            .eq("id", formState.trailer_id)
            .single(),
          supabase
            .from("export_allocations")
            .select("id")
            .eq("trailer_id", formState.trailer_id)
            .neq("id", allocation.id)
            .in("status", activeStatuses)
            .limit(1),
        ]);

        if (trailerError || !trailerData) {
          throw new Error(trailerError?.message || "Unable to validate selected trailer.");
        }

        if (activeError) {
          throw new Error(activeError.message || "Unable to validate selected trailer.");
        }

        const hasActive = (activeForTrailer ?? []).length > 0;
        const trailer = trailerData as TrailerOption;

        if (!isTrailerAvailableForExportAllocation(trailer, hasActive)) {
          throw new Error("This trailer is no longer available for allocation.");
        }

        trailerNumber = trailer.trailer_number ?? null;
      }

      const updatePayload = {
        trailer_id: formState.trailer_id,
        trailer_number: trailerNumber,
        customer: formState.customer.trim(),
        collection_address: formState.collection_address.trim() || null,
        haulier: formState.haulier.trim() || null,
        booking_reference: formState.booking_reference.trim() || null,
        load_type: formState.load_type.trim() || null,
        collection_date: formState.collection_date,
        collection_time: formState.collection_time || null,
        expected_return_at: formState.expected_return_at ? new Date(formState.expected_return_at).toISOString() : null,
        priority: formState.priority,
        notes: formState.notes.trim() || null,
        updated_at: new Date().toISOString(),
      };

      const oldValue = {
        trailer_id: allocation.trailer_id,
        trailer_number: allocation.trailer_number,
        customer: allocation.customer ?? null,
        collection_address: allocation.collection_address ?? null,
        haulier: allocation.haulier ?? null,
        booking_reference: allocation.booking_reference ?? null,
        load_type: allocation.load_type ?? null,
        collection_date: allocation.collection_date ?? null,
        collection_time: allocation.collection_time ?? null,
        expected_return_at: allocation.expected_return_at ?? null,
        priority: allocation.priority,
        notes: allocation.notes ?? null,
      };

      const { error: updateError } = await supabase
        .from("export_allocations")
        .update(updatePayload)
        .eq("id", allocation.id);

      if (updateError) {
        throw new Error(updateError.message || "Unable to update allocation.");
      }

      const { error: eventError } = await supabase.from("trailer_events").insert({
        trailer_id: updatePayload.trailer_id,
        trailer_number: updatePayload.trailer_number,
        event_type: "export_allocation_updated",
        event_description: "Export allocation details updated.",
        old_value: oldValue,
        new_value: {
          trailer_id: updatePayload.trailer_id,
          trailer_number: updatePayload.trailer_number,
          customer: updatePayload.customer,
          collection_address: updatePayload.collection_address,
          haulier: updatePayload.haulier,
          booking_reference: updatePayload.booking_reference,
          load_type: updatePayload.load_type,
          collection_date: updatePayload.collection_date,
          collection_time: updatePayload.collection_time,
          expected_return_at: updatePayload.expected_return_at,
          priority: updatePayload.priority,
          notes: updatePayload.notes,
        },
      });

      if (eventError) {
        console.error("Failed to create export_allocation_updated event:", eventError);
      }

      setSuccess("Export allocation updated successfully.");
      await loadAllocation();
    } catch (saveErr) {
      setError(saveErr instanceof Error ? saveErr.message : "Unable to save changes.");
    } finally {
      setIsSaving(false);
    }
  };

  const reachedStatuses = useMemo(() => {
    if (!allocation) {
      return new Set<ExportAllocationStatus>();
    }

    const currentIndex = STATUS_TIMELINE.indexOf(allocation.status === "cancelled" ? "allocated" : allocation.status);
    return new Set(STATUS_TIMELINE.filter((_, index) => index <= currentIndex));
  }, [allocation]);

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">Loading export allocation...</div>
      </main>
    );
  }

  if (!allocation || !formState) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-rose-500/30 bg-rose-500/10 p-6 text-sm text-rose-200">{error ?? "Export allocation not found."}</div>
      </main>
    );
  }

  const nextActionLabel = getAdvanceStatusActionLabel(allocation.status);
  const canCancel = allocation.status !== "completed" && allocation.status !== "cancelled";
  const overdue = isExportAllocationOverdue(allocation);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Export Allocation Details</h1>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">Track allocation lifecycle and update export operation details.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/export-operations" className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                Back
              </Link>
              <Link
                href={editMode ? `/dashboard/export-operations/${allocation.id}` : `/dashboard/export-operations/${allocation.id}?edit=1`}
                className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20"
              >
                {editMode ? "View Mode" : "Edit"}
              </Link>
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
        ) : null}

        {success ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>
        ) : null}

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getExportAllocationStatusClasses(allocation.status)}`}>
              {getExportAllocationStatusLabel(allocation.status)}
            </span>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getExportAllocationPriorityClasses(allocation.priority)}`}>
              {getExportAllocationPriorityLabel(allocation.priority)}
            </span>
            {overdue ? (
              <span className="rounded-full border border-rose-500/40 bg-rose-500/20 px-3 py-1 text-xs font-semibold text-rose-100">Overdue</span>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Trailer</p>
              <p className="mt-1 font-semibold text-white">{allocation.trailer_number ?? "-"}</p>
              <Link href={`/dashboard/trailers/${allocation.trailer_number ?? allocation.trailer_id}`} className="mt-1 inline-block text-xs text-cyan-200 underline hover:text-cyan-100">
                Open Trailer
              </Link>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Customer</p>
              <p className="mt-1">{allocation.customer ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Collection Date</p>
              <p className="mt-1">{formatDate(allocation.collection_date)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Collection Time</p>
              <p className="mt-1">{allocation.collection_time ?? "-"}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {nextActionLabel ? (
              <button
                type="button"
                onClick={() => void handleAdvance()}
                disabled={isSaving}
                className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-60"
              >
                {isSaving ? "Updating..." : nextActionLabel}
              </button>
            ) : null}
            {canCancel ? (
              <button
                type="button"
                onClick={() => void handleCancel()}
                disabled={isSaving}
                className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-60"
              >
                {isSaving ? "Cancelling..." : "Cancel Allocation"}
              </button>
            ) : null}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Status Timeline</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            {STATUS_TIMELINE.map((status) => {
              const reached = reachedStatuses.has(status);
              const active = allocation.status === status;
              return (
                <div
                  key={status}
                  className={`rounded-2xl border px-3 py-3 text-center text-xs font-semibold uppercase tracking-[0.16em] ${
                    active
                      ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-100"
                      : reached
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                        : "border-white/10 bg-slate-950/60 text-slate-500"
                  }`}
                >
                  {getExportAllocationStatusLabel(status)}
                </div>
              );
            })}
          </div>
          {allocation.status === "cancelled" ? (
            <p className="mt-3 text-xs text-rose-200">This allocation was cancelled and is outside the regular progression timeline.</p>
          ) : null}
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <h2 className="text-lg font-semibold text-white">Allocation Details</h2>

          {editMode ? (
            <form onSubmit={handleSaveEdit} className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-200">Trailer</label>
                {allocation.status === "allocated" ? (
                  <select
                    value={formState.trailer_id}
                    onChange={(event) => handleFieldChange("trailer_id", event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                  >
                    {availableTrailers.map((trailer) => (
                      <option key={trailer.id} value={trailer.id}>
                        {formatTrailerOption(trailer)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={allocation.trailer_number ?? "-"}
                    readOnly
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-400 outline-none"
                  />
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-200">Customer *</label>
                <input
                  value={formState.customer}
                  onChange={(event) => handleFieldChange("customer", event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-200">Collection Address</label>
                <input
                  value={formState.collection_address}
                  onChange={(event) => handleFieldChange("collection_address", event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-200">Haulier</label>
                <input
                  value={formState.haulier}
                  onChange={(event) => handleFieldChange("haulier", event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-200">Booking Reference</label>
                <input
                  value={formState.booking_reference}
                  onChange={(event) => handleFieldChange("booking_reference", event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-200">Load Type</label>
                <input
                  value={formState.load_type}
                  onChange={(event) => handleFieldChange("load_type", event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-200">Collection Date *</label>
                <input
                  type="date"
                  value={formState.collection_date}
                  onChange={(event) => handleFieldChange("collection_date", event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-200">Collection Time</label>
                <input
                  type="time"
                  value={formState.collection_time}
                  onChange={(event) => handleFieldChange("collection_time", event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-200">Expected Return</label>
                <input
                  type="datetime-local"
                  value={formState.expected_return_at}
                  onChange={(event) => handleFieldChange("expected_return_at", event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-200">Priority</label>
                <select
                  value={formState.priority}
                  onChange={(event) => handleFieldChange("priority", event.target.value as ExportAllocationPriority)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-medium text-slate-200">Notes</label>
                <textarea
                  rows={4}
                  value={formState.notes}
                  onChange={(event) => handleFieldChange("notes", event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                />
              </div>

              <div className="md:col-span-2 flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                >
                  {isSaving ? "Saving..." : "Save Changes"}
                </button>
                <Link href={`/dashboard/export-operations/${allocation.id}`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                  Cancel
                </Link>
              </div>
            </form>
          ) : (
            <dl className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Collection Address</dt>
                <dd className="mt-1">{allocation.collection_address ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Haulier</dt>
                <dd className="mt-1">{allocation.haulier ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Booking Reference</dt>
                <dd className="mt-1">{allocation.booking_reference ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Load Type</dt>
                <dd className="mt-1">{allocation.load_type ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Expected Return</dt>
                <dd className="mt-1">{formatDateTime(allocation.expected_return_at)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Allocated At</dt>
                <dd className="mt-1">{formatDateTime(allocation.allocated_at)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Updated At</dt>
                <dd className="mt-1">{formatDateTime(allocation.updated_at)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Cancelled At</dt>
                <dd className="mt-1">{formatDateTime(allocation.cancelled_at)}</dd>
              </div>
              <div className="sm:col-span-2 xl:col-span-4">
                <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Notes</dt>
                <dd className="mt-1">{allocation.notes?.trim() ? allocation.notes : "-"}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <h2 className="text-lg font-semibold text-white">Status Timestamps</h2>
          <div className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-3">
            <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Allocated</p><p className="mt-1">{formatDateTime(allocation.allocated_at)}</p></div>
            <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Delivered Empty</p><p className="mt-1">{formatDateTime(allocation.delivered_empty_at ?? allocation.collected_by_haulier_at)}</p></div>
            <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Waiting Loading</p><p className="mt-1">{formatDateTime(allocation.waiting_loading_at ?? allocation.loading_started_at)}</p></div>
            <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Collected Loaded</p><p className="mt-1">{formatDateTime(allocation.collected_loaded_at ?? allocation.loaded_at)}</p></div>
            <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Completed</p><p className="mt-1">{formatDateTime(allocation.completed_at ?? allocation.returned_at ?? allocation.shipped_at)}</p></div>
            <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Cancelled</p><p className="mt-1">{formatDateTime(allocation.cancelled_at)}</p></div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function ExportAllocationDetailsPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">Loading export allocation details...</div>
        </main>
      }
    >
      <ExportAllocationDetailsContent />
    </Suspense>
  );
}
