import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteBearerTokenMock = vi.fn();
const createAuthenticatedRouteSupabaseClientMock = vi.fn();
const requireAuthenticatedRouteUserMock = vi.fn();
const bootstrapCurrentUserRoleMock = vi.fn();
const requireRbacPermissionMock = vi.fn();
const requireDriverMobileReadAccessMock = vi.fn();
const resolveDriverMobileReadContextMock = vi.fn();
const loadDriverMobileTasksForDriverMock = vi.fn();

class SupabaseRouteAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

class RbacPermissionError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 403, code = "RBAC_PERMISSION_DENIED") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class DriverMobileIdentityError extends Error {
  status: number;
  code: string;

  constructor(message: string, code: string, status = 400) {
    super(message);
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
  requireRbacPermission: requireRbacPermissionMock,
}));

vi.mock("@/lib/driver-mobile-service", () => ({
  loadDriverMobileTasksForDriver: loadDriverMobileTasksForDriverMock,
}));

vi.mock("@/lib/driver-mobile-identity", () => ({
  DriverMobileIdentityError,
  resolveDriverMobileReadContext: resolveDriverMobileReadContextMock,
}));

vi.mock("@/lib/driver-mobile-read-access", () => ({
  requireDriverMobileReadAccess: requireDriverMobileReadAccessMock,
}));

const importRoute = async () => import("@/app/api/driver-mobile/tasks/route");

const makeRequest = () =>
  new Request("http://localhost/api/driver-mobile/tasks", {
    method: "GET",
    headers: {
      Authorization: "Bearer test-token",
    },
  });

const makeRequestWithPreview = () =>
  new Request("http://localhost/api/driver-mobile/tasks?previewDriverId=22222222-2222-4222-8222-222222222222", {
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
    requireDriverMobileReadAccessMock.mockResolvedValue({ role_key: "driver", is_active: true });
    resolveDriverMobileReadContextMock.mockResolvedValue({
      roleKey: "driver",
      isPreview: false,
      driver: {
        id: "driver-a",
        display_name: "Driver One",
        user_id: "11111111-1111-4111-8111-111111111111",
      },
    });
    loadDriverMobileTasksForDriverMock.mockResolvedValue({
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
    requireDriverMobileReadAccessMock.mockImplementation(() => {
      throw new RbacPermissionError("You do not have permission to perform this action.", 403);
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "You do not have permission to perform this action.", code: "RBAC_PERMISSION_DENIED" });
  });

  it("returns 403 with inactive-profile code when application profile is inactive", async () => {
    requireDriverMobileReadAccessMock.mockImplementation(() => {
      throw new RbacPermissionError("Your application profile is inactive.", 403, "RBAC_PROFILE_INACTIVE");
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Your application profile is inactive.", code: "RBAC_PROFILE_INACTIVE" });
  });

  it("returns scoped task payload for the authenticated driver", async () => {
    loadDriverMobileTasksForDriverMock.mockResolvedValue({
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
    expect(requireDriverMobileReadAccessMock).toHaveBeenCalledWith({}, "11111111-1111-4111-8111-111111111111");
  });

  it("passes explicit preview selection through the server identity boundary", async () => {
    resolveDriverMobileReadContextMock.mockResolvedValueOnce({
      roleKey: "administrator",
      isPreview: true,
      driver: { id: "driver-b", display_name: "Driver B", user_id: "driver-user-b" },
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequestWithPreview());

    expect(response.status).toBe(200);
    expect(resolveDriverMobileReadContextMock).toHaveBeenCalledWith(
      {},
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    );
    expect(loadDriverMobileTasksForDriverMock).toHaveBeenCalledWith({}, expect.objectContaining({ id: "driver-b" }));
    await expect(response.json()).resolves.toMatchObject({ mode: "preview", readOnly: true });
  });

  it("returns structured preview-selection state", async () => {
    resolveDriverMobileReadContextMock.mockRejectedValueOnce(
      new DriverMobileIdentityError("Select a Driver to preview Driver Mobile.", "PREVIEW_DRIVER_REQUIRED"),
    );

    const { GET } = await importRoute();
    const response = await GET(makeRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Select a Driver to preview Driver Mobile.",
      code: "PREVIEW_DRIVER_REQUIRED",
    });
  });

  it("rejects a malformed preview Driver identifier before data access", async () => {
    const { GET } = await importRoute();
    const response = await GET(new Request("http://localhost/api/driver-mobile/tasks?previewDriverId=invalid", {
      headers: { Authorization: "Bearer test-token" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "PREVIEW_DRIVER_INVALID" });
    expect(resolveDriverMobileReadContextMock).not.toHaveBeenCalled();
  });
});
