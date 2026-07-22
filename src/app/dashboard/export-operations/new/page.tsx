"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  COMPOUND_REFRESH_STORAGE_KEY,
  EXPORT_ACTIVE_STATUS_QUERY_VALUES,
  isTrailerAvailableForExportAllocation,
  type ExportAllocationPriority,
  type ExportAllocationStatus,
} from "@/lib/export-allocation";

type AllocationSource = "existing" | "outsourced";

type TrailerOption = {
  id: string;
  trailer_number?: string | null;
  load_status?: string | null;
  departure_date?: string | null;
  compound_position?: string | null;
  trailer_source?: string | null;
  is_local?: boolean | null;
  operational_status?: string | null;
};

type FormState = {
  source: AllocationSource;
  trailerId: string;
  trailerNumber: string;
  customer: string;
  collectionAddress: string;
  haulier: string;
  bookingReference: string;
  loadType: string;
  collectionDate: string;
  expectedReturnAt: string;
  priority: ExportAllocationPriority;
  notes: string;
};

const INITIAL_FORM: FormState = {
  source: "existing",
  trailerId: "",
  trailerNumber: "",
  customer: "",
  collectionAddress: "",
  haulier: "",
  bookingReference: "",
  loadType: "",
  collectionDate: "",
  expectedReturnAt: "",
  priority: "normal",
  notes: "",
};

