import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteBearerTokenMock = vi.fn();
const createAuthenticatedRouteSupabaseClientMock = vi.fn();
const requireAuthenticatedRouteUserMock = vi.fn();
const bootstrapCurrentUserRoleMock = vi.fn();
const requireRbacPermissionMock = vi.fn();
const listUsersWithRolesMock = vi.fn();
const updateUserRoleMock = vi.fn();

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

vi.mock("@/lib/rbac/service", () => ({
  listUsersWithRoles: listUsersWithRolesMock,
  updateUserRole: updateUserRoleMock,
}));

const importRoute = async () => import("@/app/api/settings/users/route");

const makeRequest = (method: "GET" | "PATCH", body?: unknown) =>
  new Request("http://localhost/api/settings/users", {
    method,
    headers: {
      Authorization: "Bearer test-token",
      ...(method === "PATCH" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "PATCH" ? JSON.stringify(body ?? {}) : undefined,
  });

describe("/api/settings/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getRouteBearerTokenMock.mockReturnValue("test-token");
    createAuthenticatedRouteSupabaseClientMock.mockReturnValue({});
    requireAuthenticatedRouteUserMock.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      email: "admin@example.com",
      user_metadata: { full_name: "Admin One" },
    });
    bootstrapCurrentUserRoleMock.mockResolvedValue(undefined);
    requireRbacPermissionMock.mockResolvedValue(undefined);
    listUsersWithRolesMock.mockResolvedValue([
      {
        userId: "22222222-2222-4222-8222-222222222222",
        email: "driver@example.com",
        displayName: "Driver One",
        roleKey: "driver",
        isActive: true,
        lastSignInAt: "2026-08-12T10:00:00.000Z",
        driverLinked: true,
      },
    ]);
    updateUserRoleMock.mockResolvedValue({
      user: {
        user_id: "22222222-2222-4222-8222-222222222222",
        email: "driver@example.com",
        display_name: "Driver One",
        role_key: "driver",
        is_active: true,
        created_at: "2026-08-12T10:00:00.000Z",
        updated_at: "2026-08-12T10:00:00.000Z",
      },
      auditEvent: {
        userId: "22222222-2222-4222-8222-222222222222",
        previousRole: "operator",
        newRole: "driver",
        previousIsActive: true,
        newIsActive: true,
        changedBy: "admin-a",
        changedAt: "2026-08-12T10:00:00.000Z",
      },
    });
  });

  it("rejects unauthenticated role promotion requests", async () => {
    getRouteBearerTokenMock.mockImplementationOnce(() => {
      throw new SupabaseRouteAuthError("Missing Authorization header.", 401);
    });

    const { PATCH } = await importRoute();
    const response = await PATCH(makeRequest("PATCH", { userId: "22222222-2222-4222-8222-222222222222", roleKey: "driver" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Missing Authorization header." });
  });

  it("rejects unauthenticated list requests", async () => {
    getRouteBearerTokenMock.mockImplementationOnce(() => {
      throw new SupabaseRouteAuthError("Missing Authorization header.", 401);
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest("GET"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Missing Authorization header." });
  });

  it("rejects non-admin list requests", async () => {
    requireRbacPermissionMock.mockImplementationOnce(() => {
      throw new RbacPermissionError("You do not have permission to perform this action.", 403);
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest("GET"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "You do not have permission to perform this action." });
  });

  it("returns merged users list for authorized callers", async () => {
    const { GET } = await importRoute();
    const response = await GET(makeRequest("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      users: [
        {
          userId: "22222222-2222-4222-8222-222222222222",
          email: "driver@example.com",
          displayName: "Driver One",
          roleKey: "driver",
          isActive: true,
          lastSignInAt: "2026-08-12T10:00:00.000Z",
          driverLinked: true,
        },
      ],
    });
    expect(listUsersWithRolesMock).toHaveBeenCalledWith({});
  });

  it("rejects non-admin callers", async () => {
    requireRbacPermissionMock.mockImplementationOnce(() => {
      throw new RbacPermissionError("You do not have permission to perform this action.", 403);
    });

    const { PATCH } = await importRoute();
    const response = await PATCH(makeRequest("PATCH", { userId: "22222222-2222-4222-8222-222222222222", roleKey: "driver" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "You do not have permission to perform this action." });
  });

  it("strips spoofed identity fields from the incoming payload", async () => {
    const { PATCH } = await importRoute();
    const response = await PATCH(
      makeRequest("PATCH", {
        userId: "22222222-2222-4222-8222-222222222222",
        roleKey: "driver",
        email: "spoof@example.com",
        displayName: "Spoofed Name",
      }),
    );

    expect(response.status).toBe(200);
    expect(updateUserRoleMock).toHaveBeenCalledWith(
      {},
      {
        userId: "22222222-2222-4222-8222-222222222222",
        roleKey: "driver",
        changedBy: "11111111-1111-4111-8111-111111111111",
      },
    );
  });

  it("returns the updated role payload after successful promotion", async () => {
    const { PATCH } = await importRoute();
    const response = await PATCH(makeRequest("PATCH", { userId: "22222222-2222-4222-8222-222222222222", roleKey: "driver" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: { user_id: "22222222-2222-4222-8222-222222222222", role_key: "driver" },
      auditEvent: { newRole: "driver" },
    });
  });

  it("passes explicit driver-link requests through the validated payload", async () => {
    const { PATCH } = await importRoute();
    const response = await PATCH(
      makeRequest("PATCH", {
        userId: "22222222-2222-4222-8222-222222222222",
        roleKey: "administrator",
        linkDriverProfile: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(updateUserRoleMock).toHaveBeenCalledWith(
      {},
      {
        userId: "22222222-2222-4222-8222-222222222222",
        roleKey: "administrator",
        linkDriverProfile: true,
        changedBy: "11111111-1111-4111-8111-111111111111",
      },
    );
  });

  it("surfaces provisioning failures as clear API errors", async () => {
    updateUserRoleMock.mockRejectedValueOnce(new Error("Unable to provision driver profile."));

    const { PATCH } = await importRoute();
    const response = await PATCH(makeRequest("PATCH", { userId: "22222222-2222-4222-8222-222222222222", roleKey: "driver" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Unable to provision driver profile." });
  });
});
