"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OperationalActionBar } from "@/components/operations/operational-action-bar";
import { TrailerOperationsPanel } from "@/components/operations/trailer-operations-panel";
import { SuccessToast } from "@/components/common/success-toast";
import { TrailerHistoryDrawer } from "@/components/trailers/trailer-history-drawer";
import { createTrailerActivity } from "@/lib/trailer-activity";
import { resolveAuditOperatorName } from "@/lib/trailer-audit-log";
import { confirmTrailerDeparture, type DepartureTransitionSnapshot } from "@/lib/operations/confirm-departure";
import { DepartureUndoConflictError, undoDeparture } from "@/lib/operations/departure-lifecycle";
import { syncTrailerCurrentOperationalState } from "@/lib/operations/trailer-current-state";
import { isEligibleForDeparture, type DepartureImportPreview } from "@/lib/imports/departure-import";
import {
  DELIVERY_BOOKING_RELEASE_STATUS_QUERY,
  getTrailerIdsReservedByActiveDeliveryBookings,
} from "@/lib/delivery-booking-availability";
import { EXPORT_ACTIVE_STATUS_QUERY_VALUES } from "@/lib/export-allocation";
import { getActiveExportStatusByTrailerId, withTrailerJobCommitments } from "@/lib/trailer-job-eligibility";
import { supabase } from "@/lib/supabase";
import { getSessionToken } from "@/lib/voice/session";

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
  hasActiveDelivery?: boolean | null;
  activeExportStatus?: string | null;
};

type DepartureStatusFilter = string;
type DepartureSort = "trailer_asc" | "trailer_desc" | "arrival_desc";

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";
const normalizeFilterValue = (value?: string | null) => value?.trim() ?? "";
const isAllFilterValue = (value?: string | null) => normalizeText(value) === "all";
const normalizeOperationalStatus = (value?: string | null) => normalizeText(value);

const normalizeTrailerPrefix = (value?: string | null) => {
  const trailer = value?.trim().toUpperCase() ?? "";
  if (!trailer) {
    return "";
  }

  const match = trailer.match(/^[A-Z]+/);
  return match?.[0] ?? "";
};

