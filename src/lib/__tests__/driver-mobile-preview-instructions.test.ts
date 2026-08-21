import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listDriverOperationalInstructionsForPreview } from "@/lib/driver-mobile-preview-instructions";

describe("listDriverOperationalInstructionsForPreview", () => {
  it("scopes the read to the explicitly selected Driver", async () => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      is: vi.fn(() => chain),
      then: (resolve: (value: { data: unknown[]; error: null; count: number }) => unknown) =>
        resolve({ data: [], error: null, count: 0 }),
    };
    const supabase = { from: vi.fn(() => chain) };

    const result = await listDriverOperationalInstructionsForPreview(
      supabase as never,
      { id: "driver-selected", display_name: "Selected Driver", user_id: "selected-user" },
      { limit: 20 },
    );

    expect(chain.eq).toHaveBeenCalledWith("driver_id", "driver-selected");
    expect(chain.is).toHaveBeenCalledWith("read_at", null);
    expect(result.driver).toEqual({ id: "driver-selected", displayName: "Selected Driver", userId: "selected-user" });
    expect(result.recent).toEqual([]);
    expect(result.unreadCount).toBe(0);
  });

  it("uses a full unread count instead of the limited recent window", async () => {
    const feedChain = {
      select: vi.fn(() => feedChain),
      eq: vi.fn(() => feedChain),
      order: vi.fn(() => feedChain),
      limit: vi.fn(() => Promise.resolve({
        data: [{
          id: "instruction-1",
          driver_id: "driver-selected",
          recipient_user_id: "selected-user",
          delivery_booking_id: null,
          trailer_id: null,
          trailer_number: "FS1001",
          instruction: "Collect now",
          priority: "normal",
          sender_user_id: "ops",
          sender_display_name: "Ops",
          created_at: "2026-08-20T10:00:00.000Z",
          read_at: null,
          read_by: null,
        }],
        error: null,
      })),
      is: vi.fn(),
    };
    const countChain = {
      select: vi.fn(() => countChain),
      eq: vi.fn(() => countChain),
      order: vi.fn(() => countChain),
      limit: vi.fn(() => countChain),
      is: vi.fn(() => Promise.resolve({ data: null, error: null, count: 42 })),
    };

    let fromCount = 0;
    const supabase = {
      from: vi.fn(() => {
        fromCount += 1;
        return fromCount === 1 ? feedChain : countChain;
      }),
    };

    const result = await listDriverOperationalInstructionsForPreview(
      supabase as never,
      { id: "driver-selected", display_name: "Selected Driver", user_id: "selected-user" },
    );

    expect(result.unreadCount).toBe(42);
    expect(result.recent).toHaveLength(1);
  });
});
