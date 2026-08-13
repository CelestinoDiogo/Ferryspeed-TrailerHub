import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteBearerTokenMock = vi.fn();
const createAuthenticatedRouteSupabaseClientMock = vi.fn();
const requireAuthenticatedRouteUserMock = vi.fn();
const bootstrapCurrentUserRoleMock = vi.fn();
const requireRbacPermissionMock = vi.fn();
const loadDriverMobileTasksForUserMock = vi.fn();

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

vi.mock("@/lib/supabase-route-client", () => ({
  SupabaseRouteAuthError,
  getRouteBearerToken: getRouteBearerTokenMock,
  createAuthenticatedRouteSupabaseClient: createAuthenticatedRouteSupabaseClientMock,
  requireAuthenticatedRouteUser: requireAuthenticatedRouteUserMock,
}));

vi.mock("@/lib/rbac/route", () => ({
  RbacPermissionError,
  bootstrapCurrentUserRole: bootstrapCurrentUserRoleMock,
  requireRbacPermission: requireRbacPermissionMock,
}));

vi.mock("@/lib/driver-mobile-service", () => ({
  loadDriverMobileTasksForUser: loadDriverMobileTasksForUserMock,
}));

const importRoute = async () => import("@/app/api/driver-mobile/tasks/route");

const makeRequest = () =>
  new Request("http://localhost/api/driver-mobile/tasks", {
    method: "GET",
    headers: {
      Authorization: "Bearer test-token",
    },
  });

const makeRequestWithDriverQuery = () =>
  new Request("http://localhost/api/driver-mobile/tasks?driverId=driver-b", {
    method: "GET",
    headers: {
      Authorization: "Bearer test-token",
    },
  });

describe("GET /api/driver-mobile/tasks", () => {
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
    requireRbacPermissionMock.mockResolvedValue(undefined);
    loadDriverMobileTasksForUserMock.mockResolvedValue({
      driver: {
        id: "driver-a",
        display_name: "Driver One",
        user_id: "11111111-1111-4111-8111-111111111111",
      },
      tasks: [],
    });
  });

  it("returns 401 when authorization is invalid", async () => {
    getRouteBearerTokenMock.mockImplementation(() => {
      throw new SupabaseRouteAuthError("Missing Authorization header.", 401);
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Missing Authorization header.", code: "UNAUTHENTICATED" });
  });

  it("returns 403 when role permission is denied", async () => {
    requireRbacPermissionMock.mockImplementation(() => {
      throw new RbacPermissionError("You do not have permission to perform this action.", 403);
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "You do not have permission to perform this action.", code: "RBAC_PERMISSION_DENIED" });
  });

  it("returns scoped task payload for the authenticated driver", async () => {
    loadDriverMobileTasksForUserMock.mockResolvedValue({
      driver: {
        id: "driver-a",
        display_name: "Driver One",
        user_id: "11111111-1111-4111-8111-111111111111",
      },
      tasks: [
        {
          bookingId: "booking-a",
          trailerId: "trailer-a",
          trailerNumber: "FS1234",
          customer: "Customer A",
          location: "Dock 3",
          bookingReference: "BK-1",
          notes: null,
          status: "on_delivery",
          deliveryDate: "2026-08-12",
          deliveryTime: "11:00:00",
          group: "current",
          nextAction: "DELIVERED",
          deliveredAt: null,
          collectedAt: "2026-08-12T10:00:00.000Z",
          waitingCollectionSince: null,
          collectedTemperatureC: null,
          temperature: {
            required: false,
          },
        },
      ],
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      driver: { id: "driver-a" },
      tasks: [{ bookingId: "booking-a", trailerNumber: "FS1234" }],
    });
    expect(requireRbacPermissionMock).toHaveBeenCalledWith({}, "11111111-1111-4111-8111-111111111111", "driver_mobile", "view");
  });

  it("ignores any client-supplied driver query and still resolves tasks from the authenticated user", async () => {
    const { GET } = await importRoute();
    const response = await GET(makeRequestWithDriverQuery());

    expect(response.status).toBe(200);
    expect(loadDriverMobileTasksForUserMock).toHaveBeenCalledWith({}, "11111111-1111-4111-8111-111111111111");
  });
});
