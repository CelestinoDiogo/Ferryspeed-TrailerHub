"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OperationalActionBar } from "@/components/operations/operational-action-bar";
import { TrailerOperationsPanel } from "@/components/operations/trailer-operations-panel";
import { SuccessToast } from "@/components/common/success-toast";
import { TrailerHistoryDrawer } from "@/components/trailers/trailer-history-drawer";
import { createTrailerActivity } from "@/lib/trailer-activity";
import { logTrailerEvent, resolveAuditOperatorName } from "@/lib/trailer-audit-log";
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
  arrival_date?: string | null;
  departure_date?: string | null;
  departure_time?: string | null;
  operational_status?: string | null;
  is_local?: boolean | null;
  active?: boolean | null;
  cancelled?: boolean | null;
  canceled?: boolean | null;
  is_cancelled?: boolean | null;
  is_canceled?: boolean | null;
  cancelled_at?: string | null;
  canceled_at?: string | null;
  status?: string | null;
};

type DepartureTransitionSnapshot = {
  trailerId: string;
  trailerNumber: string | null;
  previousDepartureDate: string | null;
  previousDepartureTime: string | null;
  previousCompoundPosition: string | null;
  previousOperationalStatus: string | null;
};

type DepartureLoadFilter = "all" | "empty" | "loaded";
type DepartureSort = "trailer_asc" | "trailer_desc" | "arrival_desc";

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const isMissingDepartureDate = (value?: string | null) => {
  if (value === null || value === undefined) {
    return true;
  }

  return value.trim().length === 0;
};

const isCancelledTrailer = (trailer: TrailerRecord) => {
  if (trailer.cancelled === true || trailer.canceled === true || trailer.is_cancelled === true || trailer.is_canceled === true) {
    return true;
  }

  if (Boolean(trailer.cancelled_at?.trim()) || Boolean(trailer.canceled_at?.trim())) {
    return true;
  }

  const statusTokens = [trailer.operational_status, trailer.status]
    .map((value) => normalizeText(value))
    .filter(Boolean);

  return statusTokens.some((status) => status === "cancelled" || status === "canceled" || status === "cancelado");
};

const normalizeTrailerPrefix = (value?: string | null) => {
  const trailer = value?.trim().toUpperCase() ?? "";
  if (!trailer) {
    return "";
  }

  const match = trailer.match(/^[A-Z]+/);
  return match?.[0] ?? "";
};

const isEligibleForDeparture = (trailer: TrailerRecord) => {
  if (!trailer.trailer_number?.trim()) {
    return false;
  }

  if (!isMissingDepartureDate(trailer.departure_date)) {
    return false;
  }

  if (trailer.active === false) {
    return false;
  }

  if (isCancelledTrailer(trailer)) {
    return false;
  }

  const operationalStatus = normalizeText(trailer.operational_status);
  if (operationalStatus === "departed") {
    return false;
  }

  return true;
};

