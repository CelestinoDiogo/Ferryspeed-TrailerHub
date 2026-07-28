import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  assignNextWaitingTrailerAfterDeliveredEmpty,
  getExportAllocationStatusLabel,
  getExportAllocationTimestampField,
  getNextExportAllocationStatus,
  normalizeExportAllocationStatus,
  type ExportAllocationRecord,
  type ExportAllocationStatus,
} from "@/lib/export-allocation";
import { recordTrailerLifecycleEvent } from "@/lib/operations/trailer-lifecycle";

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
) => {
  if (!allocation.trailer_id) {
    const nowIso = new Date().toISOString();
    const { error: updateError } = await supabaseClient
      .from("export_allocations")
      .update({
        status: "delivered_empty",
        delivered_empty_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", allocation.id)
      .eq("status", allocation.status);

    if (updateError) {
      throw new Error(updateError.message || "Unable to move allocation to delivered empty.");
    }

    return {
      occurredAt: nowIso,
      previousPosition: null as string | null,
      skipOperationalEvent: false,
    };
  }

  const rpcResult = await (supabaseClient as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
  }).rpc("set_export_allocation_delivered_empty", {
    p_allocation_id: allocation.id,
    p_expected_current_status: allocation.status,
  });

  if (!rpcResult.error) {
    const rows = Array.isArray(rpcResult.data) ? rpcResult.data : [];
    const row = (rows[0] as { transitioned?: boolean; previous_compound_position?: string | null } | undefined) ?? null;

    if (!row?.transitioned) {
      throw new Error("Allocation status changed by another user. Refresh and try again.");
    }

    return {
      occurredAt: new Date().toISOString(),
      previousPosition: normalizeCompoundPosition(row.previous_compound_position),
      skipOperationalEvent: true,
    };
  }

  if (rpcResult.error.code !== "42883") {
    throw new Error(rpcResult.error.message || "Unable to move allocation to Delivered Empty.");
  }

  const nowIso = new Date().toISOString();
  const { data: trailerData, error: trailerReadError } = await supabaseClient
    .from("trailers")
    .select("id, compound_position")
    .eq("id", allocation.trailer_id)
    .single();

  if (trailerReadError || !trailerData) {
    throw new Error(trailerReadError?.message || "Unable to load trailer compound position.");
  }

  const previousPosition = normalizeCompoundPosition((trailerData as { compound_position?: string | null }).compound_position);

  const { error: updateError } = await supabaseClient
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

  const { error: trailerUpdateError } = await supabaseClient
    .from("trailers")
    .update({
      compound_position: null,
    })
    .eq("id", allocation.trailer_id);

  if (trailerUpdateError) {
    await supabaseClient
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

  return {
    occurredAt: nowIso,
    previousPosition,
    skipOperationalEvent: false,
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

  let occurredAt = new Date().toISOString();
  let movementMetadata: Record<string, unknown> | null = null;
  let skipOperationalEvent = false;

  if (nextStatus === "delivered_empty") {
    const deliveredResult = await moveToDeliveredEmpty(supabaseClient, input.allocation);
    occurredAt = deliveredResult.occurredAt;
    movementMetadata = {
      reason: "export_departure",
      previous_compound_position: deliveredResult.previousPosition,
      new_compound_position: null,
    };
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
    previousCompoundPosition:
      typeof movementMetadata?.previous_compound_position === "string" ? movementMetadata.previous_compound_position : null,
    newCompoundPosition:
      typeof movementMetadata?.new_compound_position === "string" ? movementMetadata.new_compound_position : null,
    metadata: {
      export_allocation_id: input.allocation.id,
      customer: input.allocation.customer ?? null,
      movement: movementMetadata,
      activity_type: statusEvent.activityType,
    },
    occurredAt,
    performedBy: input.performedBy ?? null,
    oldValue: {
      export_allocation_id: input.allocation.id,
      status: previousStatus,
      ...(movementMetadata ? { movement: movementMetadata } : {}),
    } as Json,
    newValue: {
      export_allocation_id: input.allocation.id,
      status: nextStatus,
      ...(movementMetadata ? { movement: movementMetadata } : {}),
    } as Json,
    skipOperationalEvent,
  });

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
