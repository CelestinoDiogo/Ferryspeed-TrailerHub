import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteBearerTokenMock = vi.fn();
const createAuthenticatedRouteSupabaseClientMock = vi.fn();
const requireAuthenticatedRouteUserMock = vi.fn();
const bootstrapCurrentUserRoleMock = vi.fn();
const requireRbacPermissionMock = vi.fn();
const listRolesMock = vi.fn();

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

vi.mock("@/lib/rbac/service", () => ({
  listRoles: listRolesMock,
  updateRole: vi.fn(),
}));

const importRoute = async () => import("@/app/api/settings/roles/route");

const makeRequest = () =>
  new Request("http://localhost/api/settings/roles", {
    method: "GET",
    headers: {
      Authorization: "Bearer test-token",
    },
  });

describe("GET /api/settings/roles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRouteBearerTokenMock.mockReturnValue("test-token");
    createAuthenticatedRouteSupabaseClientMock.mockReturnValue({});
    requireAuthenticatedRouteUserMock.mockResolvedValue({ id: "user-admin" });
    bootstrapCurrentUserRoleMock.mockResolvedValue(undefined);
    requireRbacPermissionMock.mockResolvedValue(undefined);
    listRolesMock.mockResolvedValue([
      {
        role_key: "administrator",
        label: "Administrator",
      },
    ]);
  });

  it("allows active administrator to read roles", async () => {
    const { GET } = await importRoute();
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      roles: [{ role_key: "administrator", label: "Administrator" }],
    });
  });

  it("returns structured inactive-profile denial", async () => {
    requireRbacPermissionMock.mockImplementationOnce(() => {
      throw new RbacPermissionError("Your application profile is inactive.", 403, "RBAC_PROFILE_INACTIVE");
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Your application profile is inactive.",
      code: "RBAC_PROFILE_INACTIVE",
    });
  });

  it("returns unauthenticated when auth token is missing", async () => {
    getRouteBearerTokenMock.mockImplementationOnce(() => {
      throw new SupabaseRouteAuthError("Missing Authorization header.", 401);
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Missing Authorization header.",
      code: "UNAUTHENTICATED",
    });
  });
});
