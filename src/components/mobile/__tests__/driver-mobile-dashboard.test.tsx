// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriverMobileDashboard } from "@/components/mobile/driver-mobile-dashboard";

const useCurrentUserMock = vi.fn();
const getSessionTokenMock = vi.fn();
const { signOutMock, routerReplaceMock, routerRefreshMock } = vi.hoisted(() => ({
  signOutMock: vi.fn(),
  routerReplaceMock: vi.fn(),
  routerRefreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
    refresh: routerRefreshMock,
  }),
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

vi.mock("@/lib/realtime/operational-realtime", () => ({
  useOperationalRealtime: () => undefined,
}));

const makeTask = (overrides?: Record<string, unknown>) => ({
  taskId: "booking-a",
  driverId: "driver-a",
  taskKind: "delivery",
  bookingId: "booking-a",
  trailerId: "trailer-a",
  trailerNumber: "FS1234",
  customer: "Customer A",
  location: "Dock 1",
  bookingReference: "BK-A",
  notes: null,
  status: "scheduled",
  deliveryDate: "2026-08-11",
  deliveryTime: "12:00:00",
  group: "upcoming",
  nextAction: "COLLECTED",
  deliveredAt: null,
  collectedAt: null,
  waitingCollectionSince: null,
  collectedTemperatureC: null,
  driverAcknowledgedAt: null,
  driverAcknowledgedBy: null,
  temperature: {
    required: false,
  },
  ...overrides,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DriverMobileDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionTokenMock.mockResolvedValue("token");
    signOutMock.mockResolvedValue(undefined);
    useCurrentUserMock.mockReturnValue({
      roleKey: "driver",
      fullName: "Driver One",
      email: "driver@example.com",
      isLoading: false,
    });
  });

  it("renders deliveries and collections sections on the unified workboard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/driver-mobile/tasks")) {
          return new Response(
            JSON.stringify({
              driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
              tasks: [
                makeTask({ bookingId: "a", taskId: "a", trailerNumber: "FS-A", group: "current", status: "on_delivery", nextAction: "DELIVERED", taskKind: "delivery" }),
                makeTask({ bookingId: "b", taskId: "b", trailerNumber: "FS-B", group: "upcoming", status: "scheduled", nextAction: "COLLECTED", taskKind: "delivery" }),
                makeTask({ bookingId: "c", taskId: "c", trailerNumber: "FS-C", group: "current", status: "waiting_collection", nextAction: "COLLECTED", taskKind: "collection" }),
              ],
            }),
            { status: 200 },
          );
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileDashboard />);

    expect(await screen.findByText("Deliveries")).toBeInTheDocument();
    expect(screen.getAllByText("Collections").length).toBeGreaterThan(0);
    expect(screen.getByText("Messages / Instructions")).toBeInTheDocument();

    expect(screen.getByText("FS-A")).toBeInTheDocument();
    expect(screen.getByText("FS-B")).toBeInTheDocument();
    expect(screen.getByText("FS-C")).toBeInTheDocument();
    expect(screen.getAllByText("Delivery").length).toBeGreaterThan(0);
    expect(screen.getByText("Collection")).toBeInTheDocument();
  });

  it("shows acknowledge/read as the primary action for unacknowledged tasks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [
              makeTask({
                bookingId: "ack-a",
                trailerNumber: "FS-ACK",
                status: "scheduled",
                nextAction: "ACKNOWLEDGED",
                driverAcknowledgedAt: null,
                driverAcknowledgedBy: null,
              }),
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    render(<DriverMobileDashboard />);

    expect(await screen.findByText("FS-ACK")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acknowledge / Read" })).toBeInTheDocument();
  });

  it("shows temperature input only for temperature-controlled tasks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [
              makeTask({
                bookingId: "hot",
                trailerNumber: "FS-HOT",
                group: "upcoming",
                status: "ready",
                nextAction: "COLLECTED",
                temperature: { required: true },
              }),
              makeTask({
                bookingId: "cold",
                trailerNumber: "FS-COLD",
                group: "current",
                status: "on_delivery",
                nextAction: "DELIVERED",
                temperature: { required: false },
              }),
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    render(<DriverMobileDashboard />);

    expect(await screen.findByText("FS-HOT")).toBeInTheDocument();
    expect(screen.getByLabelText("Collection reading (C)")).toBeInTheDocument();

    const coldCard = screen.getByText("FS-COLD").closest("article");
    expect(coldCard?.textContent).not.toContain("Temperature controlled");
  });

  it("shows safe state for unlinked driver", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            driver: null,
            tasks: [],
          }),
          { status: 200 },
        ),
      ),
    );

    render(<DriverMobileDashboard />);

    expect(await screen.findByText("Driver profile required")).toBeInTheDocument();
    expect(screen.getByText("My Work")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("shows sign out on normal dashboard and signs out to login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(
            JSON.stringify({
              driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
              tasks: [makeTask({ bookingId: "a", trailerNumber: "FS-A", group: "upcoming" })],
            }),
            { status: 200 },
          );
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(
            JSON.stringify({
              unreadCount: 0,
              newestUnread: null,
              recent: [],
            }),
            { status: 200 },
          );
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileDashboard />);

    expect(await screen.findByText("FS-A")).toBeInTheDocument();

    const signOutButton = screen.getByRole("button", { name: "Sign out" });
    expect(signOutButton).toBeInTheDocument();

    fireEvent.click(signOutButton);

    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalledTimes(1);
      expect(routerReplaceMock).toHaveBeenCalledWith("/login");
      expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    });
  });

  it("shows sign out when there are zero assigned tasks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(
            JSON.stringify({
              driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
              tasks: [],
            }),
            { status: 200 },
          );
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(
            JSON.stringify({
              unreadCount: 0,
              newestUnread: null,
              recent: [],
            }),
            { status: 200 },
          );
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileDashboard />);

    expect((await screen.findAllByText("No tasks in this section.")).length).toBe(2);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("shows sign out when task API returns an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/driver-mobile/tasks")) {
          return new Response(JSON.stringify({ error: "Unable to load assigned tasks." }), { status: 500 });
        }

        if (String(input).includes("/api/driver-mobile/instructions")) {
          return new Response(
            JSON.stringify({
              unreadCount: 0,
              newestUnread: null,
              recent: [],
            }),
            { status: 200 },
          );
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileDashboard />);

    expect(await screen.findByText("Unable to load assigned tasks.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("keeps sign out visible in permission-denied fallback", async () => {
    useCurrentUserMock.mockReturnValueOnce({
      roleKey: "operator",
      fullName: "Operator One",
      email: "operator@example.com",
      isLoading: false,
    });

    render(<DriverMobileDashboard />);

    expect(screen.getByText("You do not have permission to access Driver Mobile.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("applies collected action with task busy state, prevents duplicate click, and keeps user on driver screen", async () => {
    let releaseAction: () => void = () => undefined;
    const actionPromise = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
        if (fetchMock.mock.calls.filter(([first, second]) => String(first).includes("/api/driver-mobile/tasks") && (!second?.method || second.method === "GET")).length === 1) {
          return new Response(
            JSON.stringify({
              driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
              tasks: [makeTask({ bookingId: "booking-a", trailerNumber: "FS1234", group: "upcoming", status: "scheduled", nextAction: "COLLECTED" })],
            }),
            { status: 200 },
          );
        }

        return new Response(
          JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "booking-a", trailerNumber: "FS1234", group: "current", status: "on_delivery", nextAction: "DELIVERED" })],
          }),
          { status: 200 },
        );
      }

      if (url.includes("/api/driver-mobile/tasks/action") && method === "POST") {
        await actionPromise;
        return new Response(JSON.stringify({ ok: true, booking: { id: "booking-a", status: "on_delivery" } }), { status: 200 });
      }

      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<DriverMobileDashboard />);

    const button = await screen.findByRole("button", { name: "Mark Collected" });
    fireEvent.click(button);

    await screen.findByRole("button", { name: "Updating..." });

    const updatingButton = screen.getByRole("button", { name: "Updating..." });
    expect(updatingButton).toBeDisabled();

    fireEvent.click(updatingButton);
    releaseAction();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Mark Delivered" })).toBeInTheDocument();
    });

    expect(fetchMock.mock.calls.filter(([first, second]) => String(first).includes("/api/driver-mobile/tasks/action") && second?.method === "POST")).toHaveLength(1);
    expect(screen.getByText("Ferryspeed Driver Mobile")).toBeInTheDocument();
  });

  it("blocks collected action when required temperature is missing, then accepts valid reading", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
        return new Response(
          JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [
              makeTask({
                bookingId: "booking-temp",
                trailerId: "trailer-temp",
                trailerNumber: "FS-TEMP",
                group: "current",
                status: "ready",
                nextAction: "COLLECTED",
                temperature: { required: true },
              }),
            ],
          }),
          { status: 200 },
        );
      }

      if (url.includes("/api/driver-mobile/tasks/action") && method === "POST") {
        return new Response(JSON.stringify({ ok: true, booking: { id: "booking-temp", status: "on_delivery" } }), { status: 200 });
      }

      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<DriverMobileDashboard />);

    expect(await screen.findByText("FS-TEMP")).toBeInTheDocument();

    const collectButton = screen.getByRole("button", { name: "Mark Collected" });
    fireEvent.click(collectButton);

    expect(await screen.findByText("Temperature reading is required before marking this task as collected.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([first]) => String(first).includes("/api/driver-mobile/tasks/action"))).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Collection reading (C)"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark Collected" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([first]) => String(first).includes("/api/driver-mobile/tasks/action"))).toHaveLength(1);
    });

    const actionCall = fetchMock.mock.calls.find(([first]) => String(first).includes("/api/driver-mobile/tasks/action"));
    const payload = JSON.parse(String(actionCall?.[1]?.body ?? "{}"));

    expect(payload).toMatchObject({
      bookingId: "booking-temp",
      action: "COLLECTED",
      temperatureC: 2.5,
    });
  });

  it("renders unread count, newest instruction and recent history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
          return new Response(
            JSON.stringify({
              driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
              tasks: [makeTask({ bookingId: "a", trailerNumber: "FS-A", group: "current", status: "on_delivery", nextAction: "DELIVERED" })],
            }),
            { status: 200 },
          );
        }

        if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
          return new Response(
            JSON.stringify({
              unreadCount: 2,
              newestUnread: {
                id: "instruction-a",
                instruction: "Proceed to loading lane A",
                createdAt: "2026-08-12T10:00:00.000Z",
                trailerNumber: "FS-A",
                readAt: null,
              },
              recent: [
                {
                  id: "instruction-a",
                  instruction: "Proceed to loading lane A",
                  createdAt: "2026-08-12T10:00:00.000Z",
                  readAt: null,
                },
                {
                  id: "instruction-b",
                  instruction: "Collect documents before departure",
                  createdAt: "2026-08-12T09:00:00.000Z",
                  readAt: "2026-08-12T09:30:00.000Z",
                },
              ],
            }),
            { status: 200 },
          );
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    const confirmSpy = vi.spyOn(window, "confirm");

    render(<DriverMobileDashboard />);

    expect(await screen.findByText("2 unread")).toBeInTheDocument();
    expect(screen.getAllByText("Proceed to loading lane A").length).toBeGreaterThan(0);
    expect(screen.getByText("Recent History")).toBeInTheDocument();
    expect(screen.getByText("Collect documents before departure")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark Read" })).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("disables mark-read while pending and refreshes to next unread instruction", async () => {
    let resolveRead: () => void = () => undefined;
    const readPromise = new Promise<void>((resolve) => {
      resolveRead = resolve;
    });

    let readApplied = false;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/driver-mobile/tasks") && method === "GET") {
        return new Response(
          JSON.stringify({
            driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
            tasks: [makeTask({ bookingId: "a", trailerNumber: "FS-A", group: "current", status: "on_delivery", nextAction: "DELIVERED" })],
          }),
          { status: 200 },
        );
      }

      if (url.includes("/api/driver-mobile/instructions") && method === "GET") {
        if (!readApplied) {
          return new Response(
            JSON.stringify({
              unreadCount: 2,
              newestUnread: {
                id: "instruction-a",
                instruction: "Proceed to loading lane A",
                createdAt: "2026-08-12T10:00:00.000Z",
                trailerNumber: "FS-A",
                readAt: null,
              },
              recent: [
                {
                  id: "instruction-a",
                  instruction: "Proceed to loading lane A",
                  createdAt: "2026-08-12T10:00:00.000Z",
                  readAt: null,
                },
                {
                  id: "instruction-b",
                  instruction: "Collect documents before departure",
                  createdAt: "2026-08-12T09:00:00.000Z",
                  readAt: null,
                },
              ],
            }),
            { status: 200 },
          );
        }

        return new Response(
          JSON.stringify({
            unreadCount: 1,
            newestUnread: {
              id: "instruction-b",
              instruction: "Collect documents before departure",
              createdAt: "2026-08-12T09:00:00.000Z",
              trailerNumber: "FS-A",
              readAt: null,
            },
            recent: [
              {
                id: "instruction-a",
                instruction: "Proceed to loading lane A",
                createdAt: "2026-08-12T10:00:00.000Z",
                readAt: "2026-08-12T10:10:00.000Z",
              },
              {
                id: "instruction-b",
                instruction: "Collect documents before departure",
                createdAt: "2026-08-12T09:00:00.000Z",
                readAt: null,
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (url.includes("/api/driver-mobile/instructions/read") && method === "POST") {
        await readPromise;
        readApplied = true;
        return new Response(JSON.stringify({ ok: true, instruction: { id: "instruction-a" } }), { status: 200 });
      }

      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<DriverMobileDashboard />);

    const markButton = await screen.findByRole("button", { name: "Mark Read" });
    fireEvent.click(markButton);

    const pendingButton = await screen.findByRole("button", { name: "Marking..." });
    expect(pendingButton).toBeDisabled();

    resolveRead();

    await waitFor(() => {
      expect(screen.getByText("1 unread")).toBeInTheDocument();
      expect(screen.getAllByText("Collect documents before departure").length).toBeGreaterThan(0);
    });
  });
});
