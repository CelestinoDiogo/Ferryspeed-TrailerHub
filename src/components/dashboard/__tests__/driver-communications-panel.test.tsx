// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriverCommunicationsPanel } from "@/components/dashboard/driver-communications-panel";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/voice/session";

const routeQueryState = vi.hoisted(() => ({
  driverId: "driver-a",
  deliveryBookingId: "booking-a",
  trailerId: "trailer-a",
  trailerNumber: "FS1001",
  bookingReference: "REF-A",
}));

const userState = vi.hoisted(() => ({
  roleKey: "supervisor" as "administrator" | "supervisor" | "operator" | "driver" | null,
  isLoading: false,
}));

const realtimeState = vi.hoisted(() => ({
  callback: null as null | (() => void),
}));

const driversResult = vi.hoisted(() => ({
  data: [
    { id: "driver-a", display_name: "Driver A", user_id: "user-a" },
    { id: "driver-b", display_name: "Driver B", user_id: "user-b" },
  ],
  error: null,
}));

const bookingRowsResult = vi.hoisted(() => ({
  data: [
    {
      id: "booking-a",
      driver_id: "driver-a",
      trailer_id: "trailer-a",
      booking_reference: "REF-A",
      status: "on_delivery",
      delivery_date: "2026-08-12",
      trailers: { trailer_number: "FS1001" },
    },
  ],
  error: null,
}));

const instructionSummaryResult = vi.hoisted(() => ({
  data: [{ id: "instruction-a", driver_id: "driver-a", read_at: null }],
  error: null,
}));

const getSessionTokenMock = vi.hoisted(() => vi.fn());

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => {
      if (key === "driverId") return routeQueryState.driverId;
      if (key === "deliveryBookingId") return routeQueryState.deliveryBookingId;
      if (key === "trailerId") return routeQueryState.trailerId;
      if (key === "trailerNumber") return routeQueryState.trailerNumber;
      if (key === "bookingReference") return routeQueryState.bookingReference;
      return null;
    },
  }),
}));

vi.mock("@/lib/auth/use-current-user", () => ({
  useCurrentUser: () => ({ roleKey: userState.roleKey, isLoading: userState.isLoading }),
}));

vi.mock("@/lib/realtime/operational-realtime", () => ({
  useOperationalRealtime: (_topics: string[], callback: () => void) => {
    realtimeState.callback = callback;
  },
}));

vi.mock("@/lib/voice/session", () => ({
  SESSION_EXPIRED_MESSAGE: "Your session has expired. Please sign in again.",
  getSessionToken: (...args: unknown[]) => getSessionTokenMock(...args),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "drivers") {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(async () => driversResult),
        };
        return chain;
      }

      if (table === "delivery_bookings") {
        const chain = {
          select: vi.fn(() => chain),
          not: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          limit: vi.fn(async () => bookingRowsResult),
        };
        return chain;
      }

      if (table === "driver_operational_instructions") {
        const chain = {
          select: vi.fn(() => chain),
          order: vi.fn(() => chain),
          limit: vi.fn(async () => instructionSummaryResult),
        };
        return chain;
      }

      throw new Error(`Unexpected table ${table}`);
    },
  },
}));

