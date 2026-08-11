import {
  formatVesselDateTime,
  getVesselPriorityClass,
  getVesselPriorityLabel,
  getVesselInspectionProgressLabel,
  getVesselInspectionProgressState,
  getVesselTrailerStatusClass,
  getVesselTrailerStatusLabel,
  normalizeExpectedTemperatureUnit,
  resolveExpectedFrontTemperature,
  resolveExpectedRearTemperature,
  type VesselOperationTrailerRecord,
} from "@/lib/vessel-operations";
import { getTrailerOwnershipBadgeLabel as getOwnershipBadgeLabel } from "@/lib/trailer-ownership";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { OperationalActionBar } from "@/components/operations/operational-action-bar";
import { TrailerOperationsPanel } from "@/components/operations/trailer-operations-panel";
import { TrailerHistoryDrawer } from "@/components/trailers/trailer-history-drawer";

type TrailerFilter = "all" | "expected" | "arrived" | "inspection_pending" | "inspection_in_progress" | "completed" | "priority" | "cancelled" | "no_show" | "not_discharged";
type TrailerSort = "trailer_asc" | "trailer_desc";

const extractTrailerPrefix = (value?: string | null) => {
  const normalized = value?.trim().toUpperCase() ?? "";
  if (!normalized) {
    return "";
  }
  const match = normalized.match(/^[A-Z]+/);
  return match?.[0] ?? "";
};

type VesselTrailerListProps = {
  sortedTrailers: VesselOperationTrailerRecord[];
  operationStatus: "draft" | "confirmed" | "completed";
  editable: boolean;
  isReadOnly: boolean;
  actioningTrailerId: string | null;
  onTogglePriority: (trailer: VesselOperationTrailerRecord) => Promise<void>;
  onRemoveTrailer: (trailer: VesselOperationTrailerRecord) => Promise<void>;
  onMarkArrived: (trailer: VesselOperationTrailerRecord) => Promise<void>;
  onMarkCancelled: (trailer: VesselOperationTrailerRecord) => Promise<void>;
  onMarkNoShow: (trailer: VesselOperationTrailerRecord) => Promise<void>;
  onUndoCancelled: (trailer: VesselOperationTrailerRecord) => Promise<void>;
  onUndoNoShow: (trailer: VesselOperationTrailerRecord) => Promise<void>;
};

