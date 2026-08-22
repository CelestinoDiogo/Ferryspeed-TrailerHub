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

  it("does not show overlay for normal active job without unread alerts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "normal", trailerNumber: "FS-NORMAL", status: "on_delivery", nextAction: "DELIVERED", driverAcknowledgedAt: "2026-08-13T08:00:00.000Z" })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([])), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByRole("heading", { name: "FS-NORMAL" }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Operational alert overlay" })).not.toBeInTheDocument();
  });

  it("shows yellow overlay for unread normal instruction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "task-a", trailerId: "trailer-a", trailerNumber: "FS-100", nextAction: "COLLECTED", driverAcknowledgedAt: "2026-08-13T08:00:00.000Z", status: "ready" })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([
            makeInstruction({ id: "instruction-normal", deliveryBookingId: "task-a", trailerId: "trailer-a", priority: "normal", instruction: "Report to Gate 3" }),
          ])), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions/read") && method === "POST") {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    const overlay = await screen.findByRole("dialog", { name: "Operational alert overlay" });
    expect(within(overlay).getAllByText("ATTENTION").length).toBeGreaterThan(0);
    expect(within(overlay).getByText("NEW INSTRUCTION")).toBeInTheDocument();
  });

  it("shows red overlay for high or critical instruction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "task-critical", trailerId: "trailer-critical", trailerNumber: "FS-RED", nextAction: "COLLECTED", driverAcknowledgedAt: "2026-08-13T08:00:00.000Z", status: "ready" })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([
            makeInstruction({ id: "instruction-critical", deliveryBookingId: "task-critical", trailerId: "trailer-critical", priority: "critical", instruction: "Stop movement and call supervisor" }),
          ])), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    const overlay = await screen.findByRole("dialog", { name: "Operational alert overlay" });
    expect(within(overlay).getAllByText("CRITICAL").length).toBeGreaterThan(0);
    expect(within(overlay).getByText("NEW INSTRUCTION")).toBeInTheDocument();
  });

  it("prioritizes red overlay ahead of yellow and shows remaining count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [
              makeTask({ bookingId: "task-yellow", trailerId: "trailer-yellow", trailerNumber: "FS-YEL", nextAction: "COLLECTED", driverAcknowledgedAt: "2026-08-13T08:00:00.000Z", status: "ready" }),
              makeTask({ bookingId: "task-red", trailerId: "trailer-red", trailerNumber: "FS-RED", nextAction: "COLLECTED", driverAcknowledgedAt: "2026-08-13T08:00:00.000Z", status: "ready" }),
            ],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([
            makeInstruction({ id: "instruction-yellow", deliveryBookingId: "task-yellow", trailerId: "trailer-yellow", priority: "normal", createdAt: "2026-08-12T10:00:00.000Z", instruction: "Normal instruction" }),
            makeInstruction({ id: "instruction-red", deliveryBookingId: "task-red", trailerId: "trailer-red", priority: "critical", createdAt: "2026-08-12T12:00:00.000Z", instruction: "Critical instruction" }),
          ])), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    const overlay = await screen.findByRole("dialog", { name: "Operational alert overlay" });
    expect(within(overlay).getAllByText("CRITICAL").length).toBeGreaterThan(0);
    expect(within(overlay).getByText(/1 more alerts/)).toBeInTheDocument();
    expect(within(overlay).queryByText("Normal instruction")).not.toBeInTheDocument();
  });

  it("acknowledges current overlay then shows next pending alert", async () => {
    const readCalls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [
              makeTask({ bookingId: "task-first", trailerId: "trailer-first", trailerNumber: "FS-001", nextAction: "COLLECTED", driverAcknowledgedAt: "2026-08-13T08:00:00.000Z", status: "ready" }),
              makeTask({ bookingId: "task-second", trailerId: "trailer-second", trailerNumber: "FS-002", nextAction: "COLLECTED", driverAcknowledgedAt: "2026-08-13T08:00:00.000Z", status: "ready" }),
            ],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          const firstRead = readCalls.includes("instruction-first");
          const secondRead = readCalls.includes("instruction-second");
          return new Response(JSON.stringify(buildInstructionFeed([
            makeInstruction({ id: "instruction-first", deliveryBookingId: "task-first", trailerId: "trailer-first", createdAt: "2026-08-12T09:00:00.000Z", instruction: "First instruction", readAt: firstRead ? "2026-08-13T10:00:00.000Z" : null }),
            makeInstruction({ id: "instruction-second", deliveryBookingId: "task-second", trailerId: "trailer-second", createdAt: "2026-08-12T10:00:00.000Z", instruction: "Second instruction", readAt: secondRead ? "2026-08-13T10:01:00.000Z" : null }),
          ])), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions/read") && method === "POST") {
          const body = JSON.parse(String(init?.body ?? "{}"));
          readCalls.push(body.instructionId);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    const overlay = await screen.findByRole("dialog", { name: "Operational alert overlay" });
    expect(within(overlay).getByText("First instruction")).toBeInTheDocument();

    fireEvent.click(within(overlay).getByRole("button", { name: "OPEN / ACKNOWLEDGE" }));

    await waitFor(() => {
      const nextOverlay = screen.getByRole("dialog", { name: "Operational alert overlay" });
      expect(within(nextOverlay).getByText("Second instruction")).toBeInTheDocument();
    });
  });

  it("does not resurrect acknowledged overlay after refresh", async () => {
    let isRead = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "task-refresh", trailerId: "trailer-refresh", trailerNumber: "FS-REF", nextAction: "COLLECTED", driverAcknowledgedAt: "2026-08-13T08:00:00.000Z", status: "ready" })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([
            makeInstruction({ id: "instruction-refresh", deliveryBookingId: "task-refresh", trailerId: "trailer-refresh", instruction: "Refresh-me", readAt: isRead ? "2026-08-13T10:05:00.000Z" : null }),
          ])), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions/read") && method === "POST") {
          isRead = true;
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    const overlay = await screen.findByRole("dialog", { name: "Operational alert overlay" });
    fireEvent.click(within(overlay).getByRole("button", { name: "OPEN / ACKNOWLEDGE" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Operational alert overlay" })).not.toBeInTheDocument();
    });

    realtimeState.callback?.();

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Operational alert overlay" })).not.toBeInTheDocument();
    });
  });

  it("keeps a single overlay during realtime duplicate updates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "task-dup", trailerId: "trailer-dup", trailerNumber: "FS-DUP", nextAction: "COLLECTED", driverAcknowledgedAt: "2026-08-13T08:00:00.000Z", status: "ready" })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([
            makeInstruction({ id: "instruction-dup", deliveryBookingId: "task-dup", trailerId: "trailer-dup", instruction: "Duplicate stream" }),
          ])), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);
    expect(await screen.findByRole("dialog", { name: "Operational alert overlay" })).toBeInTheDocument();

    realtimeState.callback?.();
    realtimeState.callback?.();

    await waitFor(() => {
      expect(screen.getAllByRole("dialog", { name: "Operational alert overlay" })).toHaveLength(1);
    });
  });

  it("shows waiting-for-connection state for offline instruction acknowledgement", async () => {
    setOnlineState(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "task-offline", trailerId: "trailer-offline", trailerNumber: "FS-OFFLINE", nextAction: "COLLECTED", driverAcknowledgedAt: "2026-08-13T08:00:00.000Z", status: "ready" })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([
            makeInstruction({ id: "instruction-offline", deliveryBookingId: "task-offline", trailerId: "trailer-offline", instruction: "Offline ack" }),
          ])), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions/read") && method === "POST") {
          throw new Error("Failed to fetch");
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    const overlay = await screen.findByRole("dialog", { name: "Operational alert overlay" });
    fireEvent.click(within(overlay).getByRole("button", { name: "OPEN / ACKNOWLEDGE" }));

    await waitFor(() => {
      expect(window.localStorage.getItem("trailerhub.driver-mobile.instruction-ack-queue.v1")).toContain("instruction-offline");
    });
  });

  it("surfaces RETRY after instruction acknowledgement sync failure", async () => {
    setOnlineState(false);
    let shouldFail = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "task-retry", trailerId: "trailer-retry", trailerNumber: "FS-RETRY", nextAction: "COLLECTED", driverAcknowledgedAt: "2026-08-13T08:00:00.000Z", status: "ready" })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([
            makeInstruction({ id: "instruction-retry", deliveryBookingId: "task-retry", trailerId: "trailer-retry", instruction: "Retry path" }),
          ])), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions/read") && method === "POST") {
          if (window.navigator.onLine === false) {
            throw new Error("Failed to fetch");
          }

          if (shouldFail) {
            return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
          }

          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    const overlay = await screen.findByRole("dialog", { name: "Operational alert overlay" });
    fireEvent.click(within(overlay).getByRole("button", { name: "OPEN / ACKNOWLEDGE" }));

    shouldFail = true;
    setOnlineState(true);
    window.dispatchEvent(new Event("online"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "RETRY" })).toBeInTheDocument();
    });
  });

  it("ignores unread instruction context unrelated to current driver task list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "task-own", trailerId: "trailer-own", trailerNumber: "FS-OWN", nextAction: "COLLECTED", driverAcknowledgedAt: "2026-08-13T08:00:00.000Z", status: "ready" })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([
            makeInstruction({ id: "instruction-other", deliveryBookingId: "another-booking", trailerId: "another-trailer", trailerNumber: "FS-OTHER", instruction: "Other driver message" }),
          ])), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByRole("heading", { name: "FS-OWN" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Operational alert overlay" })).not.toBeInTheDocument();
    expect(screen.queryByText("Other driver message")).not.toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "FS-NEW" })).toBeInTheDocument();
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
              makeTask({ bookingId: "todo", trailerId: "trailer-todo", trailerNumber: "FS-TODO", nextAction: "COLLECTED", group: "current", driverAcknowledgedAt: null }),
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

    expect(await screen.findByRole("heading", { name: "FS-TODO" })).toBeInTheDocument();
    expect((await screen.findAllByText("Collect trailer FS-TODO")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "RECOLHIDA / COLLECTED" })).toBeInTheDocument();
    expect(screen.getByText("Operational Instructions")).toBeInTheDocument();
    expect(screen.getAllByText("To Do").length).toBeGreaterThan(0);
    expect(screen.getAllByText("In Progress").length).toBeGreaterThan(0);
  });

  it("single job acknowledge marks the linked instruction read and does not complete the job", async () => {
    let instructionCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
        return new Response(JSON.stringify({
          driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
          tasks: [makeTask({ bookingId: "booking-a", trailerId: "trailer-a", trailerNumber: "FS1234", nextAction: "COLLECTED", driverAcknowledgedAt: null, status: "scheduled" })],
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

    expect(await screen.findByRole("heading", { name: "FS1234" })).toBeInTheDocument();
    expect((await screen.findAllByText("Collect trailer FS1234")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "OPEN / ACKNOWLEDGE" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "RECOLHIDA / COLLECTED" })).toBeInTheDocument();
      expect(screen.getAllByText(/Acknowledged/).length).toBeGreaterThan(0);
    });

    expect(fetchMock).not.toHaveBeenCalledWith(
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

    const instructionsHeading = await screen.findByRole("heading", { name: "Operational Instructions" });
    const instructionsSection = instructionsHeading.closest("section") as HTMLElement;
    expect(await within(instructionsSection).findByText("Report to quay")).toBeInTheDocument();
    expect(screen.getByText(/NEED ATTENTION/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "ACKNOWLEDGE" })[0]);

    await waitFor(() => {
      expect(screen.getByText("Instruction acknowledged.")).toBeInTheDocument();
    });

    expect(fetchMock.mock.calls.some(([first]) => String(first).includes("/api/driver-mobile/tasks/action"))).toBe(false);
    expect(fetchMock.mock.calls.some(([first]) => String(first).includes("/api/driver-mobile/instructions/read"))).toBe(true);
  });

  it("renders live Driver response controls and maps quick responses with an optional note", async () => {
    const instructionResponses: Array<{ instructionId: string; responseType: string; note?: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
        return new Response(JSON.stringify({
          driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
          tasks: [makeTask({ bookingId: "response-job", trailerId: "response-trailer", nextAction: "COLLECTED", group: "current" })],
        }), { status: 200 });
      }

      if (url.includes("/api/driver-mobile/instructions/respond") && method === "POST") {
        instructionResponses.push(JSON.parse(String(init?.body ?? "{}")) as { instructionId: string; responseType: string; note?: string });
        return new Response(JSON.stringify({ ok: true, response: { id: `event-${instructionResponses.length}` } }), { status: 200 });
      }

      if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
        return new Response(JSON.stringify(buildInstructionFeed([
          makeInstruction({ id: "instruction-response", deliveryBookingId: "response-job", trailerId: "response-trailer", instruction: "Confirm the job status" }),
        ])), { status: 200 });
      }

      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    vi.stubGlobal("fetch", fetchMock);
    render(<DriverMobileJobsDashboard />);

    const instruction = (await screen.findAllByText("Confirm the job status"))[0];
    const card = instruction.closest("article") as HTMLElement;
    for (const label of ["OK", "COMPLETED", "ARRIVED", "DELAYED", "PROBLEM", "CALL ME"]) {
      expect(within(card).getByRole("button", { name: label })).toBeInTheDocument();
    }

    fireEvent.click(within(card).getByRole("button", { name: "Add note" }));
    fireEvent.change(within(card).getByPlaceholderText("Optional note"), { target: { value: "Reached site" } });

    for (const label of ["OK", "COMPLETED", "ARRIVED", "DELAYED", "PROBLEM", "CALL ME"]) {
      fireEvent.click(within(card).getByRole("button", { name: label }));
      await waitFor(() => expect(instructionResponses).toHaveLength(["OK", "COMPLETED", "ARRIVED", "DELAYED", "PROBLEM", "CALL ME"].indexOf(label) + 1));
    }

    expect(instructionResponses).toEqual([
      { instructionId: "instruction-response", responseType: "OK", note: "Reached site" },
      { instructionId: "instruction-response", responseType: "COMPLETED" },
      { instructionId: "instruction-response", responseType: "ARRIVED" },
      { instructionId: "instruction-response", responseType: "DELAYED" },
      { instructionId: "instruction-response", responseType: "PROBLEM" },
      { instructionId: "instruction-response", responseType: "CALL_ME" },
    ]);
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

    expect(await screen.findByRole("heading", { name: "FS-TEMP" })).toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "FS-PRIO" })).toBeInTheDocument();
    const attentionSection = screen.getByRole("heading", { name: "Needs Attention" }).closest("section") as HTMLElement;
    expect(within(attentionSection).getByText("CRITICAL")).toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "FS-GREEN" })).toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "FS-OVERDUE" })).toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "FS-SEND" })).toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "FS-REJECT" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "RECOLHIDA / COLLECTED" }));

    await waitFor(() => {
      expect(screen.getByText("Task is not eligible for the Collected action.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "RECOLHIDA / COLLECTED" })).toBeInTheDocument();
    });

    expect(getCount).toBeGreaterThan(1);
    await waitFor(() => {
      expect(readQueuedActions()).toEqual([]);
    });
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

    expect(await screen.findByRole("heading", { name: "FS-OFF" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Collection reading (C)"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "RECOLHIDA / COLLECTED" }));

    await waitFor(() => {
      expect(screen.getAllByText("Saved - waiting for connection").length).toBeGreaterThan(0);
    });

    expect(screen.getByRole("button", { name: "RECOLHIDA / COLLECTED" })).toBeDisabled();
    expect(screen.queryByText("On Delivery")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ENTREGUE / DELIVERED" })).not.toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "FS-ACK" })).toBeInTheDocument();
    expect((await screen.findAllByText(/Call office before collection/)).length).toBeGreaterThan(0);
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

    expect(await screen.findByRole("heading", { name: "FS-RETRY" })).toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "FS-DONE" })).toBeInTheDocument();

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

    expect(await screen.findByRole("heading", { name: "FS-FAIL" })).toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "FS-BASE" })).toBeInTheDocument();
    expect(screen.queryByText("FS-NEWRT")).not.toBeInTheDocument();

    taskVersion = 2;
    expect(realtimeState.callback).toBeTruthy();
    realtimeState.callback?.();

    expect(await screen.findByRole("heading", { name: "FS-NEWRT" })).toBeInTheDocument();
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
    expect(await screen.findByRole("heading", { name: "FS-SAME" })).toBeInTheDocument();

    realtimeState.callback?.();
    realtimeState.callback?.();

    await waitFor(() => {
      expect(callCount).toBeGreaterThan(2);
    });

    expect(screen.queryByText(/New job assigned - PRO123/)).not.toBeInTheDocument();
  });

  it("does not show profile-required state when API access is denied", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({ error: "You do not have permission to perform this action.", code: "RBAC_PERMISSION_DENIED" }), { status: 403 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify({ error: "You do not have permission to perform this action.", code: "RBAC_PERMISSION_DENIED" }), { status: 403 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("You do not have permission to perform this action.")).toBeInTheDocument();
    expect(screen.queryByText("Driver profile required")).not.toBeInTheDocument();
  });

  it("keeps the server unread count instead of recounting the limited recent window", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "task-a", trailerNumber: "FS-READ", nextAction: "DELIVERED", driverAcknowledgedAt: "2026-08-13T08:00:00.000Z", status: "on_delivery" })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify({
            unreadCount: 50,
            newestUnread: null,
            recent: [
              makeInstruction({
                id: "read-window",
                deliveryBookingId: null,
                readAt: "2026-08-20T09:00:00.000Z",
                isRead: true,
                instruction: "Older instruction already read",
              }),
            ],
          }), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("50 unread")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Operational alert overlay" })).not.toBeInTheDocument();
  });

  it("one-tap collected on an unacknowledged job posts COLLECTED without a prior acknowledge tap", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
        return new Response(JSON.stringify({
          driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
          tasks: [makeTask({ bookingId: "one-tap", trailerNumber: "FS-ONE", status: "ready", nextAction: "COLLECTED", driverAcknowledgedAt: null })],
        }), { status: 200 });
      }

      if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
        return new Response(JSON.stringify(buildInstructionFeed([])), { status: 200 });
      }

      if (url.includes("/api/driver-mobile/tasks/action") && method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    vi.stubGlobal("fetch", fetchMock);
    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByRole("heading", { name: "FS-ONE" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Operational alert overlay" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Collection reading (C)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "RECOLHIDA / COLLECTED" }));

    await waitFor(() => {
      const actionCalls = fetchMock.mock.calls.filter(([input, init]) => String(input).includes("/api/driver-mobile/tasks/action") && (init?.method ?? "GET") === "POST");
      expect(actionCalls).toHaveLength(1);
      expect(JSON.parse(String(actionCalls[0]?.[1]?.body))).toMatchObject({
        bookingId: "one-tap",
        action: "COLLECTED",
      });
    });
  });

  it("shows collected empty and loaded as the one-tap collection actions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({
              bookingId: "collect-job",
              trailerNumber: "FS-COLLECT",
              taskKind: "collection",
              status: "waiting_collection",
              nextAction: "COLLECTED",
              group: "current",
            })],
          }), { status: 200 });
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(JSON.stringify(buildInstructionFeed([])), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByRole("heading", { name: "FS-COLLECT" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collected Empty" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collected Loaded" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Collection reading (C)")).not.toBeInTheDocument();
  });
});