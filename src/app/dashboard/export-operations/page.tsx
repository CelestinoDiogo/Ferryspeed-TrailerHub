"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { HistoryDateRangeFilter } from "@/components/common/history-date-range-filter";
import { OperationalActionBar } from "@/components/operations/operational-action-bar";
import { TrailerOperationsPanel } from "@/components/operations/trailer-operations-panel";
import { SuccessToast } from "@/components/common/success-toast";
import { TrailerHistoryDrawer } from "@/components/trailers/trailer-history-drawer";
import { PrintButton } from "@/components/print/print-button";
import { PrintFilters } from "@/components/print/print-filters";
import { PrintFooter } from "@/components/print/print-footer";
import { PrintHeader } from "@/components/print/print-header";
import { PrintReportLayout } from "@/components/print/print-report-layout";
import { ReportPrintLayout } from "@/components/print/report-print-layout";
import { PrintSummary } from "@/components/print/print-summary";
import { PrintTable } from "@/components/print/print-table";
import type { Database } from "@/lib/database.types";
import { loadExportAllocationsForReport } from "@/lib/reports/report-data";
import { supabase } from "@/lib/supabase";
import { createTrailerActivity } from "@/lib/trailer-activity";
import { resolveAuditOperatorName } from "@/lib/trailer-audit-log";
import { getLocalDateKey } from "@/lib/operational-readiness";
import {
  createHistoryDateRange,
  getHistoryDateRangeLabel,
  isDateWithinHistoryRange,
  normalizeHistoryPreset,
  type HistoryDateRangeValue,
} from "@/lib/history-date-range";
import {
  COMPOUND_REFRESH_STORAGE_KEY,
  EXPORT_ACTIVE_STATUSES,
  isExportAllocationOffCompoundStatus,
  getAdvanceStatusActionLabel,
  getExportAllocationPriorityClasses,
  getExportAllocationPriorityLabel,
  getPreviousExportAllocationStatus,
  getExportAllocationStatusClasses,
  getExportAllocationStatusLabel,
  getExportAllocationTimestampField,
  getNextExportAllocationStatus,
  isExportAllocationOverdue,
  normalizeExportAllocationRecord,
  type ExportAllocationPriority,
  type ExportAllocationRecord,
  type ExportAllocationStatus,
} from "@/lib/export-allocation";
import { getTrailerOwnershipBadgeLabel, getTrailerOwnershipType, type TrailerOwnershipType } from "@/lib/trailer-ownership";
import { advanceExportAllocationStatus } from "@/lib/operations/export-lifecycle";

type TrailerLoadSnapshot = {
  id: string;
  trailer_number?: string | null;
  load_status?: string | null;
  customer?: string | null;
  load_description?: string | null;
  compound_position?: string | null;
};

type CompoundRestoreResult = {
  restoredPosition: string | null;
  fallbackUsed: boolean;
};

type OwnershipFilter = "all" | "company" | "outsourcing";

type ExportAllocationWithOwnership = ExportAllocationRecord & {
  trailer_source?: string | null;
  external_company?: string | null;
  is_local?: boolean | null;
  ownershipType?: TrailerOwnershipType;
};

const COMPOUND_POSITIONS = Array.from({ length: 50 }, (_, index) => `P${String(index + 1).padStart(2, "0")}`);

const normalizeCompoundPosition = (value?: string | null): string | null => {
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

const getNextAvailableCompoundPosition = async () => {
  const { data, error } = await supabase
    .from("trailers")
    .select("compound_position, departure_date, is_local")
    .is("departure_date", null)
    .neq("is_local", true);

  if (error) {
    throw new Error(error.message || "Unable to determine available compound position.");
  }

  const occupied = new Set(
    ((data ?? []) as Array<{ compound_position?: string | null }>).map((row) => normalizeCompoundPosition(row.compound_position)).filter((value): value is string => Boolean(value)),
  );

  return COMPOUND_POSITIONS.find((position) => !occupied.has(position)) ?? null;
};

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  try {
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    if (!year || !month || !day) {
      return new Date(value).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    }

    return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "-";
  }
};

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const normalizeTrailerPrefix = (value?: string | null) => {
  const normalized = value?.trim().toUpperCase() ?? "";
  if (!normalized) {
    return "";
  }

  const match = normalized.match(/^[A-Z]+/);
  return match?.[0] ?? "";
};

const getDateKey = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length >= 10) {
    return normalized.slice(0, 10);
  }

  return null;
};

const formatPrintedDateTime = () =>
  new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

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

const STATUS_OPTIONS: Array<{ value: "all" | ExportAllocationStatus | "at_customer" | "overdue"; label: string }> = [
  { value: "all", label: "All Statuses" },
  { value: "allocated", label: "Allocated" },
  { value: "delivered_empty", label: "Delivered Empty" },
  { value: "waiting_loading", label: "Waiting Loading" },
  { value: "collected_loaded", label: "Collected Loaded" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "at_customer", label: "At Customer" },
  { value: "overdue", label: "Overdue" },
];

const isPrintableStatus = (value: string): value is ExportAllocationStatus =>
  value === "allocated" ||
  value === "delivered_empty" ||
  value === "waiting_loading" ||
  value === "collected_loaded" ||
  value === "completed" ||
  value === "cancelled";

const getStatusQueryValue = (value: string | null) => {
  const normalized = normalizeText(value);

  if (normalized === "at_customer" || normalized === "overdue" || normalized === "all") {
    return normalized;
  }

  if (isPrintableStatus(normalized)) {
    return normalized;
  }

  return "all";
};

const getOwnershipQueryValue = (value: string | null): OwnershipFilter => {
  const normalized = normalizeText(value);
  if (normalized === "company" || normalized === "outsourcing") {
    return normalized;
  }

  return "all";
};

const getStatusLabel = (value: string) => {
  switch (value) {
    case "all":
      return "All Statuses";
    case "at_customer":
      return "At Customer";
    case "overdue":
      return "Overdue";
    case "allocated":
      return "Allocated";
    case "delivered_empty":
      return "Delivered Empty";
    case "waiting_loading":
      return "Waiting Loading";
    case "collected_loaded":
      return "Collected Loaded";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return "All Statuses";
  }
};

