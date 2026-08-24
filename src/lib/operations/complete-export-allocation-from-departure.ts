import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  EXPORT_ACTIVE_STATUS_QUERY_VALUES,
  isExportAllocationActive,
  normalizeExportAllocationStatus,
  type ExportAllocationStatus,
} from "@/lib/export-allocation";
import { recordTrailerLifecycleEvent } from "@/lib/operations/trailer-lifecycle";

type RouteSupabase = SupabaseClient<Database>;

export const EXPORT_COMPLETED_FROM_CONFIRMED_DEPARTURE_EVENT =
  "export_allocation_completed_from_departure";

export type ExportDepartureReconciliationOutcome =
  | "none"
  | "completed"
  | "already_completed"
  | "conflict"
  | "skipped_cancelled";

export type ExportDepartureReconciliation = {
  outcome: ExportDepartureReconciliationOutcome;
  allocationId?: string | null;
  previousStatus?: ExportAllocationStatus | null;
  customer?: string | null;
};

type ExportAllocationRow = {
  id: string;
  trailer_id: string | null;
  trailer_number: string | null;
  customer: string | null;
  status: string | null;
  allocated_at: string | null;
  delivered_empty_at: string | null;
  waiting_loading_at: string | null;
  collected_loaded_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
};

const EXPORT_RECONCILIATION_SELECT =
  "id, trailer_id, trailer_number, customer, status, allocated_at, delivered_empty_at, waiting_loading_at, collected_loaded_at, completed_at, cancelled_at";

const normalizeTrailerNumber = (value?: string | null) =>
  (value ?? "").replace(/[\s-]/g, "").toUpperCase();

export function findCanonicalActiveExportAllocation(
  rows: ExportAllocationRow[],
  input: { trailerId: string; trailerNumber?: string | null },
) {
  const byTrailerId = rows.filter(
    (row) =>
      row.trailer_id === input.trailerId &&
      isExportAllocationActive(normalizeExportAllocationStatus(row.status)),
  );

  if (byTrailerId.length === 1) {
    return { match: "single" as const, allocation: byTrailerId[0] };
  }

  if (byTrailerId.length > 1) {
    return { match: "conflict" as const, allocations: byTrailerId };
  }

  const wantedNumber = normalizeTrailerNumber(input.trailerNumber);
  if (!wantedNumber) {
    return { match: "none" as const };
  }

  const byNumber = rows.filter((row) => {
    if (!row.trailer_id || row.trailer_id !== input.trailerId) {
      return false;
    }

    return (
      isExportAllocationActive(normalizeExportAllocationStatus(row.status)) &&
      normalizeTrailerNumber(row.trailer_number) === wantedNumber
    );
  });

  if (byNumber.length === 1) {
    return { match: "single" as const, allocation: byNumber[0] };
  }

  if (byNumber.length > 1) {
    return { match: "conflict" as const, allocations: byNumber };
  }

  return { match: "none" as const };
}

export async function completeExportAllocationFromConfirmedDeparture(
  supabase: RouteSupabase,
  input: {
    trailerId: string;
    trailerNumber?: string | null;
    departedAt: string;
    performedBy: string;
  },
): Promise<ExportDepartureReconciliation> {
  const { data, error } = await supabase
    .from("export_allocations")
    .select(EXPORT_RECONCILIATION_SELECT)
    .eq("trailer_id", input.trailerId)
    .in("status", [...EXPORT_ACTIVE_STATUS_QUERY_VALUES, "completed"]);

  if (error) {
    throw new Error(error.message || "Unable to load export allocations for departure reconciliation.");
  }

  const rows = (data ?? []) as ExportAllocationRow[];
  const completedRows = rows.filter(
    (row) => normalizeExportAllocationStatus(row.status) === "completed",
  );
  const canonical = findCanonicalActiveExportAllocation(rows, input);

  if (canonical.match === "conflict") {
    return { outcome: "conflict" };
  }

  if (canonical.match === "none") {
    if (completedRows.length > 0) {
      return {
        outcome: "already_completed",
        allocationId: completedRows[0].id,
        previousStatus: "completed",
        customer: completedRows[0].customer,
      };
    }

    return { outcome: "none" };
  }

  const allocation = canonical.allocation;
  const previousStatus = normalizeExportAllocationStatus(allocation.status);

  if (previousStatus === "cancelled") {
    return {
      outcome: "skipped_cancelled",
      allocationId: allocation.id,
      previousStatus,
      customer: allocation.customer,
    };
  }

  if (previousStatus === "completed") {
    return {
      outcome: "already_completed",
      allocationId: allocation.id,
      previousStatus,
      customer: allocation.customer,
    };
  }

  const { data: updated, error: updateError } = await supabase
    .from("export_allocations")
    .update({
      status: "completed",
      completed_at: allocation.completed_at ?? input.departedAt,
      updated_at: input.departedAt,
    })
    .eq("id", allocation.id)
    .in("status", [...EXPORT_ACTIVE_STATUS_QUERY_VALUES])
    .select(EXPORT_RECONCILIATION_SELECT)
    .maybeSingle();

  if (updateError) {
    throw new Error(updateError.message || "Unable to complete the linked export allocation after departure.");
  }

  if (!updated) {
    return {
      outcome: "already_completed",
      allocationId: allocation.id,
      previousStatus,
      customer: allocation.customer,
    };
  }

  await recordTrailerLifecycleEvent(supabase, {
    trailerId: input.trailerId,
    trailerNumber: input.trailerNumber ?? allocation.trailer_number ?? "Unknown trailer",
    eventType: EXPORT_COMPLETED_FROM_CONFIRMED_DEPARTURE_EVENT,
    title: "Export allocation completed from confirmed departure",
    description: "Export allocation completed from confirmed trailer departure.",
    sourceModule: "departure",
    sourceRecordId: allocation.id,
    previousStatus,
    newStatus: "completed",
    metadata: {
      export_allocation_id: allocation.id,
      previous_status: previousStatus,
      departed_at: input.departedAt,
      source: "departure",
      allocated_at: allocation.allocated_at,
      delivered_empty_at: allocation.delivered_empty_at,
      waiting_loading_at: allocation.waiting_loading_at,
      collected_loaded_at: allocation.collected_loaded_at,
    },
    occurredAt: input.departedAt,
    performedBy: input.performedBy,
    oldValue: {
      export_allocation_id: allocation.id,
      status: previousStatus,
      delivered_empty_at: allocation.delivered_empty_at,
      waiting_loading_at: allocation.waiting_loading_at,
      collected_loaded_at: allocation.collected_loaded_at,
    },
    newValue: {
      export_allocation_id: allocation.id,
      status: "completed",
      completed_at: allocation.completed_at ?? input.departedAt,
    },
    idempotencyKey: "export-completed-from-departure:" + allocation.id,
  });

  return {
    outcome: "completed",
    allocationId: allocation.id,
    previousStatus,
    customer: allocation.customer,
  };
}

export function describeExportDepartureReconciliation(
  reconciliation?: ExportDepartureReconciliation | null,
) {
  if (!reconciliation) {
    return null;
  }

  if (reconciliation.outcome === "completed") {
    const customer = reconciliation.customer?.trim();
    return customer ? `Export ${customer} completed.` : "Linked export completed.";
  }

  if (reconciliation.outcome === "conflict") {
    return "Linked export could not be completed automatically. Review Export allocations.";
  }

  return null;
}
