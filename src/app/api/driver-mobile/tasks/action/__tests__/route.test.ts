import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteBearerTokenMock = vi.fn();
const createAuthenticatedRouteSupabaseClientMock = vi.fn();
const requireAuthenticatedRouteUserMock = vi.fn();
const bootstrapCurrentUserRoleMock = vi.fn();
const requireDriverMobileWriteAccessMock = vi.fn();
const applyDriverTaskActionMock = vi.fn();

class SupabaseRouteAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

class RbacPermissionError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

class DriverMobileIdentityError extends Error {
  status: number;
  code: string;

  constructor(message: string, code: string, status = 403) {
    super(message);
    this.name = "DriverMobileIdentityError";
    this.status = status;
    this.code = code;
  }
}

vi.mock("@/lib/supabase-route-client", () => ({
  SupabaseRouteAuthError,
  getRouteBearerToken: getRouteBearerTokenMock,
  createAuthenticatedRouteSupabaseClient: createAuthenticatedRouteSupabaseClientMock,
  requireAuthenticatedRouteUser: requireAuthenticatedRouteUserMock,
}));

vi.mock("@/lib/rbac/route", () => ({
  RbacPermissionError,
  bootstrapCurrentUserRole: bootstrapCurrentUserRoleMock,
}));

vi.mock("@/lib/driver-mobile-read-access", () => ({
  requireDriverMobileWriteAccess: requireDriverMobileWriteAccessMock,
}));

vi.mock("@/lib/driver-mobile-identity", () => ({
  DriverMobileIdentityError,
}));

vi.mock("@/lib/driver-mobile-service", () => ({
  applyDriverTaskAction: applyDriverTaskActionMock,
}));

const importRoute = async () => import("@/app/api/driver-mobile/tasks/action/route");

const makeRequest = (body: unknown) =>
  new Request("http://localhost/api/driver-mobile/tasks/action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });

describe("POST /api/driver-mobile/tasks/action", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getRouteBearerTokenMock.mockReturnValue("test-token");
    createAuthenticatedRouteSupabaseClientMock.mockReturnValue({});
    requireAuthenticatedRouteUserMock.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      email: "driver@example.com",
      user_metadata: { full_name: "Driver One" },
    });
    bootstrapCurrentUserRoleMock.mockResolvedValue(undefined);
    requireDriverMobileWriteAccessMock.mockResolvedValue({ role_key: "driver", is_active: true });
    applyDriverTaskActionMock.mockResolvedValue({
      id: "booking-a",
      status: "delivered",
    });
  });

  it("returns 401 when authorization fails", async () => {
    getRouteBearerTokenMock.mockImplementation(() => {
      throw new SupabaseRouteAuthError("Missing Authorization header.", 401);
    });

    const { POST } = await importRoute();
    const response = await POST(makeRequest({ bookingId: "11111111-1111-4111-8111-111111111111", action: "DELIVERED" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Missing Authorization header." });
  });

  it("returns 400 for invalid payload", async () => {
    const { POST } = await importRoute();
    const response = await POST(makeRequest({ bookingId: "not-a-uuid", action: "INVALID" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid driver action payload." });
  });

  it("returns 409 when task transition is not eligible", async () => {
    applyDriverTaskActionMock.mockRejectedValue(new Error("Task is not eligible for the Delivered action."));

    const { POST } = await importRoute();
    const response = await POST(makeRequest({ bookingId: "11111111-1111-4111-8111-111111111111", action: "DELIVERED" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Task is not eligible for the Delivered action." });
  });

  it("returns 404 when booking is not assigned to authenticated driver", async () => {
    applyDriverTaskActionMock.mockRejectedValue(new Error("Task not found or not assigned to the authenticated driver."));

    const { POST } = await importRoute();
    const response = await POST(makeRequest({ bookingId: "11111111-1111-4111-8111-111111111111", action: "DELIVERED" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Task not found or not assigned to the authenticated driver." });
  });

  it("returns 400 when required temperature reading is missing", async () => {
    applyDriverTaskActionMock.mockRejectedValue(new Error("Temperature reading is required before marking this booking as collected."));

    const { POST } = await importRoute();
    const response = await POST(makeRequest({ bookingId: "11111111-1111-4111-8111-111111111111", action: "COLLECTED" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Temperature reading is required before marking this booking as collected." });
  });

  it("applies driver action for owned booking", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      makeRequest({
        bookingId: "11111111-1111-4111-8111-111111111111",
        action: "COLLECTED",
        temperatureC: 2.5,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      booking: {
        id: "booking-a",
        status: "delivered",
      },
    });
    expect(applyDriverTaskActionMock).toHaveBeenCalledWith({
      supabase: {},
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "driver@example.com",
        user_metadata: { full_name: "Driver One" },
      },
      bookingId: "11111111-1111-4111-8111-111111111111",
      action: "COLLECTED",
      temperatureC: 2.5,
      resultingLoadStatus: undefined,
    });
  });

  it("rejects supervisor write access server-side", async () => {
    requireDriverMobileWriteAccessMock.mockRejectedValue(
      new DriverMobileIdentityError(
        "Driver actions are available only to Driver accounts.",
        "DRIVER_ACTION_NOT_ALLOWED",
        403,
      ),
    );

    const { POST } = await importRoute();
    const response = await POST(makeRequest({
      bookingId: "11111111-1111-4111-8111-111111111111",
      action: "COLLECTED",
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Driver actions are available only to Driver accounts.",
      code: "DRIVER_ACTION_NOT_ALLOWED",
    });
    expect(applyDriverTaskActionMock).not.toHaveBeenCalled();
  });

  it("accepts acknowledged payload for owned booking", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      makeRequest({
        bookingId: "11111111-1111-4111-8111-111111111111",
        action: "ACKNOWLEDGED",
      }),
    );

    expect(response.status).toBe(200);
    expect(applyDriverTaskActionMock).toHaveBeenCalledWith({
      supabase: {},
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "driver@example.com",
        user_metadata: { full_name: "Driver One" },
      },
      bookingId: "11111111-1111-4111-8111-111111111111",
      action: "ACKNOWLEDGED",
      temperatureC: undefined,
      resultingLoadStatus: undefined,
    });
  });
});
