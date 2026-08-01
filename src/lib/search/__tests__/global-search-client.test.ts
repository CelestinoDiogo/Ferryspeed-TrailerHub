import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRbacJsonMock = vi.fn();

vi.mock("@/lib/rbac/client-fetch", () => ({
  fetchRbacJson: (...args: unknown[]) => fetchRbacJsonMock(...args),
}));

import { searchGlobal } from "@/lib/search/global-search-client";

describe("global-search client zod validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts ownership metadata payload", async () => {
    fetchRbacJsonMock.mockResolvedValue({
      query: "outsourcing",
      normalizedQuery: "outsourcing",
      limit: 20,
      offset: 0,
      totalMatched: 1,
      hasMore: false,
      results: [
        {
          id: "trailer:t-1",
          category: "trailers",
          title: "PFC200",
          subtitle: "Outsourcing Trailer",
          status: "active",
          href: "/dashboard/trailers/t-1",
          quickActionLabel: "Open trailer",
          metadata: {
            ownershipType: "outsourcing",
            trailerSource: "outsourced",
            externalCompany: "Carrier Z",
          },
        },
      ],
      groups: [
        {
          category: "trailers",
          label: "Trailers",
          count: 1,
          items: [
            {
              id: "trailer:t-1",
              category: "trailers",
              title: "PFC200",
              subtitle: "Outsourcing Trailer",
              status: "active",
              href: "/dashboard/trailers/t-1",
              quickActionLabel: "Open trailer",
              metadata: {
                ownershipType: "outsourcing",
                trailerSource: "outsourced",
                externalCompany: "Carrier Z",
              },
            },
          ],
        },
      ],
    });

    const response = await searchGlobal({ query: "outsourcing" });
    expect(response.results[0]?.metadata?.ownershipType).toBe("outsourcing");
  });
});
