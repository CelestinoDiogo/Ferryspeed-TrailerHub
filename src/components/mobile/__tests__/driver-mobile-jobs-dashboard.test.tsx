// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriverMobileJobsDashboard } from "@/components/mobile/driver-mobile-jobs-dashboard";

const useCurrentUserMock = vi.fn();
const getSessionTokenMock = vi.fn();
const { signOutMock, routerReplaceMock, routerRefreshMock } = vi.hoisted(() => ({
  signOutMock: vi.fn(),
  routerReplaceMock: vi.fn(),
  routerRefreshMock: vi.fn(),
}));

const realtimeState = vi.hoisted(() => ({
  callback: null as null | (() => void),
}));

const QUEUE_STORAGE_KEY = "trailerhub.driver-mobile.action-queue.v1";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
    refresh: routerRefreshMock,
  }),
}));

vi.mock("@/components/auth/permission-guard", () => ({
  PermissionGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/auth/use-current-user", () => ({
  useCurrentUser: () => useCurrentUserMock(),
}));

vi.mock("@/lib/realtime/operational-realtime", () => ({
  useOperationalRealtime: (_topics: string[], callback: () => void) => {
    realtimeState.callback = callback;
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signOut: signOutMock,
    },
  },
}));

vi.mock("@/lib/voice/session", () => ({
  SESSION_EXPIRED_MESSAGE: "Your session has expired. Please sign in again.",
  getSessionToken: () => getSessionTokenMock(),
}));

const makeTask = (overrides?: Record<string, unknown>) => ({
  taskId: "booking-a",
  driverId: "driver-a",
  taskKind: "delivery",
  bookingId: "booking-a",
  trailerId: "trailer-a",
  trailerNumber: "FS1234",
  customer: "Customer A",
  consignee: null,
  location: "Dock 1",
  bookingReference: "BK-A",
  notes: null,
  status: "scheduled",
  deliveryDate: "2026-08-11",
  deliveryTime: "12:00:00",
  group: "upcoming",
  nextAction: "ACKNOWLEDGED",
  deliveredAt: null,
  collectedAt: null,
  waitingCollectionSince: null,
  collectedTemperatureC: null,
  driverAcknowledgedAt: null,
  driverAcknowledgedBy: null,
  temperature: {
    required: false,
  },
  collectionAging: null,
  ...overrides,
});

const makeInstruction = (overrides?: Record<string, unknown>) => ({
  id: "instruction-a",
  deliveryBookingId: "booking-a",
  trailerId: "trailer-a",
  trailerNumber: "FS1234",
  instruction: "Collect trailer FS1234",
  priority: "normal",
  senderDisplayName: "Operations",
  createdAt: "2026-08-12T09:00:00.000Z",
  readAt: null,
  isRead: false,
  ...overrides,
});

const buildInstructionFeed = (recent: Array<Record<string, unknown>>) => ({
  unreadCount: recent.filter((item) => !item.readAt).length,
  newestUnread: recent.find((item) => !item.readAt) ?? null,
  recent,
});

const setOnlineState = (value: boolean) => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
};

