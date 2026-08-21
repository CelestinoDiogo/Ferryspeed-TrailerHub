import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { loadActiveDriverForUserMock } = vi.hoisted(() => ({
  loadActiveDriverForUserMock: vi.fn(),
}));

vi.mock("@/lib/driver-access", () => ({
  loadActiveDriverForUser: loadActiveDriverForUserMock,
}));

import { listDriverOperationalInstructionsForUser } from "@/lib/driver-operational-instructions";

describe("listDriverOperationalInstructionsForUser unread count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadActiveDriverForUserMock.mockResolvedValue({
      id: "driver-a",
      display_name: "Driver A",
      user_id: "user-a",
    });
  });

  it("does not derive unreadCount only from the limited recent window", async () => {
    const feedChain = {
      eq: vi.fn(() => feedChain),
      order: vi.fn(() => feedChain),
      limit: vi.fn(() => Promise.resolve({
        data: [{
          id: "instruction-1",
          driver_id: "driver-a",
          recipient_user_id: "user-a",
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
    };

    const countChain = {
      eq: vi.fn(() => countChain),
      is: vi.fn(() => Promise.resolve({ data: null, error: null, count: 41 })),
    };

    const eventsChain = {
      select: vi.fn(() => eventsChain),
      in: vi.fn(() => eventsChain),
      order: vi.fn(() => eventsChain),
      limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
    };

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "driver_operational_instruction_events") {
          return eventsChain;
        }

        return {
          select: (_columns: string, options?: { count?: string; head?: boolean }) => {
            if (options?.count === "exact" || options?.head) {
              return countChain;
            }

            return feedChain;
          },
        };
      }),
    };

    const result = await listDriverOperationalInstructionsForUser(supabase as never, "user-a", { limit: 30 });

    expect(feedChain.limit).toHaveBeenCalledWith(30);
    expect(countChain.eq).toHaveBeenCalledWith("recipient_user_id", "user-a");
    expect(countChain.is).toHaveBeenCalledWith("read_at", null);
    expect(result.unreadCount).toBe(41);
    expect(result.recent).toHaveLength(1);
  });
});