const readDepartureQueryState = () => {
  if (typeof window === "undefined") {
    return {
      requestedTrailerId: null as string | null,
      requestedTrailerNumber: null as string | null,
      search: "",
      statusFilter: "all" as DepartureStatusFilter,
      customerFilter: "all",
      prefixFilter: "all",
      sortBy: "trailer_asc" as DepartureSort,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const nextStatus = normalizeFilterValue(params.get("status") ?? params.get("load") ?? "all");
  const nextCustomer = normalizeFilterValue(params.get("customer"));
  const nextPrefix = normalizeFilterValue(params.get("prefix"));
  const nextSort = (params.get("sort") ?? "trailer_asc").toLowerCase();

  return {
    requestedTrailerId: params.get("trailerId"),
    requestedTrailerNumber: params.get("trailer"),
    search: params.get("search") ?? "",
    statusFilter: !nextStatus || isAllFilterValue(nextStatus) ? "all" : normalizeOperationalStatus(nextStatus),
    customerFilter: !nextCustomer || isAllFilterValue(nextCustomer) ? "all" : nextCustomer,
    prefixFilter: !nextPrefix || isAllFilterValue(nextPrefix) ? "all" : nextPrefix.toUpperCase(),
    sortBy:
      nextSort === "trailer_asc" || nextSort === "trailer_desc" || nextSort === "arrival_desc"
        ? (nextSort as DepartureSort)
        : "trailer_asc",
  };
};

const formatOperationalStatus = (value?: string | null) => {
  const normalized = normalizeOperationalStatus(value);
  if (!normalized) {
    return "Status not set";
  }

  return normalized
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
};

export default function DeparturePage() {
  const [trailers, setTrailers] = useState<TrailerRecord[]>([]);
  const [selectedTrailerId, setSelectedTrailerId] = useState<string | null>(null);
  const [selectedTrailerIds, setSelectedTrailerIds] = useState<string[]>([]);
  const initialQueryState = readDepartureQueryState();
  const [requestedTrailerId] = useState<string | null>(initialQueryState.requestedTrailerId);
  const [requestedTrailerNumber] = useState<string | null>(initialQueryState.requestedTrailerNumber);
  const [processingTrailerIds, setProcessingTrailerIds] = useState<string[]>([]);
  const [historyTrailer, setHistoryTrailer] = useState<{ trailerId: string | null; trailerNumber: string | null } | null>(null);
  const [panelTrailerId, setPanelTrailerId] = useState<string | null>(null);
  const [lastDepartureSnapshot, setLastDepartureSnapshot] = useState<DepartureTransitionSnapshot | null>(null);
  const [search, setSearch] = useState(initialQueryState.search);
  const [statusFilter, setStatusFilter] = useState<DepartureStatusFilter>(initialQueryState.statusFilter);
  const [customerFilter, setCustomerFilter] = useState<string>(initialQueryState.customerFilter);
  const [prefixFilter, setPrefixFilter] = useState<string>(initialQueryState.prefixFilter);
  const [sortBy, setSortBy] = useState<DepartureSort>(initialQueryState.sortBy);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<DepartureImportPreview | null>(null);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importKind, setImportKind] = useState<"excel" | "pdf" | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const loadDepartureTrailers = useCallback(async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading ?? true;
    if (showLoading) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const [{ data, error: supabaseError }, { data: activeDeliveries, error: deliveryError }, { data: activeExports, error: exportError }] = await Promise.all([
        supabase
          .from("trailers")
          .select("id, trailer_number, trailer_type, load_status, load_description, customer, consignee, container_number, compound_position, arrival_date, departure_date, departure_time, operational_status, is_local")
          .is("departure_date", null)
          .order("arrival_date", { ascending: false }),
        supabase
          .from("delivery_bookings")
          .select("trailer_id, status")
          .not("status", "in", DELIVERY_BOOKING_RELEASE_STATUS_QUERY),
        supabase
          .from("export_allocations")
          .select("trailer_id, status")
          .in("status", [...EXPORT_ACTIVE_STATUS_QUERY_VALUES]),
      ]);

      if (supabaseError) {
        throw supabaseError;
      }

      if (deliveryError) {
        throw deliveryError;
      }

      if (exportError) {
        throw exportError;
      }

      const loadedRaw = withTrailerJobCommitments((data ?? []) as TrailerRecord[], {
        reservedByDelivery: getTrailerIdsReservedByActiveDeliveryBookings(activeDeliveries ?? []),
        exportStatusByTrailerId: getActiveExportStatusByTrailerId(activeExports ?? []),
      });
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

      const eligibleRows = Array.from(deduped.values());
      setTrailers(eligibleRows);

      setSelectedTrailerIds((current) => current.filter((id) => eligibleRows.some((row) => row.id === id && isEligibleForDeparture(row))));

      setSelectedTrailerId((currentSelection) => {
        if (currentSelection && eligibleRows.some((row) => row.id === currentSelection)) {
          return currentSelection;
        }

        const targetById = requestedTrailerId ? eligibleRows.find((row) => row.id === requestedTrailerId) : null;
        const targetByNumber = requestedTrailerNumber
          ? eligibleRows.find(
              (row) => row.trailer_number?.trim().toUpperCase() === requestedTrailerNumber.trim().toUpperCase(),
            )
          : null;
        const target = targetById ?? targetByNumber;
        return target?.id ?? currentSelection ?? null;
      });

      const targetById = requestedTrailerId ? eligibleRows.find((row) => row.id === requestedTrailerId) : null;
      const targetByNumber = requestedTrailerNumber
        ? eligibleRows.find(
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
      if (showLoading) {
        setIsLoading(false);
      }
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
    const timeoutId = window.setTimeout(() => {
      void loadDepartureTrailers({ showLoading: true });
    }, 0);

    return () => window.clearTimeout(timeoutId);
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

  const statusOptions = useMemo(() => {
    const statuses = new Map<string, string>();

    trailers.forEach((trailer) => {
      const normalized = normalizeOperationalStatus(trailer.operational_status);
      if (!normalized) {
        return;
      }

      if (!statuses.has(normalized)) {
        statuses.set(normalized, formatOperationalStatus(trailer.operational_status));
      }
    });

    const sorted = Array.from(statuses.entries())
      .sort((left, right) => left[1].localeCompare(right[1], undefined, { sensitivity: "base" }))
      .map(([value, label]) => ({ value, label }));

    return [{ value: "all", label: "All" }, ...sorted];
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

      const statusFilterValue = normalizeOperationalStatus(trailer.operational_status);
      const normalizedCustomer = normalizeText(trailer.customer);
      const normalizedCustomerFilter = normalizeText(customerFilter);
      const trailerPrefix = normalizeTrailerPrefix(trailer.trailer_number);
      const normalizedPrefixFilter = isAllFilterValue(prefixFilter) ? "all" : normalizeFilterValue(prefixFilter).toUpperCase();

      if (term && !haystack.includes(term)) {
        return false;
      }

      if (!isAllFilterValue(statusFilter) && statusFilterValue !== normalizeOperationalStatus(statusFilter)) {
        return false;
      }

      if (!isAllFilterValue(customerFilter) && normalizedCustomer !== normalizedCustomerFilter) {
        return false;
      }

      if (normalizedPrefixFilter !== "all" && trailerPrefix !== normalizedPrefixFilter) {
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
  }, [customerFilter, prefixFilter, search, sortBy, statusFilter, trailers]);

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

    if (isAllFilterValue(statusFilter)) {
      params.delete("status");
      params.delete("load");
    } else {
      params.set("status", normalizeOperationalStatus(statusFilter));
      params.delete("load");
    }

    if (isAllFilterValue(customerFilter)) {
      params.delete("customer");
    } else {
      params.set("customer", normalizeFilterValue(customerFilter));
    }

    if (isAllFilterValue(prefixFilter)) {
      params.delete("prefix");
    } else {
      params.set("prefix", normalizeFilterValue(prefixFilter).toUpperCase());
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
  }, [customerFilter, prefixFilter, search, sortBy, statusFilter]);

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

  const performDeparture = async (targetTrailerId: string) => {
    const result = await confirmTrailerDeparture(supabase, {
      trailerId: targetTrailerId,
      operatorName: await resolveAuditOperatorName(),
    });

    if (result.alreadyDeparted) {
      throw new Error(`Trailer ${result.trailerNumber ?? targetTrailerId} is already departed.`);
    }

    return {
      snapshot: result.snapshot,
      trailerNumber: result.trailerNumber,
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
      await loadDepartureTrailers({ showLoading: false });
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

  const runConfirmedDepartures = async (targets: string[], confirmMessage: string) => {
    if (targets.length === 0 || isSubmitting) {
      setError("Select at least one trailer for batch departure.");
      return false;
    }

    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) {
      return false;
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
        const trailerNumber = trailers.find((row) => row.id === targetId)?.trailer_number
          ?? importPreview?.accepted.find((row) => row.trailer.id === targetId)?.trailer_number
          ?? targetId;
        const message = err instanceof Error ? err.message : "Unable to confirm departure.";
        failed.push(`${trailerNumber}: ${message}`);
      }
    }

    if (succeeded.length > 0) {
      removeTrailersFromList(succeeded.map((item) => item.id));
      await loadDepartureTrailers({ showLoading: false });
      setLastDepartureSnapshot(succeeded[succeeded.length - 1]?.snapshot ?? null);
      setSuccess(`${succeeded.length} trailer${succeeded.length === 1 ? "" : "s"} departed.`);
    }

    if (failed.length > 0) {
      setError(`Some departures failed: ${failed.join(" | ")}`);
    }

    setProcessingTrailerIds([]);
    setIsSubmitting(false);
    return succeeded.length > 0;
  };

  const handleConfirmBatchDeparture = async () => {
    const targets = selectedTrailerIds.filter((id) => {
      const row = trailers.find((item) => item.id === id);
      return Boolean(row && isEligibleForDeparture(row));
    });
    await runConfirmedDepartures(targets, `Confirm departure for ${targets.length} trailer${targets.length === 1 ? "" : "s"}?`);
  };

  const handleImportFileSelected = async (file: File | null, kind: "excel" | "pdf") => {
    if (!file) {
      return;
    }

    setIsImporting(true);
    setError(null);
    setSuccess(null);
    setImportPreview(null);
    setImportFileName(file.name);
    setImportKind(kind);

    try {
      const token = await getSessionToken();
      const formData = new FormData();
      formData.set("file", file);
      formData.set("purpose", "departure");

      const endpoint = kind === "excel"
        ? "/api/imports/spreadsheet?purpose=departure"
        : "/api/imports/pdf?purpose=departure";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const payload = (await response.json()) as { preview?: DepartureImportPreview; error?: string };
      if (!response.ok || !payload.preview) {
        throw new Error(payload.error || (kind === "excel" ? "Unable to read this Excel file." : "Unable to read this PDF."));
      }

      setImportPreview(payload.preview);
    } catch (importError) {
      setImportFileName(null);
      setImportKind(null);
      setError(importError instanceof Error ? importError.message : "Unable to read this file.");
    } finally {
      setIsImporting(false);
    }
  };

  const handleConfirmImportedDepartures = async () => {
    const accepted = importPreview?.accepted ?? [];
    const targets = accepted
      .map((row) => trailers.find((item) => item.id === row.trailer.id) ?? row.trailer)
      .filter((row) => isEligibleForDeparture(row))
      .map((row) => row.id);

    const departed = await runConfirmedDepartures(
      targets,
      `Confirm departure for ${targets.length} trailer${targets.length === 1 ? "" : "s"} from the ${importKind === "excel" ? "Excel" : "PDF"} preview?`,
    );
    if (departed) {
      setImportPreview(null);
      setImportFileName(null);
      setImportKind(null);
    }
  };

  const handleUndoLastDeparture = async () => {
    if (!lastDepartureSnapshot || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const operatorName = await resolveAuditOperatorName();
      const result = await undoDeparture(supabase, {
        trailerId: lastDepartureSnapshot.trailerId,
        expectedDepartureAt: lastDepartureSnapshot.expectedDepartureAt,
        performedBy: operatorName,
      });

      await syncTrailerCurrentOperationalState(supabase, result.trailerId, {
        intent: result.restoredCompoundPosition ? "place_on_compound" : "sync",
      });

      await loadDepartureTrailers({ showLoading: false });
      setLastDepartureSnapshot(null);
      setSuccess(`Undo applied for ${result.trailerNumber ?? "trailer"}.`);
    } catch (undoErr) {
      if (undoErr instanceof DepartureUndoConflictError) {
        await loadDepartureTrailers({ showLoading: false });
        if (undoErr.code === "already_restored" || undoErr.code === "stale_state") {
          setLastDepartureSnapshot(null);
        }
      }
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

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">List import</p>
              <p className="mt-1 text-sm text-slate-300">Import an Excel voyage list to preview trailers before confirming departures. PDF remains available as a fallback.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className={`rounded-xl bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950 ${isImporting ? "opacity-60" : "hover:bg-cyan-400 cursor-pointer"}`}>
                {isImporting && importKind === "excel" ? "Reading Excel..." : "Import Excel"}
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  disabled={isImporting || isSubmitting}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    event.target.value = "";
                    void handleImportFileSelected(file, "excel");
                  }}
                />
              </label>
              <label className={`rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 ${isImporting ? "opacity-60" : "hover:bg-slate-700 cursor-pointer"}`}>
                {isImporting && importKind === "pdf" ? "Reading PDF..." : "Import PDF"}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  disabled={isImporting || isSubmitting}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    event.target.value = "";
                    void handleImportFileSelected(file, "pdf");
                  }}
                />
              </label>
            </div>
          </div>
          {importFileName ? <p className="mt-3 text-xs text-slate-400">Previewing {importFileName}. The file is not saved.</p> : null}
          {importPreview ? (
            <div className="mt-4 space-y-3 text-sm">
              <p className="text-slate-200">
                {importPreview.accepted.length} accepted, {importPreview.warnings.length} warning{importPreview.warnings.length === 1 ? "" : "s"}, {importPreview.cancelled.length} cancelled, {importPreview.standBy.length} stand-by, {importPreview.outstanding.length} outstanding, {importPreview.alreadyDeparted.length} already departed, {importPreview.ineligible.length} ineligible, {importPreview.invalid.length} unrecognized, {importPreview.duplicates.length} duplicate{importPreview.duplicates.length === 1 ? "" : "s"}.
              </p>
              {importPreview.accepted.length > 0 ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Accepted</p>
                  <ul className="mt-1 max-h-40 overflow-auto text-slate-200">
                    {importPreview.accepted.map((row) => (
                      <li key={row.trailer.id}>
                        {row.trailer_number}{row.list_section === "additional" ? " (ADDITIONAL)" : ""}
                        {row.customer ? ` · ${row.customer}` : ""}
                        {row.destination ? ` · ${row.destination}` : ""}
                        {row.haz ? ` · Haz ${row.haz}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {importPreview.warnings.map((warning) => <p key={warning} className="text-amber-200">{warning}</p>)}
              {importPreview.cancelled.map((item) => <p key={`cancelled-${item.reason}`} className="text-orange-200">{item.reason}</p>)}
              {importPreview.standBy.map((item) => <p key={`standby-${item.reason}`} className="text-slate-400">{item.reason}</p>)}
              {importPreview.outstanding.map((item) => <p key={`outstanding-${item.reason}`} className="text-slate-400">{item.reason}</p>)}
              {importPreview.alreadyDeparted.map((item) => <p key={`departed-${item.reason}`} className="text-slate-400">{item.reason}</p>)}
              {importPreview.ineligible.map((item) => <p key={`ineligible-${item.reason}`} className="text-orange-200">{item.reason}</p>)}
              {importPreview.duplicates.map((item) => <p key={`dup-${item.reason}`} className="text-slate-400">{item.reason}</p>)}
              {importPreview.invalid.map((item) => <p key={`invalid-${item.reason}`} className="text-rose-200">{item.sourceLine ? `${item.sourceLine}: ` : ""}{item.reason}</p>)}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleConfirmImportedDepartures()}
                  disabled={isSubmitting || importPreview.accepted.length === 0}
                  className="rounded-xl bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                >
                  Confirm listed departures
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImportPreview(null);
                    setImportFileName(null);
                    setImportKind(null);
                  }}
                  className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                >
                  Discard preview
                </button>
              </div>
            </div>
          ) : null}
        </section>

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
              statusOptions={statusOptions}
              statusValue={statusFilter}
              onStatusChange={(value) => setStatusFilter(isAllFilterValue(value) ? "all" : normalizeOperationalStatus(value))}
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
                  const statusLabel = formatOperationalStatus(trailer.operational_status);

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
                        <span>Position: {trailer.compound_position?.trim() ? trailer.compound_position : "No position assigned"}</span>
                        <span>Status: {statusLabel}</span>
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
