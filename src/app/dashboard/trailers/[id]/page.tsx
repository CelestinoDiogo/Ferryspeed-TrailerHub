"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { Database, Json } from "@/lib/database.types";
import { TrailerTimeline } from "@/components/trailers/trailer-timeline";
import { getOperationalStageBadgeClassName } from "@/lib/operations/operational-stages";
import {
  loadTrailerOperationalProfile,
  type TrailerOperationalProfile,
} from "@/lib/operations/trailer-operational-engine";
import { supabase } from "@/lib/supabase";
import {
  buildTrailerRestorePatch,
  canReverseTrailerEvent,
} from "@/lib/trailer-movement-undo";
import {
  EXPORT_ACTIVE_STATUS_QUERY_VALUES,
  normalizeExportAllocationStatus,
  getExportAllocationStatusLabel,
  getExportAllocationStatusClasses,
  type ExportAllocationRecord,
} from "@/lib/export-allocation";

type Trailer = {
  id: string;
  trailer_number?: string | null;
  trailer_type?: string | null;
  compound_position?: string | null;
  trailer_source?: string | null;
  external_company?: string | null;
  external_reference?: string | null;
  is_local?: boolean | null;
  load_status?: string | null;
  operational_status?: string | null;
  customer?: string | null;
  consignee?: string | null;
  container_number?: string | null;
  load_description?: string | null;
  notes?: string | null;
  arrival_date?: string | null;
  departure_date?: string | null;
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

type ActiveExportAllocation = Pick<
  ExportAllocationRecord,
  "id" | "status" | "customer" | "collection_date" | "haulier" | "booking_reference"
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

const isActiveFromValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim() === "";
  }

  return false;
};