export function VesselTrailerList({
  sortedTrailers,
  operationStatus,
  editable,
  isReadOnly,
  actioningTrailerId,
  onTogglePriority,
  onRemoveTrailer,
  onMarkArrived,
  onMarkCancelled,
  onMarkNoShow,
  onUndoCancelled,
  onUndoNoShow,
}: VesselTrailerListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [historyTrailer, setHistoryTrailer] = useState<{ trailerId: string | null; trailerNumber: string | null } | null>(null);
  const [panelTrailerId, setPanelTrailerId] = useState<string | null>(null);
  const [selectedTrailerIds, setSelectedTrailerIds] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState<TrailerFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<TrailerSort>("trailer_asc");
  const [prefixFilter, setPrefixFilter] = useState<string>("all");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const filterValue = (params.get("trailerFilter") ?? "all").toLowerCase();
    const sortValue = (params.get("trailerSort") ?? "trailer_asc").toLowerCase();
    const queryValue = params.get("trailerSearch") ?? "";
    const prefixValue = (params.get("trailerPrefix") ?? "all").toUpperCase();

    if (
      filterValue === "all" ||
      filterValue === "expected" ||
      filterValue === "arrived" ||
      filterValue === "inspection_pending" ||
      filterValue === "inspection_in_progress" ||
      filterValue === "completed" ||
      filterValue === "priority" ||
      filterValue === "cancelled" ||
      filterValue === "no_show" ||
      filterValue === "not_discharged"
    ) {
      setActiveFilter(filterValue);
    }

    if (sortValue === "trailer_asc" || sortValue === "trailer_desc") {
      setSortBy(sortValue);
    }

    setPrefixFilter(prefixValue || "all");
    setSearchTerm(queryValue);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (activeFilter === "all") {
      params.delete("trailerFilter");
    } else {
      params.set("trailerFilter", activeFilter);
    }

    if (sortBy === "trailer_asc") {
      params.delete("trailerSort");
    } else {
      params.set("trailerSort", sortBy);
    }

    if (searchTerm.trim()) {
      params.set("trailerSearch", searchTerm.trim());
    } else {
      params.delete("trailerSearch");
    }

    if (prefixFilter !== "all") {
      params.set("trailerPrefix", prefixFilter);
    } else {
      params.delete("trailerPrefix");
    }

    const nextQuery = params.toString();
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) {
      router.replace(nextUrl, { scroll: false });
    }
  }, [activeFilter, pathname, prefixFilter, router, searchTerm, sortBy]);

  const prefixOptions = useMemo(() => {
    const prefixes = new Set<string>();
    sortedTrailers.forEach((item) => {
      const prefix = extractTrailerPrefix(item.trailer_number);
      if (prefix) {
        prefixes.add(prefix);
      }
    });

    return [
      { value: "all", label: "All" },
      ...Array.from(prefixes)
        .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
        .map((prefix) => ({ value: prefix, label: prefix })),
    ];
  }, [sortedTrailers]);

  const filteredTrailers = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toUpperCase();

    const list = sortedTrailers.filter((trailer) => {
      const trailerNumber = trailer.trailer_number?.trim().toUpperCase() ?? "";
      const arrivalStatus = trailer.arrival_status ?? "expected";
      const inspectionState = getVesselInspectionProgressState(trailer);
      const isPriority = trailer.priority_level === "priority";
      const trailerPrefix = extractTrailerPrefix(trailer.trailer_number);

      if (normalizedSearch && !trailerNumber.includes(normalizedSearch)) {
        return false;
      }

      if (prefixFilter !== "all" && trailerPrefix !== prefixFilter) {
        return false;
      }

      if (activeFilter === "priority") {
        return isPriority;
      }

      if (activeFilter === "expected") {
        return arrivalStatus === "expected" || arrivalStatus === "available_for_arrival";
      }

      if (activeFilter === "arrived") {
        return arrivalStatus === "arrived";
      }

      if (activeFilter === "inspection_pending") {
        return arrivalStatus === "arrived" && !trailer.inspection_started_at && !trailer.inspection_completed_at;
      }

      if (activeFilter === "inspection_in_progress") {
        return arrivalStatus === "arrived" && Boolean(trailer.inspection_started_at) && !trailer.inspection_completed_at;
      }

      if (activeFilter === "completed") {
        return inspectionState === "completed" || inspectionState === "issues_found" || trailer.status === "inspected";
      }

      if (activeFilter === "cancelled") {
        return arrivalStatus === "cancelled";
      }

      if (activeFilter === "no_show") {
        return arrivalStatus === "no_show";
      }

      if (activeFilter === "not_discharged") {
        return arrivalStatus === "not_discharged";
      }

      return true;
    });

    return [...list].sort((left, right) => {
      const leftValue = left.trailer_number?.trim() ?? "";
      const rightValue = right.trailer_number?.trim() ?? "";

      if (!leftValue && !rightValue) {
        return 0;
      }
      if (!leftValue) {
        return 1;
      }
      if (!rightValue) {
        return -1;
      }

      const base = leftValue.localeCompare(rightValue, undefined, {
        numeric: true,
        sensitivity: "base",
      });

      return sortBy === "trailer_desc" ? -base : base;
    });
  }, [activeFilter, prefixFilter, searchTerm, sortBy, sortedTrailers]);

  const filterButtons: Array<{ key: TrailerFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "expected", label: "Expected" },
    { key: "arrived", label: "Arrived" },
    { key: "inspection_pending", label: "Inspection Pending" },
    { key: "inspection_in_progress", label: "Inspection In Progress" },
    { key: "completed", label: "Completed" },
    { key: "priority", label: "Priority" },
    { key: "cancelled", label: "Cancelled" },
    { key: "no_show", label: "No Show" },
    { key: "not_discharged", label: "Not Discharged" },
  ];

  const panelTrailer = useMemo(
    () => filteredTrailers.find((trailer) => trailer.id === panelTrailerId) ?? null,
    [filteredTrailers, panelTrailerId],
  );

  useEffect(() => {
    setSelectedTrailerIds((current) => current.filter((id) => filteredTrailers.some((item) => item.id === id)));
  }, [filteredTrailers]);

  const toggleTrailerSelection = (trailerId: string) => {
    setSelectedTrailerIds((current) => {
      if (current.includes(trailerId)) {
        return current.filter((id) => id !== trailerId);
      }

      return [...current, trailerId];
    });
  };

  const toggleSelectVisible = () => {
    setSelectedTrailerIds((current) => {
      const visibleIds = filteredTrailers.map((item) => item.id);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.includes(id));
      if (allVisibleSelected) {
        return current.filter((id) => !visibleIds.includes(id));
      }

      const merged = new Set(current);
      visibleIds.forEach((id) => merged.add(id));
      return Array.from(merged);
    });
  };

  const clearSelected = () => {
    setSelectedTrailerIds([]);
  };

  const handleBatchArrived = async () => {
    const selectedRows = filteredTrailers.filter((item) => selectedTrailerIds.includes(item.id));
    const eligibleRows = selectedRows.filter(
      (item) => operationStatus === "confirmed" && (item.status === "expected" || item.arrival_status === "available_for_arrival"),
    );

    for (const trailer of eligibleRows) {
      await onMarkArrived(trailer);
    }

    setSelectedTrailerIds((current) => current.filter((id) => !eligibleRows.some((item) => item.id === id)));
  };

  const selectedPanelCount = selectedTrailerIds.length;

  const statusOptions = filterButtons.map((item) => ({ value: item.key, label: item.label }));
  const sortOptions = [
    { value: "trailer_asc", label: "Trailer A-Z" },
    { value: "trailer_desc", label: "Trailer Z-A" },
  ];

  return (
    <section className="space-y-3">
      <OperationalActionBar
        moduleLabel="Vessel Operations"
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Search trailer number"
        prefixOptions={prefixOptions}
        prefixValue={prefixFilter}
        onPrefixChange={setPrefixFilter}
        statusOptions={statusOptions}
        statusValue={activeFilter}
        onStatusChange={(value) => setActiveFilter(value as TrailerFilter)}
        sortOptions={sortOptions}
        sortValue={sortBy}
        onSortChange={(value) => setSortBy(value as TrailerSort)}
        selectedCount={selectedPanelCount}
        primaryActions={
          <>
            <button
              type="button"
              onClick={toggleSelectVisible}
              className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            >
              {filteredTrailers.length > 0 && filteredTrailers.every((item) => selectedTrailerIds.includes(item.id))
                ? "Unselect Visible"
                : "Select Visible"}
            </button>
            <button
              type="button"
              onClick={clearSelected}
              disabled={selectedTrailerIds.length === 0}
              className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => void handleBatchArrived()}
              disabled={selectedTrailerIds.length === 0 || actioningTrailerId !== null}
              className="rounded-xl bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
            >
              Batch Arrived
            </button>
          </>
        }
        secondaryActions={
          <p className="text-xs text-slate-400">{filteredTrailers.length} trailer{filteredTrailers.length === 1 ? "" : "s"} in current view.</p>
        }
      />

      {filteredTrailers.length === 0 ? (
        <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-300">No trailers have been added to this vessel operation yet.</div>
      ) : (
        filteredTrailers.map((trailer) => {
          const expectedFront = resolveExpectedFrontTemperature(trailer);
          const expectedRear = resolveExpectedRearTemperature(trailer);
          const expectedUnit = normalizeExpectedTemperatureUnit(trailer.expected_temperature_unit);
          const canMarkArrived = operationStatus === "confirmed" && (trailer.status === "expected" || trailer.arrival_status === "available_for_arrival");
          const canMarkCancelled = operationStatus === "confirmed" && (trailer.arrival_status === "expected" || trailer.arrival_status === "available_for_arrival");
          const canMarkNoShow = operationStatus === "confirmed" && (trailer.arrival_status === "expected" || trailer.arrival_status === "available_for_arrival");
          const canUndoCancelled = operationStatus === "confirmed" && trailer.arrival_status === "cancelled";
          const canUndoNoShow = operationStatus === "confirmed" && trailer.arrival_status === "no_show";
          const canOpenInspection =
            operationStatus !== "draft" &&
            trailer.arrival_status !== "cancelled" &&
            trailer.arrival_status !== "no_show" &&
            trailer.arrival_status !== "not_discharged";
          const inspectionState = getVesselInspectionProgressState(trailer);
          const inspectionLabel = getVesselInspectionProgressLabel(inspectionState);
          const isInspectionStarted = Boolean(trailer.inspection_started_at);
          const isInspectionCompleted = trailer.status === "inspected" || Boolean(trailer.inspection_completed_at) || inspectionState === "completed" || inspectionState === "issues_found";

          let primaryAction: "arrived" | "start_inspection" | "continue_inspection" | "view_inspection" | null = null;
          if (canMarkArrived) {
            primaryAction = "arrived";
          } else if (canOpenInspection && trailer.arrival_status === "arrived" && !isInspectionStarted && !isInspectionCompleted) {
            primaryAction = "start_inspection";
          } else if (canOpenInspection && trailer.arrival_status === "arrived" && isInspectionStarted && !isInspectionCompleted) {
            primaryAction = "continue_inspection";
          } else if (canOpenInspection && isInspectionCompleted) {
            primaryAction = "view_inspection";
          }

          const arrivalLabel = trailer.arrival_status?.replace(/_/g, " ") ?? "expected";
          const compoundPosition = trailer.assigned_position ?? "-";

          return (
            <article key={trailer.id} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/70 px-2.5 py-1 text-xs text-slate-300">
                        <input
                          type="checkbox"
                          checked={selectedTrailerIds.includes(trailer.id)}
                          onChange={() => toggleTrailerSelection(trailer.id)}
                          className="h-4 w-4"
                        />
                        Select
                      </label>
                      <h2 className="text-xl font-semibold text-white">
                        {trailer.trailer_id ? (
                          <Link href={`/dashboard/trailers/${trailer.trailer_id}`} className="underline decoration-cyan-400/60 underline-offset-2 hover:text-cyan-200">
                            {trailer.trailer_number ?? "-"}
                          </Link>
                        ) : (
                          trailer.trailer_number ?? "-"
                        )}
                      </h2>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselPriorityClass(trailer.priority_level)}`}>
                        {getVesselPriorityLabel(trailer.priority_level)}
                      </span>
                      <span className="rounded-full border border-white/10 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200">
                        {getOwnershipBadgeLabel(trailer.ownership_type ?? "unknown")}
                      </span>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselTrailerStatusClass(trailer.status)}`}>
                        {getVesselTrailerStatusLabel(trailer.status)}
                      </span>
                      {trailer.added_after_confirmation ? (
                        <span className="rounded-full border border-amber-400/30 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-100">
                          Added After Confirmation
                        </span>
                      ) : null}
                    </div>
                    <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-4">
                      <p>Customer: {trailer.customer ?? "-"}</p>
                      <p>External Company: {trailer.external_company ?? "-"}</p>
                      <p>Booking Ref: {trailer.booking_reference ?? "-"}</p>
                      <p>Load Status: {trailer.load_status ?? "-"}</p>
                      <p>Priority: {getVesselPriorityLabel(trailer.priority_level)}</p>
                      <p>Source: {trailer.trailer_source ?? "-"}</p>
                      <p>Arrival Status: {arrivalLabel}</p>
                      <p>Inspection Status: {inspectionLabel}</p>
                      <p>Compound Position: {compoundPosition}</p>
                      <p>Expected Front Temp: {expectedFront === null ? "-" : `${expectedFront} ${expectedUnit}`}</p>
                      <p>Expected Rear Temp: {expectedRear === null ? "-" : `${expectedRear} ${expectedUnit}`}</p>
                      <p>Arrival: {formatVesselDateTime(trailer.arrival_confirmed_at ?? trailer.arrived_at)}</p>
                      <p>Damage: {trailer.has_damage ? "Yes" : "No"}</p>
                      <p>Temp Alert: {trailer.has_temperature_alert ? "Yes" : "No"}</p>
                      <p>Added At: {formatVesselDateTime(trailer.added_after_confirmation_at ?? trailer.created_at)}</p>
                      <p>Notes: {trailer.planning_notes?.trim() || "-"}</p>
                    </div>
                  </div>

                  <div className="flex w-full flex-col gap-2 lg:w-60">
                    {primaryAction === "arrived" ? (
                      <button
                        type="button"
                        onClick={() => void onMarkArrived(trailer)}
                        disabled={actioningTrailerId === trailer.id}
                        className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                      >
                        Arrived
                      </button>
                    ) : null}

                    {primaryAction === "start_inspection" || primaryAction === "continue_inspection" || primaryAction === "view_inspection" ? (
                      <button
                        type="button"
                        onClick={() => setPanelTrailerId(trailer.id)}
                        className="rounded-2xl bg-cyan-500 px-4 py-3 text-center text-sm font-semibold text-slate-950 hover:bg-cyan-400"
                      >
                        {primaryAction === "start_inspection"
                          ? "Start Inspection"
                          : primaryAction === "continue_inspection"
                            ? "Continue Inspection"
                            : "View Inspection"}
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => setPanelTrailerId(trailer.id)}
                      className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
                    >
                      Open Workspace
                    </button>

                    <details className="group rounded-2xl border border-white/10 bg-slate-950/60">
                      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-100 marker:content-none">More Actions</summary>
                      <div className="flex flex-col gap-2 border-t border-white/10 px-3 pb-3 pt-2">
                        {!isReadOnly ? (
                          <button
                            type="button"
                            onClick={() => void onTogglePriority(trailer)}
                            disabled={actioningTrailerId === trailer.id}
                            className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-left text-xs font-semibold text-rose-100 hover:bg-rose-500/20 disabled:opacity-60"
                          >
                            {trailer.priority_level === "priority" ? "Set No Priority" : "Set Priority"}
                          </button>
                        ) : null}

                        {editable ? (
                          <button
                            type="button"
                            onClick={() => void onRemoveTrailer(trailer)}
                            disabled={actioningTrailerId === trailer.id}
                            className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-left text-xs font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-60"
                          >
                            Remove Trailer
                          </button>
                        ) : null}

                        {canMarkCancelled ? (
                          <button
                            type="button"
                            onClick={() => void onMarkCancelled(trailer)}
                            disabled={actioningTrailerId === trailer.id}
                            className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-left text-xs font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-60"
                          >
                            Mark Cancelled
                          </button>
                        ) : null}

                        {canMarkNoShow ? (
                          <button
                            type="button"
                            onClick={() => void onMarkNoShow(trailer)}
                            disabled={actioningTrailerId === trailer.id}
                            className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-60"
                          >
                            Mark No Show
                          </button>
                        ) : null}

                        {canUndoCancelled ? (
                          <button
                            type="button"
                            onClick={() => void onUndoCancelled(trailer)}
                            disabled={actioningTrailerId === trailer.id}
                            className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-left text-xs font-semibold text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-60"
                          >
                            Undo Cancelled
                          </button>
                        ) : null}

                        {canUndoNoShow ? (
                          <button
                            type="button"
                            onClick={() => void onUndoNoShow(trailer)}
                            disabled={actioningTrailerId === trailer.id}
                            className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-left text-xs font-semibold text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-60"
                          >
                            Undo No Show
                          </button>
                        ) : null}

                        <button
                          type="button"
                          onClick={() =>
                            setHistoryTrailer({
                              trailerId: trailer.trailer_id ?? null,
                              trailerNumber: trailer.trailer_number ?? null,
                            })
                          }
                          className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-left text-xs font-semibold text-white hover:bg-slate-700"
                        >
                          History
                        </button>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            </article>
          );
        })
      )}

      <TrailerHistoryDrawer
        isOpen={Boolean(historyTrailer)}
        trailerId={historyTrailer?.trailerId}
        trailerNumber={historyTrailer?.trailerNumber}
        onClose={() => setHistoryTrailer(null)}
      />

      <TrailerOperationsPanel
        isOpen={Boolean(panelTrailer)}
        onClose={() => setPanelTrailerId(null)}
        moduleLabel="Vessel Operations"
        trailer={
          panelTrailer
            ? {
                id: panelTrailer.id,
                trailerId: panelTrailer.trailer_id ?? panelTrailer.id,
                trailerNumber: panelTrailer.trailer_number ?? null,
                customer: panelTrailer.customer ?? null,
                consignee: null,
                loadStatus: panelTrailer.load_status ?? null,
                status: panelTrailer.status ?? null,
                compoundPosition: panelTrailer.assigned_position ?? null,
              }
            : null
        }
        inspectionHref={
          panelTrailer
            ? `/dashboard/vessel-operations/${panelTrailer.vessel_operation_id}/boat-check/${panelTrailer.id}?returnTo=${encodeURIComponent(pathname)}`
            : null
        }
        photosHref={panelTrailer?.trailer_id ? `/dashboard/trailers/${panelTrailer.trailer_id}` : null}
        damageHref={panelTrailer?.trailer_id ? `/dashboard/trailers/${panelTrailer.trailer_id}` : null}
        onArrived={
          panelTrailer && operationStatus === "confirmed" && (panelTrailer.status === "expected" || panelTrailer.arrival_status === "available_for_arrival")
            ? () => onMarkArrived(panelTrailer)
            : undefined
        }
        onTogglePriority={panelTrailer && !isReadOnly ? () => onTogglePriority(panelTrailer) : undefined}
        onOpenHistory={
          panelTrailer
            ? () => setHistoryTrailer({ trailerId: panelTrailer.trailer_id ?? null, trailerNumber: panelTrailer.trailer_number ?? null })
            : undefined
        }
        isBusy={actioningTrailerId === panelTrailer?.id}
      />
    </section>
  );
}
