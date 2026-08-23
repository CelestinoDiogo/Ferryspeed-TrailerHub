import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeStockCheckMutationMock = vi.fn();
const recordStockCheckFindingMock = vi.fn();
const resolveStockCheckDiscrepancyMock = vi.fn();
const completeCompoundStockCheckMock = vi.fn();

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

class StockCheckFindingError extends Error {
  status: number;
  code: string;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "StockCheckFindingError";
    this.status = status;
    this.code = code;
  }
}

class StockCheckResolutionError extends Error {
  status: number;
  code: string;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "StockCheckResolutionError";
    this.status = status;
    this.code = code;
  }
}

vi.mock("@/lib/supabase-route-client", () => ({
  SupabaseRouteAuthError,
}));

vi.mock("@/lib/rbac/route", () => ({
  RbacPermissionError,
}));

vi.mock("@/lib/compound-stock-check-session", () => ({
  StockCheckSessionError,
  completeCompoundStockCheck: completeCompoundStockCheckMock,
}));

vi.mock("@/lib/compound-stock-check-route-auth", () => ({
  authorizeStockCheckMutation: authorizeStockCheckMutationMock,
}));

vi.mock("@/lib/compound-stock-check-unexpected", () => ({
  StockCheckFindingError,
  recordStockCheckFinding: recordStockCheckFindingMock,
}));

vi.mock("@/lib/compound-stock-check-resolution", () => ({
  STOCK_CHECK_RESOLUTION_ACTIONS: [
    "update_compound_position",
    "update_load_status",
    "return_to_main_list",
    "confirm_compound_presence",
    "keep_unresolved",
    "create_trailer",
  ],
  StockCheckResolutionError,
  resolveStockCheckDiscrepancy: resolveStockCheckDiscrepancyMock,
}));

const STOCK_CHECK_ID = "273206eb-2cb0-4529-8f67-e5d7d8fab4f1";
const ITEM_ID = "a1b2c3d4-e5f6-4111-8111-111111111111";

const makeRequest = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });

describe("stock check unexpected and resolution routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeStockCheckMutationMock.mockResolvedValue({
      supabase: {},
      operatorName: "Operator One",
      roleKey: "supervisor",
    });
    recordStockCheckFindingMock.mockResolvedValue({
      kind: "unexpected",
      unknownTrailer: false,
      trailerCreated: false,
      expectedTotal: 49,
      unexpectedTotal: 1,
      positionConflict: { trailerNumber: "PRO815" },
    });
    resolveStockCheckDiscrepancyMock.mockResolvedValue({
      unexpectedPreserved: true,
      repeated: false,
    });
    completeCompoundStockCheckMock.mockResolvedValue({
      alreadyCompleted: false,
      unresolvedCount: 2,
      stockCheck: { id: STOCK_CHECK_ID, status: "completed" },
    });
  });

  it("lets an authorized operator record an unexpected finding", async () => {
    const { POST } = await import("@/app/api/stock-check/unexpected/route");
    const response = await POST(
      makeRequest("http://localhost/api/stock-check/unexpected", {
        stockCheckId: STOCK_CHECK_ID,
        trailerNumber: "PFC99",
        actualPosition: "P32",
        physicalLoad: "loaded",
      }),
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.expectedTotal).toBe(49);
    expect(payload.unexpectedTotal).toBe(1);
    expect(payload.trailerCreated).toBe(false);
    expect(recordStockCheckFindingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trailerNumber: "PFC99",
        actualPosition: "P32",
        physicalLoad: "loaded",
        operatorName: "Operator One",
      }),
    );
  });

  it("blocks a driver from adding an unexpected trailer", async () => {
    authorizeStockCheckMutationMock.mockRejectedValue(
      new RbacPermissionError("Drivers cannot add unexpected trailers or resolve stock check discrepancies.", 403),
    );
    const { POST } = await import("@/app/api/stock-check/unexpected/route");
    const response = await POST(
      makeRequest("http://localhost/api/stock-check/unexpected", {
        stockCheckId: STOCK_CHECK_ID,
        trailerNumber: "PFC99",
        actualPosition: "P32",
        physicalLoad: "empty",
      }),
    );
    expect(response.status).toBe(403);
    expect(recordStockCheckFindingMock).not.toHaveBeenCalled();
  });

  it("blocks a driver from resolving a discrepancy", async () => {
    authorizeStockCheckMutationMock.mockRejectedValue(
      new RbacPermissionError("Drivers cannot add unexpected trailers or resolve stock check discrepancies.", 403),
    );
    const { POST } = await import("@/app/api/stock-check/resolve/route");
    const response = await POST(
      makeRequest("http://localhost/api/stock-check/resolve", {
        stockCheckId: STOCK_CHECK_ID,
        itemId: ITEM_ID,
        action: "update_compound_position",
      }),
    );
    expect(response.status).toBe(403);
    expect(resolveStockCheckDiscrepancyMock).not.toHaveBeenCalled();
  });

  it("lets desktop resolve without rewriting the unexpected historical count", async () => {
    const { POST } = await import("@/app/api/stock-check/resolve/route");
    const response = await POST(
      makeRequest("http://localhost/api/stock-check/resolve", {
        stockCheckId: STOCK_CHECK_ID,
        itemId: ITEM_ID,
        action: "update_compound_position",
        surface: "desktop",
      }),
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.unexpectedPreserved).toBe(true);
  });

  it("can complete a physical stock check with unresolved discrepancies", async () => {
    const { POST } = await import("@/app/api/stock-check/complete/route");
    const response = await POST(
      makeRequest("http://localhost/api/stock-check/complete", {
        stockCheckId: STOCK_CHECK_ID,
      }),
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.unresolvedCount).toBe(2);
    expect(completeCompoundStockCheckMock).toHaveBeenCalledWith(expect.anything(), {
      stockCheckId: STOCK_CHECK_ID,
      completedBy: "Operator One",
    });
  });
});
