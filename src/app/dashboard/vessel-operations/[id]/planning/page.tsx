"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Json } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import {
  PLANNED_DESTINATION_SUGGESTIONS,
  computeVesselOperationSummary,
  formatVesselDateTime,
  getVesselOperationStatusClass,
  getVesselOperationStatusLabel,
  getVesselPriorityClass,
  getVesselPriorityLabel,
  getVesselTrailerStatusClass,
  getVesselTrailerStatusLabel,
  normalizeTrailerNumber,
  normalizeExpectedTemperatureUnit,
  normalizeVesselText,
  sortVesselOperationTrailersForArrivals,
  type VesselOperationRecord,
  type VesselOperationStatus,
  type VesselOperationTrailerRecord,
  type VesselPriorityLevel,
  type VesselTrailerStatus,
} from "@/lib/vessel-operations";

type FleetTrailer = {
  id: string;
  trailer_number?: string | null;
  customer?: string | null;
  load_description?: string | null;
  load_status?: string | null;
  departure_date?: string | null;
  compound_position?: string | null;
  trailer_source?: string | null;
  external_company?: string | null;
  is_local?: boolean | null;
};

type DraftTrailer = {
  clientId: string;
  trailer_id?: string | null;
  trailer_number: string;
  customer: string;
  booking_reference: string;
  load_description: string;
  expected_front_temperature: string;
  expected_rear_temperature: string;
  expected_temperature_unit: string;
  priority_level: VesselPriorityLevel;
  priority_reason: string;
  planned_destination: string;
  planning_notes: string;
  status: VesselTrailerStatus;
};

const emptyDraft = (): DraftTrailer => ({
  clientId: crypto.randomUUID(),
  trailer_id: null,
  trailer_number: "",
  customer: "",
  booking_reference: "",
  load_description: "",
  expected_front_temperature: "",
  expected_rear_temperature: "",
  expected_temperature_unit: "C",
  priority_level: "normal",
  priority_reason: "",
  planned_destination: "Compound",
  planning_notes: "",
  status: "expected",
});

const toOperationDateTime = (operation?: VesselOperationRecord | null) =>
  operation?.expected_arrival_at ? formatVesselDateTime(operation.expected_arrival_at) : "—";

const parseOptionalTemperatureInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return { value: null as number | null, error: null as string | null };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { value: null as number | null, error: "Temperature values must be numeric." };
  }

  return { value: parsed, error: null as string | null };
};

const parseLegacyFrontExpectedTemperature = (value?: string | null) => {
  const text = (value ?? "").trim();
  if (!text) {
    return "";
  }

  const direct = Number(text);
  if (Number.isFinite(direct)) {
    return String(direct);
  }

  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? match[0] : "";
};

type ImportedTrailerRow = {
  trailer_number: string;
  expected_front_temperature: string;
  expected_rear_temperature: string;
  expected_temperature_unit: string;
};

const normalizeImportHeader = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const IMPORT_HEADER_ALIASES: Record<string, keyof ImportedTrailerRow> = {
  "trailer": "trailer_number",
  "trailer number": "trailer_number",
  "expected front temperature": "expected_front_temperature",
  "front temperature": "expected_front_temperature",
  "expected rear temperature": "expected_rear_temperature",
  "rear temperature": "expected_rear_temperature",
  "temperature unit": "expected_temperature_unit",
};

const parseImportedRows = (rawText: string) => {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return [] as ImportedTrailerRow[];
  }

  const looksDelimited = lines[0].includes(",") || lines[0].includes("\t");
  if (!looksDelimited) {
    return lines.map((line) => ({
      trailer_number: normalizeTrailerNumber(line),
      expected_front_temperature: "",
      expected_rear_temperature: "",
      expected_temperature_unit: "C",
    })).filter((row) => Boolean(row.trailer_number));
  }

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const cells = lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
  const header = cells[0];
  const headerMap = new Map<number, keyof ImportedTrailerRow>();

  header.forEach((headerCell, index) => {
    const normalizedHeader = normalizeImportHeader(headerCell);
    const mapped = IMPORT_HEADER_ALIASES[normalizedHeader];
    if (mapped) {
      headerMap.set(index, mapped);
    }
  });

  const hasTrailerColumn = Array.from(headerMap.values()).includes("trailer_number");
  if (!hasTrailerColumn) {
    return [] as ImportedTrailerRow[];
  }

  return cells.slice(1).map((row) => {
    const imported: ImportedTrailerRow = {
      trailer_number: "",
      expected_front_temperature: "",
      expected_rear_temperature: "",
      expected_temperature_unit: "C",
    };

    row.forEach((value, index) => {
      const key = headerMap.get(index);
      if (!key) {
        return;
      }

      imported[key] = value;
    });

    imported.trailer_number = normalizeTrailerNumber(imported.trailer_number);
    imported.expected_temperature_unit = normalizeExpectedTemperatureUnit(imported.expected_temperature_unit || "C");
    return imported;
  }).filter((row) => Boolean(row.trailer_number));
};

