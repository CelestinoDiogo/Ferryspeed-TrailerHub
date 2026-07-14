"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  computeVesselOperationSummary,
  formatVesselDateTime,
  getVesselOperationStatusClass,
  getVesselOperationStatusLabel,
  getVesselPriorityClass,
  getVesselPriorityLabel,
  getVesselTrailerStatusClass,
  getVesselTrailerStatusLabel,
  logVesselSupabaseError,
  normalizeTrailerNumber,
  sortVesselOperationTrailersForArrivals,
  type VesselOperationRecord,
  type VesselOperationTrailerRecord,
  type VesselPriorityLevel,
  type VesselTrailerStatus,
} from "@/lib/vessel-operations";

type TrailerFormState = {
  trailerNumber: string;
  customer: string;
  bookingReference: string;
  loadStatus: string;
  temperatureRequired: string;
  priorityLevel: VesselPriorityLevel;
  notes: string;
};

const initialTrailerForm: TrailerFormState = {
  trailerNumber: "",
  customer: "",
  bookingReference: "",
  loadStatus: "",
  temperatureRequired: "",
  priorityLevel: "normal",
  notes: "",
};

const isListEditable = (status?: string | null) => status === "draft" || status === "reopened";

function VesselOperationDetailsPageContent() {
  const params = useParams();
  const operationId = typeof params?.id === "string" ? params.id : "";

  const [operation, setOperation] = useState<VesselOperationRecord | null>(null);
  const [trailers, setTrailers] = useState<VesselOperationTrailerRecord[]>([]);
  const [formState, setFormState] = useState<TrailerFormState>(initialTrailerForm);
  const [bulkText, setBulkText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [actioningTrailerId, setActioningTrailerId] = useState<string | null>(null);
  const [isChangingListState, setIsChangingListState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadOperation = useCallback(async () => {
    if (!operationId) {
      setError("Invalid vessel operation id.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [operationResult, trailersResult] = await Promise.all([
        supabase
          .from("vessel_operations")
          .select("id, vessel_name, sailing_reference, origin_port, berth, expected_arrival_at, actual_arrival_at, status, list_status, list_confirmed_at, list_confirmed_by, notes, created_at, updated_at")
          .eq("id", operationId)
          .single(),
        supabase
          .from("vessel_operation_trailers")
          .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, load_description, temperature_required, priority_level, priority_reason, planned_destination, planning_notes, status, arrived_at, arrival_status, arrival_confirmed_at, arrival_record_id, arrival_confirmed_by, inspection_started_at, inspection_completed_at, position_assigned_at, assigned_position, has_damage, has_temperature_alert, created_at, updated_at")
          .eq("vessel_operation_id", operationId)
          .order("created_at", { ascending: true }),
      ]);

      if (operationResult.error || !operationResult.data) {
        logVesselSupabaseError("Load vessel operation failed", operationResult.error);
        throw operationResult.error ?? new Error("Unable to load vessel operation.");
      }

      if (trailersResult.error) {
        logVesselSupabaseError("Load vessel operation trailers failed", trailersResult.error);
        throw trailersResult.error;
      }

      setOperation(operationResult.data as VesselOperationRecord);
      setTrailers(sortVesselOperationTrailersForArrivals((trailersResult.data ?? []) as VesselOperationTrailerRecord[]));
    } catch (loadErr) {
      console.error("Unable to load vessel operation:", loadErr);
      setError("Unable to load vessel operation.");
    } finally {
      setIsLoading(false);
    }
  }, [operationId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadOperation();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadOperation]);

  const summary = useMemo(() => computeVesselOperationSummary(trailers), [trailers]);
  const sortedTrailers = useMemo(() => sortVesselOperationTrailersForArrivals(trailers), [trailers]);
  const editable = isListEditable(operation?.list_status ?? "draft");

  const handleFieldChange = <K extends keyof TrailerFormState>(field: K, value: TrailerFormState[K]) => {
    setFormState((current) => ({ ...current, [field]: value }));
  };

  const existingTrailerNumbers = useMemo(
    () => new Set(trailers.map((item) => normalizeTrailerNumber(item.trailer_number))),
    [trailers],
  );

  const insertTrailers = async (
    rows: Array<{
      trailer_number: string;
      customer?: string | null;
      booking_reference?: string | null;
      load_status?: string | null;
      temperature_required?: string | null;
      priority_level: VesselPriorityLevel;
      notes?: string | null;
    }>,
  ) => {
    if (!operation) return;

    const nowIso = new Date().toISOString();
    const payload = rows.map((row) => ({
      vessel_operation_id: operation.id,
      trailer_number: row.trailer_number,
      customer: row.customer ?? null,
      booking_reference: row.booking_reference ?? null,
      load_status: row.load_status ?? null,
      temperature_required: row.temperature_required ?? null,
      priority_level: row.priority_level,
      status: "expected" as VesselTrailerStatus,
      arrival_status: "expected",
      planning_notes: row.notes ?? null,
      created_at: nowIso,
      updated_at: nowIso,
    }));

    const { error: insertError } = await supabase.from("vessel_operation_trailers").insert(payload);
    if (insertError) {
      logVesselSupabaseError("Insert vessel trailers failed", insertError);
      throw insertError;
    }

    for (const row of payload) {
      const { error: eventError } = await supabase.from("trailer_events").insert({
        trailer_id: null,
        trailer_number: row.trailer_number,
        event_type: "vessel_trailer_planned",
        event_description: `Trailer planned for vessel ${operation.vessel_name ?? "operation"}.`,
        old_value: null,
        new_value: row,
      });

      if (eventError) {
        logVesselSupabaseError("Insert vessel trailer event failed", eventError);
      }
    }
  };

  const handleAddSingleTrailer = async () => {
    if (!editable) {
      setError("List is confirmed. Reopen list to edit trailers.");
      return;
    }

    const trailerNumber = normalizeTrailerNumber(formState.trailerNumber);
    if (!trailerNumber) {
      setError("Trailer number is required.");
      return;
    }

    if (existingTrailerNumbers.has(trailerNumber)) {
      setError(`Trailer ${trailerNumber} already exists in this vessel operation.`);
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await insertTrailers([
        {
          trailer_number: trailerNumber,
          customer: formState.customer.trim() || null,
          booking_reference: formState.bookingReference.trim() || null,
          load_status: formState.loadStatus.trim() || null,
          temperature_required: formState.temperatureRequired.trim() || null,
          priority_level: formState.priorityLevel,
          notes: formState.notes.trim() || null,
        },
      ]);

      setFormState(initialTrailerForm);
      setSuccess("Trailer added to vessel operation.");
      await loadOperation();
    } catch (saveErr) {
      console.error("Unable to add trailer:", saveErr);
      setError("Unable to add trailer.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleBulkAdd = async () => {
    if (!editable) {
      setError("List is confirmed. Reopen list to edit trailers.");
      return;
    }

    const trailerNumbers = bulkText
      .split(/\r?\n/)
      .map((line) => normalizeTrailerNumber(line))
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index);

    const newTrailerNumbers = trailerNumbers.filter((value) => !existingTrailerNumbers.has(value));

    if (newTrailerNumbers.length === 0) {
      setError("No new trailer numbers found in the bulk list.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await insertTrailers(newTrailerNumbers.map((trailerNumber) => ({ trailer_number: trailerNumber, priority_level: "normal" as VesselPriorityLevel })));
      setBulkText("");
      setSuccess(`${newTrailerNumbers.length} trailer${newTrailerNumbers.length === 1 ? "" : "s"} added.`);
      await loadOperation();
    } catch (saveErr) {
      console.error("Unable to add bulk trailer list:", saveErr);
      setError("Unable to add bulk trailer list.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTogglePriority = async (trailer: VesselOperationTrailerRecord) => {
    if (!editable) {
      setError("List is confirmed. Reopen list to edit trailers.");
      return;
    }

    setActioningTrailerId(trailer.id);
    setError(null);

    try {
      const nextPriorityLevel: VesselPriorityLevel = trailer.priority_level === "priority" ? "normal" : "priority";
      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("vessel_operation_trailers")
        .update({
          priority_level: nextPriorityLevel,
          updated_at: nowIso,
        })
        .eq("id", trailer.id);

      if (updateError) {
        logVesselSupabaseError("Update vessel trailer priority failed", updateError);
        throw updateError;
      }

      await loadOperation();
      setSuccess(`Trailer ${trailer.trailer_number ?? ""} priority updated.`);
    } catch (priorityErr) {
      console.error("Unable to update trailer priority:", priorityErr);
      setError("Unable to update trailer priority.");
    } finally {
      setActioningTrailerId(null);
    }
  };

  const handleRemoveTrailer = async (trailer: VesselOperationTrailerRecord) => {
    if (!editable) {
      setError("List is confirmed. Reopen list to edit trailers.");
      return;
    }

    const isArrived = trailer.arrival_status === "arrived" || Boolean(trailer.arrival_record_id);
    if (isArrived) {
      setError("Arrived trailers cannot be removed. Mark as Not Discharged or Cancelled if required.");
      return;
    }

    const confirmed = window.confirm(`Remove trailer ${trailer.trailer_number ?? ""} from this vessel operation?`);
    if (!confirmed) return;

    setActioningTrailerId(trailer.id);
    setError(null);

    try {
      const { error: deleteError } = await supabase.from("vessel_operation_trailers").delete().eq("id", trailer.id);
      if (deleteError) {
        logVesselSupabaseError("Delete vessel trailer failed", deleteError);
        throw deleteError;
      }

      await loadOperation();
      setSuccess(`Trailer ${trailer.trailer_number ?? ""} removed.`);
    } catch (deleteErr) {
      console.error("Unable to remove trailer:", deleteErr);
      setError("Unable to remove trailer.");
    } finally {
      setActioningTrailerId(null);
    }
  };

  const handleConfirmList = async () => {
    if (!operation) return;

    const confirmed = window.confirm("Confirm vessel list and make expected trailers available in Arrivals?");
    if (!confirmed) return;

    setIsChangingListState(true);
    setError(null);
    setSuccess(null);

    try {
      const { error: rpcError } = await supabase.rpc("confirm_vessel_operation_list", {
        p_vessel_operation_id: operation.id,
        p_confirmed_by: "TrailerHub User",
      });

      if (rpcError) {
        throw rpcError;
      }

      setSuccess("Vessel list confirmed. Expected trailers are now available in Arrivals.");
      await loadOperation();
    } catch (listErr) {
      console.error("Unable to confirm vessel list:", listErr);
      setError(listErr instanceof Error ? listErr.message : "Unable to confirm vessel list.");
    } finally {
      setIsChangingListState(false);
    }
  };

  const handleReopenList = async () => {
    if (!operation) return;

    const confirmed = window.confirm("Reopen vessel list? Unreceived trailers will move back to Expected and can be edited.");
    if (!confirmed) return;

    setIsChangingListState(true);
    setError(null);
    setSuccess(null);

    try {
      const { error: rpcError } = await supabase.rpc("reopen_vessel_operation_list", {
        p_vessel_operation_id: operation.id,
        p_reopened_by: "TrailerHub User",
      });

      if (rpcError) {
        throw rpcError;
      }

      setSuccess("Vessel list reopened.");
      await loadOperation();
    } catch (listErr) {
      console.error("Unable to reopen vessel list:", listErr);
      setError(listErr instanceof Error ? listErr.message : "Unable to reopen vessel list.");
    } finally {
      setIsChangingListState(false);
    }
  };

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">Loading vessel operation...</div>
      </main>
    );
  }

  if (!operation) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-rose-500/30 bg-rose-500/10 p-6 text-sm text-rose-200">{error ?? "Vessel operation not found."}</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Vessel Operation</h1>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">{operation.vessel_name ?? "Unnamed vessel"} - {operation.sailing_reference ?? "No voyage reference"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/vessel-operations" className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Back to List</Link>
              <Link href={`/dashboard/vessel-operations/${operation.id}/planning`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Planning</Link>
              <Link href={`/dashboard/vessel-operations/${operation.id}/arrivals`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Arrivals</Link>
              <Link href={`/dashboard/vessel-operations/${operation.id}/boat-check`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Boat Check</Link>
            </div>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
        {success ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div> : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Operation Status</p><p className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getVesselOperationStatusClass(operation.status)}`}>{getVesselOperationStatusLabel(operation.status)}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">List Status</p><p className="mt-2 text-lg font-semibold text-white capitalize">{operation.list_status ?? "draft"}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Expected</p><p className="mt-2 text-lg font-semibold text-white">{summary.expected}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Available for Arrival</p><p className="mt-2 text-lg font-semibold text-cyan-200">{summary.availableForArrival}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Arrived</p><p className="mt-2 text-lg font-semibold text-amber-200">{summary.arrived}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Pending</p><p className="mt-2 text-lg font-semibold text-violet-200">{summary.pending}</p></div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">List Control</p>
              <p className="mt-1 text-sm text-slate-300">Confirmed at: {formatVesselDateTime(operation.list_confirmed_at)}{operation.list_confirmed_by ? ` by ${operation.list_confirmed_by}` : ""}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {editable ? (
                <button type="button" onClick={() => void handleConfirmList()} disabled={isChangingListState || isSaving || trailers.length === 0} className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60">Confirm Vessel List</button>
              ) : (
                <button type="button" onClick={() => void handleReopenList()} disabled={isChangingListState} className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-60">Reopen Vessel List</button>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Operation Details</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Voyage / Reference</p><p className="mt-1 text-sm text-white">{operation.sailing_reference ?? "-"}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Port</p><p className="mt-1 text-sm text-white">{operation.origin_port ?? "-"}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Berth</p><p className="mt-1 text-sm text-white">{operation.berth ?? "-"}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Expected Arrival</p><p className="mt-1 text-sm text-white">{formatVesselDateTime(operation.expected_arrival_at)}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Actual Arrival</p><p className="mt-1 text-sm text-white">{formatVesselDateTime(operation.actual_arrival_at)}</p></div>
              <div className="sm:col-span-2"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Notes</p><p className="mt-1 text-sm text-white">{operation.notes?.trim() || "-"}</p></div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Add Trailer</p>
            {!editable ? <p className="mt-2 text-sm text-amber-200">List is confirmed. Reopen to edit trailers.</p> : null}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input value={formState.trailerNumber} onChange={(event) => handleFieldChange("trailerNumber", event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Trailer Number *" disabled={!editable} />
              <input value={formState.customer} onChange={(event) => handleFieldChange("customer", event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Customer" disabled={!editable} />
              <input value={formState.bookingReference} onChange={(event) => handleFieldChange("bookingReference", event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Booking Reference" disabled={!editable} />
              <input value={formState.loadStatus} onChange={(event) => handleFieldChange("loadStatus", event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Load Status" disabled={!editable} />
              <input value={formState.temperatureRequired} onChange={(event) => handleFieldChange("temperatureRequired", event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Temperature Required" disabled={!editable} />
              <select value={formState.priorityLevel} onChange={(event) => handleFieldChange("priorityLevel", event.target.value as VesselPriorityLevel)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" disabled={!editable}>
                <option value="normal">No Priority</option>
                <option value="priority">Priority</option>
              </select>
              <textarea value={formState.notes} onChange={(event) => handleFieldChange("notes", event.target.value)} rows={3} className="md:col-span-2 rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Notes" disabled={!editable} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => void handleAddSingleTrailer()} disabled={isSaving || !editable} className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60">{isSaving ? "Saving..." : "Add Trailer"}</button>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Bulk Add Trailers</p>
          <textarea value={bulkText} onChange={(event) => setBulkText(event.target.value)} rows={5} className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="One trailer number per line" disabled={!editable} />
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void handleBulkAdd()} disabled={isSaving || !editable} className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-60">Add Multiple Trailers</button>
          </div>
        </section>

        <section className="space-y-3">
          {sortedTrailers.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-300">No trailers have been added to this vessel operation yet.</div>
          ) : (
            sortedTrailers.map((trailer) => (
              <article key={trailer.id} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-white">{trailer.trailer_number ?? "-"}</h2>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselPriorityClass(trailer.priority_level)}`}>{getVesselPriorityLabel(trailer.priority_level)}</span>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselTrailerStatusClass((trailer.arrival_status ?? trailer.status) as VesselTrailerStatus)}`}>{getVesselTrailerStatusLabel((trailer.arrival_status ?? trailer.status) as VesselTrailerStatus)}</span>
                    </div>
                    <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-4">
                      <p>Customer: {trailer.customer ?? "-"}</p>
                      <p>Booking Ref: {trailer.booking_reference ?? "-"}</p>
                      <p>Load Status: {trailer.load_status ?? "-"}</p>
                      <p>Temperature Required: {trailer.temperature_required ?? "-"}</p>
                      <p>Arrival Status: {(trailer.arrival_status ?? "expected").replace(/_/g, " ")}</p>
                      <p>Actual Arrival: {formatVesselDateTime(trailer.arrival_confirmed_at)}</p>
                      <p>Inspection: {trailer.status}</p>
                      <p>Notes: {trailer.planning_notes?.trim() || "-"}</p>
                    </div>
                    {trailer.arrival_record_id ? <Link href={`/dashboard/trailers/${trailer.trailer_number ?? trailer.arrival_record_id}`} className="inline-block text-xs text-cyan-200 underline">Open linked arrival record</Link> : null}
                  </div>

                  <div className="flex flex-col gap-2 lg:min-w-64">
                    <button type="button" onClick={() => void handleTogglePriority(trailer)} disabled={actioningTrailerId === trailer.id || !editable} className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100 hover:bg-rose-500/20 disabled:opacity-60">
                      {trailer.priority_level === "priority" ? "Set No Priority" : "Set Priority"}
                    </button>
                    <Link href={`/dashboard/vessel-operations/${operation.id}/boat-check/${trailer.id}`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-slate-700">
                      Open Inspection
                    </Link>
                    <button type="button" onClick={() => void handleRemoveTrailer(trailer)} disabled={actioningTrailerId === trailer.id || !editable} className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-60">
                      Remove Trailer
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </main>
  );
}

export default function VesselOperationDetailsPage() {
  return <VesselOperationDetailsPageContent />;
}
