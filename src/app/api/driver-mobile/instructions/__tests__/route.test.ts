import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteBearerTokenMock = vi.fn();
const createAuthenticatedRouteSupabaseClientMock = vi.fn();
const requireAuthenticatedRouteUserMock = vi.fn();
const bootstrapCurrentUserRoleMock = vi.fn();
const requireRbacPermissionMock = vi.fn();
const listDriverOperationalInstructionsForUserMock = vi.fn();

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

vi.mock("@/lib/driver-operational-instructions", () => ({
  listDriverOperationalInstructionsForUser: listDriverOperationalInstructionsForUserMock,
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
});
