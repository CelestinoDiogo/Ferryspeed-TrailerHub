import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import type { ExportAllocationRecord, ExportAllocationStatus } from "@/lib/export-allocation";
import { advanceExportAllocationStatus } from "@/lib/operations/export-lifecycle";

const makeAllocation = (status: ExportAllocationStatus): ExportAllocationRecord => ({
  id: `allocation-${status}`,
  trailer_id: "trailer-a",
  trailer_number: "FS100",
  customer: "Customer A",
  priority: "normal",
  status,
});

const makeClient = (error: { message: string } | null = null) => {
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
    data: error ? null : [{
      transitioned: true,
      trailer_id: "trailer-a",
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

  it("does not attempt a browser fallback when the transaction fails", async () => {
    const { client, from } = makeClient({ message: "transaction rejected" });

    await expect(advanceExportAllocationStatus(client, {
      allocation: makeAllocation("waiting_loading"),
      sourceModule: "export",
      skipWaitingAutoAssign: true,
    })).rejects.toThrow("transaction rejected");

    expect(from).not.toHaveBeenCalled();
  });
});