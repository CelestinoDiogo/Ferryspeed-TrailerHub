// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriverMobileDashboard } from "@/components/mobile/driver-mobile-dashboard";

const useCurrentUserMock = vi.fn();
const getSessionTokenMock = vi.fn();

vi.mock("@/lib/auth/use-current-user", () => ({
  useCurrentUser: () => useCurrentUserMock(),
}));

vi.mock("@/lib/voice/session", () => ({
  SESSION_EXPIRED_MESSAGE: "Your session has expired. Please sign in again.",
  getSessionToken: () => getSessionTokenMock(),
}));

vi.mock("@/components/auth/permission-guard", () => ({
  PermissionGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const makeTask = (overrides?: Record<string, unknown>) => ({
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
    useCurrentUserMock.mockReturnValue({
      roleKey: "driver",
      fullName: "Driver One",
      email: "driver@example.com",
      isLoading: false,
    });
  });

  it("renders current, upcoming, and completed assigned tasks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/driver-mobile/tasks")) {
          return new Response(
            JSON.stringify({
              driver: { id: "driver-a", display_name: "Driver One", user_id: "user-a" },
              tasks: [
                makeTask({ bookingId: "a", trailerNumber: "FS-A", group: "current", status: "on_delivery", nextAction: "DELIVERED" }),
                makeTask({ bookingId: "b", trailerNumber: "FS-B", group: "upcoming", status: "scheduled", nextAction: "COLLECTED" }),
                makeTask({ bookingId: "c", trailerNumber: "FS-C", group: "completed", status: "collected", nextAction: null }),
              ],
            }),
            { status: 200 },
          );
        }

        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      }),
    );

    render(<DriverMobileDashboard />);

    expect(await screen.findByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();

    expect(screen.getByText("FS-A")).toBeInTheDocument();
    expect(screen.getByText("FS-B")).toBeInTheDocument();
    expect(screen.getByText("FS-C")).toBeInTheDocument();
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
    expect(screen.getAllByText("Assigned Delivery Tasks").length).toBeGreaterThan(0);
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
});