const normalizeLoadStatus = (value?: string | null) => (value ?? "").trim().toLowerCase();
const normalizeTrailerNumber = (value?: string | null) => (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();

const formatTrailerOption = (trailer: TrailerOption) => {
  const ownership = trailer.trailer_source === "outsourced" ? "Outsourced" : "Ferryspeed";
  const location = trailer.is_local ? "Local" : "Compound";
  const position = trailer.is_local ? "" : trailer.compound_position?.trim() ? ` - Position ${trailer.compound_position.trim()}` : " - Position Unassigned";
  return `${trailer.trailer_number ?? "Unknown"} - ${ownership} - ${location}${position}`;
};

export default function NewExportAllocationPage() {
  const router = useRouter();
  const [trailers, setTrailers] = useState<TrailerOption[]>([]);
  const [activeAllocationTrailerIds, setActiveAllocationTrailerIds] = useState<Set<string>>(new Set());
  const [formState, setFormState] = useState<FormState>(INITIAL_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableTrailers = useMemo(() => {
    return trailers
      .filter((trailer) =>
        isTrailerAvailableForExportAllocation(trailer, activeAllocationTrailerIds.has(trailer.id)),
      )
      .sort((a, b) => (a.trailer_number ?? "").localeCompare(b.trailer_number ?? ""));
  }, [trailers, activeAllocationTrailerIds]);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);

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

        if (trailerError) {
          throw trailerError;
        }

        if (allocationsError) {
          throw allocationsError;
        }

        const trailerRows = (trailerData ?? []) as TrailerOption[];
        const trailerIds = new Set<string>();
        (activeAllocations ?? []).forEach((row) => {
          const trailerId = (row as { trailer_id?: string | null }).trailer_id;
          if (trailerId) {
            trailerIds.add(trailerId);
          }
        });

        setTrailers(trailerRows);
        setActiveAllocationTrailerIds(trailerIds);
      } catch (loadErr) {
        setError(loadErr instanceof Error ? loadErr.message : "Unable to load trailers for export allocation.");
      } finally {
        setIsLoading(false);
      }
    };

    void loadData();
  }, []);

  const selectedTrailer = availableTrailers.find((item) => item.id === formState.trailerId) ?? null;

  const handleChange = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setFormState((current) => ({ ...current, [field]: value }));
  };

  const validateTrailerAvailability = async (trailerId: string) => {
    const activeStatuses = [...EXPORT_ACTIVE_STATUS_QUERY_VALUES];
    const [{ data: trailerData, error: trailerError }, { data: allocationsData, error: allocationsError }] = await Promise.all([
      supabase
        .from("trailers")
        .select("id, trailer_number, load_status, departure_date, compound_position, trailer_source, is_local, operational_status")
        .eq("id", trailerId)
        .single(),
      supabase
        .from("export_allocations")
        .select("id")
        .eq("trailer_id", trailerId)
        .in("status", activeStatuses)
        .limit(1),
    ]);

    if (trailerError || !trailerData) {
      return null;
    }

    if (allocationsError) {
      throw allocationsError;
    }

    const hasActiveAllocation = (allocationsData ?? []).length > 0;
    const trailer = trailerData as TrailerOption;

    const isAvailable = isTrailerAvailableForExportAllocation(trailer, hasActiveAllocation) && normalizeLoadStatus(trailer.load_status) === "empty";

    return isAvailable ? trailer : null;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const requiresExistingTrailer = formState.source === "existing";
    const normalizedManualTrailerNumber = normalizeTrailerNumber(formState.trailerNumber);

    if (!formState.customer.trim() || !formState.collectionDate) {
      setError("Customer and Collection Date are required.");
      return;
    }

    if (requiresExistingTrailer && !formState.trailerId) {
      setError("Trailer is required.");
      return;
    }

    if (!requiresExistingTrailer && !normalizedManualTrailerNumber) {
      setError("Trailer Number is required for outsourced allocations.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      let trailer: TrailerOption | null = null;

      if (requiresExistingTrailer) {
        trailer = await validateTrailerAvailability(formState.trailerId);
        if (!trailer) {
          setError("This trailer is no longer available for allocation.");
          setIsSaving(false);
          return;
        }
      } else {
        const normalizedNumber = normalizeTrailerNumber(formState.trailerNumber);
        const { data: matchingTrailerRows, error: matchingTrailerError } = await supabase
          .from("trailers")
          .select("id, trailer_number, load_status, departure_date, compound_position, trailer_source, is_local, operational_status")
          .is("departure_date", null)
          .ilike("trailer_number", normalizedNumber);

        if (matchingTrailerError) {
          throw new Error(matchingTrailerError.message || "Unable to validate outsourced trailer number.");
        }

        const matches = ((matchingTrailerRows ?? []) as TrailerOption[]).filter(
          (row) => normalizeTrailerNumber(row.trailer_number) === normalizedNumber,
        );

        const existingTrailer = matches[0] ?? null;

        if (existingTrailer) {
          const { data: activeForTrailer, error: activeForTrailerError } = await supabase
            .from("export_allocations")
            .select("id")
            .eq("trailer_id", existingTrailer.id)
            .in("status", [...EXPORT_ACTIVE_STATUS_QUERY_VALUES])
            .limit(1);

          if (activeForTrailerError) {
            throw new Error(activeForTrailerError.message || "Unable to validate active export allocations for outsourced trailer.");
          }

          if ((activeForTrailer ?? []).length > 0) {
            setError("This outsourced trailer already has an active export allocation.");
            setIsSaving(false);
            return;
          }

          const isEmpty = normalizeLoadStatus(existingTrailer.load_status) === "empty" || !normalizeLoadStatus(existingTrailer.load_status);
          if (!isEmpty) {
            setError("Outsourced trailer must be Empty before it can be allocated.");
            setIsSaving(false);
            return;
          }

          trailer = {
            ...existingTrailer,
            trailer_number: normalizeTrailerNumber(existingTrailer.trailer_number) || normalizedNumber,
          };
        } else {
          const { data: createdTrailer, error: createTrailerError } = await supabase
            .from("trailers")
            .insert({
              trailer_number: normalizedNumber,
              trailer_source: "outsourced",
              load_status: "Empty",
              customer: formState.customer.trim() || null,
              is_local: false,
              operational_status: "In Compound",
            })
            .select("id, trailer_number, load_status, departure_date, compound_position, trailer_source, is_local, operational_status")
            .single();

          if (createTrailerError || !createdTrailer) {
            throw new Error(createTrailerError?.message || "Unable to create outsourced trailer.");
          }

          trailer = createdTrailer as TrailerOption;
        }
      }

      const nowIso = new Date().toISOString();
      const insertPayload = {
        trailer_id: trailer.id,
        trailer_number: normalizeTrailerNumber(trailer.trailer_number),
        customer: formState.customer.trim(),
        collection_address: formState.collectionAddress.trim() || null,
        haulier: formState.haulier.trim() || null,
        booking_reference: formState.bookingReference.trim() || null,
        load_type: formState.loadType.trim() || null,
        collection_date: formState.collectionDate,
        expected_return_at: formState.expectedReturnAt ? new Date(formState.expectedReturnAt).toISOString() : null,
        priority: formState.priority,
        status: "allocated" as ExportAllocationStatus,
        notes: formState.notes.trim() || null,
        allocated_at: nowIso,
        updated_at: nowIso,
      };

      const { data: allocationData, error: insertError } = await supabase
        .from("export_allocations")
        .insert(insertPayload)
        .select("id")
        .single();

      if (insertError || !allocationData) {
        throw new Error(insertError?.message || "Unable to create export allocation.");
      }

      const { error: waitingCleanupError } = await supabase
        .from("compound_waiting_list")
        .update(
          {
            status: "cancelled",
            notes: "Automatically removed after export allocation creation.",
            updated_at: nowIso,
          } as never,
        )
        .eq("trailer_id", trailer.id)
        .eq("status", "waiting");

      if (waitingCleanupError) {
        throw new Error(waitingCleanupError.message || "Export allocation created, but waiting queue could not be synchronized.");
      }

      const { error: eventError } = await supabase.from("trailer_events").insert({
        trailer_id: trailer.id,
        trailer_number: normalizeTrailerNumber(trailer.trailer_number),
        event_type: "export_allocation_created",
        event_description: `Trailer allocated to ${formState.customer.trim()}.`,
        old_value: null,
        new_value: {
          export_allocation_id: allocationData.id,
          customer: insertPayload.customer,
          collection_address: insertPayload.collection_address,
          haulier: insertPayload.haulier,
          booking_reference: insertPayload.booking_reference,
          load_type: insertPayload.load_type,
          collection_date: insertPayload.collection_date,
          expected_return_at: insertPayload.expected_return_at,
          priority: insertPayload.priority,
          status: "allocated",
          source: formState.source,
        },
      });

      if (eventError) {
        console.error("Failed to create export_allocation_created event:", eventError);
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem(COMPOUND_REFRESH_STORAGE_KEY, Date.now().toString());
      }

      router.push("/dashboard/export-operations?saved=1");
    } catch (submitErr) {
      setError(submitErr instanceof Error ? submitErr.message : "Unable to save export allocation.");
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">New Export Allocation</h1>
          <p className="mt-2 text-sm text-slate-300 sm:text-base">Allocate an available empty trailer for export loading operations.</p>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
        ) : null}

        <form onSubmit={handleSubmit} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-200">Source</label>
              <select
                value={formState.source}
                onChange={(event) => handleChange("source", event.target.value as AllocationSource)}
                disabled={isSaving}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
              >
                <option value="existing">Existing Trailer</option>
                <option value="outsourced">Outsourced Trailer (Manual)</option>
              </select>
            </div>

            <div className="md:col-span-2">
              {formState.source === "existing" ? (
                <>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Trailer *</label>
                  <select
                    value={formState.trailerId}
                    onChange={(event) => handleChange("trailerId", event.target.value)}
                    disabled={isLoading || isSaving}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                  >
                    <option value="">Select available trailer</option>
                    {availableTrailers.map((trailer) => (
                      <option key={trailer.id} value={trailer.id}>
                        {formatTrailerOption(trailer)}
                      </option>
                    ))}
                  </select>
                  {selectedTrailer ? <p className="mt-2 text-xs text-cyan-200">Selected: {formatTrailerOption(selectedTrailer)}</p> : null}
                </>
              ) : (
                <>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Trailer Number *</label>
                  <input
                    value={formState.trailerNumber}
                    onChange={(event) => handleChange("trailerNumber", event.target.value.toUpperCase())}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    placeholder="e.g. OUT-1234"
                    disabled={isSaving}
                  />
                  <p className="mt-2 text-xs text-slate-400">Manual outsourced allocations do not require selecting a company trailer.</p>
                </>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Customer *</label>
              <input
                value={formState.customer}
                onChange={(event) => handleChange("customer", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Customer name"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Collection Address</label>
              <input
                value={formState.collectionAddress}
                onChange={(event) => handleChange("collectionAddress", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Collection address"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Haulier / Third Party</label>
              <input
                value={formState.haulier}
                onChange={(event) => handleChange("haulier", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Haulier name"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Booking Reference</label>
              <input
                value={formState.bookingReference}
                onChange={(event) => handleChange("bookingReference", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Reference"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Load Type</label>
              <input
                value={formState.loadType}
                onChange={(event) => handleChange("loadType", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Load type"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Collection Date *</label>
              <input
                type="date"
                value={formState.collectionDate}
                onChange={(event) => handleChange("collectionDate", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Expected Return</label>
              <input
                type="datetime-local"
                value={formState.expectedReturnAt}
                onChange={(event) => handleChange("expectedReturnAt", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Priority</label>
              <select
                value={formState.priority}
                onChange={(event) => handleChange("priority", event.target.value as ExportAllocationPriority)}
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
                onChange={(event) => handleChange("notes", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Operational notes"
              />
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Link
              href="/dashboard/export-operations"
              className="rounded-2xl border border-white/10 bg-slate-800 px-5 py-3 text-center text-sm font-medium text-slate-200 hover:bg-slate-700"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSaving || isLoading}
              className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Create Allocation"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
