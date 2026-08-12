import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { listActiveDriverOptions } from "@/lib/delivery-driver-assignment";
import type { Database } from "@/lib/database.types";

describe("delivery driver assignment helpers", () => {
  it("queries only active drivers for assignment options", async () => {
    const queryState = { active: null as boolean | null };

    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        if (column === "active") {
          queryState.active = value === true;
        }
        return chain;
      }),
      order: vi.fn(async () => ({
        data: [
          { id: "driver-a", display_name: "Driver A", user_id: "user-a", active: true },
        ],
        error: null,
      })),
    };

    const supabase = {
      from: vi.fn((table: string) => {
        expect(table).toBe("drivers");
        return chain;
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await listActiveDriverOptions(supabase);

    expect(queryState.active).toBe(true);
    expect(result).toEqual([
      { id: "driver-a", display_name: "Driver A", user_id: "user-a", active: true },
    ]);
  });
});