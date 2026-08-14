import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteBearerTokenMock = vi.fn();
const createAuthenticatedRouteSupabaseClientMock = vi.fn();
const requireAuthenticatedRouteUserMock = vi.fn();
const bootstrapCurrentUserRoleMock = vi.fn();
const requireRbacPermissionMock = vi.fn();
const listOperationalInstructionContextForManagerMock = vi.fn();
const sendDriverOperationalInstructionMock = vi.fn();

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
  DRIVER_INSTRUCTION_MAX_LENGTH: 180,
  listOperationalInstructionContextForManager: listOperationalInstructionContextForManagerMock,
  sendDriverOperationalInstruction: sendDriverOperationalInstructionMock,
}));

const importRoute = async () => import("@/app/api/operations/driver-instructions/route");

const makeGetRequest = (query: string) =>
  new Request(`http://localhost/api/operations/driver-instructions${query}`, {
    method: "GET",
    headers: {
      Authorization: "Bearer test-token",
    },
  });

const makePostRequest = (body: unknown) =>
  new Request("http://localhost/api/operations/driver-instructions", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("/api/operations/driver-instructions", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getRouteBearerTokenMock.mockReturnValue("test-token");
    createAuthenticatedRouteSupabaseClientMock.mockReturnValue({});
    requireAuthenticatedRouteUserMock.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      email: "ops@example.com",
      user_metadata: { full_name: "Ops One" },
    });
    bootstrapCurrentUserRoleMock.mockResolvedValue(undefined);
    requireRbacPermissionMock.mockResolvedValue(undefined);
    listOperationalInstructionContextForManagerMock.mockResolvedValue({
      instructions: [],
      latestResponse: null,
      latestException: null,
      timeline: [],
    });
    sendDriverOperationalInstructionMock.mockResolvedValue({ id: "instruction-a" });
  });

  it("returns context history on GET", async () => {
    const { GET } = await importRoute();
    const response = await GET(
      makeGetRequest("?driverId=22222222-2222-4222-8222-222222222222&deliveryBookingId=33333333-3333-4333-8333-333333333333&limit=8"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      instructions: [],
      latestResponse: null,
      latestException: null,
      timeline: [],
    });
    expect(listOperationalInstructionContextForManagerMock).toHaveBeenCalledWith(
      {},
      {
        userId: "11111111-1111-4111-8111-111111111111",
        driverId: "22222222-2222-4222-8222-222222222222",
        deliveryBookingId: "33333333-3333-4333-8333-333333333333",
        trailerId: undefined,
        limit: 8,
      },
    );
  });

  it("rejects unauthenticated send requests", async () => {
    getRouteBearerTokenMock.mockImplementationOnce(() => {
      throw new SupabaseRouteAuthError("Missing Authorization header.", 401);
    });

    const { POST } = await importRoute();
    const response = await POST(makePostRequest({}));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Missing Authorization header." });
  });

  it("rejects unauthorized sender roles", async () => {
    requireRbacPermissionMock.mockImplementationOnce(() => {
      throw new RbacPermissionError("You do not have permission to perform this action.", 403);
    });

    const { POST } = await importRoute();
    const response = await POST(
      makePostRequest({
        driverId: "22222222-2222-4222-8222-222222222222",
        instruction: "Proceed directly to loading lane A.",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "You do not have permission to perform this action." });
  });

  it("returns 400 for invalid send payload", async () => {
    const { POST } = await importRoute();
    const response = await POST(makePostRequest({ driverId: "bad", instruction: "x" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid send-instruction payload." });
  });

  it("rejects empty instruction payload", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      makePostRequest({
        driverId: "22222222-2222-4222-8222-222222222222",
        instruction: "   ",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid send-instruction payload." });
  });

  it("rejects instruction payloads above 180 characters", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      makePostRequest({
        driverId: "22222222-2222-4222-8222-222222222222",
        instruction: "X".repeat(181),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid send-instruction payload." });
  });

  it("maps invalid or inactive driver context errors from service", async () => {
    sendDriverOperationalInstructionMock.mockRejectedValueOnce(new Error("Driver was not found or is not linked to a user account."));

    const { POST } = await importRoute();
    const response = await POST(
      makePostRequest({
        driverId: "22222222-2222-4222-8222-222222222222",
        instruction: "Proceed directly to loading lane A.",
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Driver was not found or is not linked to a user account." });
  });

  it("maps booking-driver mismatch errors from service", async () => {
    sendDriverOperationalInstructionMock.mockRejectedValueOnce(new Error("Trailer context does not match the selected delivery booking."));

    const { POST } = await importRoute();
    const response = await POST(
      makePostRequest({
        driverId: "22222222-2222-4222-8222-222222222222",
        deliveryBookingId: "33333333-3333-4333-8333-333333333333",
        trailerId: "44444444-4444-4444-8444-444444444444",
        instruction: "Proceed directly to loading lane A.",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Trailer context does not match the selected delivery booking." });
  });

  it("does not allow sender spoofing fields in request payload", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      makePostRequest({
        driverId: "22222222-2222-4222-8222-222222222222",
        instruction: "Proceed directly to loading lane A.",
        sender_user_id: "99999999-9999-4999-8999-999999999999",
      }),
    );

    expect(response.status).toBe(200);
    expect(sendDriverOperationalInstructionMock).toHaveBeenCalledWith(
      {},
      {
        driverId: "22222222-2222-4222-8222-222222222222",
        deliveryBookingId: undefined,
        trailerId: undefined,
        trailerNumber: undefined,
        instruction: "Proceed directly to loading lane A.",
        priority: undefined,
      },
      {
        id: "11111111-1111-4111-8111-111111111111",
        email: "ops@example.com",
        user_metadata: { full_name: "Ops One" },
      },
    );
  });

  it("sends instruction as authenticated operator", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      makePostRequest({
        driverId: "22222222-2222-4222-8222-222222222222",
        deliveryBookingId: "33333333-3333-4333-8333-333333333333",
        trailerId: "44444444-4444-4444-8444-444444444444",
        trailerNumber: "FS-1234",
        instruction: "Proceed directly to loading lane A.",
        priority: "normal",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, instruction: { id: "instruction-a" } });
    expect(sendDriverOperationalInstructionMock).toHaveBeenCalledWith(
      {},
      {
        driverId: "22222222-2222-4222-8222-222222222222",
        deliveryBookingId: "33333333-3333-4333-8333-333333333333",
        trailerId: "44444444-4444-4444-8444-444444444444",
        trailerNumber: "FS-1234",
        instruction: "Proceed directly to loading lane A.",
        priority: "normal",
      },
      {
        id: "11111111-1111-4111-8111-111111111111",
        email: "ops@example.com",
        user_metadata: { full_name: "Ops One" },
      },
    );
  });
});
