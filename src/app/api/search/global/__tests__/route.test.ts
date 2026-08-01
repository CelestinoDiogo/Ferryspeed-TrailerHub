import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteBearerTokenMock = vi.fn();
const createAuthenticatedRouteSupabaseClientMock = vi.fn();
const requireAuthenticatedRouteUserMock = vi.fn();
const searchGlobalIndexMock = vi.fn();

class SupabaseRouteAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
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

vi.mock("@/lib/search/global-search", async () => {
  const actual = await vi.importActual<typeof import("@/lib/search/global-search")>("@/lib/search/global-search");
  return {
    ...actual,
    searchGlobalIndex: searchGlobalIndexMock,
  };
});

const importRoute = async () => import("@/app/api/search/global/route");

describe("GET /api/search/global", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRouteBearerTokenMock.mockReturnValue("test-token");
    createAuthenticatedRouteSupabaseClientMock.mockReturnValue({});
    requireAuthenticatedRouteUserMock.mockResolvedValue({ id: "user-1" });
    searchGlobalIndexMock.mockResolvedValue({
      query: "pfc",
      normalizedQuery: "pfc",
      limit: 20,
      offset: 0,
      totalMatched: 1,
      hasMore: false,
      results: [],
      groups: [],
    });
  });

  it("rejects invalid query parameters", async () => {
    const { GET } = await importRoute();
    const response = await GET(new Request("http://localhost/api/search/global?limit=20&offset=0"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid global search query." });
  });

  it("rejects unauthenticated access", async () => {
    getRouteBearerTokenMock.mockImplementation(() => {
      throw new SupabaseRouteAuthError("Missing Authorization header.", 401);
    });

    const { GET } = await importRoute();
    const response = await GET(new Request("http://localhost/api/search/global?q=pfc"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Missing Authorization header." });
  });

  it("returns successful search payload for authenticated request", async () => {
    const { GET } = await importRoute();
    const response = await GET(new Request("http://localhost/api/search/global?q=pfc123&limit=20&offset=0", {
      headers: {
        Authorization: "Bearer test-token",
      },
    }));

    expect(response.status).toBe(200);
    expect(searchGlobalIndexMock).toHaveBeenCalledWith({}, {
      query: "pfc123",
      limit: 20,
      offset: 0,
    });
  });
});
