import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import { DepartureUndoConflictError, undoDeparture } from "@/lib/operations/departure-lifecycle";

const makeClient = (row: Record<string, unknown>) => {
  const rpc = vi.fn(async () => ({ data: [row], error: null }));
  const from = vi.fn(() => {
    throw new Error("Departure Undo must not use browser table mutations.");
  });

  return { client: { rpc, from } as unknown as SupabaseClient<Database>, rpc, from };
};

describe("atomic Departure Undo lifecycle", () => {
  it("uses one authoritative RPC with the expected departure timestamp", async () => {
    const { client, rpc, from } = makeClient({
      transitioned: true,
      conflict_code: null,
      trailer_id: "trailer-a",
      trailer_number: "FS100",
      restored_operational_status: "In Compound",
      restored_compound_position: "P10",
      load_status: "Loaded",
      occurred_at: "2026-08-17T10:00:00.000Z",
    });

    const result = await undoDeparture(client, {
      trailerId: "trailer-a",
      expectedDepartureAt: "2026-08-17T09:00:00.000Z",
      performedBy: "Supervisor",
    });

    expect(result.restoredCompoundPosition).toBe("P10");
    expect(result.loadStatus).toBe("Loaded");
    expect(rpc).toHaveBeenCalledWith("undo_trailer_departure", {
      p_trailer_id: "trailer-a",
      p_expected_departure_at: "2026-08-17T09:00:00.000Z",
      p_performed_by: "Supervisor",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it.each(["already_restored", "stale_state", "position_occupied"] as const)(
    "returns a structured %s conflict without browser fallback",
    async (conflictCode) => {
      const { client, from } = makeClient({ transitioned: false, conflict_code: conflictCode });

      await expect(undoDeparture(client, {
        trailerId: "trailer-a",
        expectedDepartureAt: "2026-08-17T09:00:00.000Z",
      })).rejects.toMatchObject({ code: conflictCode } satisfies Partial<DepartureUndoConflictError>);

      expect(from).not.toHaveBeenCalled();
    },
  );

  it("does not reopen or mutate export allocations when undoing a departure", () => {
    const source = readFileSync(new URL("../departure-lifecycle.ts", import.meta.url), "utf8");
    expect(source).toContain("undo_trailer_departure");
    expect(source).not.toContain("export_allocations");
    expect(source).not.toContain("completeExportAllocationFromConfirmedDeparture");
  });
});