export default function DeparturePage() {
  const [trailers, setTrailers] = useState<TrailerRecord[]>([]);
  const [selectedTrailerId, setSelectedTrailerId] = useState<string | null>(null);
  const [selectedTrailerIds, setSelectedTrailerIds] = useState<string[]>([]);
  const [requestedTrailerId, setRequestedTrailerId] = useState<string | null>(null);
  const [requestedTrailerNumber, setRequestedTrailerNumber] = useState<string | null>(null);
  const [processingTrailerIds, setProcessingTrailerIds] = useState<string[]>([]);
  const [historyTrailer, setHistoryTrailer] = useState<{ trailerId: string | null; trailerNumber: string | null } | null>(null);
  const [panelTrailerId, setPanelTrailerId] = useState<string | null>(null);
  const [lastDepartureSnapshot, setLastDepartureSnapshot] = useState<DepartureTransitionSnapshot | null>(null);
  const [search, setSearch] = useState("");
  const [loadFilter, setLoadFilter] = useState<DepartureLoadFilter>("all");
  const [customerFilter, setCustomerFilter] = useState<string>("all");
  const [prefixFilter, setPrefixFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<DepartureSort>("trailer_asc");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadDepartureTrailers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .from("trailers")
        .select("*")
        .order("arrival_date", { ascending: false });

      if (supabaseError) {
        throw supabaseError;
      }

      const loadedRaw = (data ?? []) as TrailerRecord[];
      const deduped = new Map<string, TrailerRecord>();
      for (const trailer of loadedRaw) {
        if (!trailer.id) {
          continue;
        }

        if (!isEligibleForDeparture(trailer)) {
          continue;
        }

        if (!deduped.has(trailer.id)) {
          deduped.set(trailer.id, trailer);
        }
      }

      const loaded = Array.from(deduped.values());
      setTrailers(loaded);

      if (process.env.NODE_ENV !== "production") {
        console.debug("[departure] trailers loaded", {
          totalRows: loadedRaw.length,
          eligibleRows: loaded.length,
        });
      }

      setSelectedTrailerId((currentSelection) => {
        if (currentSelection && loaded.some((row) => row.id === currentSelection)) {
          return currentSelection;
        }

        const targetById = requestedTrailerId ? loaded.find((row) => row.id === requestedTrailerId) : null;
        const targetByNumber = requestedTrailerNumber
          ? loaded.find(
              (row) => row.trailer_number?.trim().toUpperCase() === requestedTrailerNumber.trim().toUpperCase(),
            )
          : null;
        const target = targetById ?? targetByNumber;
        return target?.id ?? currentSelection ?? null;
      });

      const targetById = requestedTrailerId ? loaded.find((row) => row.id === requestedTrailerId) : null;
      const targetByNumber = requestedTrailerNumber
        ? loaded.find(
            (row) => row.trailer_number?.trim().toUpperCase() === requestedTrailerNumber.trim().toUpperCase(),
          )
        : null;
      const target = targetById ?? targetByNumber;
      if (target) {
        setSearch(target.trailer_number ?? "");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load departure candidates.";
      if (process.env.NODE_ENV !== "production") {
        console.error("[departure] load failed", { message });
      }
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [requestedTrailerId, requestedTrailerNumber]);

  useEffect(() => {
    if (!success) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSuccess(null);
    }, 2600);

    return () => window.clearTimeout(timeoutId);
  }, [success]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRequestedTrailerId(params.get("trailerId"));
    setRequestedTrailerNumber(params.get("trailer"));
    setSearch(params.get("search") ?? "");

    const nextLoad = (params.get("load") ?? "all").toLowerCase();
    if (nextLoad === "all" || nextLoad === "empty" || nextLoad === "loaded") {
      setLoadFilter(nextLoad);
    }

    const nextSort = (params.get("sort") ?? "trailer_asc").toLowerCase();
    if (nextSort === "trailer_asc" || nextSort === "trailer_desc" || nextSort === "arrival_desc") {
      setSortBy(nextSort);
    }

    setCustomerFilter((params.get("customer") ?? "all").trim() || "all");
    setPrefixFilter((params.get("prefix") ?? "all").trim().toUpperCase() || "all");
  }, []);

  useEffect(() => {
    void loadDepartureTrailers();
  }, [loadDepartureTrailers]);

  const customerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    trailers.forEach((trailer) => {
      const customer = trailer.customer?.trim();
      if (!customer) {
        return;
      }

      const key = customer.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, customer);
      }
    });

    return Array.from(seen.values()).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }, [trailers]);

  const prefixOptions = useMemo(() => {
    const prefixes = new Set<string>();
    trailers.forEach((trailer) => {
      const prefix = normalizeTrailerPrefix(trailer.trailer_number);
      if (prefix) {
        prefixes.add(prefix);
      }
    });

    return Array.from(prefixes).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }, [trailers]);

  const filteredTrailers = useMemo(() => {
    const term = search.trim().toLowerCase();

    const filtered = trailers.filter((trailer) => {
      const haystack = [
        trailer.trailer_number,
        trailer.container_number,
        trailer.customer,
        trailer.consignee,
        trailer.compound_position,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const normalizedLoad = normalizeText(trailer.load_status);
      const normalizedCustomer = trailer.customer?.trim() ?? "";
      const trailerPrefix = normalizeTrailerPrefix(trailer.trailer_number);

      if (term && !haystack.includes(term)) {
        return false;
      }

      if (loadFilter === "empty" && !normalizedLoad.includes("empty")) {
        return false;
      }

      if (loadFilter === "loaded" && !normalizedLoad.includes("loaded")) {
        return false;
      }

      if (customerFilter !== "all" && normalizedCustomer !== customerFilter) {
        return false;
      }

      if (prefixFilter !== "all" && trailerPrefix !== prefixFilter) {
        return false;
      }

      return true;
    });

    return [...filtered].sort((left, right) => {
      if (sortBy === "arrival_desc") {
        const leftTime = left.arrival_date ? new Date(left.arrival_date).getTime() : Number.NaN;
        const rightTime = right.arrival_date ? new Date(right.arrival_date).getTime() : Number.NaN;
        const leftValid = Number.isFinite(leftTime);
        const rightValid = Number.isFinite(rightTime);

        if (leftValid && rightValid && leftTime !== rightTime) {
          return rightTime - leftTime;
        }

        if (!leftValid && rightValid) {
          return 1;
        }

        if (leftValid && !rightValid) {
          return -1;
        }
      }

      const leftTrailer = left.trailer_number?.trim() ?? "";
      const rightTrailer = right.trailer_number?.trim() ?? "";
      const base = leftTrailer.localeCompare(rightTrailer, undefined, {
        numeric: true,
        sensitivity: "base",
      });

      return sortBy === "trailer_desc" ? -base : base;
    });
  }, [customerFilter, loadFilter, prefixFilter, search, sortBy, trailers]);

  const eligibleVisibleIds = useMemo(
    () => filteredTrailers.filter((trailer) => isEligibleForDeparture(trailer)).map((trailer) => trailer.id),
    [filteredTrailers],
  );

  const selectedTrailer = filteredTrailers.find((item) => item.id === selectedTrailerId) ?? null;
  const selectedVisibleCount = eligibleVisibleIds.filter((id) => selectedTrailerIds.includes(id)).length;
  const panelTrailer = trailers.find((item) => item.id === panelTrailerId) ?? null;

  const handleSelectTrailer = (trailerId: string) => {
    setSelectedTrailerId(trailerId);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (search.trim()) {
      params.set("search", search.trim());
    } else {
      params.delete("search");
    }

    if (loadFilter === "all") {
      params.delete("load");
    } else {
      params.set("load", loadFilter);
    }

    if (customerFilter === "all") {
      params.delete("customer");
    } else {
      params.set("customer", customerFilter);
    }

    if (prefixFilter === "all") {
      params.delete("prefix");
    } else {
      params.set("prefix", prefixFilter);
    }

    if (sortBy === "trailer_asc") {
      params.delete("sort");
    } else {
      params.set("sort", sortBy);
    }

    const nextQuery = params.toString();
    const nextUrl = nextQuery ? `${window.location.pathname}?${nextQuery}` : window.location.pathname;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState({}, "", nextUrl);
    }
  }, [customerFilter, loadFilter, prefixFilter, search, sortBy]);

  const toggleTrailerSelection = (trailerId: string) => {
    const trailer = filteredTrailers.find((row) => row.id === trailerId);
    if (!trailer || !isEligibleForDeparture(trailer)) {
      return;
    }

    setSelectedTrailerIds((current) => {
      if (current.includes(trailerId)) {
        return current.filter((id) => id !== trailerId);
      }
      return [...current, trailerId];
    });
  };

  const toggleSelectVisible = () => {
    setSelectedTrailerIds((current) => {
      const visibleIds = eligibleVisibleIds;
      const allVisibleSelected = visibleIds.every((id) => current.includes(id));
      if (allVisibleSelected) {
        return current.filter((id) => !visibleIds.includes(id));
      }

      const merged = new Set(current);
      visibleIds.forEach((id) => merged.add(id));
      return Array.from(merged);
    });
  };

  useEffect(() => {
    setSelectedTrailerIds((current) => current.filter((id) => trailers.some((row) => row.id === id && isEligibleForDeparture(row))));
  }, [trailers]);

  const clearSelections = () => {
    setSelectedTrailerIds([]);
  };

  const handleQuickMove = async (trailerId: string, nextPosition: string) => {
    const nowIso = new Date().toISOString();
    const current = trailers.find((item) => item.id === trailerId);
    if (!current) {
      throw new Error("Trailer not found.");
    }

    const { error: updateError } = await supabase
      .from("trailers")
      .update({
        compound_position: nextPosition,
      })
      .eq("id", trailerId)
      .select("id")
      .single();

    if (updateError) {
      throw new Error(updateError.message || "Unable to update compound position.");
    }

    const operatorName = await resolveAuditOperatorName();
    await createTrailerActivity({
      trailerId,
      trailerNumber: current.trailer_number ?? trailerId,
      eventType: "compound_position_assigned",
      eventTitle: "Position updated",
      eventDescription: `Compound position changed to ${nextPosition}.`,
      sourceModule: "operations",
      sourceRecordId: trailerId,
      previousStatus: current.operational_status ?? null,
      newStatus: current.operational_status ?? null,
      previousCompoundPosition: current.compound_position ?? null,
      newCompoundPosition: nextPosition,
      performedBy: operatorName,
      createdAt: nowIso,
    });

    setTrailers((rows) => rows.map((row) => (row.id === trailerId ? { ...row, compound_position: nextPosition } : row)));
  };

  const registerDepartureHistory = async (
    trailerId: string,
    trailerNumber: string | null,
    previousValue: DepartureTransitionSnapshot,
    updatePayload: { departure_date: string; departure_time: string; operational_status: string; compound_position: null },
    operatorName: string,
  ) => {
    const { error: eventError } = await supabase.from("trailer_events").insert({
      trailer_id: trailerId,
      trailer_number: trailerNumber,
      event_type: "departure_registered",
      event_description: "Trailer departure registered.",
      old_value: {
        departure_date: previousValue.previousDepartureDate,
        departure_time: previousValue.previousDepartureTime,
        compound_position: previousValue.previousCompoundPosition,
        operational_status: previousValue.previousOperationalStatus,
      },
      new_value: {
        departure_date: updatePayload.departure_date,
        departure_time: updatePayload.departure_time,
        compound_position: updatePayload.compound_position,
        operational_status: updatePayload.operational_status,
      },
    });

    if (eventError) {
      throw new Error(eventError.message || "Unable to create trailer event history.");
    }

    await logTrailerEvent({
      trailerId,
      trailerNumber,
      eventType: "departure_registered",
      description: "Trailer departure registered.",
      previousValue: {
        departure_date: previousValue.previousDepartureDate,
        departure_time: previousValue.previousDepartureTime,
        compound_position: previousValue.previousCompoundPosition,
        operational_status: previousValue.previousOperationalStatus,
      },
      newValue: {
        departure_date: updatePayload.departure_date,
        departure_time: updatePayload.departure_time,
        compound_position: updatePayload.compound_position,
        operational_status: updatePayload.operational_status,
      },
      sourceModule: "departure",
      performedBy: operatorName,
    });

    await createTrailerActivity({
      trailerId,
      trailerNumber: trailerNumber ?? trailerId,
      eventType: "departed",
      eventTitle: "Trailer departed",
      eventDescription: "Trailer departure registered from departure list.",
      sourceModule: "operations",
      sourceRecordId: trailerId,
      previousStatus: previousValue.previousOperationalStatus,
      newStatus: "Departed",
      previousCompoundPosition: previousValue.previousCompoundPosition,
      newCompoundPosition: null,
      metadata: {
        departure_date: updatePayload.departure_date,
        departure_time: updatePayload.departure_time,
      },
      performedBy: operatorName,
      createdAt: updatePayload.departure_date,
    });
  };

  const performDeparture = async (targetTrailerId: string) => {
    const now = new Date();
    const nowIso = now.toISOString();
    const nowTime = now.toTimeString().slice(0, 8);

    const { data: currentTrailer, error: currentTrailerError } = await supabase
      .from("trailers")
      .select("id, trailer_number, departure_date, departure_time, compound_position, operational_status, is_local")
      .eq("id", targetTrailerId)
      .single();

    if (currentTrailerError || !currentTrailer) {
      throw new Error(currentTrailerError?.message || "Unable to load current trailer state before departure.");
    }

    if (currentTrailer.departure_date) {
      throw new Error(`Trailer ${currentTrailer.trailer_number ?? targetTrailerId} is already departed.`);
    }

    const previousValue: DepartureTransitionSnapshot = {
      trailerId: currentTrailer.id,
      trailerNumber: currentTrailer.trailer_number ?? null,
      previousDepartureDate: currentTrailer.departure_date ?? null,
      previousDepartureTime: currentTrailer.departure_time ?? null,
      previousCompoundPosition: currentTrailer.compound_position ?? null,
      previousOperationalStatus: currentTrailer.operational_status ?? null,
    };

    const updatePayload = {
      departure_date: nowIso,
      departure_time: nowTime,
      operational_status: "Departed",
      compound_position: null,
    };

    const { data, error } = await supabase
      .from("trailers")
      .update(updatePayload)
      .eq("id", targetTrailerId)
      .is("departure_date", null)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new Error(error.message || "Unable to confirm departure.");
    }

    if (!data) {
      throw new Error("No trailer was updated. Another operator may have already completed this action.");
    }

    const operatorName = await resolveAuditOperatorName();

    try {
      await registerDepartureHistory(currentTrailer.id, currentTrailer.trailer_number ?? null, previousValue, updatePayload, operatorName);
    } catch (historyError) {
      const rollbackResult = await supabase
        .from("trailers")
        .update({
          departure_date: previousValue.previousDepartureDate,
          departure_time: previousValue.previousDepartureTime,
          operational_status: previousValue.previousOperationalStatus,
          compound_position: previousValue.previousCompoundPosition,
        })
        .eq("id", currentTrailer.id)
        .eq("departure_date", updatePayload.departure_date)
        .select("id")
        .maybeSingle();

      if (rollbackResult.error || !rollbackResult.data) {
        throw new Error("Departure update succeeded but history logging failed, and automatic rollback could not be completed.");
      }

      throw new Error("Departure was rolled back because history logging failed.");
    }

    return {
      snapshot: previousValue,
      trailerNumber: currentTrailer.trailer_number ?? null,
    };
  };

  const removeTrailersFromList = (trailerIds: string[]) => {
    const removedSet = new Set(trailerIds);
    setTrailers((current) => {
      const remaining = current.filter((item) => !removedSet.has(item.id));
      if (selectedTrailerId && removedSet.has(selectedTrailerId)) {
        window.setTimeout(() => {
          setSelectedTrailerId(remaining[0]?.id ?? null);
        }, 0);
      }
      return remaining;
    });
    setSelectedTrailerIds((current) => current.filter((id) => !removedSet.has(id)));
  };

  const handleConfirmSingleDeparture = async (targetTrailerId: string) => {
    if (isSubmitting) {
      return;
    }

    const targetTrailer = trailers.find((row) => row.id === targetTrailerId);
    if (!targetTrailer || !isEligibleForDeparture(targetTrailer)) {
      setError("This trailer is not eligible for departure.");
      return;
    }

    setIsSubmitting(true);
    setProcessingTrailerIds((current) => (current.includes(targetTrailerId) ? current : [...current, targetTrailerId]));
    setError(null);
    setSuccess(null);

    try {
      const result = await performDeparture(targetTrailerId);
      removeTrailersFromList([targetTrailerId]);
      await loadDepartureTrailers();
      setLastDepartureSnapshot(result.snapshot);
      setSuccess(`${result.trailerNumber ?? "Trailer"} departed.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to confirm departure.";
      setError(message);
    } finally {
      setProcessingTrailerIds((current) => current.filter((id) => id !== targetTrailerId));
      setIsSubmitting(false);
    }
  };

  const handleConfirmBatchDeparture = async () => {
    const targets = selectedTrailerIds.filter((id) => {
      const row = trailers.find((item) => item.id === id);
      return Boolean(row && isEligibleForDeparture(row));
    });
    if (targets.length === 0 || isSubmitting) {
      setError("Select at least one trailer for batch departure.");
      return;
    }

    const confirmed = window.confirm(`Confirm departure for ${targets.length} trailer${targets.length === 1 ? "" : "s"}?`);
    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    setProcessingTrailerIds(targets);

    const succeeded: Array<{ id: string; number: string | null; snapshot: DepartureTransitionSnapshot }> = [];
    const failed: string[] = [];

    for (const targetId of targets) {
      try {
        const result = await performDeparture(targetId);
        succeeded.push({ id: targetId, number: result.trailerNumber, snapshot: result.snapshot });
      } catch (err) {
        const trailerNumber = trailers.find((row) => row.id === targetId)?.trailer_number ?? targetId;
        const message = err instanceof Error ? err.message : "Unable to confirm departure.";
        failed.push(`${trailerNumber}: ${message}`);
      }
    }

    if (succeeded.length > 0) {
      removeTrailersFromList(succeeded.map((item) => item.id));
      await loadDepartureTrailers();
      setLastDepartureSnapshot(succeeded[succeeded.length - 1]?.snapshot ?? null);
      setSuccess(`${succeeded.length} trailer${succeeded.length === 1 ? "" : "s"} departed.`);
    }

    if (failed.length > 0) {
      setError(`Some departures failed: ${failed.join(" | ")}`);
    }

    setProcessingTrailerIds([]);
    setIsSubmitting(false);
  };

  const handleUndoLastDeparture = async () => {
    if (!lastDepartureSnapshot || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const nowIso = new Date().toISOString();
      const { data: restoredTrailer, error: restoreError } = await supabase
        .from("trailers")
        .update({
          departure_date: lastDepartureSnapshot.previousDepartureDate,
          departure_time: lastDepartureSnapshot.previousDepartureTime,
          operational_status: lastDepartureSnapshot.previousOperationalStatus,
          compound_position: lastDepartureSnapshot.previousCompoundPosition,
        })
        .eq("id", lastDepartureSnapshot.trailerId)
        .select("id, trailer_number, trailer_type, load_status, load_description, customer, consignee, container_number, compound_position, arrival_date, departure_date, departure_time, operational_status, is_local")
        .single();

      if (restoreError || !restoredTrailer) {
        throw new Error(restoreError?.message || "Unable to undo last departure.");
      }

      const operatorName = await resolveAuditOperatorName();

      await createTrailerActivity({
        trailerId: restoredTrailer.id,
        trailerNumber: restoredTrailer.trailer_number ?? restoredTrailer.id,
        eventType: "movement_undone",
        eventTitle: "Departure undone",
        eventDescription: "Departure action was undone from departure list.",
        sourceModule: "operations",
        sourceRecordId: restoredTrailer.id,
        previousStatus: "Departed",
        newStatus: lastDepartureSnapshot.previousOperationalStatus,
        previousCompoundPosition: null,
        newCompoundPosition: lastDepartureSnapshot.previousCompoundPosition,
        metadata: {
          undo_target: "departure_registered",
          undone_at: nowIso,
        },
        performedBy: operatorName,
        createdAt: nowIso,
      });

      setTrailers((current) => [restoredTrailer as TrailerRecord, ...current]);
      await loadDepartureTrailers();
      setLastDepartureSnapshot(null);
      setSuccess(`Undo applied for ${restoredTrailer.trailer_number ?? "trailer"}.`);
    } catch (undoErr) {
      setError(undoErr instanceof Error ? undoErr.message : "Unable to undo departure.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Departure</h1>
          <p className="mt-2 text-sm text-slate-300 sm:text-base">
            Search active trailers and confirm departures quickly and accurately.
          </p>
        </header>

        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void loadDepartureTrailers()}
              className="rounded-xl border border-rose-300/40 bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-500/30"
            >
              Retry
            </button>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
            <OperationalActionBar
              moduleLabel="Departures"
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search by trailer, container, customer, consignee or position"
              prefixOptions={[{ value: "all", label: "All" }, ...prefixOptions.map((prefix) => ({ value: prefix, label: prefix }))]}
              prefixValue={prefixFilter}
              onPrefixChange={setPrefixFilter}
              statusOptions={[
                { value: "all", label: "All" },
                { value: "empty", label: "Empty" },
                { value: "loaded", label: "Loaded" },
              ]}
              statusValue={loadFilter}
              onStatusChange={(value) => setLoadFilter(value as DepartureLoadFilter)}
              sortOptions={[
                { value: "trailer_asc", label: "Trailer A-Z" },
                { value: "trailer_desc", label: "Trailer Z-A" },
                { value: "arrival_desc", label: "Newest Arrival" },
              ]}
              sortValue={sortBy}
              onSortChange={(value) => setSortBy(value as DepartureSort)}
              selectedCount={selectedVisibleCount}
              primaryActions={
                <>
                  <button
                    type="button"
                    onClick={toggleSelectVisible}
                    className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    {eligibleVisibleIds.length > 0 && selectedVisibleCount === eligibleVisibleIds.length ? "Unselect Visible" : "Select Visible"}
                  </button>
                  <button
                    type="button"
                    onClick={clearSelections}
                    disabled={selectedTrailerIds.length === 0}
                    className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmBatchDeparture()}
                    disabled={isSubmitting || selectedTrailerIds.length === 0}
                    className="rounded-xl bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                  >
                    {isSubmitting ? "Processing..." : "Confirm Departure"}
                  </button>
                </>
              }
              secondaryActions={
                <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Customer
                  <select
                    value={customerFilter}
                    onChange={(event) => setCustomerFilter(event.target.value)}
                    className="mt-1.5 h-10 rounded-xl border border-white/10 bg-slate-950/85 px-3 text-sm text-slate-100"
                  >
                    <option value="all">All</option>
                    {customerOptions.map((customer) => (
                      <option key={customer} value={customer}>
                        {customer}
                      </option>
                    ))}
                  </select>
                </label>
              }
            />

            <div className="mt-4 space-y-3">
              {isLoading ? (
                <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-sm text-slate-400">
                  Loading departure candidates...
                </div>
              ) : filteredTrailers.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-sm text-slate-400">
                  <p>No eligible trailers found for departure with the current filters.</p>
                  <button
                    type="button"
                    onClick={() => void loadDepartureTrailers()}
                    className="mt-3 rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                filteredTrailers.map((trailer) => {
                  const isEligible = isEligibleForDeparture(trailer);

                  return (
                    <article
                      key={trailer.id}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        selectedTrailerId === trailer.id
                          ? "border-cyan-400/50 bg-cyan-500/10"
                          : "border-white/10 bg-slate-950/80 hover:bg-slate-800"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <button
                            type="button"
                            onClick={() => handleSelectTrailer(trailer.id)}
                            className="text-left"
                          >
                            <p className="text-sm font-semibold text-white">{trailer.trailer_number ?? "Unnamed trailer"}</p>
                          </button>
                          <p className="mt-1 text-sm text-slate-400">{trailer.customer ?? "No customer"}</p>
                        </div>
                        <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-200">
                          {trailer.load_status ?? "Unknown"}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                        <span>Container: {trailer.container_number ?? "—"}</span>
                        <span>Position: {trailer.compound_position ?? "—"}</span>
                        <span>Status: {trailer.operational_status ?? "Active"}</span>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-200">
                          <input
                            type="checkbox"
                            checked={selectedTrailerIds.includes(trailer.id)}
                            onChange={() => toggleTrailerSelection(trailer.id)}
                            disabled={!isEligible}
                            className="h-4 w-4"
                          />
                          Batch
                        </label>
                        <button
                          type="button"
                          onClick={() => void handleConfirmSingleDeparture(trailer.id)}
                          disabled={isSubmitting || processingTrailerIds.includes(trailer.id) || !isEligible}
                          className="rounded-xl bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                        >
                          {processingTrailerIds.includes(trailer.id) ? "Departing..." : isEligible ? "Depart" : "Ineligible"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setHistoryTrailer({ trailerId: trailer.id, trailerNumber: trailer.trailer_number ?? null })}
                          className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                        >
                          History
                        </button>
                        <button
                          type="button"
                          onClick={() => setPanelTrailerId(trailer.id)}
                          className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                        >
                          Open Workspace
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
            <h2 className="text-lg font-semibold text-white">Confirm departure</h2>
            <p className="mt-2 text-sm text-slate-300">
              Select a trailer from the list to confirm its departure from the compound.
            </p>

            {selectedTrailer ? (
              <div className="mt-5 space-y-4 rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                {isEligibleForDeparture(selectedTrailer) ? null : (
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                    This trailer is currently ineligible for departure.
                  </div>
                )}
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Trailer</p>
                  <p className="mt-1 text-lg font-semibold text-white">{selectedTrailer.trailer_number}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Customer</p>
                    <p className="mt-1 text-sm text-slate-300">{selectedTrailer.customer ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Consignee</p>
                    <p className="mt-1 text-sm text-slate-300">{selectedTrailer.consignee ?? "—"}</p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Container</p>
                    <p className="mt-1 text-sm text-slate-300">{selectedTrailer.container_number ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Position</p>
                    <p className="mt-1 text-sm text-slate-300">{selectedTrailer.compound_position ?? "—"}</p>
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setSelectedTrailerId(null)}
                    className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-3 text-sm font-medium text-slate-200"
                  >
                    Clear Selection
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistoryTrailer({ trailerId: selectedTrailer.id, trailerNumber: selectedTrailer.trailer_number ?? null })}
                    className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-3 text-sm font-medium text-slate-200"
                  >
                    History
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmSingleDeparture(selectedTrailer.id)}
                    disabled={isSubmitting || !selectedTrailerId || !isEligibleForDeparture(selectedTrailer)}
                    className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? "Confirming..." : "Confirm Departure"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-slate-950/70 p-4 text-sm text-slate-400">
                Choose a trailer from the list to continue.
              </div>
            )}
          </section>
        </div>
      </div>

      {success ? (
        <SuccessToast
          message={success}
          onClose={() => setSuccess(null)}
          actionLabel={lastDepartureSnapshot ? "Undo" : undefined}
          onAction={lastDepartureSnapshot ? () => void handleUndoLastDeparture() : undefined}
          actionDisabled={isSubmitting}
        />
      ) : null}

      <TrailerHistoryDrawer
        isOpen={Boolean(historyTrailer)}
        trailerId={historyTrailer?.trailerId}
        trailerNumber={historyTrailer?.trailerNumber}
        onClose={() => setHistoryTrailer(null)}
      />

      <TrailerOperationsPanel
        isOpen={Boolean(panelTrailer)}
        onClose={() => setPanelTrailerId(null)}
        moduleLabel="Departures"
        trailer={
          panelTrailer
            ? {
                id: panelTrailer.id,
                trailerId: panelTrailer.id,
                trailerNumber: panelTrailer.trailer_number ?? null,
                customer: panelTrailer.customer ?? null,
                consignee: panelTrailer.consignee ?? null,
                loadStatus: panelTrailer.load_status ?? null,
                status: panelTrailer.operational_status ?? null,
                compoundPosition: panelTrailer.compound_position ?? null,
                arrivalDate: panelTrailer.arrival_date ?? null,
              }
            : null
        }
        inspectionHref={panelTrailer ? `/dashboard/trailers/${panelTrailer.id}` : null}
        photosHref={panelTrailer ? `/dashboard/trailers/${panelTrailer.id}` : null}
        damageHref={panelTrailer ? `/dashboard/trailers/${panelTrailer.id}` : null}
        onDeparture={panelTrailer ? () => handleConfirmSingleDeparture(panelTrailer.id) : undefined}
        onOpenHistory={
          panelTrailer
            ? () => setHistoryTrailer({ trailerId: panelTrailer.id, trailerNumber: panelTrailer.trailer_number ?? null })
            : undefined
        }
        onMove={panelTrailer ? (nextPosition) => handleQuickMove(panelTrailer.id, nextPosition) : undefined}
        moveLabel="Move Trailer"
        isBusy={isSubmitting || Boolean(panelTrailer && processingTrailerIds.includes(panelTrailer.id))}
      />
    </main>
  );
}
