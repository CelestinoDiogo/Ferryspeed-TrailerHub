import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeliveryBookingAvailabilityError,
  TRAILER_ACTIVE_DELIVERY_BOOKING_CODE,
  TRAILER_ACTIVE_DELIVERY_BOOKING_MESSAGE,
} from "@/lib/delivery-booking-availability";
import {
  TRAILER_ACTIVE_EXPORT_ALLOCATION_CODE,
  TRAILER_ACTIVE_EXPORT_ALLOCATION_MESSAGE,
  TrailerJobConflictError,
} from "@/lib/trailer-job-eligibility";

const getRouteBearerTokenMock = vi.hoisted(() => vi.fn());
const createAuthenticatedRouteSupabaseClientMock = vi.hoisted(() => vi.fn());
const requireAuthenticatedRouteUserMock = vi.hoisted(() => vi.fn());
const bootstrapCurrentUserRoleMock = vi.hoisted(() => vi.fn());
const requireRbacPermissionMock = vi.hoisted(() => vi.fn());
const createDeliveryBookingIfTrailerAvailableMock = vi.hoisted(() => vi.fn());

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

vi.mock("@/lib/delivery-booking-availability", async () => {
  const actual = await vi.importActual<typeof import("@/lib/delivery-booking-availability")>(
    "@/lib/delivery-booking-availability",
  );

  return {
    ...actual,
    createDeliveryBookingIfTrailerAvailable: createDeliveryBookingIfTrailerAvailableMock,
  };
});

const importRoute = async () => import("@/app/api/deliveries/route");

const makeRequest = (body: unknown) =>
  new Request("http://localhost/api/deliveries", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("/api/deliveries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRouteBearerTokenMock.mockReturnValue("test-token");
    createAuthenticatedRouteSupabaseClientMock.mockReturnValue({ client: true });
    requireAuthenticatedRouteUserMock.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
    bootstrapCurrentUserRoleMock.mockResolvedValue(undefined);
    requireRbacPermissionMock.mockResolvedValue(undefined);
    createDeliveryBookingIfTrailerAvailableMock.mockResolvedValue({ id: "booking-new" });
  });

  it("creates a delivery booking when the trailer is not reserved", async () => {
    const { POST } = await importRoute();
    const payload = {
      trailer_id: "11111111-1111-4111-8111-111111111111",
      delivery_date: "2026-08-21",
      status: "scheduled",
    };

    const response = await POST(makeRequest(payload));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ booking: { id: "booking-new" } });
    expect(requireRbacPermissionMock).toHaveBeenCalledWith(
      { client: true },
      "11111111-1111-4111-8111-111111111111",
      "arrivals",
      "create",
    );
    expect(createDeliveryBookingIfTrailerAvailableMock).toHaveBeenCalledWith({ client: true }, payload);
  });

  it("keeps create authorization and availability checks on the server path", () => {
    const source = readFileSync(new URL("../route.ts", import.meta.url), "utf8");

    expect(source).toContain("createDeliveryBookingIfTrailerAvailable");
    expect(source).toContain("DeliveryBookingAvailabilityError");
    expect(source).toContain("TrailerJobConflictError");
    expect(source).toContain('requireRbacPermission(supabase, user.id, "arrivals", "create")');
    expect(source).not.toContain(".insert(");
  });

  it("rejects a direct attempt to double-book a trailer that already has an active delivery booking", async () => {
    createDeliveryBookingIfTrailerAvailableMock.mockRejectedValue(new DeliveryBookingAvailabilityError());

    const { POST } = await importRoute();
    const response = await POST(
      makeRequest({
        trailer_id: "11111111-1111-4111-8111-111111111111",
        delivery_date: "2026-08-21",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: TRAILER_ACTIVE_DELIVERY_BOOKING_MESSAGE,
      code: TRAILER_ACTIVE_DELIVERY_BOOKING_CODE,
    });
  });

  it("rejects a delivery booking when the trailer already has an active export allocation", async () => {
    createDeliveryBookingIfTrailerAvailableMock.mockRejectedValue(
      new TrailerJobConflictError(
        TRAILER_ACTIVE_EXPORT_ALLOCATION_CODE,
        TRAILER_ACTIVE_EXPORT_ALLOCATION_MESSAGE,
      ),
    );

    const { POST } = await importRoute();
    const response = await POST(
      makeRequest({
        trailer_id: "11111111-1111-4111-8111-111111111111",
        delivery_date: "2026-08-21",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: TRAILER_ACTIVE_EXPORT_ALLOCATION_MESSAGE,
      code: TRAILER_ACTIVE_EXPORT_ALLOCATION_CODE,
    });
  });
});
