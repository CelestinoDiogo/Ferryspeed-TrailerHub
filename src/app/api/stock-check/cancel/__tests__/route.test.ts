import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteBearerTokenMock = vi.fn();
const createAuthenticatedRouteSupabaseClientMock = vi.fn();
const requireAuthenticatedRouteUserMock = vi.fn();
const bootstrapCurrentUserRoleMock = vi.fn();
const requireRbacPermissionMock = vi.fn();
const cancelCompoundStockCheckMock = vi.fn();

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

class StockCheckSessionError extends Error {
  status: number;
  code: string;

  constructor(message: string, code: string, status = 409) {
    super(message);
    this.name = "StockCheckSessionError";
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

vi.mock("@/lib/compound-stock-check-session", () => ({
  StockCheckSessionError,
  cancelCompoundStockCheck: cancelCompoundStockCheckMock,
}));

const importRoute = async () => import("@/app/api/stock-check/cancel/route");

const makeRequest = (body: unknown) =>
  new Request("http://localhost/api/stock-check/cancel", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });

describe("POST /api/stock-check/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRouteBearerTokenMock.mockReturnValue("test-token");
    createAuthenticatedRouteSupabaseClientMock.mockReturnValue({});
    requireAuthenticatedRouteUserMock.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      email: "operator@example.com",
      user_metadata: { full_name: "Operator One" },
    });
    bootstrapCurrentUserRoleMock.mockResolvedValue(undefined);
    requireRbacPermissionMock.mockResolvedValue(undefined);
    cancelCompoundStockCheckMock.mockResolvedValue({
      alreadyCancelled: false,
      items: [],
      stockCheck: { id: "273206eb-2cb0-4529-8f67-e5d7d8fab4f1", status: "cancelled" },
    });
  });

  it("returns 401 when authorization is missing", async () => {
    getRouteBearerTokenMock.mockImplementation(() => {
      throw new SupabaseRouteAuthError("Missing Authorization header.", 401);
    });

    const { POST } = await importRoute();
    const response = await POST(makeRequest({ stockCheckId: "273206eb-2cb0-4529-8f67-e5d7d8fab4f1" }));
    expect(response.status).toBe(401);
  });

  it("requires stock_check edit permission", async () => {
    requireRbacPermissionMock.mockRejectedValue(new RbacPermissionError("You do not have permission to perform this action."));
    const { POST } = await importRoute();
    const response = await POST(makeRequest({ stockCheckId: "273206eb-2cb0-4529-8f67-e5d7d8fab4f1" }));
    expect(response.status).toBe(403);
    expect(requireRbacPermissionMock).toHaveBeenCalledWith(expect.anything(), expect.any(String), "stock_check", "edit");
  });

  it("closes an in-progress session", async () => {
    const { POST } = await importRoute();
    const response = await POST(makeRequest({ stockCheckId: "273206eb-2cb0-4529-8f67-e5d7d8fab4f1" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(cancelCompoundStockCheckMock).toHaveBeenCalledWith(expect.anything(), {
      stockCheckId: "273206eb-2cb0-4529-8f67-e5d7d8fab4f1",
      cancelledBy: "Operator One",
    });
  });

  it("safely returns an already cancelled session", async () => {
    cancelCompoundStockCheckMock.mockResolvedValue({
      alreadyCancelled: true,
      items: [],
      stockCheck: { id: "273206eb-2cb0-4529-8f67-e5d7d8fab4f1", status: "cancelled" },
    });
    const { POST } = await importRoute();
    const response = await POST(makeRequest({ stockCheckId: "273206eb-2cb0-4529-8f67-e5d7d8fab4f1" }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.alreadyCancelled).toBe(true);
  });

  it("rejects closing a completed historical check", async () => {
    cancelCompoundStockCheckMock.mockRejectedValue(
      new StockCheckSessionError(
        "Completed stock checks are historical and cannot be closed or changed.",
        "STOCK_CHECK_ALREADY_COMPLETED",
        409,
      ),
    );
    const { POST } = await importRoute();
    const response = await POST(makeRequest({ stockCheckId: "273206eb-2cb0-4529-8f67-e5d7d8fab4f1" }));
    expect(response.status).toBe(409);
  });
});
