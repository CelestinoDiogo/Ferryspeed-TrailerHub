"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { PrintButton } from "@/components/print/print-button";
import { PrintFilters } from "@/components/print/print-filters";
import { PrintFooter } from "@/components/print/print-footer";
import { PrintHeader } from "@/components/print/print-header";
import { PrintReportLayout } from "@/components/print/print-report-layout";
import { ReportPrintLayout } from "@/components/print/report-print-layout";
import { PrintSummary } from "@/components/print/print-summary";
import { PrintTable } from "@/components/print/print-table";
import type { Database } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { getLocalDateKey } from "@/lib/operational-readiness";
import {
  COMPOUND_REFRESH_STORAGE_KEY,
  assignNextWaitingTrailerAfterDeliveredEmpty,
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

const formatDateKey = (value?: string | null) => {
  if (!value) return "-";

  try {
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    if (!year || !month || !day) {
      return new Date(value).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
    }

    return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "-";
  }
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

function ExportOperationsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const saved = searchParams.get("saved") === "1";
  const selectedDate = searchParams.get("date") ?? "";
  const selectedCustomerQuery = searchParams.get("customer") ?? "";
  const statusQuery = searchParams.get("status");
  const legacyFilterQuery = statusQuery ? null : searchParams.get("filter");
  const statusFilter = getStatusQueryValue(statusQuery ?? legacyFilterQuery ?? "all");

  const [searchTerm, setSearchTerm] = useState("");

  const [allocations, setAllocations] = useState<ExportAllocationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const updateFilters = (updates: { date?: string; customer?: string; status?: string }) => {
    const params = new URLSearchParams(searchParams.toString());

    if (updates.date !== undefined) {
      const value = updates.date.trim();
      if (value) {
        params.set("date", value);
      } else {
        params.delete("date");
      }
    }

    if (updates.customer !== undefined) {
      const value = updates.customer.trim();
      if (value) {
        params.set("customer", value);
      } else {
        params.delete("customer");
      }
    }

    if (updates.status !== undefined) {
      const value = updates.status.trim();
      if (value && value !== "all") {
        params.set("status", value);
      } else {
        params.delete("status");
      }
    }

    params.delete("filter");

    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(nextUrl, { scroll: false });
  };

  const handleClearFilters = () => {
    setSearchTerm("");
    router.replace(pathname, { scroll: false });
  };

  const handlePrintList = () => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.print();
      });
    });
  };

  const loadAllocations = async () => {
    setIsLoading(true);
    setError(null);
    setWarning(null);

    try {
      const queryColumns = `
        id,
        trailer_id,
        trailer_number,
        customer,
        collection_address,
        haulier,
        booking_reference,
        load_type,
        collection_date,
        expected_return_at,
        priority,
        status,
        notes,
        allocated_at,
        delivered_empty_at,
        waiting_loading_at,
        collected_loaded_at,
        completed_at,
        collected_by_haulier_at,
        loading_started_at,
        loaded_at,
        returned_at,
        shipped_at,
        cancelled_at,
        created_at,
        updated_at
      `;

      const fallbackColumns = `
        id,
        trailer_id,
        trailer_number,
        customer,
        collection_address,
        haulier,
        booking_reference,
        load_type,
        collection_date,
        expected_return_at,
        priority,
        status,
        notes,
        allocated_at,
        delivered_empty_at,
        waiting_loading_at,
        collected_loaded_at,
        completed_at,
        created_at,
        updated_at
      `;

      const runQuery = async (columns: string) =>
        supabase
          .from("export_allocations")
          .select(columns)
          .order("collection_date", { ascending: true })
          .order("created_at", { ascending: false });

      let result = await runQuery(queryColumns);

      if (result.error) {
        result = await runQuery(fallbackColumns);

        if (result.error) {
          throw new Error([result.error.message, result.error.details, result.error.hint].filter(Boolean).join(" - "));
        }
      }

      const rows = (result.data ?? []) as unknown as ExportAllocationRecord[];
      setAllocations(rows.map((row) => normalizeExportAllocationRecord(row)));
    } catch (loadErr) {
      setError(loadErr instanceof Error ? loadErr.message : "Unable to load export allocations.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAllocations();
  }, []);

  const baseFilteredAllocations = useMemo(() => {
    const todayKey = getLocalDateKey();
    const normalizedSearch = normalizeText(searchTerm);
    const nowIso = new Date().toISOString();

    return allocations.filter((item) => {
      const collectionDate = item.collection_date?.trim() ?? "";

      if (selectedDate.trim()) {
        if (collectionDate !== selectedDate.trim()) {
          return false;
        }
      } else if (legacyFilterQuery === "today") {
        const collectionDateKey = collectionDate.slice(0, 10);
        if (collectionDateKey !== todayKey) {
          return false;
        }
      } else if (legacyFilterQuery === "upcoming") {
        const collectionDateKey = collectionDate.slice(0, 10);
        if (!collectionDateKey || !todayKey || collectionDateKey <= todayKey) {
          return false;
        }
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
  }, [allocations, legacyFilterQuery, searchTerm, selectedDate, statusFilter]);

  const customerOptions = useMemo(() => getCustomerOptions(baseFilteredAllocations), [baseFilteredAllocations]);

  const resolvedCustomerValue = useMemo(() => {
    const query = selectedCustomerQuery.trim();
    if (!query) {
      return "";
    }

    const match = customerOptions.find((option) => normalizeText(option) === normalizeText(query));
    return match ?? query;
  }, [customerOptions, selectedCustomerQuery]);

  const customerSelectOptions = useMemo(() => {
    if (!resolvedCustomerValue) {
      return customerOptions;
    }

    const hasMatch = customerOptions.some((option) => normalizeText(option) === normalizeText(resolvedCustomerValue));
    if (hasMatch) {
      return customerOptions;
    }

    return [...customerOptions, resolvedCustomerValue].sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
  }, [customerOptions, resolvedCustomerValue]);

  const filteredAllocations = useMemo(() => {
    if (!resolvedCustomerValue) {
      return baseFilteredAllocations;
    }

    return baseFilteredAllocations.filter((item) => normalizeText(item.customer) === normalizeText(resolvedCustomerValue));
  }, [baseFilteredAllocations, resolvedCustomerValue]);

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
  const selectedDateLabel = selectedDate.trim() ? formatDateKey(selectedDate) : "All Dates";
  const selectedCustomerLabel = resolvedCustomerValue ? resolvedCustomerValue : "All Customers";
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
  ) => {
    const customer = allocation.customer?.trim() ? allocation.customer.trim() : "customer";
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
  };

  const moveAllocationToDeliveredEmpty = async (allocation: ExportAllocationRecord) => {
    if (!allocation.trailer_id) {
      return { previousPosition: null as string | null, requiresClientEvent: true };
    }

    const rpcResult = await (supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
    }).rpc("set_export_allocation_delivered_empty", {
      p_allocation_id: allocation.id,
      p_expected_current_status: allocation.status,
    });

    if (!rpcResult.error) {
      const rpcRows = Array.isArray(rpcResult.data) ? rpcResult.data : [];
      const row = (rpcRows[0] as { transitioned?: boolean; previous_compound_position?: string | null } | undefined) ?? null;
      if (!row?.transitioned) {
        throw new Error("Allocation status changed by another user. Refresh and try again.");
      }

      return {
        previousPosition: normalizeCompoundPosition(row.previous_compound_position),
        requiresClientEvent: false,
      };
    }

    if (rpcResult.error.code !== "42883") {
      throw new Error(rpcResult.error.message || "Unable to move allocation to Delivered Empty.");
    }

    const nowIso = new Date().toISOString();
    const { data: trailerData, error: trailerReadError } = await supabase
      .from("trailers")
      .select("id, compound_position")
      .eq("id", allocation.trailer_id)
      .single();

    if (trailerReadError || !trailerData) {
      throw new Error(trailerReadError?.message || "Unable to load trailer compound position.");
    }

    const previousPosition = normalizeCompoundPosition((trailerData as { compound_position?: string | null }).compound_position);
    const { error: updateError } = await supabase
      .from("export_allocations")
      .update({
        status: "delivered_empty",
        delivered_empty_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", allocation.id)
      .eq("status", allocation.status);

    if (updateError) {
      throw new Error(updateError.message || "Unable to advance export allocation status.");
    }

    const { error: trailerUpdateError } = await supabase
      .from("trailers")
      .update({
        compound_position: null,
      })
      .eq("id", allocation.trailer_id);

    if (trailerUpdateError) {
      await supabase
        .from("export_allocations")
        .update({
          status: allocation.status,
          delivered_empty_at: allocation.delivered_empty_at ?? null,
          updated_at: nowIso,
        })
        .eq("id", allocation.id)
        .eq("status", "delivered_empty");

      throw new Error(trailerUpdateError.message || "Unable to clear trailer compound position.");
    }

    return { previousPosition, requiresClientEvent: true };
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
    if (actioningId) {
      return;
    }

    const nextStatus = getNextExportAllocationStatus(allocation.status);
    if (!nextStatus) {
      return;
    }

    setActioningId(allocation.id);
    setError(null);
    setSuccess(null);
    setWarning(null);

    try {
      let movementMetadata: Record<string, unknown> | undefined;

      if (nextStatus === "delivered_empty") {
        const delivered = await moveAllocationToDeliveredEmpty(allocation);
        movementMetadata = {
          reason: "export_departure",
          previous_compound_position: delivered.previousPosition,
          new_compound_position: null,
        };

        let automaticAssignmentMessage: string | null = null;

        try {
          const automaticAssignment = await assignNextWaitingTrailerAfterDeliveredEmpty(
            supabase as unknown as {
              rpc: (
                fn: string,
                args?: Record<string, unknown>,
              ) => Promise<{
                data: unknown;
                error: { code?: string; message?: string } | null;
              }>;
            },
          );

          if (automaticAssignment.assigned) {
            const trailerNumber = automaticAssignment.trailerNumber ?? "the waiting trailer";
            const assignedPosition = automaticAssignment.assignedPosition ?? "the first available position";
            automaticAssignmentMessage = `Trailer delivered empty. Waiting trailer ${trailerNumber} was automatically assigned to ${assignedPosition}.`;
          }
        } catch {
          setWarning("Trailer delivered empty, but automatic waiting assignment could not be completed.");
        }

        if (delivered.requiresClientEvent) {
          await createStatusChangedEvent(allocation, allocation.status, nextStatus, movementMetadata);
        }
        setSuccess(
          automaticAssignmentMessage
            ? `Status updated to Delivered Empty. Trailer removed from compound inventory. ${automaticAssignmentMessage}`
            : "Status updated to Delivered Empty. Trailer removed from compound inventory.",
        );
        await loadAllocations();
        if (typeof window !== "undefined") {
          window.localStorage.setItem(COMPOUND_REFRESH_STORAGE_KEY, Date.now().toString());
        }
        return;
      }

      if (nextStatus === "collected_loaded") {
        await updateTrailerWhenLoaded(allocation);
      }

      const nowIso = new Date().toISOString();
      const timestampField = getExportAllocationTimestampField(nextStatus);
      const updatePayload: Database["public"]["Tables"]["export_allocations"]["Update"] = {
        status: nextStatus,
        updated_at: nowIso,
      };

      if (timestampField) {
        updatePayload[timestampField] = nowIso;
      }

      const { error: updateError } = await supabase
        .from("export_allocations")
        .update(updatePayload)
        .eq("id", allocation.id)
        .eq("status", allocation.status);

      if (updateError) {
        throw new Error(updateError.message || "Unable to advance export allocation status.");
      }

      await createStatusChangedEvent(allocation, allocation.status, nextStatus);
      setSuccess(`Status updated to ${getExportAllocationStatusLabel(nextStatus)}.`);
      await loadAllocations();
    } catch (advanceErr) {
      setError(advanceErr instanceof Error ? advanceErr.message : "Unable to advance status.");
    } finally {
      setActioningId(null);
    }
  };

  const handleCancel = async (allocation: ExportAllocationRecord) => {
    if (actioningId) {
      return;
    }

    if (allocation.status === "completed" || allocation.status === "cancelled") {
      return;
    }

    setActioningId(allocation.id);
    setError(null);
    setSuccess(null);

    try {
      const nowIso = new Date().toISOString();
      const cancelledAfterDeparture = isExportAllocationOffCompoundStatus(allocation.status);
      const { error: cancelError } = await supabase
        .from("export_allocations")
        .update({
          status: "cancelled",
          cancelled_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", allocation.id)
        .eq("status", allocation.status);

      if (cancelError) {
        throw new Error(cancelError.message || "Unable to cancel export allocation.");
      }

      await createStatusChangedEvent(allocation, allocation.status, "cancelled", {
        requires_manual_compound_return: cancelledAfterDeparture,
      });
      setSuccess(
        cancelledAfterDeparture
          ? "Allocation cancelled. Trailer remains outside compound until explicitly returned."
          : "Allocation cancelled.",
      );
      await loadAllocations();
    } catch (cancelErr) {
      setError(cancelErr instanceof Error ? cancelErr.message : "Unable to cancel allocation.");
    } finally {
      setActioningId(null);
    }
  };

  const handleUndoLastMovement = async (allocation: ExportAllocationRecord) => {
    if (actioningId) {
      return;
    }

    const previousStatus = getPreviousExportAllocationStatus(allocation.status);
    if (!previousStatus) {
      setError("Undo is only available after a status movement.");
      return;
    }

    setActioningId(allocation.id);
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
      setSuccess(
        `Last movement undone. Status is now ${getExportAllocationStatusLabel(previousStatus)}.${fallbackRestoreMessage ?? ""}`,
      );
      await loadAllocations();
    } catch (undoErr) {
      setError(undoErr instanceof Error ? undoErr.message : "Unable to undo last movement.");
    } finally {
      setActioningId(null);
    }
  };

  const activeCount = allocations.filter((item) => EXPORT_ACTIVE_STATUSES.has(item.status)).length;
  const atCustomerCount = allocations.filter((item) => item.status === "delivered_empty" || item.status === "waiting_loading").length;
  const completedCount = allocations.filter((item) => item.status === "completed").length;

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
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>
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
          <div className="grid gap-3 xl:grid-cols-4">
            <label className="flex flex-col gap-2 text-sm text-slate-300">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Collection Date</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => updateFilters({ date: event.target.value })}
                className="h-11 rounded-2xl border border-white/10 bg-slate-950/80 px-3 text-slate-100 outline-none ring-0 placeholder:text-slate-500 focus:border-cyan-400/50"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm text-slate-300">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Customer</span>
              <select
                value={resolvedCustomerValue}
                onChange={(event) => updateFilters({ customer: event.target.value })}
                className="h-11 rounded-2xl border border-white/10 bg-slate-950/80 px-3 text-slate-100 outline-none ring-0 focus:border-cyan-400/50"
              >
                <option value="">All Customers</option>
                {customerSelectOptions.map((customer) => (
                  <option key={customer} value={customer}>
                    {customer}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm text-slate-300">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => updateFilters({ status: event.target.value })}
                className="h-11 rounded-2xl border border-white/10 bg-slate-950/80 px-3 text-slate-100 outline-none ring-0 focus:border-cyan-400/50"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm text-slate-300">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Search</span>
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Trailer, customer, address, haulier, booking, load type"
                className="h-11 rounded-2xl border border-white/10 bg-slate-950/80 px-3 text-slate-100 outline-none ring-0 placeholder:text-slate-500 focus:border-cyan-400/50"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-200">
              {filteredCount} allocation{filteredCount === 1 ? "" : "s"}
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => updateFilters({ date: getLocalDateKey() })}
                className="rounded-2xl border border-white/10 bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              >
                Today
              </button>
              <button
                type="button"
                onClick={handleClearFilters}
                className="rounded-2xl border border-white/10 bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              >
                Clear Filters
              </button>
              <PrintButton label="Print / Export" disabled={isLoading || filteredCount === 0} onPrint={handlePrintList} className="action-buttons" />
            </div>
          </div>
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
              const isActioning = actioningId === allocation.id;
              const overdue = isExportAllocationOverdue(allocation);

              return (
                <article key={allocation.id} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Trailer</p>
                      <p className="mt-1 text-xl font-semibold text-white">{allocation.trailer_number ?? "-"}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getExportAllocationStatusClasses(allocation.status)}`}>
                        {getExportAllocationStatusLabel(allocation.status)}
                      </span>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getExportAllocationPriorityClasses(allocation.priority as ExportAllocationPriority)}`}>
                        {getExportAllocationPriorityLabel(allocation.priority as ExportAllocationPriority)}
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
                    <Link href={`/dashboard/export-operations/${allocation.id}`} className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">
                      View
                    </Link>
                    <Link href={`/dashboard/export-operations/${allocation.id}?edit=1`} className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">
                      Edit
                    </Link>
                    {nextActionLabel ? (
                      <button
                        type="button"
                        onClick={() => void handleAdvanceStatus(allocation)}
                        disabled={isActioning}
                        className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-60"
                      >
                        {isActioning ? "Updating..." : nextActionLabel}
                      </button>
                    ) : null}
                    {canCancel ? (
                      <button
                        type="button"
                        onClick={() => void handleCancel(allocation)}
                        disabled={isActioning}
                        className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-60"
                      >
                        {isActioning ? "Cancelling..." : "Cancel Allocation"}
                      </button>
                    ) : null}
                    {canUndo ? (
                      <button
                        type="button"
                        onClick={() => void handleUndoLastMovement(allocation)}
                        disabled={isActioning}
                        className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-60"
                      >
                        {isActioning ? "Undoing..." : "Undo Last Movement"}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}
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
