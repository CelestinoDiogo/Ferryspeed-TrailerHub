import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteBearerTokenMock = vi.fn();
const createAuthenticatedRouteSupabaseClientMock = vi.fn();
const requireAuthenticatedRouteUserMock = vi.fn();
const bootstrapCurrentUserRoleMock = vi.fn();
const requireRbacPermissionMock = vi.fn();
const resolveDriverMobileReadContextMock = vi.fn();
const listDriverOperationalInstructionsForUserMock = vi.fn();
const listDriverOperationalInstructionsForPreviewMock = vi.fn();

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

vi.mock("@/lib/driver-operational-instructions", () => ({
  listDriverOperationalInstructionsForUser: listDriverOperationalInstructionsForUserMock,
}));

vi.mock("@/lib/driver-mobile-preview-instructions", () => ({
  listDriverOperationalInstructionsForPreview: listDriverOperationalInstructionsForPreviewMock,
}));

vi.mock("@/lib/driver-mobile-identity", () => ({
  DriverMobileIdentityError,
  resolveDriverMobileReadContext: resolveDriverMobileReadContextMock,
}));

const importRoute = async () => import("@/app/api/driver-mobile/instructions/route");

const makeRequest = (query = "") =>
  new Request(`http://localhost/api/driver-mobile/instructions${query}`, {
    method: "GET",
    headers: {
      Authorization: "Bearer test-token",
    },
  });

describe("GET /api/driver-mobile/instructions", () => {
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
    resolveDriverMobileReadContextMock.mockResolvedValue({
      roleKey: "driver",
      isPreview: false,
      driver: { id: "driver-a", display_name: "Driver One", user_id: "11111111-1111-4111-8111-111111111111" },
    });
    listDriverOperationalInstructionsForUserMock.mockResolvedValue({
      driver: {
        id: "driver-a",
        displayName: "Driver One",
        userId: "11111111-1111-4111-8111-111111111111",
      },
      unreadCount: 1,
      newestUnread: {
        id: "22222222-2222-4222-8222-222222222222",
        instruction: "Proceed to lane A",
      },
      recent: [{ id: "33333333-3333-4333-8333-333333333333", instruction: "Collect docs first" }],
    });
  });

  it("returns 401 for auth failures", async () => {
    getRouteBearerTokenMock.mockImplementation(() => {
      throw new SupabaseRouteAuthError("Missing Authorization header.", 401);
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Missing Authorization header.", code: "UNAUTHENTICATED" });
  });

  it("rejects unauthenticated requests", async () => {
    requireAuthenticatedRouteUserMock.mockRejectedValueOnce(new SupabaseRouteAuthError("Authentication session is invalid.", 401));

    const { GET } = await importRoute();
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication session is invalid.", code: "UNAUTHENTICATED" });
  });

  it("returns 400 for invalid query", async () => {
    const { GET } = await importRoute();
    const response = await GET(makeRequest("?limit=9999"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid instructions query." });
  });

  it("returns structured invalid-preview response for malformed Driver id", async () => {
    const { GET } = await importRoute();
    const response = await GET(makeRequest("?previewDriverId=invalid"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "The selected Driver is invalid.",
      code: "PREVIEW_DRIVER_INVALID",
    });
    expect(resolveDriverMobileReadContextMock).not.toHaveBeenCalled();
  });

  it("returns structured inactive-profile denial", async () => {
    requireRbacPermissionMock.mockImplementationOnce(() => {
      throw new RbacPermissionError("Your application profile is inactive.", 403, "RBAC_PROFILE_INACTIVE");
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Your application profile is inactive.", code: "RBAC_PROFILE_INACTIVE" });
  });

  it("returns driver-scoped instruction feed", async () => {
    const { GET } = await importRoute();
    const response = await GET(makeRequest("?limit=20"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      unreadCount: 1,
      newestUnread: { id: "22222222-2222-4222-8222-222222222222" },
      recent: [{ id: "33333333-3333-4333-8333-333333333333" }],
    });
    expect(listDriverOperationalInstructionsForUserMock).toHaveBeenCalledWith(
      {},
      "11111111-1111-4111-8111-111111111111",
      { limit: 20 },
    );
  });

  it("reads instructions only for the selected preview Driver", async () => {
    const previewDriver = { id: "driver-b", display_name: "Driver B", user_id: "driver-user-b" };
    resolveDriverMobileReadContextMock.mockResolvedValueOnce({ roleKey: "supervisor", isPreview: true, driver: previewDriver });
    listDriverOperationalInstructionsForPreviewMock.mockResolvedValueOnce({ driver: previewDriver, unreadCount: 0, newestUnread: null, recent: [] });

    const { GET } = await importRoute();
    const response = await GET(makeRequest("?limit=20&previewDriverId=22222222-2222-4222-8222-222222222222"));

    expect(response.status).toBe(200);
    expect(listDriverOperationalInstructionsForPreviewMock).toHaveBeenCalledWith({}, previewDriver, { limit: 20 });
    expect(listDriverOperationalInstructionsForUserMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ mode: "preview", readOnly: true });
  });

  it("returns structured inactive preview Driver state", async () => {
    resolveDriverMobileReadContextMock.mockRejectedValueOnce(
      new DriverMobileIdentityError("The selected Driver profile is inactive.", "PREVIEW_DRIVER_INACTIVE", 409),
    );

    const { GET } = await importRoute();
    const response = await GET(makeRequest("?previewDriverId=22222222-2222-4222-8222-222222222222"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "PREVIEW_DRIVER_INACTIVE" });
  });
});