export default function TrailerDetailsPage() {
  const params = useParams();
  const rawTrailerNumber = params?.id && typeof params.id === "string" ? decodeURIComponent(params.id) : undefined;
  const trailerNumber = rawTrailerNumber?.replace(/\s+/g, " ").trim();
  const identifierError = trailerNumber ? null : "Unable to identify trailer from the URL.";
  const [trailer, setTrailer] = useState<Trailer | null>(null);
  const [events, setEvents] = useState<TrailerEvent[]>([]);
  const [activeExportAllocation, setActiveExportAllocation] = useState<ActiveExportAllocation | null>(null);
  const [operationalProfile, setOperationalProfile] = useState<TrailerOperationalProfile | null>(null);
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
  const [isReversing, setIsReversing] = useState(false);
  const [showUndoConfirm, setShowUndoConfirm] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(identifierError);

  const loadTrailer = useCallback(async () => {
    if (!trailerNumber) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const profile = await loadTrailerOperationalProfile(supabase, trailerNumber);
      setOperationalProfile(profile);
      setTrailer((profile.trailer as Trailer | null) ?? null);
      setEvents(
        profile.trailerEventRows.map((row) => ({
          id: row.id,
          trailer_id: row.trailer_id ?? null,
          trailer_number: row.trailer_number ?? null,
          event_type: row.event_type ?? null,
          event_description: row.event_description ?? null,
          old_value: row.old_value ?? undefined,
          new_value: row.new_value ?? undefined,
          created_at: row.created_at ?? null,
        })),
      );

      const firstActiveExport = profile.exportAllocations.find((row) => !["completed", "cancelled", "returned", "shipped"].includes((row.status ?? "").trim().toLowerCase())) ?? null;
      setActiveExportAllocation(
        firstActiveExport
          ? {
              id: firstActiveExport.id,
              status: normalizeExportAllocationStatus(firstActiveExport.status),
              customer: firstActiveExport.customer ?? null,
              collection_date: firstActiveExport.collection_date ?? null,
              haulier: firstActiveExport.haulier ?? null,
              booking_reference: firstActiveExport.booking_reference ?? null,
            }
          : null,
      );

      if (profile.trailer) {
        const initialForm: TrailerForm = {
          trailer_number: profile.trailer.trailer_number ?? null,
          trailer_type: profile.trailer.trailer_type ?? null,
          compound_position: profile.trailer.compound_position ?? null,
          load_status: profile.trailer.load_status ?? null,
          operational_status: profile.trailer.operational_status ?? null,
          customer: profile.trailer.customer ?? null,
          consignee: profile.trailer.consignee ?? null,
          container_number: profile.trailer.container_number ?? null,
          load_description: profile.trailer.load_description ?? null,
          notes: profile.trailer.notes ?? null,
        };

        setFormState(initialForm);
        setOriginalForm(initialForm);
      }

      if (!profile.trailer && profile.vesselOperationTrailers.length === 0 && profile.events.length === 0) {
        setError("Trailer not found.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load trailer details.";
      setTrailer(null);
      setEvents([]);
      setOperationalProfile(null);
      setActiveExportAllocation(null);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [trailerNumber]);

  useEffect(() => {
    if (!trailerNumber) {
      return;
    }

    void loadTrailer();
  }, [loadTrailer]);

  const currentStatus = useMemo(
    () => normalizeStatus(trailer?.operational_status),
    [trailer?.operational_status]
  );

  const derivedStageBadgeClass = useMemo(() => {
    if (!operationalProfile?.position.operationalStage) {
      return "border-slate-500/30 bg-slate-500/10 text-slate-200";
    }

    return getOperationalStageBadgeClassName(operationalProfile.position.operationalStage);
  }, [operationalProfile?.position.operationalStage]);

  const statusBadgeClass = useMemo(
    () => `${getStatusColor(trailer?.operational_status)} rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset`,
    [trailer?.operational_status]
  );

  const lastReversibleEvent = useMemo(() => {
    return events.find((event) => canReverseTrailerEvent(event).allowed) ?? null;
  }, [events]);

  const lastReversiblePatch = useMemo(() => {
    if (!lastReversibleEvent) {
      return null;
    }

    return buildTrailerRestorePatch(lastReversibleEvent.old_value);
  }, [lastReversibleEvent]);

  const undoPreviewEntries = useMemo(() => {
    if (!lastReversiblePatch) {
      return [];
    }

    return Object.entries(lastReversiblePatch);
  }, [lastReversiblePatch]);

  const findAvailableCompoundPosition = async (excludeTrailerId: string) => {
    const { data, error: activeTrailersError } = await supabase
      .from("trailers")
      .select("id, compound_position")
      .is("departure_date", null)
      .neq("is_local", true)
      .neq("id", excludeTrailerId);

    if (activeTrailersError) {
      throw new Error(getSupabaseErrorMessage(activeTrailersError) || "Unable to validate compound positions.");
    }

    const occupied = new Set<string>();
    (data ?? []).forEach((item) => {
      const normalized = normalizeCompoundPosition((item as Record<string, unknown>)["compound_position"] as string | null | undefined);
      if (normalized) {
        occupied.add(normalized);
      }
    });

    const firstAvailable = Array.from({ length: 50 }, (_, index) => `P${String(index + 1).padStart(2, "0")}`).find(
      (position) => !occupied.has(position),
    );

    return { occupied, firstAvailable };
  };

  const handleUndoLastMovement = async () => {
    if (!trailer || !lastReversibleEvent) {
      return;
    }

    setIsReversing(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const { data: latestEvent, error: latestEventError } = await supabase
        .from("trailer_events")
        .select("id, trailer_id, trailer_number, event_type, event_description, old_value, new_value, created_at")
        .eq("id", lastReversibleEvent.id)
        .single();

      if (latestEventError || !latestEvent) {
        throw new Error(latestEventError?.message || "Unable to load latest event before undo.");
      }

      const eventValidation = canReverseTrailerEvent(latestEvent as TrailerEvent);
      if (!eventValidation.allowed) {
        throw new Error(eventValidation.reason || "This movement cannot be undone.");
      }

      const { data: currentTrailer, error: currentTrailerError } = await supabase
        .from("trailers")
        .select("id, trailer_number, trailer_type, load_status, load_description, customer, consignee, container_number, compound_position, arrival_date, departure_date, departure_time, trailer_source, external_company, external_reference, is_local, operational_status, notes")
        .eq("id", trailer.id)
        .single();

      if (currentTrailerError || !currentTrailer) {
        throw new Error(currentTrailerError?.message || "Unable to load current trailer before undo.");
      }

      const restorePatch = buildTrailerRestorePatch((latestEvent as TrailerEvent).old_value);
      if (Object.keys(restorePatch).length === 0) {
        throw new Error("Unable to undo because old_value has no reversible trailer fields.");
      }

      const currentSnapshot: Record<string, unknown> = {};
      Object.keys(restorePatch).forEach((field) => {
        currentSnapshot[field] = (currentTrailer as Record<string, unknown>)[field];
      });

      const effectivePatch: Database["public"]["Tables"]["trailers"]["Update"] = {
        ...(restorePatch as Partial<Database["public"]["Tables"]["trailers"]["Update"]>),
      };
      let reassignedCompoundPosition = false;

      const restoredLocalValue =
        Object.prototype.hasOwnProperty.call(effectivePatch, "is_local")
          ? effectivePatch["is_local"] === true
          : (currentTrailer as Record<string, unknown>)["is_local"] === true;
      const restoredDepartureValue =
        Object.prototype.hasOwnProperty.call(effectivePatch, "departure_date")
          ? effectivePatch["departure_date"]
          : (currentTrailer as Record<string, unknown>)["departure_date"];
      const willBeActive = isActiveFromValue(restoredDepartureValue);

      if (restoredLocalValue) {
        effectivePatch["compound_position"] = null;
      } else if (willBeActive) {
        const { occupied, firstAvailable } = await findAvailableCompoundPosition(trailer.id);
        const desiredPositionRaw = Object.prototype.hasOwnProperty.call(effectivePatch, "compound_position")
          ? (effectivePatch["compound_position"] as string | null | undefined)
          : ((currentTrailer as Record<string, unknown>)["compound_position"] as string | null | undefined);
        const desiredPosition = normalizeCompoundPosition(desiredPositionRaw);

        if (desiredPosition && !occupied.has(desiredPosition)) {
          effectivePatch["compound_position"] = desiredPosition;
        } else {
          if (!firstAvailable) {
            throw new Error("Unable to undo departure because no compound position is available.");
          }

          effectivePatch["compound_position"] = firstAvailable;
          reassignedCompoundPosition = Boolean(desiredPosition);
        }
      }

      const { error: restoreError } = await supabase
        .from("trailers")
        .update(effectivePatch)
        .eq("id", trailer.id);

      if (restoreError) {
        throw new Error(getSupabaseErrorMessage(restoreError) || "Unable to restore trailer state.");
      }

      const { error: reversalEventError } = await supabase
        .from("trailer_events")
        .insert({
          trailer_id: latestEvent.trailer_id,
          trailer_number: latestEvent.trailer_number,
          event_type: "movement_reversed",
          event_description: `Movement reversed: ${latestEvent.event_description ?? latestEvent.event_type}`,
          old_value: currentSnapshot as Json,
          new_value: effectivePatch as unknown as Json,
        })
        .select("id")
        .single();

      if (reversalEventError) {
        throw new Error(getSupabaseErrorMessage(reversalEventError) || "Unable to create reversal event.");
      }

      await loadTrailer();
      setShowUndoConfirm(false);
      setSuccessMessage(
        reassignedCompoundPosition
          ? "Movement reversed successfully. The previous position was occupied, so a new compound position was assigned."
          : "Last movement reversed successfully."
      );
    } catch (undoError) {
      setError(undoError instanceof Error ? undoError.message : "Unable to reverse the last movement.");
    } finally {
      setIsReversing(false);
    }
  };

  const refreshTrailerData = async (id: string) => {
    const { data, error } = await supabase
      .from("trailers")
      .select(
        "id, trailer_number, trailer_type, compound_position, trailer_source, external_company, external_reference, is_local, load_status, operational_status, customer, consignee, container_number, load_description, notes, arrival_date, departure_date"
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
      .select("id, trailer_id, trailer_number, event_type, event_description, old_value, new_value, created_at")
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
    };

    let updatePayload: Database["public"]["Tables"]["trailers"]["Update"] = {};
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
        };
        eventDescription = "Trailer marked as delivered.";
        break;
      case "Return Empty":
        updatePayload = {
          operational_status: "Returned Empty",
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

    await loadTrailer();

    setSuccessMessage(`${action} completed successfully.`);
    setIsSaving(false);
  };

  const handleAction = (label: string) => {
    if (["Mark Empty", "Mark On Delivery", "Mark Delivered", "Return Empty"].includes(label)) {
      void applyOperationalAction(label);
      return;
    }

    setError(`${label} is not available from this screen.`);
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
        .select("id, trailer_number, trailer_type, compound_position, trailer_source, external_company, external_reference, is_local, load_status, operational_status, customer, consignee, container_number, load_description, notes, arrival_date, departure_date")
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
      await loadTrailer();
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
        ) : !operationalProfile ? (
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

            <section className="grid gap-6 rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-inner shadow-black/20 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="space-y-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.24em] text-cyan-400">Trailer identity</p>
                  <h2 className="mt-2 text-3xl font-semibold text-white">{operationalProfile.identifier}</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${derivedStageBadgeClass}`}>
                      {operationalProfile.position.stageLabel}
                    </span>
                    <span className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-1 text-xs font-semibold text-slate-200">
                      {operationalProfile.fleetStatus}
                    </span>
                    {operationalProfile.position.priority ? (
                      <span className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-1 text-xs font-semibold text-slate-200 capitalize">
                        Priority: {operationalProfile.position.priority}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Trailer Type</p>
                    <p className="mt-2 text-base font-semibold text-white">{operationalProfile.trailerType ?? "-"}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Current Location</p>
                    <p className="mt-2 text-base font-semibold text-white">{operationalProfile.position.currentLocation ?? "-"}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Customer</p>
                    <p className="mt-2 text-base font-semibold text-white">{operationalProfile.position.customer ?? "-"}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Compound Position</p>
                    <p className="mt-2 text-base font-semibold text-white">{operationalProfile.position.compoundPosition ?? "-"}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Vessel / Voyage</p>
                    <p className="mt-2 text-base font-semibold text-white">
                      {operationalProfile.position.vessel ?? operationalProfile.position.voyage
                        ? `${operationalProfile.position.vessel ?? "-"}${operationalProfile.position.voyage ? ` / ${operationalProfile.position.voyage}` : ""}`
                        : "-"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Current Operation Ref</p>
                    <p className="mt-2 text-base font-semibold text-white">{operationalProfile.position.currentOperationReference ?? "-"}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-3xl border border-white/5 bg-slate-950/70 p-5">
                <div className="rounded-2xl bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Stage Started</p>
                  <p className="mt-2 text-base font-semibold text-white">{formatDateTime(operationalProfile.position.stageStartedAt)}</p>
                </div>
                <div className="rounded-2xl bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Duration In Stage</p>
                  <p className="mt-2 text-base font-semibold text-white">{operationalProfile.position.dwell.durationInStageLabel}</p>
                </div>
                <div className="rounded-2xl bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Yard Dwell</p>
                  <p className="mt-2 text-base font-semibold text-white">{operationalProfile.position.dwell.totalYardDwellLabel}</p>
                </div>
                <div className="rounded-2xl bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Issues</p>
                  {operationalProfile.position.issueIndicator.hasIssues ? (
                    <div className="mt-2 space-y-2 text-sm text-rose-200">
                      {operationalProfile.position.issueIndicator.reasons.map((reason) => (
                        <p key={reason}>{reason}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm font-semibold text-emerald-200">No active issues</p>
                  )}
                </div>
                <div className="rounded-2xl bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Next Available Action</p>
                  {operationalProfile.position.nextRecommendedAction ? (
                    operationalProfile.position.nextRecommendedAction.href ? (
                      <Link
                        href={operationalProfile.position.nextRecommendedAction.href}
                        className="mt-2 inline-block text-sm font-semibold text-cyan-200 underline hover:text-cyan-100"
                      >
                        {operationalProfile.position.nextRecommendedAction.label}
                      </Link>
                    ) : (
                      <p className="mt-2 text-sm font-semibold text-slate-200">{operationalProfile.position.nextRecommendedAction.label}</p>
                    )
                  ) : (
                    <p className="mt-2 text-sm text-slate-300">No direct action available.</p>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-inner shadow-black/10">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Related Records</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">Operational links</h3>
                </div>
                <p className="text-sm text-slate-400">Precedence: {operationalProfile.position.precedenceReason}</p>
              </div>

              {operationalProfile.relatedRecords.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-slate-950/80 p-5 text-sm text-slate-400">
                  No related operational records were found.
                </div>
              ) : (
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {operationalProfile.relatedRecords.map((record) => (
                    <div key={record.id} className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{record.module}</p>
                      <p className="mt-2 text-base font-semibold text-white">{record.label}</p>
                      <p className="mt-1 text-sm text-slate-400">{formatDateTime(record.recordedAt ?? null)}</p>
                      {record.href ? (
                        <Link href={record.href} className="mt-3 inline-block text-sm font-semibold text-cyan-200 underline hover:text-cyan-100">
                          Open Record
                        </Link>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {trailer ? (
            <section className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.3em] text-amber-300">Movement Control</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">Undo Last Movement</h3>
                  <p className="mt-2 text-sm text-amber-100/90">
                    Restore the trailer to its previous operational state while keeping a full audit trail.
                  </p>
                </div>
                {lastReversibleEvent ? (
                  <button
                    type="button"
                    onClick={() => setShowUndoConfirm(true)}
                    disabled={isReversing}
                    className="rounded-2xl border border-amber-300/40 bg-amber-300/15 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-300/25 disabled:opacity-60"
                  >
                    {isReversing ? "Reversing..." : "Undo Last Movement"}
                  </button>
                ) : null}
              </div>

              {lastReversibleEvent ? (
                <div className="mt-4 rounded-2xl border border-amber-300/25 bg-slate-950/40 p-4">
                  <p className="text-sm font-semibold text-white">{lastReversibleEvent.event_description ?? lastReversibleEvent.event_type}</p>
                  <p className="mt-1 text-xs text-slate-300">{formatDateTime(lastReversibleEvent.created_at)}</p>

                  {undoPreviewEntries.length > 0 ? (
                    <div className="mt-3 grid gap-2 text-xs text-slate-200 sm:grid-cols-2">
                      {undoPreviewEntries.map(([field, value]) => (
                        <div key={field} className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2">
                          <p className="uppercase tracking-[0.2em] text-slate-400">{field}</p>
                          <p className="mt-1 text-sm text-white">{formatValue(value)}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-white/20 bg-slate-950/40 p-4 text-sm text-slate-300">
                  No reversible movement is currently available for this trailer.
                </div>
              )}

              {showUndoConfirm && lastReversibleEvent ? (
                <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
                  <p className="text-lg font-semibold text-rose-100">Undo Last Movement?</p>
                  <p className="mt-2 text-sm text-rose-100/90">
                    This will restore the trailer to its previous operational state. The original event will remain in the history and will be marked as reversed.
                  </p>
                  <div className="mt-3 grid gap-2 text-sm text-slate-100 sm:grid-cols-2">
                    <p>Trailer Number: {trailer.trailer_number ?? "—"}</p>
                    <p>Movement: {lastReversibleEvent.event_description ?? lastReversibleEvent.event_type ?? "—"}</p>
                    <p>Event Date: {formatDateTime(lastReversibleEvent.created_at)}</p>
                    <p>Fields to Restore: {undoPreviewEntries.length}</p>
                  </div>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => void handleUndoLastMovement()}
                      disabled={isReversing}
                      className="rounded-2xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-400 disabled:opacity-60"
                    >
                      {isReversing ? "Reversing..." : "Confirm Undo"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowUndoConfirm(false)}
                      disabled={isReversing}
                      className="rounded-2xl border border-white/15 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
            ) : null}
            <div className="grid gap-6 rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-inner shadow-black/20 sm:grid-cols-[1.5fr_1fr]">
              <div className="space-y-3">
                <p className="text-sm uppercase tracking-[0.24em] text-cyan-400">Trailer overview</p>
                <h2 className="text-3xl font-semibold text-white">
                  {operationalProfile.identifier}
                </h2>
                <p className="max-w-xl text-sm text-slate-300">
                  Compound position, load and operational status for this trailer.
                </p>
              </div>

              <div className="grid gap-3 rounded-3xl border border-white/5 bg-slate-950/80 p-5">
                <div className="rounded-3xl bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Location type</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {trailer?.is_local ? "Local" : operationalProfile.position.operationalStage === "local" ? "Local" : "Compound"}
                  </p>
                </div>

                {!trailer?.is_local ? (
                  <div className="rounded-3xl bg-slate-900/70 p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Current position</p>
                    <p className="mt-2 text-lg font-semibold text-white">
                      {operationalProfile.position.compoundPosition ?? "Not assigned"}
                    </p>
                  </div>
                ) : null}

                <div className="rounded-3xl bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Ownership</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {operationalProfile.fleetStatus}
                  </p>
                </div>

                <div className="rounded-3xl bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">External Company</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {trailer?.trailer_source === "outsourced" ? trailer.external_company ?? "—" : "—"}
                  </p>
                </div>

                <div className="rounded-3xl bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">External Reference</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {trailer?.trailer_source === "outsourced" ? trailer.external_reference ?? "—" : "—"}
                  </p>
                </div>

                <div className="rounded-3xl bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Load status</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {trailer?.load_status ?? "Unknown"}
                  </p>
                </div>

                <div className="rounded-3xl bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Operational status</p>
                  <p className="mt-2">
                    <span className={trailer ? statusBadgeClass : `rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${derivedStageBadgeClass}`}>
                      {trailer ? currentStatus : operationalProfile.position.stageLabel}
                    </span>
                  </p>
                </div>

                {activeExportAllocation ? (
                  <div className="rounded-3xl border border-orange-400/30 bg-orange-500/10 p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-orange-200">Export Allocation</p>
                    <p className="mt-2">
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getExportAllocationStatusClasses(activeExportAllocation.status)}`}>
                        {getExportAllocationStatusLabel(activeExportAllocation.status)}
                      </span>
                    </p>
                    <p className="mt-3 text-sm text-slate-100">Allocation Customer: {activeExportAllocation.customer ?? "-"}</p>
                    <p className="mt-1 text-sm text-slate-200">Collection Date: {formatDate(activeExportAllocation.collection_date)}</p>
                    <p className="mt-1 text-sm text-slate-200">Haulier: {activeExportAllocation.haulier ?? "-"}</p>
                    <p className="mt-1 text-sm text-slate-200">Booking Ref: {activeExportAllocation.booking_reference ?? "-"}</p>
                    <Link
                      href={`/dashboard/export-operations/${activeExportAllocation.id}`}
                      className="mt-3 inline-block text-sm font-semibold text-cyan-200 underline hover:text-cyan-100"
                    >
                      View Export Allocation
                    </Link>
                  </div>
                ) : null}
              </div>
            </div>

            {trailer ? (
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
                </div>
              </article>
            </div>
            ) : null}

            <TrailerTimeline events={operationalProfile.events} />

            {trailer ? (
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
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}
