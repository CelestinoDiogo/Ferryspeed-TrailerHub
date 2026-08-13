// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriverMobileJobsDashboard } from "@/components/mobile/driver-mobile-jobs-dashboard";

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DriverMobileJobsDashboard", () => {
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
});
