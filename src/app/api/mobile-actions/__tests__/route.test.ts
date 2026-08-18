import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteBearerTokenMock = vi.fn();
const createAuthenticatedRouteSupabaseClientMock = vi.fn();
const requireAuthenticatedRouteUserMock = vi.fn();
const bootstrapCurrentUserRoleMock = vi.fn();
const requireRbacPermissionMock = vi.fn();
const executeMobileActionMock = vi.fn();

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

vi.mock("@/lib/mobile/mobile-actions-service", () => ({
  executeMobileAction: executeMobileActionMock,
}));

const importRoute = async () => import("@/app/api/mobile-actions/route");

const makeRequest = (body: unknown) =>
  new Request("http://localhost/api/mobile-actions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });

describe("POST /api/mobile-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getRouteBearerTokenMock.mockReturnValue("test-token");
    createAuthenticatedRouteSupabaseClientMock.mockReturnValue({});
    requireAuthenticatedRouteUserMock.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      email: "supervisor@example.com",
      user_metadata: { full_name: "Supervisor One" },
    });
    bootstrapCurrentUserRoleMock.mockResolvedValue(undefined);
    requireRbacPermissionMock.mockResolvedValue(undefined);
  });

  it("returns 401 when authorization is missing/invalid", async () => {
    getRouteBearerTokenMock.mockImplementation(() => {
      throw new SupabaseRouteAuthError("Missing Authorization header.", 401);
    });

    const { POST } = await importRoute();
    const response = await POST(makeRequest({ action: { actionType: "MARK_ARRIVED", payload: { trailerNumber: "FS1" } } }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Missing Authorization header." });
  });

  it("returns 403 for unauthorized role permission", async () => {
    requireRbacPermissionMock.mockImplementation(() => {
      throw new RbacPermissionError("You do not have permission to perform this action.", 403);
    });

    const { POST } = await importRoute();
    const response = await POST(
      makeRequest({
        actionId: "q-1",
        action: {
          actionType: "MOVE_COMPOUND_POSITION",
          payload: {
            trailerId: "11111111-1111-4111-8111-111111111111",
            targetPosition: "P12",
          },
        },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "You do not have permission to perform this action." });
  });

  it("returns 400 for invalid payload", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      makeRequest({
        action: {
          actionType: "MOVE_COMPOUND_POSITION",
          payload: {
            trailerId: "not-a-uuid",
            targetPosition: "P12",
          },
        },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid mobile action payload." });
  });

  it("handles successful arrival action", async () => {
    executeMobileActionMock.mockResolvedValue({
      ok: true,
      status: "success",
      message: "FS1234 marked as arrived.",
      retryable: false,
      updatedVesselTrailer: {
        vesselTrailerId: "22222222-2222-4222-8222-222222222222",
        trailerNumber: "FS1234",
        arrivalStatus: "arrived",
        status: "arrived",
        inspectionStartedAt: null,
        inspectionCompletedAt: null,
        hasDamage: false,
        hasTemperatureAlert: false,
      },
    });

    const { POST } = await importRoute();
    const response = await POST(
      makeRequest({
        actionId: "q-arrived",
        action: {
          actionType: "MARK_ARRIVED",
          payload: {
            vesselTrailerId: "22222222-2222-4222-8222-222222222222",
            trailerNumber: "FS1234",
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe("success");
    expect(json.actionId).toBe("q-arrived");
  });

  it("requires vessel edit permission for cancellation", async () => {
    executeMobileActionMock.mockResolvedValue({
      ok: true,
      status: "success",
      message: "FS1234 marked Cancelled.",
      retryable: false,
    });

    const { POST } = await importRoute();
    await POST(
      makeRequest({
        action: {
          actionType: "MARK_CANCELLED",
          payload: {
            vesselTrailerId: "22222222-2222-4222-8222-222222222222",
            trailerNumber: "FS1234",
          },
        },
      }),
    );

    expect(requireRbacPermissionMock).toHaveBeenCalledWith(
      expect.anything(),
      "11111111-1111-4111-8111-111111111111",
      "vessel_operations",
      "edit",
    );
  });

  it("handles idempotent arrival as success", async () => {
    executeMobileActionMock.mockResolvedValue({
      ok: true,
      status: "success",
      message: "FS1234 is already marked as arrived.",
      retryable: false,
    });

    const { POST } = await importRoute();
    const response = await POST(
      makeRequest({
        action: {
          actionType: "MARK_ARRIVED",
          payload: {
            trailerNumber: "FS1234",
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: "success",
      message: "FS1234 is already marked as arrived.",
    });
  });

  it("returns conflict with server state for occupied destination", async () => {
    executeMobileActionMock.mockResolvedValue({
      ok: false,
      status: "conflict",
      message: "Compound position P12 is already occupied.",
      retryable: false,
      conflict: {
        code: "position_occupied",
        message: "Compound position P12 is already occupied.",
        serverState: {
          targetPosition: "P12",
          currentPosition: "P08",
        },
      },
    });

    const { POST } = await importRoute();
    const response = await POST(
      makeRequest({
        action: {
          actionType: "MOVE_COMPOUND_POSITION",
          payload: {
            trailerId: "11111111-1111-4111-8111-111111111111",
            targetPosition: "P12",
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "conflict",
      conflict: {
        code: "position_occupied",
      },
    });
  });

  it("returns failed response for inspection validation errors", async () => {
    executeMobileActionMock.mockResolvedValue({
      ok: false,
      status: "failed",
      message: "Front temperature is required for this trailer.",
      retryable: false,
    });

    const { POST } = await importRoute();
    const response = await POST(
      makeRequest({
        action: {
          actionType: "COMPLETE_INSPECTION",
          payload: {
            vesselTrailerId: "22222222-2222-4222-8222-222222222222",
            trailerNumber: "FS1234",
            frontTemperature: null,
            rearTemperature: null,
            unit: "C",
            notes: "",
            damage: {
              hasDamage: false,
            },
          },
        },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      status: "failed",
      message: "Front temperature is required for this trailer.",
      retryable: false,
    });
  });
});
