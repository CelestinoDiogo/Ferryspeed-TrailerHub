import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import type { ExportAllocationRecord, ExportAllocationStatus } from "@/lib/export-allocation";
import { advanceExportAllocationStatus, undoExportAllocationStatus } from "@/lib/operations/export-lifecycle";

vi.mock("@/lib/operations/trailer-lifecycle", () => ({
  recordTrailerLifecycleEvent: vi.fn(async () => undefined),
}));

const makeAllocation = (status: ExportAllocationStatus): ExportAllocationRecord => ({
  id: `allocation-${status}`,
  trailer_id: "trailer-a",
  trailer_number: "FS100",
  customer: "Customer A",
  priority: "normal",
  status,
});

const makeClient = (error: { message: string } | null = null) => {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => ({
    data: error ? null : [{
      transitioned: true,
      trailer_id: "trailer-a",
      previous_status: name === "undo_export_allocation_load_lifecycle"
        ? ({
            delivered_empty: "allocated",
            waiting_loading: "delivered_empty",
            collected_loaded: "waiting_loading",
            completed: "collected_loaded",
          } as Record<string, string>)[String(args.p_expected_current_status)]
        : null,
      restored_compound_position: args.p_expected_current_status === "delivered_empty" ? "P01" : null,
      fallback_position_used: false,
      previous_compound_position: args.p_target_status === "delivered_empty" ? "P01" : null,
      previous_load_status: args.p_target_status === "delivered_empty" ? "Loaded" : "Empty",
      new_load_status: args.p_target_status === "collected_loaded" ? "Loaded" : "Empty",
      occurred_at: "2026-08-16T12:00:00.000Z",
    }],
    error,
  }));
  const from = vi.fn(() => {
    throw new Error("Forward export transitions must not use browser table mutations.");
  });

  return {
    client: { rpc, from } as unknown as SupabaseClient<Database>,
    rpc,
    from,
  };
};

describe("atomic export load lifecycle", () => {
  it.each([
    ["allocated", "delivered_empty"],
    ["delivered_empty", "waiting_loading"],
    ["waiting_loading", "collected_loaded"],
    ["collected_loaded", "completed"],
  ] as const)("moves %s to %s through the authoritative RPC", async (status, targetStatus) => {
    const { client, rpc, from } = makeClient();

    const result = await advanceExportAllocationStatus(client, {
      allocation: makeAllocation(status),
      sourceModule: "export",
      performedBy: "Operator",
      skipWaitingAutoAssign: true,
    });

    expect(result.nextStatus).toBe(targetStatus);
    expect(rpc).toHaveBeenCalledWith("advance_export_allocation_load_lifecycle", {
      p_allocation_id: `allocation-${status}`,
      p_expected_current_status: status,
      p_target_status: targetStatus,
      p_performed_by: "Operator",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("blocks trailer-dependent advance while the allocation is unassigned", async () => {
    const { client, rpc, from } = makeClient();

    await expect(advanceExportAllocationStatus(client, {
      allocation: {
        id: "allocation-unassigned",
        trailer_id: null,
        trailer_number: null,
        customer: "Later Assign",
        priority: "normal",
        status: "allocated",
      },
      sourceModule: "export",
      skipWaitingAutoAssign: true,
    })).rejects.toThrow("Assign a trailer before continuing this operation.");

    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("allows cancelling an unassigned allocation", async () => {
    const updateEq = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({
      update: () => ({
        eq: () => ({
          eq: updateEq,
        }),
      }),
    }));
    const rpc = vi.fn();
    const client = { rpc, from } as unknown as SupabaseClient<Database>;

    const result = await advanceExportAllocationStatus(client, {
      allocation: {
        id: "allocation-unassigned",
        trailer_id: null,
        trailer_number: null,
        customer: "Later Assign",
        priority: "normal",
        status: "allocated",
      },
      sourceModule: "export",
      targetStatus: "cancelled",
      skipWaitingAutoAssign: true,
    });

    expect(result.nextStatus).toBe("cancelled");
    expect(rpc).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalled();
    expect(updateEq).toHaveBeenCalled();
  });

  it("does not attempt a browser fallback when the transaction fails", async () => {
    const { client, from } = makeClient({ message: "transaction rejected" });

    await expect(advanceExportAllocationStatus(client, {
      allocation: makeAllocation("waiting_loading"),
      sourceModule: "export",
      skipWaitingAutoAssign: true,
    })).rejects.toThrow("transaction rejected");

    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    ["delivered_empty", "allocated"],
    ["waiting_loading", "delivered_empty"],
    ["collected_loaded", "waiting_loading"],
    ["completed", "collected_loaded"],
  ] as const)("undoes %s to %s through one authoritative RPC", async (status, targetStatus) => {
    const { client, rpc, from } = makeClient();

    const result = await undoExportAllocationStatus(client, {
      allocation: makeAllocation(status),
      performedBy: "Operator",
    });

    expect(result.previousStatus).toBe(targetStatus);
    expect(rpc).toHaveBeenCalledWith("undo_export_allocation_load_lifecycle", {
      p_allocation_id: `allocation-${status}`,
      p_expected_current_status: status,
      p_performed_by: "Operator",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("records delivered with escort when an escort-needed allocation is delivered empty", async () => {
    const escortEq = vi.fn(async () => ({ error: null }));
    const escortUpdate = vi.fn(() => ({ eq: escortEq }));
    const from = vi.fn(() => ({ update: escortUpdate }));
    const rpc = vi.fn(async () => ({
      data: [{
        transitioned: true,
        trailer_id: "trailer-a",
        previous_status: null,
        restored_compound_position: null,
        fallback_position_used: false,
        previous_compound_position: "P01",
        previous_load_status: "Empty",
        new_load_status: "Empty",
        occurred_at: "2026-08-16T12:00:00.000Z",
      }],
      error: null,
    }));
    const client = { rpc, from } as unknown as SupabaseClient<Database>;

    const result = await advanceExportAllocationStatus(client, {
      allocation: {
        ...makeAllocation("allocated"),
        escort_needed: true,
        delivered_with_escort: false,
      },
      sourceModule: "export",
      performedBy: "Operator",
      skipWaitingAutoAssign: true,
    });

    expect(result.nextStatus).toBe("delivered_empty");
    expect(rpc).toHaveBeenCalledWith("advance_export_allocation_load_lifecycle", expect.objectContaining({
      p_target_status: "delivered_empty",
    }));
    expect(from).toHaveBeenCalledWith("export_allocations");
    expect(escortUpdate).toHaveBeenCalledWith(expect.objectContaining({
      delivered_with_escort: true,
    }));
    expect(escortEq).toHaveBeenCalledWith("id", "allocation-allocated");
  });
});