const readQueuedActions = () => JSON.parse(window.localStorage.getItem(QUEUE_STORAGE_KEY) ?? "[]") as Array<Record<string, unknown>>;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DriverMobileJobsDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    setOnlineState(true);
    getSessionTokenMock.mockResolvedValue("token");
    signOutMock.mockResolvedValue(undefined);
    realtimeState.callback = null;
    useCurrentUserMock.mockReturnValue({
      roleKey: "driver",
      fullName: "Driver One",
      email: "driver@example.com",
      isLoading: false,
    });
  });

  it("marks new unacknowledged work as attention with a top summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "new-a", trailerId: "trailer-new", trailerNumber: "FS-NEW", nextAction: "ACKNOWLEDGED", driverAcknowledgedAt: null })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([])), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-NEW")).toBeInTheDocument();
    expect(screen.getAllByText("NEW").length).toBeGreaterThan(0);
    expect(screen.getByText(/NEED ATTENTION/)).toBeInTheDocument();
  });

  it("renders grouped jobs and linked operational instruction context in the live dashboard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [
              makeTask({ bookingId: "todo", trailerId: "trailer-todo", trailerNumber: "FS-TODO", nextAction: "ACKNOWLEDGED", group: "current" }),
              makeTask({ bookingId: "progress", trailerId: "trailer-progress", trailerNumber: "FS-PROGRESS", status: "on_delivery", nextAction: "DELIVERED", group: "current" }),
            ],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([
            makeInstruction({ id: "instruction-todo", deliveryBookingId: "todo", trailerId: "trailer-todo", trailerNumber: "FS-TODO", instruction: "Collect trailer FS-TODO" }),
          ])), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-TODO")).toBeInTheDocument();
    expect(await screen.findByText("Collect trailer FS-TODO")).toBeInTheDocument();
    expect(screen.getByText("Acknowledge this job to confirm the instruction.")).toBeInTheDocument();
    expect(screen.getByText("Operational Instructions")).toBeInTheDocument();
    expect(screen.getAllByText("To Do").length).toBeGreaterThan(0);
    expect(screen.getAllByText("In Progress").length).toBeGreaterThan(0);
  });

  it("single job acknowledge marks the linked instruction read and does not complete the job", async () => {
    let taskCalls = 0;
    let instructionCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
        taskCalls += 1;
        return new Response(JSON.stringify({
          driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
          tasks: [makeTask({ bookingId: "booking-a", trailerId: "trailer-a", trailerNumber: "FS1234", nextAction: taskCalls === 1 ? "ACKNOWLEDGED" : "COLLECTED", driverAcknowledgedAt: taskCalls === 1 ? null : "2026-08-13T10:00:00.000Z", driverAcknowledgedBy: taskCalls === 1 ? null : "user-a", status: taskCalls === 1 ? "scheduled" : "ready" })],
        }), { status: 200 });
      }

      if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
        instructionCalls += 1;
        return new Response(JSON.stringify(buildInstructionFeed([
          makeInstruction({ id: "instruction-a", readAt: instructionCalls === 1 ? null : "2026-08-13T10:00:00.000Z", isRead: instructionCalls > 1 }),
        ])), { status: 200 });
      }

      if (url.includes("/api/driver-mobile/tasks/action") && method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (url.includes("/api/driver-mobile/instructions/read") && method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS1234")).toBeInTheDocument();
    expect(await screen.findByText("Collect trailer FS1234")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ACKNOWLEDGE" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "RECOLHIDA / COLLECTED" })).toBeInTheDocument();
      expect(screen.getAllByText(/Acknowledged/).length).toBeGreaterThan(0);
    });

    expect(screen.queryAllByText("NEW").length).toBe(0);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/driver-mobile/tasks/action"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/driver-mobile/instructions/read"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(screen.queryByText("Delivered")).not.toBeInTheDocument();
  });

  it("supports standalone instruction acknowledgement without creating a fake delivery job", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
        return new Response(JSON.stringify({
          driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
          tasks: [],
        }), { status: 200 });
      }

      if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
        return new Response(JSON.stringify(buildInstructionFeed([
          makeInstruction({ id: "instruction-only", deliveryBookingId: null, trailerId: null, trailerNumber: null, instruction: "Report to quay", priority: "high" }),
        ])), { status: 200 });
      }

      if (url.includes("/api/driver-mobile/instructions/read") && method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("Report to quay")).toBeInTheDocument();
    expect(screen.getByText(/NEED ATTENTION/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "ACKNOWLEDGE" })[0]);

    await waitFor(() => {
      expect(screen.getByText("Instruction acknowledged.")).toBeInTheDocument();
    });

    expect(fetchMock.mock.calls.some(([first]) => String(first).includes("/api/driver-mobile/tasks/action"))).toBe(false);
    expect(fetchMock.mock.calls.some(([first]) => String(first).includes("/api/driver-mobile/instructions/read"))).toBe(true);
  });

  it("blocks collected action when required temperature is missing and leaves temperature rules unchanged", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
        return new Response(JSON.stringify({
          driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
          tasks: [makeTask({ bookingId: "temp", trailerNumber: "FS-TEMP", status: "ready", group: "upcoming", nextAction: "COLLECTED", temperature: { required: true }, taskKind: "delivery" })],
        }), { status: 200 });
      }

      if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
        return new Response(JSON.stringify(buildInstructionFeed([])), { status: 200 });
      }

      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-TEMP")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "RECOLHIDA / COLLECTED" }));

    await waitFor(() => {
      expect(screen.getByText("Temperature reading is required before marking as collected.")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces critical instruction priority on linked work", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "prio-a", trailerId: "trailer-prio", trailerNumber: "FS-PRIO", nextAction: "ACKNOWLEDGED" })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([
            makeInstruction({ id: "instruction-prio", deliveryBookingId: "prio-a", trailerId: "trailer-prio", trailerNumber: "FS-PRIO", priority: "critical" }),
          ])), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-PRIO")).toBeInTheDocument();
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
  });

  it("keeps collection ageing color thresholds unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [
              makeTask({ bookingId: "green", trailerNumber: "FS-GREEN", taskKind: "collection", status: "waiting_collection", nextAction: "COLLECTED", collectionAging: { level: "green", label: "Under 24h", waitingHours: 12, waitingSince: "2026-08-13T01:00:00.000Z", dueDate: null, isOverdue: false, overdueDays: null } }),
              makeTask({ bookingId: "orange", trailerNumber: "FS-ORANGE", taskKind: "collection", status: "waiting_collection", nextAction: "COLLECTED", collectionAging: { level: "orange", label: "24-48h", waitingHours: 30, waitingSince: "2026-08-12T01:00:00.000Z", dueDate: null, isOverdue: true, overdueDays: 1 } }),
              makeTask({ bookingId: "red", trailerNumber: "FS-RED", taskKind: "collection", status: "waiting_collection", nextAction: "COLLECTED", collectionAging: { level: "red", label: "Over 48h", waitingHours: 60, waitingSince: "2026-08-11T01:00:00.000Z", dueDate: null, isOverdue: true, overdueDays: 2 } }),
            ],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([])), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-GREEN")).toBeInTheDocument();
    expect(screen.getByText(/Under 24h/).className).toContain("border-emerald-300");
    expect(screen.getByText(/24-48h/).className).toContain("border-orange-300");
    expect(screen.getByText(/Over 48h/).className).toContain("border-rose-300");
  });

  it("sorts overdue collection attention ahead of normal work", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [
              makeTask({ bookingId: "normal", trailerNumber: "FS-NORMAL", taskKind: "delivery", nextAction: "COLLECTED", status: "ready", group: "upcoming", deliveryDate: "2026-08-13", deliveryTime: "15:00:00" }),
              makeTask({ bookingId: "overdue", trailerNumber: "FS-OVERDUE", taskKind: "collection", status: "waiting_collection", nextAction: "COLLECTED", collectionAging: { level: "red", label: "Over 48h", waitingHours: 72, waitingSince: "2026-08-10T01:00:00.000Z", dueDate: null, isOverdue: true, overdueDays: 3 } }),
            ],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([])), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-OVERDUE")).toBeInTheDocument();
    const attentionSection = screen.getByRole("heading", { name: "Needs Attention" }).closest("section") as HTMLElement;
    const articles = within(attentionSection).getAllByRole("article");
    expect(within(articles[0]).getByText("FS-OVERDUE")).toBeInTheDocument();
  });

  it("disables the tapped action while sending and prevents duplicate requests", async () => {
    const pendingResponse = new Promise<Response>(() => undefined);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
        return new Response(JSON.stringify({
          driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
          tasks: [makeTask({ bookingId: "sending", trailerNumber: "FS-SEND", status: "ready", nextAction: "COLLECTED" })],
        }), { status: 200 });
      }

      if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
        return new Response(JSON.stringify(buildInstructionFeed([])), { status: 200 });
      }

      if (url.includes("/api/driver-mobile/tasks/action") && method === "POST") {
        return pendingResponse;
      }

      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-SEND")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "RECOLHIDA / COLLECTED" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Sending..." }));

    expect(fetchMock.mock.calls.filter(([input, init]) => String(input).includes("/api/driver-mobile/tasks/action") && (init?.method ?? "GET") === "POST")).toHaveLength(1);
  });

  it("rolls back optimistic state when the server rejects the action", async () => {
    let getCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          getCount += 1;
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "reject", trailerNumber: "FS-REJECT", status: "ready", nextAction: "COLLECTED", group: "upcoming" })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([])), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/tasks/action") && method === "POST") {
          return new Response(JSON.stringify({ error: "Task is not eligible for the Collected action." }), { status: 409 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-REJECT")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "RECOLHIDA / COLLECTED" }));

    await waitFor(() => {
      expect(screen.getByText("Task is not eligible for the Collected action.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "RECOLHIDA / COLLECTED" })).toBeInTheDocument();
    });

    expect(getCount).toBeGreaterThan(1);
    expect(readQueuedActions()).toEqual([]);
  });

  it("queues offline collected actions and preserves temperature for retry", async () => {
    setOnlineState(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "offline", trailerNumber: "FS-OFF", status: "ready", nextAction: "COLLECTED", temperature: { required: true } })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([])), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/tasks/action") && method === "POST") {
          throw new Error("Failed to fetch");
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-OFF")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Collection reading (C)"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "RECOLHIDA / COLLECTED" }));

    await waitFor(() => {
      expect(screen.getAllByText("Saved - waiting for connection").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("On Delivery")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ENTREGUE / DELIVERED" })).toBeDisabled();
    await waitFor(() => {
      expect(readQueuedActions()[0]).toMatchObject({ bookingId: "offline", action: "COLLECTED", temperatureC: 2.5, state: "pending" });
    });
  });

  it("keeps queued acknowledge explicit and stores linked instruction identifiers for safe retry", async () => {
    setOnlineState(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "ack", trailerId: "trailer-ack", trailerNumber: "FS-ACK", nextAction: "ACKNOWLEDGED", driverAcknowledgedAt: null, driverAcknowledgedBy: null })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([
            makeInstruction({ id: "instruction-ack", deliveryBookingId: "ack", trailerId: "trailer-ack", trailerNumber: "FS-ACK", instruction: "Call office before collection" }),
          ])), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/tasks/action") && method === "POST") {
          throw new Error("Failed to fetch");
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-ACK")).toBeInTheDocument();
    expect(await screen.findByText("Call office before collection")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ACKNOWLEDGE" }));

    await waitFor(() => {
      expect(screen.getAllByText("Saved - waiting for connection").length).toBeGreaterThan(0);
    });

    expect(readQueuedActions()[0]).toMatchObject({
      bookingId: "ack",
      action: "ACKNOWLEDGED",
      linkedInstructionIds: ["instruction-ack"],
      temperatureC: null,
    });
  });

  it("replays queued actions after connectivity returns and clears the queue on success", async () => {
    setOnlineState(false);

    let taskState: "ready" | "on_delivery" = "ready";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
        return new Response(JSON.stringify({
          driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
          tasks: [makeTask({ bookingId: "retry", trailerNumber: "FS-RETRY", status: taskState, nextAction: taskState === "ready" ? "COLLECTED" : "DELIVERED", group: taskState === "ready" ? "upcoming" : "current" })],
        }), { status: 200 });
      }

      if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
        return new Response(JSON.stringify(buildInstructionFeed([])), { status: 200 });
      }

      if (url.includes("/api/driver-mobile/tasks/action") && method === "POST") {
        if (window.navigator.onLine === false) {
          throw new Error("Failed to fetch");
        }

        taskState = "on_delivery";
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-RETRY")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "RECOLHIDA / COLLECTED" }));

    await waitFor(() => {
      expect(readQueuedActions()).toHaveLength(1);
    });

    setOnlineState(true);
    window.dispatchEvent(new Event("online"));

    await waitFor(() => {
      expect(readQueuedActions()).toEqual([]);
      expect(screen.getByRole("button", { name: "ENTREGUE / DELIVERED" })).toBeInTheDocument();
    });
  });

  it("treats already-completed server state as reconciled during queued retry", async () => {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify([
      {
        id: "queued-done",
        bookingId: "done",
        action: "DELIVERED",
        linkedInstructionIds: [],
        temperatureC: null,
        createdAt: "2026-08-13T10:00:00.000Z",
        retryCount: 1,
        state: "pending",
        lastError: null,
        lastAttemptAt: "2026-08-13T10:00:00.000Z",
        nextRetryAt: null,
      },
    ]));

    let getCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          getCount += 1;
          const status = getCount === 1 ? "on_delivery" : "delivered";
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "done", trailerNumber: "FS-DONE", status, nextAction: status === "on_delivery" ? "DELIVERED" : null, group: status === "on_delivery" ? "current" : "completed", deliveredAt: status === "delivered" ? new Date().toISOString() : null })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([])), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/tasks/action") && method === "POST") {
          return new Response(JSON.stringify({ error: "Task is not eligible for the Delivered action." }), { status: 409 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-DONE")).toBeInTheDocument();

    await waitFor(() => {
      expect(readQueuedActions()).toEqual([]);
      expect(screen.getByText("Completed")).toBeInTheDocument();
    });
  });

  it("shows retry attention for failed queued actions", async () => {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify([
      {
        id: "queued-failed",
        bookingId: "retry-failed",
        action: "COLLECTED",
        linkedInstructionIds: [],
        temperatureC: null,
        createdAt: "2026-08-13T10:00:00.000Z",
        retryCount: 5,
        state: "failed",
        lastError: "Server unavailable",
        lastAttemptAt: "2026-08-13T10:00:00.000Z",
        nextRetryAt: null,
      },
    ]));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "retry-failed", trailerNumber: "FS-FAIL", status: "ready", nextAction: "COLLECTED" })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([])), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-FAIL")).toBeInTheDocument();
    expect(screen.getByText("RETRY NEEDED")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("updates dashboard when realtime callback reports a new assignment", async () => {
    let taskVersion = 1;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: taskVersion === 1
              ? [makeTask({ bookingId: "base", trailerNumber: "FS-BASE" })]
              : [makeTask({ bookingId: "base", trailerNumber: "FS-BASE" }), makeTask({ bookingId: "new-job", trailerNumber: "FS-NEWRT", bookingReference: "PRO123" })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([])), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-BASE")).toBeInTheDocument();
    expect(screen.queryByText("FS-NEWRT")).not.toBeInTheDocument();

    taskVersion = 2;
    expect(realtimeState.callback).toBeTruthy();
    realtimeState.callback?.();

    expect(await screen.findByText("FS-NEWRT")).toBeInTheDocument();
    expect(screen.getByText(/New job assigned - PRO123/)).toBeInTheDocument();
  });

  it("does not repeatedly show new-work alert for the same assignment", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          callCount += 1;
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "same", trailerNumber: "FS-SAME", bookingReference: "PRO123" })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([])), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);
    expect(await screen.findByText("FS-SAME")).toBeInTheDocument();

    realtimeState.callback?.();
    realtimeState.callback?.();

    await waitFor(() => {
      expect(callCount).toBeGreaterThan(2);
    });

    expect(screen.queryByText(/New job assigned - PRO123/)).not.toBeInTheDocument();
  });
});