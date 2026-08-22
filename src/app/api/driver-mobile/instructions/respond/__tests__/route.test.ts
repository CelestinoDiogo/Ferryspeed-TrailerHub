import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteBearerTokenMock = vi.fn();
const createAuthenticatedRouteSupabaseClientMock = vi.fn();
const requireAuthenticatedRouteUserMock = vi.fn();
const bootstrapCurrentUserRoleMock = vi.fn();
const requireDriverMobileWriteAccessMock = vi.fn();
const createDriverOperationalInstructionResponseMock = vi.fn();

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

class DriverMobileIdentityError extends Error {
  status: number;
  code: string;

  constructor(message: string, code: string, status = 403) {
    super(message);
    this.name = "DriverMobileIdentityError";
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
}));

vi.mock("@/lib/driver-mobile-read-access", () => ({
  requireDriverMobileWriteAccess: requireDriverMobileWriteAccessMock,
}));

vi.mock("@/lib/driver-mobile-identity", () => ({
  DriverMobileIdentityError,
}));

vi.mock("@/lib/driver-operational-instructions", () => ({
  DRIVER_RESPONSE_NOTE_MAX_LENGTH: 120,
  createDriverOperationalInstructionResponse: createDriverOperationalInstructionResponseMock,
}));

const importRoute = async () => import("@/app/api/driver-mobile/instructions/respond/route");

const makeRequest = (body: unknown) =>
  new Request("http://localhost/api/driver-mobile/instructions/respond", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("POST /api/driver-mobile/instructions/respond", () => {
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
    requireDriverMobileWriteAccessMock.mockResolvedValue({ role_key: "driver", is_active: true });
    createDriverOperationalInstructionResponseMock.mockResolvedValue({
      id: "event-1",
      responseType: "ok",
      createdAt: "2026-08-12T16:30:00.000Z",
    });
  });

  it("rejects unauthenticated requests", async () => {
    getRouteBearerTokenMock.mockImplementationOnce(() => {
      throw new SupabaseRouteAuthError("Missing Authorization header.", 401);
    });

    const { POST } = await importRoute();
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Missing Authorization header." });
  });

  it("allows driver responses to own instruction", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      makeRequest({
        instructionId: "22222222-2222-4222-8222-222222222222",
        responseType: "OK",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, response: { id: "event-1" } });
    expect(createDriverOperationalInstructionResponseMock).toHaveBeenCalledWith(
      {},
      "11111111-1111-4111-8111-111111111111",
      {
        instructionId: "22222222-2222-4222-8222-222222222222",
        responseType: "ok",
        note: undefined,
      },
    );
  });

  it("blocks responses to another driver's instruction", async () => {
    createDriverOperationalInstructionResponseMock.mockRejectedValueOnce(
      new Error("Instruction not found for the authenticated driver."),
    );

    const { POST } = await importRoute();
    const response = await POST(
      makeRequest({
        instructionId: "33333333-3333-4333-8333-333333333333",
        responseType: "ARRIVED",
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Instruction not found for the authenticated driver." });
  });

  it("rejects spoofed driver identifiers in payload", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      makeRequest({
        instructionId: "22222222-2222-4222-8222-222222222222",
        responseType: "OK",
        driver_id: "44444444-4444-4444-8444-444444444444",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid instruction response payload." });
    expect(createDriverOperationalInstructionResponseMock).not.toHaveBeenCalled();
  });

  it("rejects invalid response types", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      makeRequest({
        instructionId: "22222222-2222-4222-8222-222222222222",
        responseType: "LATER",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid instruction response payload." });
  });

  it("accepts optional note for exception responses", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      makeRequest({
        instructionId: "22222222-2222-4222-8222-222222222222",
        responseType: "DELAYED",
        note: "Traffic at St Peter Port",
      }),
    );

    expect(response.status).toBe(200);
    expect(createDriverOperationalInstructionResponseMock).toHaveBeenCalledWith(
      {},
      "11111111-1111-4111-8111-111111111111",
      {
        instructionId: "22222222-2222-4222-8222-222222222222",
        responseType: "delayed",
        note: "Traffic at St Peter Port",
      },
    );
  });
});
