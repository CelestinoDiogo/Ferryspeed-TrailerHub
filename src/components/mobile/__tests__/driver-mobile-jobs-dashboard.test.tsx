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
    useCurrentUserMock.mockReturnValue({
      roleKey: "driver",
      fullName: "Driver One",
      email: "driver@example.com",
      isLoading: false,
    });
  });

  it("groups assigned jobs into To Do, In Progress, and Completed Today", async () => {
    const todayIso = new Date().toISOString();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/driver-mobile/tasks")) {
          return new Response(
            JSON.stringify({
              driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
              tasks: [
                makeTask({ bookingId: "todo", trailerNumber: "FS-TODO", nextAction: "ACKNOWLEDGED", group: "current" }),
                makeTask({ bookingId: "progress", trailerNumber: "FS-PROGRESS", status: "on_delivery", nextAction: "DELIVERED", group: "current" }),
                makeTask({ bookingId: "done", trailerNumber: "FS-DONE", status: "delivered", nextAction: null, group: "completed", deliveredAt: todayIso }),
              ],
            }),
            { status: 200 },
          );
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-TODO")).toBeInTheDocument();
    expect(screen.getByText("FS-PROGRESS")).toBeInTheDocument();
    expect(screen.getByText("FS-DONE")).toBeInTheDocument();

    expect(screen.getAllByText("To Do").length).toBeGreaterThan(0);
    expect(screen.getAllByText("In Progress").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Completed Today").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "ACKNOWLEDGE" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ENTREGUE / DELIVERED" })).toBeInTheDocument();
  });

  it("blocks collected action when required temperature is missing", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
        return new Response(
          JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [
              makeTask({
                bookingId: "temp",
                trailerNumber: "FS-TEMP",
                status: "ready",
                group: "upcoming",
                nextAction: "COLLECTED",
                temperature: { required: true },
                taskKind: "delivery",
              }),
            ],
          }),
          { status: 200 },
        );
      }

      if (url.includes("/api/driver-mobile/tasks/action") && method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("disables the tapped action while sending and prevents duplicate requests", async () => {
    const pendingResponse = new Promise<Response>(() => undefined);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
        return new Response(
          JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "sending", trailerNumber: "FS-SEND", status: "ready", nextAction: "COLLECTED" })],
          }),
          { status: 200 },
        );
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

  it("moves a collected job optimistically into in-progress state", async () => {
    const pendingResponse = new Promise<Response>(() => undefined);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(
            JSON.stringify({
              driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
              tasks: [makeTask({ bookingId: "collect", trailerNumber: "FS-COLLECT", status: "ready", nextAction: "COLLECTED", group: "upcoming" })],
            }),
            { status: 200 },
          );
        }

        if (url.includes("/api/driver-mobile/tasks/action") && method === "POST") {
          return pendingResponse;
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-COLLECT")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "RECOLHIDA / COLLECTED" }));

    await waitFor(() => {
      expect(screen.getByText("On Delivery")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sending..." })).toBeInTheDocument();
    });
  });

  it("moves a delivered job optimistically into completed state", async () => {
    const pendingResponse = new Promise<Response>(() => undefined);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(
            JSON.stringify({
              driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
              tasks: [makeTask({ bookingId: "deliver", trailerNumber: "FS-DELIVER", status: "on_delivery", nextAction: "DELIVERED", group: "current" })],
            }),
            { status: 200 },
          );
        }

        if (url.includes("/api/driver-mobile/tasks/action") && method === "POST") {
          return pendingResponse;
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-DELIVER")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ENTREGUE / DELIVERED" }));

    await waitFor(() => {
      const card = screen.getByText("FS-DELIVER").closest("article") as HTMLElement;
      expect(within(card).getByText("Delivered")).toBeInTheDocument();
      expect(within(card).getByText("No action required")).toBeInTheDocument();
    });
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
          return new Response(
            JSON.stringify({
              driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
              tasks: [makeTask({ bookingId: "reject", trailerNumber: "FS-REJECT", status: "ready", nextAction: "COLLECTED", group: "upcoming" })],
            }),
            { status: 200 },
          );
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

  it("queues network failures and preserves required temperature", async () => {
    setOnlineState(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(
            JSON.stringify({
              driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
              tasks: [makeTask({ bookingId: "offline", trailerNumber: "FS-OFF", status: "ready", nextAction: "COLLECTED", temperature: { required: true } })],
            }),
            { status: 200 },
          );
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

    const queued = readQueuedActions();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      bookingId: "offline",
      action: "COLLECTED",
      temperatureC: 2.5,
      state: "pending",
    });
  });

  it("replays queued actions after connectivity returns and clears the queue on success", async () => {
    setOnlineState(false);

    let taskState: "ready" | "on_delivery" = "ready";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
        return new Response(
          JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "retry", trailerNumber: "FS-RETRY", status: taskState, nextAction: taskState === "ready" ? "COLLECTED" : "DELIVERED", group: taskState === "ready" ? "upcoming" : "current" })],
          }),
          { status: 200 },
        );
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
      expect(screen.getAllByText("Saved - waiting for connection").length).toBeGreaterThan(0);
      expect(readQueuedActions()).toHaveLength(1);
    });

    setOnlineState(true);
    window.dispatchEvent(new Event("online"));

    await waitFor(() => {
      expect(readQueuedActions()).toEqual([]);
      expect(screen.getByRole("button", { name: "ENTREGUE / DELIVERED" })).toBeInTheDocument();
    });
  });

  it("keeps failed queued retries visible and retryable", async () => {
    window.localStorage.setItem(
      QUEUE_STORAGE_KEY,
      JSON.stringify([
        {
          id: "queued-failed",
          bookingId: "retry-fail",
          action: "COLLECTED",
          temperatureC: null,
          createdAt: "2026-08-13T10:00:00.000Z",
          retryCount: 5,
          state: "pending",
          lastError: null,
          lastAttemptAt: "2026-08-13T10:00:00.000Z",
          nextRetryAt: null,
        },
      ]),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(
            JSON.stringify({
              driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
              tasks: [makeTask({ bookingId: "retry-fail", trailerNumber: "FS-FAIL", status: "ready", nextAction: "COLLECTED" })],
            }),
            { status: 200 },
          );
        }

        if (url.includes("/api/driver-mobile/tasks/action") && method === "POST") {
          return new Response(JSON.stringify({ error: "Server unavailable" }), { status: 500 });
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });

    expect(readQueuedActions()[0]).toMatchObject({ state: "failed" });
  });

  it("keeps queued acknowledgement explicit and separate from completion", async () => {
    setOnlineState(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(
            JSON.stringify({
              driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
              tasks: [makeTask({ bookingId: "ack", trailerNumber: "FS-ACK", nextAction: "ACKNOWLEDGED", driverAcknowledgedAt: null, driverAcknowledgedBy: null })],
            }),
            { status: 200 },
          );
        }

        if (url.includes("/api/driver-mobile/tasks/action") && method === "POST") {
          throw new Error("Failed to fetch");
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileJobsDashboard />);

    expect(await screen.findByText("FS-ACK")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ACKNOWLEDGE" }));

    await waitFor(() => {
      expect(screen.getAllByText("Saved - waiting for connection").length).toBeGreaterThan(0);
    });

    expect(readQueuedActions()[0]).toMatchObject({
      bookingId: "ack",
      action: "ACKNOWLEDGED",
      temperatureC: null,
    });
  });

  it("treats already-completed server state as reconciled during queued retry", async () => {
    window.localStorage.setItem(
      QUEUE_STORAGE_KEY,
      JSON.stringify([
        {
          id: "queued-done",
          bookingId: "done",
          action: "DELIVERED",
          temperatureC: null,
          createdAt: "2026-08-13T10:00:00.000Z",
          retryCount: 1,
          state: "pending",
          lastError: null,
          lastAttemptAt: "2026-08-13T10:00:00.000Z",
          nextRetryAt: null,
        },
      ]),
    );

    let getCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          getCount += 1;
          const status = getCount === 1 ? "on_delivery" : "delivered";
          return new Response(
            JSON.stringify({
              driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
              tasks: [makeTask({ bookingId: "done", trailerNumber: "FS-DONE", status, nextAction: status === "on_delivery" ? "DELIVERED" : null, group: status === "on_delivery" ? "current" : "completed", deliveredAt: status === "delivered" ? new Date().toISOString() : null })],
            }),
            { status: 200 },
          );
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
});
