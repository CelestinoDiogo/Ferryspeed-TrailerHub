import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAuthenticatedRouteUserMock, requireDriverMobileReadAccessMock, listActiveDriversMock } = vi.hoisted(() => ({
  requireAuthenticatedRouteUserMock: vi.fn(),
  requireDriverMobileReadAccessMock: vi.fn(),
  listActiveDriversMock: vi.fn(),
}));

class SupabaseRouteAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

vi.mock("@/lib/supabase-route-client", () => ({
  SupabaseRouteAuthError,
  getRouteBearerToken: () => "token",
  createAuthenticatedRouteSupabaseClient: () => ({}),
  requireAuthenticatedRouteUser: requireAuthenticatedRouteUserMock,
}));
vi.mock("@/lib/rbac/route", () => ({
  RbacPermissionError: class extends Error {},
  bootstrapCurrentUserRole: vi.fn(),
  requireRbacPermission: vi.fn(),
}));
vi.mock("@/lib/driver-access", () => ({ listActiveDrivers: listActiveDriversMock }));
vi.mock("@/lib/driver-mobile-read-access", () => ({ requireDriverMobileReadAccess: requireDriverMobileReadAccessMock }));
vi.mock("@/lib/driver-mobile-identity", () => ({
  DriverMobileIdentityError: class extends Error {
    status: number;
    code: string;
    constructor(message: string, code: string, status: number) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

const importRoute = () => import("@/app/api/driver-mobile/preview-drivers/route");
const request = () => new Request("http://localhost/api/driver-mobile/preview-drivers", { headers: { Authorization: "Bearer token" } });

describe("GET /api/driver-mobile/preview-drivers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthenticatedRouteUserMock.mockResolvedValue({ id: "manager-user" });
    listActiveDriversMock.mockResolvedValue([{ id: "driver-a", display_name: "Driver A", active: true }]);
  });

  it.each(["administrator", "supervisor"])("returns minimal active Driver fields for %s", async (roleKey) => {
    requireDriverMobileReadAccessMock.mockResolvedValue({ role_key: roleKey, is_active: true });
    const { GET } = await importRoute();
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ drivers: [{ id: "driver-a", displayName: "Driver A" }] });
  });

  it("does not expose the Driver list to Driver roles", async () => {
    requireDriverMobileReadAccessMock.mockResolvedValue({ role_key: "driver", is_active: true });
    const { GET } = await importRoute();
    const response = await GET(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "PREVIEW_NOT_ALLOWED" });
    expect(listActiveDriversMock).not.toHaveBeenCalled();
  });
});
