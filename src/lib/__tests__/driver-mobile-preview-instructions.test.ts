import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listDriverOperationalInstructionsForPreview } from "@/lib/driver-mobile-preview-instructions";

describe("listDriverOperationalInstructionsForPreview", () => {
  it("scopes the read to the explicitly selected Driver", async () => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
    };
    const supabase = { from: vi.fn(() => chain) };

    const result = await listDriverOperationalInstructionsForPreview(
      supabase as never,
      { id: "driver-selected", display_name: "Selected Driver", user_id: "selected-user" },
      { limit: 20 },
    );

    expect(chain.eq).toHaveBeenCalledWith("driver_id", "driver-selected");
    expect(result.driver).toEqual({ id: "driver-selected", displayName: "Selected Driver", userId: "selected-user" });
    expect(result.recent).toEqual([]);
  });
});