describe("DriverCommunicationsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    userState.roleKey = "supervisor";
    userState.isLoading = false;
    routeQueryState.driverId = "driver-a";
    routeQueryState.deliveryBookingId = "booking-a";
    routeQueryState.trailerId = "trailer-a";
    routeQueryState.trailerNumber = "FS1001";
    routeQueryState.bookingReference = "REF-A";
    realtimeState.callback = null;
    getSessionTokenMock.mockResolvedValue("token-main");

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/operations/driver-instructions?") && method === "GET") {
        return {
          ok: true,
          json: async () => ({
            instructions: [
              {
                id: "instruction-a",
                deliveryBookingId: "booking-a",
                trailerId: "trailer-a",
                trailerNumber: "FS1001",
                instruction: "Return to depot",
                priority: "normal",
                senderDisplayName: "Manager",
                createdAt: "2026-08-12T09:00:00.000Z",
                readAt: "2026-08-12T09:05:00.000Z",
                latestResponse: {
                  id: "response-b",
                  responseType: "delayed",
                  message: "Traffic",
                  createdAt: "2026-08-12T09:12:00.000Z",
                  isException: true,
                },
                responseHistory: [
                  {
                    id: "response-a",
                    responseType: "ok",
                    message: null,
                    createdAt: "2026-08-12T09:08:00.000Z",
                    isException: false,
                  },
                  {
                    id: "response-b",
                    responseType: "delayed",
                    message: "Traffic",
                    createdAt: "2026-08-12T09:12:00.000Z",
                    isException: true,
                  },
                ],
              },
            ],
            latestResponse: {
              id: "response-b",
              responseType: "delayed",
              message: "Traffic",
              createdAt: "2026-08-12T09:12:00.000Z",
              isException: true,
            },
            latestException: {
              id: "response-b",
              responseType: "delayed",
              message: "Traffic",
              createdAt: "2026-08-12T09:12:00.000Z",
              isException: true,
            },
            timeline: [
              {
                id: "instruction:instruction-a",
                kind: "manager_instruction",
                createdAt: "2026-08-12T09:00:00.000Z",
                actorLabel: "Manager",
                text: "Return to depot",
                isException: false,
              },
              {
                id: "response:response-a",
                kind: "driver_response",
                createdAt: "2026-08-12T09:08:00.000Z",
                actorLabel: "Driver",
                text: "OK",
                isException: false,
              },
              {
                id: "response:response-b",
                kind: "driver_response",
                createdAt: "2026-08-12T09:12:00.000Z",
                actorLabel: "Driver",
                text: "DELAYED - Traffic",
                isException: true,
              },
            ],
          }),
        };
      }

      if (url.includes("/api/operations/driver-instructions") && method === "POST") {
        return {
          ok: true,
          json: async () => ({ ok: true }),
        };
      }

      return {
        ok: false,
        json: async () => ({ error: "Unexpected request" }),
      };
    });

    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders desktop route for authorized role and loads active drivers", async () => {
    render(<DriverCommunicationsPanel />);

    expect(await screen.findByText("Driver Communications")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Driver A" })).toBeInTheDocument();
    expect(await screen.findByText("Pending 1")).toBeInTheDocument();
    expect(screen.queryByText(/Auth session missing/i)).not.toBeInTheDocument();
  });

  it.each(["operator", "driver"] as const)("denies %s without querying operational communications", async (roleKey) => {
    userState.roleKey = roleKey;
    render(<DriverCommunicationsPanel />);

    expect(await screen.findByText("You do not have permission to access Driver Communications.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("desktop history GET resolves authenticated session and deep-link context", async () => {
    render(<DriverCommunicationsPanel />);

    await screen.findByRole("heading", { name: "Driver A" });

    await waitFor(() => {
      const getCalls = fetchMock.mock.calls.filter(([first]) => String(first).includes("/api/operations/driver-instructions?"));
      expect(getCalls.length).toBeGreaterThan(0);
    });

    const getCalls = fetchMock.mock.calls.filter(([first]) => String(first).includes("/api/operations/driver-instructions?"));
    const contextCall = getCalls.find(([first]) => {
      const url = String(first);
      return url.includes("driverId=driver-a") && url.includes("deliveryBookingId=booking-a") && url.includes("trailerId=trailer-a");
    });

    expect(contextCall).toBeTruthy();
    expect((contextCall?.[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer token-main" });
  });

  it("selecting a driver reloads communication history", async () => {
    render(<DriverCommunicationsPanel />);

    await screen.findByRole("heading", { name: "Driver A" });
    fireEvent.click(screen.getByRole("button", { name: /Driver B/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("driverId=driver-b"), expect.anything());
    });
  });

  it("sends free-text message with existing instruction endpoint", async () => {
    render(<DriverCommunicationsPanel />);

    await screen.findByRole("heading", { name: "Driver A" });
    fireEvent.change(screen.getByPlaceholderText("Type message or operational instruction"), {
      target: { value: "Contact manager" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      const sendCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
      expect(sendCall).toBeTruthy();
      const body = JSON.parse(String((sendCall?.[1] as RequestInit)?.body));
      expect(body).toMatchObject({
        driverId: "driver-a",
        instruction: "Contact manager",
        deliveryBookingId: "booking-a",
        trailerId: "trailer-a",
      });
      expect((sendCall?.[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer token-main" });
    });
  });

  it("quick preset appends text and can be sent", async () => {
    render(<DriverCommunicationsPanel />);

    await screen.findByRole("heading", { name: "Driver A" });
    fireEvent.click(screen.getByRole("button", { name: "Call office" }));

    const textarea = screen.getByPlaceholderText("Type message or operational instruction");
    expect(textarea).toHaveValue("Call office");
  });

  it("renders response events, multiple history items and read status", async () => {
    render(<DriverCommunicationsPanel />);

    expect(await screen.findByText(/Read\s+12 Aug,/)).toBeInTheDocument();
    expect(screen.getByText("Job: REF-A • On Delivery")).toBeInTheDocument();
    expect(screen.getByText("Latest: DELAYED - Traffic")).toBeInTheDocument();
    expect(screen.getAllByText(/OK/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/DELAYED - Traffic/).length).toBeGreaterThan(0);
  });

  it("realtime callback refreshes selected driver communication", async () => {
    render(<DriverCommunicationsPanel />);

    await screen.findByRole("heading", { name: "Driver A" });
    const before = fetchMock.mock.calls.filter(([first, init]) => String(first).includes("/api/operations/driver-instructions?") && (init as RequestInit | undefined)?.method === "GET").length;

    expect(realtimeState.callback).toBeTruthy();
    realtimeState.callback?.();

    await waitFor(() => {
      const after = fetchMock.mock.calls.filter(([first, init]) => String(first).includes("/api/operations/driver-instructions?") && (init as RequestInit | undefined)?.method === "GET").length;
      expect(after).toBeGreaterThan(before);
    });
  });

  it("realtime refetch uses current session token and does not hard-cache token", async () => {
    getSessionTokenMock.mockReset();
    getSessionTokenMock
      .mockResolvedValueOnce("token-a")
      .mockResolvedValueOnce("token-b")
      .mockResolvedValue("token-b");

    render(<DriverCommunicationsPanel />);

    await screen.findByRole("heading", { name: "Driver A" });
    realtimeState.callback?.();

    await waitFor(() => {
      expect(getSessionTokenMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    const getCalls = fetchMock.mock.calls.filter(([first, init]) => String(first).includes("/api/operations/driver-instructions?") && (init as RequestInit | undefined)?.method === "GET");
    expect((getCalls[0]?.[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer token-a" });
    expect((getCalls[getCalls.length - 1]?.[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer token-b" });
  });

  it("handles missing or expired session safely", async () => {
    getSessionTokenMock.mockRejectedValueOnce(new Error(SESSION_EXPIRED_MESSAGE));

    render(<DriverCommunicationsPanel />);

    expect(await screen.findByText(SESSION_EXPIRED_MESSAGE)).toBeInTheDocument();
  });

  it("normalizes 401 auth-session API error and avoids raw internal token message", async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "Invalid authentication token: Auth session missing!" }),
    }));

    render(<DriverCommunicationsPanel />);

    expect(await screen.findByText(SESSION_EXPIRED_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid authentication token: Auth session missing!/i)).not.toBeInTheDocument();
  });

  it("blocks unauthorized driver role", async () => {
    userState.roleKey = "driver";

    render(<DriverCommunicationsPanel />);

    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    expect(screen.getByText("You do not have permission to access Driver Communications.")).toBeInTheDocument();
  });
});