function VesselPlanningPageContent() {
  const params = useParams();
  const router = useRouter();
  const operationId = typeof params?.id === "string" ? params.id : "";

  const [operation, setOperation] = useState<VesselOperationRecord | null>(null);
  const [trailers, setTrailers] = useState<DraftTrailer[]>([]);
  const [fleetTrailers, setFleetTrailers] = useState<FleetTrailer[]>([]);
  const [newDraft, setNewDraft] = useState<DraftTrailer>(emptyDraft);
  const [importText, setImportText] = useState("");
  const [fleetSearch, setFleetSearch] = useState("");
  const [selectedFleetTrailerId, setSelectedFleetTrailerId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isEditable = (operation?.list_status ?? "draft") === "draft" || (operation?.list_status ?? "draft") === "reopened";

  useEffect(() => {
    const loadPlanning = async () => {
      if (!operationId) {
        setError("Invalid vessel operation reference.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const [operationResult, trailersResult, fleetResult] = await Promise.all([
          supabase
            .from("vessel_operations")
            .select("id, vessel_name, sailing_reference, origin_port, berth, expected_arrival_at, actual_arrival_at, status, list_status, list_confirmed_at, list_confirmed_by, notes, created_at, updated_at")
            .eq("id", operationId)
            .single(),
          supabase
            .from("vessel_operation_trailers")
            .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, load_description, temperature_required, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, priority_level, priority_reason, planned_destination, planning_notes, status, arrived_at, arrival_confirmed_by, inspection_started_at, inspection_completed_at, position_assigned_at, assigned_position, has_damage, has_temperature_alert, created_at, updated_at")
            .eq("vessel_operation_id", operationId)
            .order("created_at", { ascending: true }),
          supabase
            .from("trailers")
            .select("id, trailer_number, customer, load_description, load_status, departure_date, compound_position, trailer_source, external_company, is_local")
            .is("departure_date", null)
            .neq("is_local", true)
            .order("trailer_number", { ascending: true }),
        ]);

        if (operationResult.error || !operationResult.data) throw operationResult.error ?? new Error("Operation not found.");
        if (trailersResult.error) throw trailersResult.error;
        if (fleetResult.error) throw fleetResult.error;

        setOperation(operationResult.data as VesselOperationRecord);
        const nextTrailers = ((trailersResult.data ?? []) as VesselOperationTrailerRecord[]).map((row) => ({
          clientId: row.id,
          trailer_id: row.trailer_id ?? null,
          trailer_number: row.trailer_number ?? "",
          customer: row.customer ?? "",
          booking_reference: row.booking_reference ?? "",
          load_description: row.load_description ?? "",
          expected_front_temperature:
            typeof row.expected_front_temperature === "number"
              ? String(row.expected_front_temperature)
              : parseLegacyFrontExpectedTemperature(row.temperature_required),
          expected_rear_temperature:
            typeof row.expected_rear_temperature === "number"
              ? String(row.expected_rear_temperature)
              : "",
          expected_temperature_unit: normalizeExpectedTemperatureUnit(row.expected_temperature_unit),
          priority_level: row.priority_level,
          priority_reason: row.priority_reason ?? "",
          planned_destination: row.planned_destination ?? "Compound",
          planning_notes: row.planning_notes ?? "",
          status: row.status,
        }));

        setTrailers(sortVesselOperationTrailersForArrivals(nextTrailers));
        setFleetTrailers((fleetResult.data ?? []) as FleetTrailer[]);
        setNewDraft(emptyDraft());
      } catch (loadErr) {
        console.error("Unable to load planning data:", loadErr);
        setError("Unable to load planning data.");
      } finally {
        setIsLoading(false);
      }
    };

    void loadPlanning();
  }, [operationId]);

  const filteredFleetTrailers = useMemo(() => {
    const search = normalizeVesselText(fleetSearch);
    if (!search) {
      return fleetTrailers.slice(0, 12);
    }

    return fleetTrailers.filter((item) =>
      [item.trailer_number, item.customer, item.load_description, item.external_company].some((value) =>
        normalizeVesselText(value).includes(search),
      ),
    );
  }, [fleetSearch, fleetTrailers]);

  const summary = useMemo(() => computeVesselOperationSummary(trailers), [trailers]);

  const updateDraft = <K extends keyof DraftTrailer>(field: K, value: DraftTrailer[K], clientId: string) => {
    setTrailers((current) =>
      sortVesselOperationTrailersForArrivals(
        current.map((item) => (item.clientId === clientId ? { ...item, [field]: value } : item)),
      ),
    );
  };

  const updateNewDraft = <K extends keyof DraftTrailer>(field: K, value: DraftTrailer[K]) => {
    setNewDraft((current) => ({ ...current, [field]: value }));
  };

  const addNewTrailer = () => {
    const trailerNumber = normalizeTrailerNumber(newDraft.trailer_number);
    if (!trailerNumber) {
      setError("Trailer Number is required.");
      return;
    }

    const normalizedExisting = new Set(trailers.map((item) => normalizeTrailerNumber(item.trailer_number)));
    if (normalizedExisting.has(trailerNumber)) {
      setError(`Trailer ${trailerNumber} is already in this vessel operation.`);
      return;
    }

    const nextTrailer: DraftTrailer = {
      ...newDraft,
      clientId: crypto.randomUUID(),
      trailer_number: trailerNumber,
      status: "expected",
      planned_destination: newDraft.planned_destination.trim() || "Compound",
    };

    setTrailers((current) => sortVesselOperationTrailersForArrivals([...current, nextTrailer]));
    setNewDraft(emptyDraft());
    setError(null);
  };

  const importTrailers = () => {
    const rows = parseImportedRows(importText);

    if (rows.length === 0) {
      setError("No valid trailer rows found. Add trailer numbers or include a header with Trailer Number.");
      return;
    }

    const existing = new Set(trailers.map((item) => normalizeTrailerNumber(item.trailer_number)));
    const uniqueImported = rows.filter((row, index) => rows.findIndex((candidate) => candidate.trailer_number === row.trailer_number) === index);
    const imported = uniqueImported.filter((row) => !existing.has(row.trailer_number));

    if (imported.length === 0) {
      setError("No new trailer numbers to import.");
      return;
    }

    const nextItems = imported.map((row) => ({
      ...emptyDraft(),
      clientId: crypto.randomUUID(),
      trailer_number: row.trailer_number,
      expected_front_temperature: row.expected_front_temperature,
      expected_rear_temperature: row.expected_rear_temperature,
      expected_temperature_unit: normalizeExpectedTemperatureUnit(row.expected_temperature_unit),
      status: "expected" as VesselTrailerStatus,
    }));

    setTrailers((current) => sortVesselOperationTrailersForArrivals([...current, ...nextItems]));
    setImportText("");
    setError(null);
  };

  const savePlanning = async () => {
    if (!operation || !isEditable) {
      return;
    }

    const normalizedNumbers = new Set<string>();
    for (const trailer of trailers) {
      const normalized = normalizeTrailerNumber(trailer.trailer_number);
      if (!normalized) {
        setError("Every trailer needs a trailer number.");
        return;
      }

      if (normalizedNumbers.has(normalized)) {
        setError(`Duplicate trailer number found: ${normalized}`);
        return;
      }

      const parsedFront = parseOptionalTemperatureInput(trailer.expected_front_temperature);
      if (parsedFront.error) {
        setError(`${normalized}: expected front temperature must be numeric.`);
        return;
      }

      const parsedRear = parseOptionalTemperatureInput(trailer.expected_rear_temperature);
      if (parsedRear.error) {
        setError(`${normalized}: expected rear temperature must be numeric.`);
        return;
      }

      normalizedNumbers.add(normalized);
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const nowIso = new Date().toISOString();
      const { error: deleteError } = await supabase.from("vessel_operation_trailers").delete().eq("vessel_operation_id", operation.id);
      if (deleteError) throw deleteError;

      const rowsToInsert = trailers.map((trailer) => {
        const parsedFront = parseOptionalTemperatureInput(trailer.expected_front_temperature);
        const parsedRear = parseOptionalTemperatureInput(trailer.expected_rear_temperature);
        const unit = normalizeExpectedTemperatureUnit(trailer.expected_temperature_unit || "C");

        return {
        vessel_operation_id: operation.id,
        trailer_id: trailer.trailer_id ?? null,
        trailer_number: normalizeTrailerNumber(trailer.trailer_number),
        customer: trailer.customer.trim() || null,
        booking_reference: trailer.booking_reference.trim() || null,
        load_description: trailer.load_description.trim() || null,
        expected_front_temperature: parsedFront.value,
        expected_rear_temperature: parsedRear.value,
        expected_temperature_unit: unit,
        temperature_required: parsedFront.value !== null ? String(parsedFront.value) : null,
        priority_level: trailer.priority_level,
        priority_reason: trailer.priority_reason.trim() || null,
        planned_destination: trailer.planned_destination.trim() || "Compound",
        planning_notes: trailer.planning_notes.trim() || null,
        status: "expected" as VesselTrailerStatus,
        arrival_status: "expected",
        created_at: nowIso,
        updated_at: nowIso,
      }});

      const { error: insertError } = await supabase.from("vessel_operation_trailers").insert(rowsToInsert);
      if (insertError) throw insertError;

      for (const trailer of rowsToInsert) {
        const eventPayload = {
          trailer_id: trailer.trailer_id,
          trailer_number: trailer.trailer_number,
          event_type: trailer.priority_level === "priority" ? "vessel_priority_planned" : "vessel_trailer_planned",
          event_description:
            trailer.priority_level === "priority"
              ? `Priority trailer planned for ${trailer.planned_destination}.`
              : `Trailer planned for ${trailer.planned_destination}.`,
          old_value: null,
          new_value: trailer as unknown as Json,
        };

        const { error: eventError } = await supabase.from("trailer_events").insert(eventPayload);
        if (eventError) {
          console.error("Failed to create planning event:", eventError);
        }
      }

      setSuccess("Planning saved successfully.");
      router.refresh();
      const { data: reloadedTrailers } = await supabase
        .from("vessel_operation_trailers")
        .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, load_description, temperature_required, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, priority_level, priority_reason, planned_destination, planning_notes, status, arrived_at, arrival_confirmed_by, inspection_started_at, inspection_completed_at, position_assigned_at, assigned_position, has_damage, has_temperature_alert, created_at, updated_at")
        .eq("vessel_operation_id", operation.id)
        .order("created_at", { ascending: true });

      setTrailers(
        sortVesselOperationTrailersForArrivals(
          ((reloadedTrailers ?? []) as VesselOperationTrailerRecord[]).map((row) => ({
            clientId: row.id,
            trailer_id: row.trailer_id ?? null,
            trailer_number: row.trailer_number ?? "",
            customer: row.customer ?? "",
            booking_reference: row.booking_reference ?? "",
            load_description: row.load_description ?? "",
            expected_front_temperature:
              typeof row.expected_front_temperature === "number"
                ? String(row.expected_front_temperature)
                : parseLegacyFrontExpectedTemperature(row.temperature_required),
            expected_rear_temperature:
              typeof row.expected_rear_temperature === "number"
                ? String(row.expected_rear_temperature)
                : "",
            expected_temperature_unit: normalizeExpectedTemperatureUnit(row.expected_temperature_unit),
            priority_level: row.priority_level,
            priority_reason: row.priority_reason ?? "",
            planned_destination: row.planned_destination ?? "Compound",
            planning_notes: row.planning_notes ?? "",
            status: row.status,
          })),
        ),
      );
    } catch (saveErr) {
      console.error("Unable to save planning:", saveErr);
      setError("Unable to save planning.");
    } finally {
      setIsSaving(false);
    }
  };

  const startArrivals = async () => {
    if (!operation) {
      return;
    }

    await savePlanning();

    try {
      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("vessel_operations")
        .update({ status: "arriving" as VesselOperationStatus, updated_at: nowIso })
        .eq("id", operation.id);

      if (updateError) {
        throw updateError;
      }

      setSuccess("Arrivals started.");
      router.push(`/dashboard/vessel-operations/${operation.id}/arrivals`);
    } catch (startErr) {
      console.error("Unable to start arrivals:", startErr);
      setError("Unable to start arrivals.");
    }
  };

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">Loading planning data...</div>
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
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Planning</h1>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">
                {operation.vessel_name ?? "Unnamed vessel"} - Expected {toOperationDateTime(operation)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/dashboard/vessel-operations/${operation.id}/arrivals`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                Arrivals
              </Link>
              <button
                type="button"
                disabled={!isEditable || isSaving}
                onClick={() => void savePlanning()}
                className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save Planning"}
              </button>
              <button
                type="button"
                disabled={!isEditable || isSaving}
                onClick={() => void startArrivals()}
                className="rounded-2xl border border-amber-500/30 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Start Arrivals
              </button>
            </div>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
        {success ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div> : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Vessel</p><p className="mt-2 text-lg font-semibold text-white">{operation.vessel_name ?? "-"}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Status</p><p className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getVesselOperationStatusClass(operation.status)}`}>{getVesselOperationStatusLabel(operation.status)}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Trailer Count</p><p className="mt-2 text-lg font-semibold text-white">{summary.expected}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Priority Pending</p><p className="mt-2 text-lg font-semibold text-rose-200">{summary.priorityRemaining}</p></div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Add Trailer</p>
              <p className="mt-2 text-sm text-slate-300">Create the expected trailer list before the ferry arrives.</p>
            </div>
            {!isEditable ? (
              <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">Planning is read-only once arrivals have started.</p>
            ) : null}
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-slate-200">Trailer Number *</label>
                  <input
                    value={newDraft.trailer_number}
                    onChange={(event) => updateNewDraft("trailer_number", event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    placeholder="PRO810"
                    disabled={!isEditable}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Customer</label>
                  <input value={newDraft.customer} onChange={(event) => updateNewDraft("customer", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" disabled={!isEditable} />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Booking Reference</label>
                  <input value={newDraft.booking_reference} onChange={(event) => updateNewDraft("booking_reference", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" disabled={!isEditable} />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-slate-200">Load Description</label>
                  <input value={newDraft.load_description} onChange={(event) => updateNewDraft("load_description", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" disabled={!isEditable} />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Expected Front Temperature</label>
                  <input
                    value={newDraft.expected_front_temperature}
                    onChange={(event) => updateNewDraft("expected_front_temperature", event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    placeholder="Optional"
                    disabled={!isEditable}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Expected Rear Temperature</label>
                  <input
                    value={newDraft.expected_rear_temperature}
                    onChange={(event) => updateNewDraft("expected_rear_temperature", event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    placeholder="Optional"
                    disabled={!isEditable}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Temperature Unit</label>
                  <select
                    value={newDraft.expected_temperature_unit}
                    onChange={(event) => updateNewDraft("expected_temperature_unit", event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    disabled={!isEditable}
                  >
                    <option value="C">Celsius (C)</option>
                    <option value="F">Fahrenheit (F)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Priority</label>
                  <select value={newDraft.priority_level} onChange={(event) => updateNewDraft("priority_level", event.target.value as VesselPriorityLevel)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" disabled={!isEditable}>
                    <option value="priority">Priority</option>
                    <option value="normal">Normal</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Priority Reason</label>
                  <input value={newDraft.priority_reason} onChange={(event) => updateNewDraft("priority_reason", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" disabled={!isEditable} />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-slate-200">Planned Destination</label>
                  <input
                    list="planned-destinations"
                    value={newDraft.planned_destination}
                    onChange={(event) => updateNewDraft("planned_destination", event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    disabled={!isEditable}
                  />
                  <datalist id="planned-destinations">
                    {PLANNED_DESTINATION_SUGGESTIONS.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-slate-200">Planning Notes</label>
                  <textarea value={newDraft.planning_notes} onChange={(event) => updateNewDraft("planning_notes", event.target.value)} rows={3} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" disabled={!isEditable} />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => void addNewTrailer()} disabled={!isEditable} className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60">
                  Add Trailer
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <label className="mb-2 block text-sm font-medium text-slate-200">Import Trailer Numbers</label>
              <textarea
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                rows={8}
                placeholder={"PRO810\nPFC102\n\nOr CSV header:\nTrailer Number,Expected Front Temperature,Expected Rear Temperature,Temperature Unit"}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                disabled={!isEditable}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={importTrailers} disabled={!isEditable} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
                  Import Trailers
                </button>
              </div>

              <div className="mt-4">
                <label className="mb-2 block text-sm font-medium text-slate-200">Company Fleet Search</label>
                <input
                  value={fleetSearch}
                  onChange={(event) => setFleetSearch(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                  placeholder="Search company fleet trailers"
                  disabled={!isEditable}
                />

                <div className="mt-3 max-h-72 overflow-auto rounded-2xl border border-white/10 bg-slate-950/60">
                  {filteredFleetTrailers.length === 0 ? (
                    <p className="p-4 text-sm text-slate-400">No trailers match this search.</p>
                  ) : (
                    filteredFleetTrailers.map((fleetTrailer) => (
                      <button
                        key={fleetTrailer.id}
                        type="button"
                        onClick={() => {
                          setSelectedFleetTrailerId(fleetTrailer.id);
                          setNewDraft((current) => ({
                            ...current,
                            trailer_id: fleetTrailer.id,
                            trailer_number: fleetTrailer.trailer_number ?? current.trailer_number,
                            customer: fleetTrailer.customer ?? current.customer,
                            load_description: fleetTrailer.load_description ?? current.load_description,
                          }));
                        }}
                        className={`w-full border-b border-white/5 px-4 py-3 text-left text-sm hover:bg-white/5 ${selectedFleetTrailerId === fleetTrailer.id ? "bg-cyan-500/10 text-cyan-100" : "text-slate-200"}`}
                      >
                        {fleetTrailer.trailer_number ?? "-"}
                        <span className="ml-2 text-xs text-slate-400">{fleetTrailer.customer ?? "No customer"}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Expected Trailers</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Planning list</h2>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-center"><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Expected</p><p className="text-lg font-bold text-white">{summary.expected}</p></div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-center"><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Priority</p><p className="text-lg font-bold text-rose-200">{summary.priority}</p></div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-center"><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Inspected</p><p className="text-lg font-bold text-emerald-200">{summary.inspected}</p></div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-center"><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Pending</p><p className="text-lg font-bold text-cyan-200">{summary.pendingInspection}</p></div>
            </div>
          </div>

          <div className="mt-5 grid gap-4">
            {trailers.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-white/10 bg-slate-950/60 p-4 text-sm text-slate-400">No trailers planned yet.</p>
            ) : (
              trailers.map((trailer) => (
                <article key={trailer.clientId} className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="space-y-2 xl:min-w-[260px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xl font-semibold text-white">{trailer.trailer_number || "Trailer Number"}</p>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselPriorityClass(trailer.priority_level)}`}>{getVesselPriorityLabel(trailer.priority_level)}</span>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselTrailerStatusClass(trailer.status)}`}>{getVesselTrailerStatusLabel(trailer.status)}</span>
                      </div>
                      <p className="text-sm text-slate-300">Planned Destination: {trailer.planned_destination || "-"}</p>
                      <p className="text-sm text-slate-300">Customer: {trailer.customer || "-"}</p>
                      <p className="text-sm text-slate-300">Booking Reference: {trailer.booking_reference || "-"}</p>
                    </div>

                    <div className="grid flex-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <input value={trailer.trailer_number} onChange={(event) => updateDraft("trailer_number", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable} placeholder="Trailer Number" />
                      <input value={trailer.customer} onChange={(event) => updateDraft("customer", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable} placeholder="Customer" />
                      <input value={trailer.booking_reference} onChange={(event) => updateDraft("booking_reference", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable} placeholder="Booking Reference" />
                      <input value={trailer.load_description} onChange={(event) => updateDraft("load_description", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable} placeholder="Load Description" />
                      <input value={trailer.expected_front_temperature} onChange={(event) => updateDraft("expected_front_temperature", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable} placeholder="Expected Front Temp" />
                      <input value={trailer.expected_rear_temperature} onChange={(event) => updateDraft("expected_rear_temperature", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable} placeholder="Expected Rear Temp" />
                      <select value={trailer.expected_temperature_unit} onChange={(event) => updateDraft("expected_temperature_unit", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable}>
                        <option value="C">Celsius (C)</option>
                        <option value="F">Fahrenheit (F)</option>
                      </select>
                      <select value={trailer.priority_level} onChange={(event) => updateDraft("priority_level", event.target.value as VesselPriorityLevel, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable}>
                        <option value="priority">Priority</option>
                        <option value="normal">Normal</option>
                      </select>
                      <input value={trailer.priority_reason} onChange={(event) => updateDraft("priority_reason", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable} placeholder="Priority Reason" />
                      <input list="planned-destinations" value={trailer.planned_destination} onChange={(event) => updateDraft("planned_destination", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable} placeholder="Planned Destination" />
                      <textarea value={trailer.planning_notes} onChange={(event) => updateDraft("planning_notes", event.target.value, trailer.clientId)} rows={2} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none md:col-span-2 xl:col-span-3" disabled={!isEditable} placeholder="Planning Notes" />
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function VesselPlanningPage() {
  return <VesselPlanningPageContent />;
}