const comparePrintAllocations = (left: ExportAllocationRecord, right: ExportAllocationRecord) => {
  const leftDate = left.collection_date?.trim() ?? "";
  const rightDate = right.collection_date?.trim() ?? "";

  if (leftDate !== rightDate) {
    if (!leftDate) return 1;
    if (!rightDate) return -1;
    return leftDate.localeCompare(rightDate);
  }

  const customerCompare = normalizeText(left.customer).localeCompare(normalizeText(right.customer));
  if (customerCompare !== 0) {
    return customerCompare;
  }

  return normalizeText(left.trailer_number).localeCompare(normalizeText(right.trailer_number));
};

const getCustomerOptions = (items: ExportAllocationRecord[]) => {
  const seen = new Map<string, string>();

  for (const item of items) {
    const customer = item.customer?.trim();
    if (!customer) {
      continue;
    }

    const key = normalizeText(customer);
    if (!seen.has(key)) {
      seen.set(key, customer);
    }
  }

  return Array.from(seen.values()).sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
};

const getDistinctOptions = (items: ExportAllocationRecord[], field: "haulier" | "priority") => {
  const values = new Map<string, string>();
  items.forEach((item) => {
    const value = field === "priority" ? item.priority : item.haulier;
    const trimmed = value?.trim();
    if (trimmed && !values.has(normalizeText(trimmed))) {
      values.set(normalizeText(trimmed), trimmed);
    }
  });
  return Array.from(values.values()).sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
};

function ExportOperationsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const saved = searchParams.get("saved") === "1";
  const selectedCustomerQueries = searchParams.getAll("customer");
  const selectedCustomerQuery = selectedCustomerQueries[0] ?? searchParams.get("customer") ?? "";
  const statusQuery = searchParams.get("status");
  const legacyFilterQuery = statusQuery ? null : searchParams.get("filter");
  const statusFilter = getStatusQueryValue(statusQuery ?? legacyFilterQuery ?? "all");
  const ownershipQuery = searchParams.get("ownership");
  const ownershipFilter = getOwnershipQueryValue(ownershipQuery);
  const priorityFilter = searchParams.get("priority") ?? "all";
  const haulierFilter = searchParams.get("haulier") ?? "all";
  const historyPresetQuery = searchParams.get("history");
  const historyStartQuery = searchParams.get("start") ?? "";
  const historyEndQuery = searchParams.get("end") ?? "";

  const [searchTerm, setSearchTerm] = useState("");

  const [allocations, setAllocations] = useState<ExportAllocationWithOwnership[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [actioningIds, setActioningIds] = useState<string[]>([]);
  const [undoCandidateAllocationId, setUndoCandidateAllocationId] = useState<string | null>(null);
  const [historyTrailer, setHistoryTrailer] = useState<{ trailerId: string | null; trailerNumber: string | null } | null>(null);
  const [selectedAllocationIds, setSelectedAllocationIds] = useState<string[]>([]);
  const [panelAllocationId, setPanelAllocationId] = useState<string | null>(null);
  const [prefixFilter, setPrefixFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"collection_date" | "trailer_asc" | "trailer_desc">("collection_date");

  const historyRange = useMemo<HistoryDateRangeValue>(() => {
    const preset = normalizeHistoryPreset(historyPresetQuery);

    if (preset === "custom") {
      const fallback = createHistoryDateRange("today");
      return {
        preset,
        startDate: historyStartQuery || fallback.startDate,
        endDate: historyEndQuery || fallback.endDate,
      };
    }

    return createHistoryDateRange(preset);
  }, [historyEndQuery, historyPresetQuery, historyStartQuery]);

  const updateFilters = (updates: {
    customers?: string[];
    status?: string;
    ownership?: OwnershipFilter;
    priority?: string;
    haulier?: string;
    history?: HistoryDateRangeValue;
  }) => {
    const params = new URLSearchParams(searchParams.toString());

    if (updates.customers !== undefined) {
      params.delete("customer");
      updates.customers.map((value) => value.trim()).filter(Boolean).forEach((value) => params.append("customer", value));
    }

    if (updates.status !== undefined) {
      const value = updates.status.trim();
      if (value && value !== "all") {
        params.set("status", value);
      } else {
        params.delete("status");
      }
    }

    if (updates.ownership !== undefined) {
      if (updates.ownership !== "all") {
        params.set("ownership", updates.ownership);
      } else {
        params.delete("ownership");
      }
    }

    if (updates.priority !== undefined) {
      if (updates.priority !== "all") params.set("priority", updates.priority);
      else params.delete("priority");
    }

    if (updates.haulier !== undefined) {
      if (updates.haulier !== "all") params.set("haulier", updates.haulier);
      else params.delete("haulier");
    }

    if (updates.history !== undefined) {
      params.set("history", updates.history.preset);

      if (updates.history.preset === "custom") {
        if (updates.history.startDate.trim()) {
          params.set("start", updates.history.startDate.trim());
        } else {
          params.delete("start");
        }

        if (updates.history.endDate.trim()) {
          params.set("end", updates.history.endDate.trim());
        } else {
          params.delete("end");
        }
      } else {
        params.delete("start");
        params.delete("end");
      }
    }

    params.delete("filter");
    params.delete("date");

    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(nextUrl, { scroll: false });
  };

  const handleClearFilters = () => {
    setSearchTerm("");
    const params = new URLSearchParams();
    params.set("history", "today");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const loadAllocations = async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading ?? true;
    if (showLoading) {
      setIsLoading(true);
    }
    setError(null);
    setWarning(null);

    try {
      const rows = await loadExportAllocationsForReport(supabase);
      const normalizedRows = rows.map((row) => normalizeExportAllocationRecord(row));
      const trailerIds = Array.from(new Set(normalizedRows.map((row) => row.trailer_id).filter((value): value is string => Boolean(value))));

      let trailerOwnershipById = new Map<string, { trailer_source?: string | null; external_company?: string | null; is_local?: boolean | null; trailer_number?: string | null }>();
      if (trailerIds.length > 0) {
        const { data: trailerRows, error: trailerLookupError } = await supabase
          .from("trailers")
          .select("id, trailer_source, external_company, is_local, trailer_number")
          .in("id", trailerIds);

        if (trailerLookupError) {
          throw new Error(trailerLookupError.message || "Unable to load trailer ownership data for export filters.");
        }

        trailerOwnershipById = new Map((trailerRows ?? []).map((row) => [
          row.id,
          {
            trailer_source: row.trailer_source,
            external_company: row.external_company,
            is_local: row.is_local,
            trailer_number: row.trailer_number,
          },
        ]));
      }

      const withOwnership = normalizedRows.map((row) => {
        const ownershipSource = row.trailer_id ? trailerOwnershipById.get(row.trailer_id) : undefined;
        const ownershipType = getTrailerOwnershipType({
          trailerSource: ownershipSource?.trailer_source,
          externalCompany: ownershipSource?.external_company,
          isLocal: ownershipSource?.is_local,
          trailerNumber: ownershipSource?.trailer_number ?? row.trailer_number,
        });

        return {
          ...row,
          trailer_source: ownershipSource?.trailer_source ?? null,
          external_company: ownershipSource?.external_company ?? null,
          is_local: ownershipSource?.is_local ?? null,
          ownershipType,
        } satisfies ExportAllocationWithOwnership;
      });

      setAllocations(withOwnership);
    } catch (loadErr) {
      setError(loadErr instanceof Error ? loadErr.message : "Unable to load export allocations.");
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAllocations({ showLoading: true });
  }, []);

  const isActioning = (allocationId: string) => actioningIds.includes(allocationId);
  const hasAnyActionInProgress = actioningIds.length > 0;

  const startAction = (allocationId: string) => {
    setActioningIds((current) => (current.includes(allocationId) ? current : [...current, allocationId]));
  };

  const finishAction = (allocationId: string) => {
    setActioningIds((current) => current.filter((id) => id !== allocationId));
  };

  useEffect(() => {
    if (!success) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSuccess(null);
    }, 2600);

    return () => window.clearTimeout(timeoutId);
  }, [success]);

  const baseFilteredAllocations = useMemo(() => {
    const todayKey = getLocalDateKey();
    const normalizedSearch = normalizeText(searchTerm);
    const nowIso = new Date().toISOString();

    return allocations.filter((item) => {
      const collectionDateKey = getDateKey(item.collection_date);
      if (!isDateWithinHistoryRange(collectionDateKey, historyRange)) {
        return false;
      }

      if (legacyFilterQuery === "upcoming" && todayKey && collectionDateKey && collectionDateKey <= todayKey) {
        return false;
      }

      if (legacyFilterQuery === "upcoming" && !collectionDateKey) {
        return false;
      }

      if (statusFilter === "overdue") {
        if (!isExportAllocationOverdue(item, nowIso)) {
          return false;
        }
      } else if (statusFilter === "at_customer") {
        if (item.status !== "delivered_empty" && item.status !== "waiting_loading") {
          return false;
        }
      } else if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }

      if (normalizedSearch) {
        const searchTargets = [
          item.trailer_number,
          item.customer,
          item.collection_address,
          item.haulier,
          item.booking_reference,
          item.load_type,
        ];

        const matchesSearch = searchTargets.some((value) => normalizeText(value).includes(normalizedSearch));
        if (!matchesSearch) {
          return false;
        }
      }

      return true;
    });
  }, [allocations, historyRange, legacyFilterQuery, searchTerm, statusFilter]);

  const customerOptions = useMemo(() => getCustomerOptions(allocations), [allocations]);

  const priorityOptions = useMemo(() => getDistinctOptions(allocations, "priority"), [allocations]);
  const haulierOptions = useMemo(() => getDistinctOptions(allocations, "haulier"), [allocations]);

  const resolvedCustomerValues = useMemo(() => {
    const queries = selectedCustomerQueries.length > 0 ? selectedCustomerQueries : selectedCustomerQuery ? [selectedCustomerQuery] : [];
    return queries.map((query) => customerOptions.find((option) => normalizeText(option) === normalizeText(query)) ?? query).filter(Boolean);
  }, [customerOptions, selectedCustomerQueries, selectedCustomerQuery]);

  const customerSelectOptions = useMemo(() => {
    if (resolvedCustomerValues.length === 0) {
      return customerOptions;
    }
    return Array.from(new Set([...customerOptions, ...resolvedCustomerValues])).sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
  }, [customerOptions, resolvedCustomerValues]);

  const filteredAllocations = useMemo(() => {
    const filteredByCustomer = resolvedCustomerValues.length === 0
      ? baseFilteredAllocations
      : baseFilteredAllocations.filter((item) => resolvedCustomerValues.some((customer) => normalizeText(item.customer) === normalizeText(customer)));

    const filteredByOptionalFields = filteredByCustomer.filter((item) =>
      (priorityFilter === "all" || item.priority === priorityFilter)
      && (haulierFilter === "all" || normalizeText(item.haulier) === normalizeText(haulierFilter)),
    );

    const filteredByOwnership = ownershipFilter === "all"
      ? filteredByOptionalFields
      : filteredByOptionalFields.filter((item) => item.ownershipType === ownershipFilter);

    const filteredByPrefix = filteredByOwnership.filter((item) => {
      if (prefixFilter === "all") {
        return true;
      }

      return normalizeTrailerPrefix(item.trailer_number) === prefixFilter;
    });

    return [...filteredByPrefix].sort((left, right) => {
      if (sortBy === "trailer_asc" || sortBy === "trailer_desc") {
        const leftTrailer = left.trailer_number?.trim() ?? "";
        const rightTrailer = right.trailer_number?.trim() ?? "";
        const base = leftTrailer.localeCompare(rightTrailer, undefined, {
          numeric: true,
          sensitivity: "base",
        });
        return sortBy === "trailer_desc" ? -base : base;
      }

      return comparePrintAllocations(left, right);
    });
  }, [baseFilteredAllocations, haulierFilter, ownershipFilter, prefixFilter, priorityFilter, resolvedCustomerValues, sortBy]);

  const prefixOptions = useMemo(() => {
    const prefixes = new Set<string>();
    allocations.forEach((item) => {
      const prefix = normalizeTrailerPrefix(item.trailer_number);
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
  }, [allocations]);

  const panelAllocation = useMemo(
    () => filteredAllocations.find((item) => item.id === panelAllocationId) ?? null,
    [filteredAllocations, panelAllocationId],
  );

  const visibleSelectedAllocationIds = useMemo(
    () => selectedAllocationIds.filter((id) => filteredAllocations.some((item) => item.id === id)),
    [filteredAllocations, selectedAllocationIds],
  );

  const printAllocations = useMemo(() => [...filteredAllocations].sort(comparePrintAllocations), [filteredAllocations]);

  const filteredCount = filteredAllocations.length;
  const printSummary = useMemo(
    () => ({
      totalAllocated: filteredAllocations.filter((item) => item.status === "allocated").length,
      atCustomer: filteredAllocations.filter((item) => item.status === "delivered_empty" || item.status === "waiting_loading").length,
      collectedLoaded: filteredAllocations.filter((item) => item.status === "collected_loaded").length,
      completed: filteredAllocations.filter((item) => item.status === "completed").length,
      urgent: filteredAllocations.filter((item) => item.priority === "urgent").length,
    }),
    [filteredAllocations],
  );

  const selectedStatusLabel = getStatusLabel(statusFilter);
  const selectedDateLabel = getHistoryDateRangeLabel(historyRange);
  const selectedCustomerLabel = resolvedCustomerValues.length > 0 ? resolvedCustomerValues.join(", ") : "All Customers";
  const selectedOwnershipLabel = ownershipFilter === "all" ? "All Ownership" : ownershipFilter === "company" ? "Company" : "Outsourcing";
  const printedAt = formatPrintedDateTime();

  const updateTrailerWhenLoaded = async (allocation: ExportAllocationRecord) => {
    if (!allocation.trailer_id) {
      return;
    }

    const { data: trailerData, error: trailerError } = await supabase
      .from("trailers")
      .select("id, trailer_number, load_status, customer, load_description")
      .eq("id", allocation.trailer_id)
      .single();

    if (trailerError || !trailerData) {
      throw new Error(trailerError?.message || "Unable to load trailer before marking export allocation as loaded.");
    }

    const trailer = trailerData as TrailerLoadSnapshot;
    const oldValue = {
      load_status: trailer.load_status ?? null,
      customer: trailer.customer ?? null,
      load_description: trailer.load_description ?? null,
    };

    const nextLoadDescription = allocation.load_type?.trim() ? allocation.load_type.trim() : trailer.load_description ?? null;
    const updatePayload = {
      load_status: "Loaded",
      customer: allocation.customer?.trim() ? allocation.customer.trim() : trailer.customer ?? null,
      load_description: nextLoadDescription,
    };

    const hasChange =
      (trailer.load_status ?? null) !== updatePayload.load_status ||
      (trailer.customer ?? null) !== updatePayload.customer ||
      (trailer.load_description ?? null) !== updatePayload.load_description;

    if (!hasChange) {
      return;
    }

    const { error: trailerUpdateError } = await supabase
      .from("trailers")
      .update(updatePayload)
      .eq("id", allocation.trailer_id);

    if (trailerUpdateError) {
      throw new Error(trailerUpdateError.message || "Unable to update trailer load fields from export allocation.");
    }

    const { error: eventError } = await supabase.from("trailer_events").insert({
      trailer_id: allocation.trailer_id,
      trailer_number: allocation.trailer_number,
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
      console.error("Failed to create trailer_loaded event from export allocation:", eventError);
    }
  };

  const createStatusChangedEvent = async (
    allocation: ExportAllocationRecord,
    oldStatus: ExportAllocationStatus,
    newStatus: ExportAllocationStatus,
    movementMetadata?: Record<string, unknown>,
    options?: { skipLegacyEvent?: boolean },
  ) => {
    const customer = allocation.customer?.trim() ? allocation.customer.trim() : "customer";
    let eventType = "export_allocation_status_changed";
    let eventDescription = `Export allocation status changed from ${getExportAllocationStatusLabel(oldStatus)} to ${getExportAllocationStatusLabel(newStatus)}.`;
    let activityEventType: "export_status_changed" | "export_cancelled" = "export_status_changed";
    let activityTitle = "Export status changed";

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
      activityEventType = "export_cancelled";
      activityTitle = "Export allocation cancelled";
      eventDescription = "Export allocation cancelled.";
    }

    const oldValuePayload = {
      export_allocation_id: allocation.id,
      status: oldStatus,
      ...(movementMetadata ? { movement: movementMetadata } : {}),
    } as Database["public"]["Tables"]["trailer_events"]["Insert"]["old_value"];

    const newValuePayload = {
      export_allocation_id: allocation.id,
      status: newStatus,
      ...(movementMetadata ? { movement: movementMetadata } : {}),
    } as Database["public"]["Tables"]["trailer_events"]["Insert"]["new_value"];

    if (!options?.skipLegacyEvent) {
      const { error: eventError } = await supabase.from("trailer_events").insert({
        trailer_id: allocation.trailer_id,
        trailer_number: allocation.trailer_number,
        event_type: eventType,
        event_description: eventDescription,
        old_value: oldValuePayload,
        new_value: newValuePayload,
      });

      if (eventError) {
        console.error("Failed to create export allocation status event:", eventError);
      }
    }

    try {
      await createTrailerActivity({
        trailerId: allocation.trailer_id,
        trailerNumber: allocation.trailer_number ?? "",
        eventType: activityEventType,
        eventTitle: activityTitle,
        eventDescription,
        sourceModule: "export",
        sourceRecordId: allocation.id,
        previousStatus: oldStatus,
        newStatus,
        previousCompoundPosition:
          typeof movementMetadata?.previous_compound_position === "string" ? movementMetadata.previous_compound_position : null,
        newCompoundPosition:
          typeof movementMetadata?.new_compound_position === "string" ? movementMetadata.new_compound_position : null,
        metadata: {
          export_allocation_id: allocation.id,
          customer: allocation.customer ?? null,
          movement: movementMetadata ?? null,
        },
      });
    } catch (activityError) {
      console.error("Unable to log trailer activity for export allocation status change:", activityError);
    }
  };

  const restoreTrailerToCompoundAfterUndo = async (
    allocation: ExportAllocationRecord,
    previousPosition?: string | null,
  ): Promise<CompoundRestoreResult> => {
    if (!allocation.trailer_id) {
      return { restoredPosition: null, fallbackUsed: false };
    }

    const preferred = normalizeCompoundPosition(previousPosition);
    let targetPosition = preferred;
    let fallbackUsed = false;

    if (targetPosition) {
      const { data: existingOccupancy, error: occupancyError } = await supabase
        .from("trailers")
        .select("id")
        .is("departure_date", null)
        .neq("is_local", true)
        .eq("compound_position", targetPosition)
        .neq("id", allocation.trailer_id)
        .limit(1);

      if (occupancyError) {
        throw new Error(occupancyError.message || "Unable to verify compound position availability.");
      }

      if ((existingOccupancy ?? []).length > 0) {
        targetPosition = null;
      }
    }

    if (!targetPosition) {
      targetPosition = await getNextAvailableCompoundPosition();
      fallbackUsed = Boolean(targetPosition);
    }

    if (!targetPosition) {
      throw new Error("No available compound position to restore trailer after undo.");
    }

    const { error: restoreError } = await supabase
      .from("trailers")
      .update({
        compound_position: targetPosition,
      })
      .eq("id", allocation.trailer_id);

    if (restoreError) {
      throw new Error(restoreError.message || "Unable to restore trailer compound position after undo.");
    }

    return { restoredPosition: targetPosition, fallbackUsed };
  };

  const handleAdvanceStatus = async (allocation: ExportAllocationRecord) => {
    if (isActioning(allocation.id)) {
      return;
    }

    const nextStatus = getNextExportAllocationStatus(allocation.status);
    if (!nextStatus) {
      return;
    }

    startAction(allocation.id);
    setError(null);
    setSuccess(null);
    setWarning(null);

    try {
      const advanceResult = await advanceExportAllocationStatus(supabase, {
        allocation,
        sourceModule: "export",
      });

      if (advanceResult.warning) {
        setWarning(advanceResult.warning);
      }

      if (advanceResult.nextStatus === "delivered_empty") {
        setUndoCandidateAllocationId(allocation.id);
        setSuccess("Status updated to Delivered Empty. Trailer removed from compound inventory.");
        await loadAllocations({ showLoading: false });
        if (typeof window !== "undefined") {
          window.localStorage.setItem(COMPOUND_REFRESH_STORAGE_KEY, Date.now().toString());
        }
        return;
      }

      if (advanceResult.nextStatus === "collected_loaded") {
        await updateTrailerWhenLoaded(allocation);
      }

      if (advanceResult.nextStatus === "waiting_loading" || advanceResult.nextStatus === "collected_loaded") {
        setUndoCandidateAllocationId(allocation.id);
      } else {
        setUndoCandidateAllocationId(null);
      }
      setSuccess(`Status updated to ${getExportAllocationStatusLabel(advanceResult.nextStatus)}.`);
      await loadAllocations({ showLoading: false });
    } catch (advanceErr) {
      setError(advanceErr instanceof Error ? advanceErr.message : "Unable to advance status.");
    } finally {
      finishAction(allocation.id);
    }
  };

  const handleCancel = async (allocation: ExportAllocationRecord) => {
    if (isActioning(allocation.id)) {
      return;
    }

    if (allocation.status === "completed" || allocation.status === "cancelled") {
      return;
    }

    startAction(allocation.id);
    setError(null);
    setSuccess(null);

    try {
      const cancelledAfterDeparture = isExportAllocationOffCompoundStatus(allocation.status);
      await advanceExportAllocationStatus(supabase, {
        allocation,
        sourceModule: "export",
        targetStatus: "cancelled",
        skipWaitingAutoAssign: true,
      });
      setUndoCandidateAllocationId(null);
      setSuccess(
        cancelledAfterDeparture
          ? "Allocation cancelled. Trailer remains outside compound until explicitly returned."
          : "Allocation cancelled.",
      );
      await loadAllocations({ showLoading: false });
    } catch (cancelErr) {
      setError(cancelErr instanceof Error ? cancelErr.message : "Unable to cancel allocation.");
    } finally {
      finishAction(allocation.id);
    }
  };

  const handleUndoLastMovement = async (allocation: ExportAllocationRecord) => {
    if (isActioning(allocation.id)) {
      return;
    }

    const previousStatus = getPreviousExportAllocationStatus(allocation.status);
    if (!previousStatus) {
      setError("Undo is only available after a status movement.");
      return;
    }

    startAction(allocation.id);
    setError(null);
    setSuccess(null);

    try {
      const nowIso = new Date().toISOString();
      const currentStatusTimestampField = getExportAllocationTimestampField(allocation.status);
      let movementMetadata: Record<string, unknown> | undefined;
      let fallbackRestoreMessage: string | null = null;
      const updatePayload: Database["public"]["Tables"]["export_allocations"]["Update"] = {
        status: previousStatus,
        updated_at: nowIso,
      };

      if (currentStatusTimestampField) {
        updatePayload[currentStatusTimestampField] = null;
      }

      const { error: undoError } = await supabase
        .from("export_allocations")
        .update(updatePayload)
        .eq("id", allocation.id)
        .eq("status", allocation.status);

      if (undoError) {
        throw new Error(undoError.message || "Unable to undo last movement.");
      }

      if (allocation.status === "delivered_empty" && previousStatus === "allocated") {
        if (!allocation.trailer_id) {
          throw new Error("Trailer is missing for undo operation.");
        }

        const workflowEvent = await supabase
          .from("trailer_events")
          .select("old_value, new_value")
          .eq("trailer_id", allocation.trailer_id)
          .eq("event_type", "export_allocation_status_changed")
          .order("created_at", { ascending: false })
          .limit(30);

        if (workflowEvent.error) {
          throw new Error(workflowEvent.error.message || "Unable to read export movement history for undo.");
        }

        const matchingEvent = (workflowEvent.data ?? []).find((row) => {
          const oldValue = row.old_value as { export_allocation_id?: string; movement?: { previous_compound_position?: string | null } } | null;
          const newValue = row.new_value as { status?: string } | null;
          return oldValue?.export_allocation_id === allocation.id && newValue?.status === "delivered_empty";
        }) as { old_value?: unknown } | undefined;

        const previousPosition = (
          matchingEvent?.old_value as { movement?: { previous_compound_position?: string | null } } | undefined
        )?.movement?.previous_compound_position;

        const restoreResult = await restoreTrailerToCompoundAfterUndo(allocation, previousPosition);
        movementMetadata = {
          reason: "export_undo_return",
          previous_compound_position: previousPosition ?? null,
          restored_compound_position: restoreResult.restoredPosition,
          fallback_position_used: restoreResult.fallbackUsed,
        };
        if (restoreResult.fallbackUsed && restoreResult.restoredPosition) {
          fallbackRestoreMessage = ` Trailer restored to next free position ${restoreResult.restoredPosition}.`;
        }
      }

      await createStatusChangedEvent(allocation, allocation.status, previousStatus, movementMetadata);
      setUndoCandidateAllocationId(null);
      setSuccess(
        `Last movement undone. Status is now ${getExportAllocationStatusLabel(previousStatus)}.${fallbackRestoreMessage ?? ""}`,
      );
      await loadAllocations({ showLoading: false });
    } catch (undoErr) {
      setError(undoErr instanceof Error ? undoErr.message : "Unable to undo last movement.");
    } finally {
      finishAction(allocation.id);
    }
  };

  const activeCount = allocations.filter((item) => EXPORT_ACTIVE_STATUSES.has(item.status)).length;
  const atCustomerCount = allocations.filter((item) => item.status === "delivered_empty" || item.status === "waiting_loading").length;
  const completedCount = allocations.filter((item) => item.status === "completed").length;

  const handleUndoFromToast = async () => {
    if (!undoCandidateAllocationId) {
      return;
    }

    const candidate = allocations.find((item) => item.id === undoCandidateAllocationId);
    if (!candidate) {
      setUndoCandidateAllocationId(null);
      return;
    }

    await handleUndoLastMovement(candidate);
  };

  const toggleAllocationSelection = (allocationId: string) => {
    setSelectedAllocationIds((current) => {
      if (current.includes(allocationId)) {
        return current.filter((id) => id !== allocationId);
      }

      return [...current, allocationId];
    });
  };

  const toggleSelectVisible = () => {
    setSelectedAllocationIds((current) => {
      const visibleIds = filteredAllocations.map((item) => item.id);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.includes(id));
      if (allVisibleSelected) {
        return current.filter((id) => !visibleIds.includes(id));
      }

      const merged = new Set(current);
      visibleIds.forEach((id) => merged.add(id));
      return Array.from(merged);
    });
  };

  const clearSelection = () => {
    setSelectedAllocationIds([]);
  };

  const handleBatchQuickAction = async () => {
    if (visibleSelectedAllocationIds.length === 0 || hasAnyActionInProgress) {
      return;
    }

    const selectedRows = filteredAllocations.filter((item) => visibleSelectedAllocationIds.includes(item.id));
    for (const allocation of selectedRows) {
      const next = getNextExportAllocationStatus(allocation.status);
      if (!next) {
        continue;
      }

      await handleAdvanceStatus(allocation);
    }
  };

  const handleQuickMove = async (allocation: ExportAllocationRecord, nextPosition: string) => {
    if (!allocation.trailer_id) {
      throw new Error("No trailer available for this allocation.");
    }

    const { data: trailerRow, error: trailerError } = await supabase
      .from("trailers")
      .select("id, trailer_number, load_status, compound_position")
      .eq("id", allocation.trailer_id)
      .single();

    if (trailerError || !trailerRow) {
      throw new Error(trailerError?.message || "Unable to load trailer for movement.");
    }

    const { error: updateError } = await supabase
      .from("trailers")
      .update({ compound_position: nextPosition })
      .eq("id", allocation.trailer_id)
      .select("id")
      .single();

    if (updateError) {
      throw new Error(updateError.message || "Unable to move trailer.");
    }

    const operatorName = await resolveAuditOperatorName();
    const nowIso = new Date().toISOString();
    await createTrailerActivity({
      trailerId: allocation.trailer_id,
      trailerNumber: trailerRow.trailer_number ?? allocation.trailer_number ?? allocation.trailer_id,
      eventType: "compound_position_assigned",
      eventTitle: "Position updated",
      eventDescription: `Compound position changed to ${nextPosition} from Export Operations.`,
      sourceModule: "export",
      sourceRecordId: allocation.id,
      previousStatus: trailerRow.load_status ?? null,
      newStatus: trailerRow.load_status ?? null,
      previousCompoundPosition: trailerRow.compound_position ?? null,
      newCompoundPosition: nextPosition,
      performedBy: operatorName,
      createdAt: nowIso,
    });

    setSuccess(`Trailer moved to ${nextPosition}.`);
  };

  return (
    <ReportPrintLayout
      screen={
        <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="screen-header rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Export Operations</h1>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">Allocate empty trailers and track export loading lifecycle.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/export-operations/new" className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
                + New Allocation
              </Link>
              <Link href="/dashboard" className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                Back to Dashboard
              </Link>
            </div>
          </div>
        </header>

        {saved ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            Export allocation saved successfully.
          </div>
        ) : null}

        {error ? (
          <div className="alert-screen-only rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
        ) : null}

        {success ? (
          <SuccessToast
            message={success}
            onClose={() => setSuccess(null)}
            actionLabel={undoCandidateAllocationId ? "Undo" : undefined}
            onAction={undoCandidateAllocationId ? () => void handleUndoFromToast() : undefined}
            actionDisabled={hasAnyActionInProgress}
          />
        ) : null}

        {warning ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            {warning}
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Total Allocations</p>
            <p className="mt-2 text-2xl font-bold text-white">{allocations.length}</p>
          </article>
          <article className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-200">Active</p>
            <p className="mt-2 text-2xl font-bold text-white">{activeCount}</p>
          </article>
          <article className="rounded-2xl border border-orange-500/30 bg-orange-500/10 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-orange-200">At Customer</p>
            <p className="mt-2 text-2xl font-bold text-white">{atCustomerCount}</p>
          </article>
          <article className="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-violet-200">Completed</p>
            <p className="mt-2 text-2xl font-bold text-white">{completedCount}</p>
          </article>
        </section>

        <section className="filters rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
          <OperationalActionBar
            moduleLabel="Export Operations"
            searchValue={searchTerm}
            onSearchChange={setSearchTerm}
            searchPlaceholder="Trailer, customer, address, haulier, booking, load type"
            prefixOptions={prefixOptions}
            prefixValue={prefixFilter}
            onPrefixChange={setPrefixFilter}
            statusOptions={STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            statusValue={statusFilter}
            onStatusChange={(value) => updateFilters({ status: value })}
            sortOptions={[
              { value: "collection_date", label: "Collection Date" },
              { value: "trailer_asc", label: "Trailer A-Z" },
              { value: "trailer_desc", label: "Trailer Z-A" },
            ]}
            sortValue={sortBy}
            onSortChange={(value) => setSortBy(value as "collection_date" | "trailer_asc" | "trailer_desc")}
            selectedCount={visibleSelectedAllocationIds.length}
            primaryActions={
              <>
                <button
                  type="button"
                  onClick={toggleSelectVisible}
                  className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  {filteredCount > 0 && filteredAllocations.every((item) => selectedAllocationIds.includes(item.id))
                    ? "Unselect Visible"
                    : "Select Visible"}
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={selectedAllocationIds.length === 0}
                  className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => void handleBatchQuickAction()}
                  disabled={selectedAllocationIds.length === 0 || hasAnyActionInProgress}
                  className="rounded-xl bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                >
                  Run Quick Action
                </button>
              </>
            }
            secondaryActions={
              <>
                <HistoryDateRangeFilter
                  value={historyRange}
                  onChange={(nextRange) => updateFilters({ history: nextRange })}
                  label="Collection Period"
                />
                <fieldset className="min-w-[220px] text-xs uppercase tracking-[0.2em] text-slate-500">
                  <legend>Customers</legend>
                  <div className="mt-1.5 max-h-32 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/85 p-2 text-sm normal-case tracking-normal text-slate-100">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={resolvedCustomerValues.length === 0}
                        onChange={() => updateFilters({ customers: [] })}
                      />
                      All Customers
                    </label>
                    {customerSelectOptions.map((customer) => (
                      <label key={customer} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={resolvedCustomerValues.some((selected) => normalizeText(selected) === normalizeText(customer))}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...resolvedCustomerValues, customer]
                              : resolvedCustomerValues.filter((selected) => normalizeText(selected) !== normalizeText(customer));
                            updateFilters({ customers: next });
                          }}
                        />
                        {customer}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Priority
                  <select
                    value={priorityFilter}
                    onChange={(event) => updateFilters({ priority: event.target.value })}
                    className="mt-1.5 h-10 rounded-xl border border-white/10 bg-slate-950/85 px-3 text-sm text-slate-100"
                  >
                    <option value="all">All Priorities</option>
                    {priorityOptions.map((priority) => <option key={priority} value={priority}>{getExportAllocationPriorityLabel(priority as ExportAllocationPriority)}</option>)}
                  </select>
                </label>
                <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Haulier
                  <select
                    value={haulierFilter}
                    onChange={(event) => updateFilters({ haulier: event.target.value })}
                    className="mt-1.5 h-10 rounded-xl border border-white/10 bg-slate-950/85 px-3 text-sm text-slate-100"
                  >
                    <option value="all">All Hauliers</option>
                    {haulierOptions.map((haulier) => <option key={haulier} value={haulier}>{haulier}</option>)}
                  </select>
                </label>
                <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Ownership
                  <select
                    value={ownershipFilter}
                    onChange={(event) => updateFilters({ ownership: getOwnershipQueryValue(event.target.value) })}
                    className="mt-1.5 h-10 rounded-xl border border-white/10 bg-slate-950/85 px-3 text-sm text-slate-100"
                  >
                    <option value="all">All Ownership</option>
                    <option value="company">Company</option>
                    <option value="outsourcing">Outsourcing</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  Clear Filters
                </button>
                <PrintButton label="Print / Export" disabled={isLoading || filteredCount === 0} className="action-buttons" />
              </>
            }
          />

          <p className="mt-4 text-sm font-semibold text-slate-200">{filteredCount} allocation{filteredCount === 1 ? "" : "s"}</p>
        </section>

        {isLoading ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">Loading export allocations...</div>
        ) : null}

        {!isLoading && filteredCount === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-300">
            No export allocations match the selected filters.
          </div>
        ) : null}

        {!isLoading && filteredCount > 0 ? (
          <section className="space-y-3">
            {filteredAllocations.map((allocation) => {
              const canQuickAdvance =
                allocation.status === "allocated" || allocation.status === "delivered_empty" || allocation.status === "waiting_loading" || allocation.status === "collected_loaded";
              const nextActionLabel = canQuickAdvance ? getAdvanceStatusActionLabel(allocation.status) : null;
              const canCancel = allocation.status !== "completed" && allocation.status !== "cancelled";
              const canUndo = allocation.status === "delivered_empty" || allocation.status === "waiting_loading" || allocation.status === "collected_loaded";
              const isActioningRow = isActioning(allocation.id);
              const overdue = isExportAllocationOverdue(allocation);

              return (
                <article key={allocation.id} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/70 px-2.5 py-1 text-xs text-slate-300">
                        <input
                          type="checkbox"
                          checked={selectedAllocationIds.includes(allocation.id)}
                          onChange={() => toggleAllocationSelection(allocation.id)}
                          className="h-4 w-4"
                        />
                        Select
                      </label>
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Trailer</p>
                      <p className="mt-1 text-xl font-semibold text-white">
                        {allocation.trailer_id ? (
                          <Link href={`/dashboard/trailers/${allocation.trailer_id}`} className="underline decoration-cyan-400/60 underline-offset-2 hover:text-cyan-200">
                            {allocation.trailer_number ?? "-"}
                          </Link>
                        ) : (
                          allocation.trailer_number ?? "-"
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getExportAllocationStatusClasses(allocation.status)}`}>
                        {getExportAllocationStatusLabel(allocation.status)}
                      </span>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getExportAllocationPriorityClasses(allocation.priority as ExportAllocationPriority)}`}>
                        {getExportAllocationPriorityLabel(allocation.priority as ExportAllocationPriority)}
                      </span>
                      <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200">
                        {getTrailerOwnershipBadgeLabel(allocation.ownershipType ?? "unknown")}
                      </span>
                      {overdue ? (
                        <span className="rounded-full border border-rose-500/40 bg-rose-500/20 px-3 py-1 text-xs font-semibold text-rose-100">Overdue</span>
                      ) : null}
                    </div>
                  </div>

                  <dl className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Customer</dt>
                      <dd className="mt-1">{allocation.customer ?? "-"}</dd>
                    </div>
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
                      <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Collection Date</dt>
                      <dd className="mt-1">{formatDate(allocation.collection_date)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Expected Return</dt>
                      <dd className="mt-1">{formatDateTime(allocation.expected_return_at)}</dd>
                    </div>
                  </dl>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-300">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Notes</p>
                    <p className="mt-1">{allocation.notes?.trim() ? allocation.notes : "-"}</p>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {nextActionLabel ? (
                      <button
                        type="button"
                        onClick={() => void handleAdvanceStatus(allocation)}
                        disabled={isActioningRow}
                        className="rounded-xl bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                      >
                        {isActioningRow ? "Updating..." : nextActionLabel}
                      </button>
                    ) : (
                      <Link href={`/dashboard/export-operations/${allocation.id}`} className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700">
                        View Allocation
                      </Link>
                    )}

                    <details className="group rounded-xl border border-white/10 bg-slate-950/60">
                      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-slate-100 marker:content-none">More Actions</summary>
                      <div className="flex flex-col gap-2 border-t border-white/10 p-2">
                        {allocation.trailer_id ? (
                          <Link href={`/dashboard/trailers/${allocation.trailer_id}`} className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">
                            View Trailer
                          </Link>
                        ) : null}
                        <Link href={`/dashboard/export-operations/${allocation.id}`} className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">
                          View
                        </Link>
                        <Link href={`/dashboard/export-operations/${allocation.id}?edit=1`} className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">
                          Edit
                        </Link>
                        <button
                          type="button"
                          onClick={() => setHistoryTrailer({ trailerId: allocation.trailer_id ?? null, trailerNumber: allocation.trailer_number ?? null })}
                          className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-left text-xs font-semibold text-white hover:bg-slate-700"
                        >
                          History
                        </button>
                        {canCancel ? (
                          <button
                            type="button"
                            onClick={() => void handleCancel(allocation)}
                            disabled={isActioningRow}
                            className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-left text-xs font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-60"
                          >
                            {isActioningRow ? "Cancelling..." : "Cancel Allocation"}
                          </button>
                        ) : null}
                        {canUndo ? (
                          <button
                            type="button"
                            onClick={() => void handleUndoLastMovement(allocation)}
                            disabled={isActioningRow}
                            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-60"
                          >
                            {isActioningRow ? "Undoing..." : "Undo Last Movement"}
                          </button>
                        ) : null}
                      </div>
                    </details>

                    <button
                      type="button"
                      onClick={() => setPanelAllocationId(allocation.id)}
                      className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                    >
                      Open Workspace
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}

        <TrailerHistoryDrawer
          isOpen={Boolean(historyTrailer)}
          trailerId={historyTrailer?.trailerId}
          trailerNumber={historyTrailer?.trailerNumber}
          onClose={() => setHistoryTrailer(null)}
        />

        <TrailerOperationsPanel
          isOpen={Boolean(panelAllocation)}
          onClose={() => setPanelAllocationId(null)}
          moduleLabel="Export Operations"
          trailer={
            panelAllocation
              ? {
                  id: panelAllocation.id,
                  trailerId: panelAllocation.trailer_id ?? null,
                  trailerNumber: panelAllocation.trailer_number ?? null,
                  customer: panelAllocation.customer ?? null,
                  loadStatus: panelAllocation.load_type ?? null,
                  status: panelAllocation.status,
                  compoundPosition: null,
                  arrivalDate: panelAllocation.collection_date ?? null,
                }
              : null
          }
          inspectionHref={panelAllocation?.trailer_id ? `/dashboard/trailers/${panelAllocation.trailer_id}` : null}
          photosHref={panelAllocation?.trailer_id ? `/dashboard/trailers/${panelAllocation.trailer_id}` : null}
          damageHref={panelAllocation?.trailer_id ? `/dashboard/trailers/${panelAllocation.trailer_id}` : null}
          onDeliveredEmpty={
            panelAllocation && getNextExportAllocationStatus(panelAllocation.status)
              ? () => handleAdvanceStatus(panelAllocation)
              : undefined
          }
          onOpenHistory={
            panelAllocation
              ? () =>
                  setHistoryTrailer({
                    trailerId: panelAllocation.trailer_id ?? null,
                    trailerNumber: panelAllocation.trailer_number ?? null,
                  })
              : undefined
          }
          onMove={panelAllocation ? (nextPosition) => handleQuickMove(panelAllocation, nextPosition) : undefined}
          moveLabel="Move Trailer"
          isBusy={hasAnyActionInProgress}
        />
      </div>
    </main>
      }
      print={
        <PrintReportLayout orientation="landscape">
          <PrintHeader title="Export Trailer Operations" printedAt={printedAt} totalRecords={filteredCount}>
            <PrintFilters
              items={[
                { label: "Collection Date", value: selectedDateLabel },
                { label: "Customer", value: selectedCustomerLabel },
                { label: "Ownership", value: selectedOwnershipLabel },
                { label: "Status", value: selectedStatusLabel },
                { label: "Search", value: searchTerm.trim() || "All visible records" },
              ]}
            />
          </PrintHeader>

          <PrintSummary
            items={[
              { label: "Total Allocated", value: printSummary.totalAllocated },
              { label: "At Customer", value: printSummary.atCustomer },
              { label: "Collected Loaded", value: printSummary.collectedLoaded },
              { label: "Completed", value: printSummary.completed },
              { label: "Urgent", value: printSummary.urgent },
            ]}
          />

          <PrintTable
            rows={printAllocations}
            rowClassName={(allocation) => (allocation.priority === "urgent" ? "print-urgent" : undefined)}
            columns={[
              { key: "trailer_number", header: "Trailer", render: (allocation) => allocation.trailer_number ?? "—" },
              { key: "ownership", header: "Ownership", render: (allocation) => getTrailerOwnershipBadgeLabel(allocation.ownershipType ?? "unknown") },
              { key: "customer", header: "Customer", render: (allocation) => allocation.customer ?? "—" },
              { key: "collection_address", header: "Collection Address", render: (allocation) => allocation.collection_address ?? "—" },
              { key: "haulier", header: "Haulier", render: (allocation) => allocation.haulier ?? "—" },
              { key: "booking_reference", header: "Booking Reference", render: (allocation) => allocation.booking_reference ?? "—" },
              { key: "load_type", header: "Load Type", render: (allocation) => allocation.load_type ?? "—" },
              { key: "priority", header: "Priority", render: (allocation) => allocation.priority === "urgent" ? "URGENT" : getExportAllocationPriorityLabel(allocation.priority as ExportAllocationPriority) },
              { key: "status", header: "Status", render: (allocation) => getExportAllocationStatusLabel(allocation.status) },
              { key: "notes", header: "Notes", render: (allocation) => allocation.notes?.trim() ? allocation.notes : "—" },
            ]}
          />

          <PrintFooter />
        </PrintReportLayout>
      }
    />
  );
}

export default function ExportOperationsPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">Loading export operations...</div>
        </main>
      }
    >
      <ExportOperationsPageContent />
    </Suspense>
  );
}
