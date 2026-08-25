import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  assignNextWaitingTrailerAfterDeliveredEmpty,
  ASSIGN_TRAILER_BEFORE_OPERATION_MESSAGE,
  getExportAllocationStatusLabel,
  getExportAllocationTimestampField,
  getNextExportAllocationStatus,
  hasAssignedTrailer,
  normalizeExportAllocationStatus,
  type ExportAllocationRecord,
  type ExportAllocationStatus,
} from "@/lib/export-allocation";
import { recordTrailerLifecycleEvent } from "@/lib/operations/trailer-lifecycle";
import { resolveDeliveredWithEscortOnCompletion } from "@/lib/operations/escort-flags";

export type ExportLifecycleModule = "export" | "operations";

export type AdvanceExportStatusInput = {
  allocation: ExportAllocationRecord;
  sourceModule: ExportLifecycleModule;
  performedBy?: string | null;
  targetStatus?: ExportAllocationStatus;
  skipWaitingAutoAssign?: boolean;
};

export type AdvanceExportStatusResult = {
  previousStatus: ExportAllocationStatus;
  nextStatus: ExportAllocationStatus;
  occurredAt: string;
  movementMetadata: Record<string, unknown> | null;
  warning: string | null;
};

export type UndoExportStatusInput = {
  allocation: ExportAllocationRecord;
  performedBy?: string | null;
};

export type UndoExportStatusResult = {
  previousStatus: ExportAllocationStatus;
  restoredCompoundPosition: string | null;
  fallbackPositionUsed: boolean;
};

const normalizeCompoundPosition = (value?: string | null) => {
  const trimmed = (value ?? "").trim().toUpperCase();
  if (!trimmed) {
    return null;
  }

  return trimmed;
};

const buildStatusEvent = (
  allocation: ExportAllocationRecord,
  oldStatus: ExportAllocationStatus,
  newStatus: ExportAllocationStatus,
) => {
  const customer = allocation.customer?.trim() ? allocation.customer.trim() : "customer";

  if (newStatus === "completed") {
    return {
      eventType: "export_allocation_completed",
      activityType: "export_status_changed",
      title: "Export allocation completed",
      description: "Export allocation completed.",
    };
  }

  if (newStatus === "cancelled") {
    return {
      eventType: "export_allocation_cancelled",
      activityType: "export_cancelled",
      title: "Export allocation cancelled",
      description: "Export allocation cancelled.",
    };
  }

  if (newStatus === "delivered_empty") {
    return {
      eventType: "export_allocation_status_changed",
      activityType: "export_status_changed",
      title: "Delivered empty",
      description: `Empty trailer delivered to ${customer}.`,
    };
  }

  if (newStatus === "waiting_loading") {
    return {
      eventType: "export_allocation_status_changed",
      activityType: "export_status_changed",
      title: "Waiting loading",
      description: `Trailer waiting for loading at ${customer}.`,
    };
  }

  if (newStatus === "collected_loaded") {
    return {
      eventType: "export_allocation_status_changed",
      activityType: "export_status_changed",
      title: "Collected loaded",
      description: `Loaded trailer collected from ${customer}.`,
    };
  }

  return {
    eventType: "export_allocation_status_changed",
    activityType: "export_status_changed",
    title: "Export status changed",
    description: `Export allocation status changed from ${getExportAllocationStatusLabel(oldStatus)} to ${getExportAllocationStatusLabel(newStatus)}.`,
  };
};

const moveToDeliveredEmpty = async (
  supabaseClient: SupabaseClient<Database>,
  allocation: ExportAllocationRecord,
  targetStatus: ExportAllocationStatus,
  performedBy?: string | null,
) => {
  const rpcResult = await supabaseClient.rpc("advance_export_allocation_load_lifecycle", {
    p_allocation_id: allocation.id,
    p_expected_current_status: allocation.status,
    p_target_status: targetStatus,
    p_performed_by: performedBy ?? null,
  });

  if (rpcResult.error) {
    throw new Error(rpcResult.error.message || "Unable to advance export allocation lifecycle.");
  }

  const row = rpcResult.data?.[0];
  if (!row?.transitioned) {
    throw new Error("Allocation status changed by another user. Refresh and try again.");
  }

  return {
    occurredAt: row.occurred_at,
    previousPosition: normalizeCompoundPosition(row.previous_compound_position),
    skipOperationalEvent: true,
  };
};

