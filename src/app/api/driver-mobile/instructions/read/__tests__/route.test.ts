import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteBearerTokenMock = vi.fn();
const createAuthenticatedRouteSupabaseClientMock = vi.fn();
const requireAuthenticatedRouteUserMock = vi.fn();
const bootstrapCurrentUserRoleMock = vi.fn();
const requireRbacPermissionMock = vi.fn();
const markDriverOperationalInstructionReadMock = vi.fn();

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

vi.mock("@/lib/driver-operational-instructions", () => ({
  markDriverOperationalInstructionRead: markDriverOperationalInstructionReadMock,
}));

const importRoute = async () => import("@/app/api/driver-mobile/instructions/read/route");

const makeRequest = (body: unknown) =>
  new Request("http://localhost/api/driver-mobile/instructions/read", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("POST /api/driver-mobile/instructions/read", () => {
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
    markDriverOperationalInstructionReadMock.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      readAt: "2026-08-12T10:00:00.000Z",
    });
  });

  it("returns 400 for invalid payload", async () => {
    const { POST } = await importRoute();
    const response = await POST(makeRequest({ instructionId: "bad-id" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid mark-read payload." });
  });

  it("returns 401 when user authentication fails", async () => {
    requireAuthenticatedRouteUserMock.mockRejectedValueOnce(new SupabaseRouteAuthError("Authentication session is invalid.", 401));

    const { POST } = await importRoute();
    const response = await POST(makeRequest({ instructionId: "22222222-2222-4222-8222-222222222222" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication session is invalid." });
  });

  it("returns structured inactive-profile denial", async () => {
    requireRbacPermissionMock.mockImplementationOnce(() => {
      throw new RbacPermissionError("Your application profile is inactive.", 403, "RBAC_PROFILE_INACTIVE");
    });

    const { POST } = await importRoute();
    const response = await POST(makeRequest({ instructionId: "22222222-2222-4222-8222-222222222222" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Your application profile is inactive.",
      code: "RBAC_PROFILE_INACTIVE",
    });
  });

  it("returns 404 when instruction is missing", async () => {
    markDriverOperationalInstructionReadMock.mockRejectedValue(new Error("Instruction not found."));

    const { POST } = await importRoute();
    const response = await POST(makeRequest({ instructionId: "22222222-2222-4222-8222-222222222222" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Instruction not found." });
  });

  it("returns 404 when instruction belongs to another driver", async () => {
    markDriverOperationalInstructionReadMock.mockRejectedValueOnce(new Error("Operational instruction 22222222-2222-4222-8222-222222222222 was not found for the authenticated driver."));

    const { POST } = await importRoute();
    const response = await POST(makeRequest({ instructionId: "22222222-2222-4222-8222-222222222222" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Operational instruction 22222222-2222-4222-8222-222222222222 was not found for the authenticated driver." });
  });

  it("marks instruction as read for authenticated driver", async () => {
    const { POST } = await importRoute();
    const response = await POST(makeRequest({ instructionId: "22222222-2222-4222-8222-222222222222" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(markDriverOperationalInstructionReadMock).toHaveBeenCalledWith({}, { instructionId: "22222222-2222-4222-8222-222222222222" });
  });

  it("accepts repeated mark-read calls (idempotent route behavior)", async () => {
    markDriverOperationalInstructionReadMock.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      readAt: "2026-08-12T10:00:00.000Z",
      readBy: "11111111-1111-4111-8111-111111111111",
    });

    const { POST } = await importRoute();
    const first = await POST(makeRequest({ instructionId: "22222222-2222-4222-8222-222222222222" }));
    const second = await POST(makeRequest({ instructionId: "22222222-2222-4222-8222-222222222222" }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(markDriverOperationalInstructionReadMock).toHaveBeenCalledTimes(2);
  });

  it("ignores client-supplied read attribution fields", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      makeRequest({
        instructionId: "22222222-2222-4222-8222-222222222222",
        readBy: "99999999-9999-4999-8999-999999999999",
        readAt: "2026-08-12T12:00:00.000Z",
      }),
    );

    expect(response.status).toBe(200);
    expect(markDriverOperationalInstructionReadMock).toHaveBeenCalledWith(
      {},
      { instructionId: "22222222-2222-4222-8222-222222222222" },
    );
  });
});