export const advanceExportAllocationStatus = async (
  supabaseClient: SupabaseClient<Database>,
  input: AdvanceExportStatusInput,
): Promise<AdvanceExportStatusResult> => {
  const previousStatus = normalizeExportAllocationStatus(input.allocation.status);
  const nextStatus = input.targetStatus ?? getNextExportAllocationStatus(previousStatus);

  if (!nextStatus) {
    throw new Error("No valid next export status is available.");
  }

  if (nextStatus === "allocated") {
    throw new Error("Allocated is not a forward transition target.");
  }

  if (nextStatus !== "cancelled" && !hasAssignedTrailer(input.allocation)) {
    throw new Error(ASSIGN_TRAILER_BEFORE_OPERATION_MESSAGE);
  }

  let occurredAt = new Date().toISOString();
  let movementMetadata: Record<string, unknown> | null = null;
  let skipOperationalEvent = false;

  if (nextStatus !== "cancelled") {
    const deliveredResult = await moveToDeliveredEmpty(
      supabaseClient,
      input.allocation,
      nextStatus,
      input.performedBy,
    );
    occurredAt = deliveredResult.occurredAt;
    movementMetadata = nextStatus === "delivered_empty"
      ? {
          reason: "export_departure",
          previous_compound_position: deliveredResult.previousPosition,
          new_compound_position: null,
        }
      : null;
    skipOperationalEvent = deliveredResult.skipOperationalEvent;
  } else {
    const timestampField = getExportAllocationTimestampField(nextStatus);
    const updatePayload: Database["public"]["Tables"]["export_allocations"]["Update"] = {
      status: nextStatus,
      updated_at: occurredAt,
    };

    if (timestampField) {
      updatePayload[timestampField] = occurredAt;
    }

    if (nextStatus === "cancelled") {
      updatePayload.cancelled_at = occurredAt;
    }

    const { error: updateError } = await supabaseClient
      .from("export_allocations")
      .update(updatePayload)
      .eq("id", input.allocation.id)
      .eq("status", previousStatus);

    if (updateError) {
      throw new Error(updateError.message || "Unable to update export allocation status.");
    }
  }

  if (nextStatus === "delivered_empty") {
    const deliveredWithEscort = resolveDeliveredWithEscortOnCompletion({
      escortNeeded: input.allocation.escort_needed,
      deliveredWithEscort: input.allocation.delivered_with_escort,
    });

    if (deliveredWithEscort && input.allocation.delivered_with_escort !== true) {
      const { error: escortUpdateError } = await supabaseClient
        .from("export_allocations")
        .update({ delivered_with_escort: true, updated_at: occurredAt })
        .eq("id", input.allocation.id);

      if (escortUpdateError) {
        throw new Error(escortUpdateError.message || "Unable to record delivered with escort.");
      }
    }
  }

  if (!skipOperationalEvent) {
    const statusEvent = buildStatusEvent(input.allocation, previousStatus, nextStatus);

    await recordTrailerLifecycleEvent(supabaseClient, {
      trailerId: input.allocation.trailer_id ?? null,
      trailerNumber: input.allocation.trailer_number ?? "Unknown trailer",
      eventType: statusEvent.eventType,
      title: statusEvent.title,
      description: statusEvent.description,
      sourceModule: input.sourceModule,
      sourceRecordId: input.allocation.id,
      previousStatus,
      newStatus: nextStatus,
      metadata: {
        export_allocation_id: input.allocation.id,
        customer: input.allocation.customer ?? null,
        activity_type: statusEvent.activityType,
      },
      occurredAt,
      performedBy: input.performedBy ?? null,
      oldValue: { export_allocation_id: input.allocation.id, status: previousStatus } as Json,
      newValue: { export_allocation_id: input.allocation.id, status: nextStatus } as Json,
    });
  }

  let warning: string | null = null;

  if (nextStatus === "delivered_empty" && !input.skipWaitingAutoAssign) {
    try {
      const assignment = await assignNextWaitingTrailerAfterDeliveredEmpty(
        supabaseClient as unknown as {
          rpc: (
            fn: string,
            args?: Record<string, unknown>,
          ) => Promise<{
            data: unknown;
            error: { code?: string; message?: string } | null;
          }>;
        },
      );

      if (assignment.assigned) {
        warning = `Waiting trailer ${assignment.trailerNumber ?? "unknown"} assigned to ${assignment.assignedPosition ?? "next free position"}.`;
      }
    } catch {
      warning = "Delivered empty transition succeeded, but automatic waiting assignment could not be completed.";
    }
  }

  return {
    previousStatus,
    nextStatus,
    occurredAt,
    movementMetadata,
    warning,
  };
};

export const undoExportAllocationStatus = async (
  supabaseClient: SupabaseClient<Database>,
  input: UndoExportStatusInput,
): Promise<UndoExportStatusResult> => {
  const currentStatus = normalizeExportAllocationStatus(input.allocation.status);
  const rpcResult = await supabaseClient.rpc("undo_export_allocation_load_lifecycle", {
    p_allocation_id: input.allocation.id,
    p_expected_current_status: currentStatus,
    p_performed_by: input.performedBy ?? null,
  });

  if (rpcResult.error) {
    throw new Error(rpcResult.error.message || "Unable to undo export allocation lifecycle.");
  }

  const row = rpcResult.data?.[0];
  if (!row?.transitioned) {
    throw new Error("Allocation status changed by another user. Refresh and try again.");
  }

  return {
    previousStatus: normalizeExportAllocationStatus(row.previous_status),
    restoredCompoundPosition: normalizeCompoundPosition(row.restored_compound_position),
    fallbackPositionUsed: row.fallback_position_used,
  };
};
