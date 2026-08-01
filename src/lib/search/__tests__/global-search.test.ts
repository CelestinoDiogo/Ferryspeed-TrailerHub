import { describe, expect, it } from "vitest";
import {
  buildIlikePatterns,
  buildResponse,
  matchesContains,
  searchGlobalIndex,
  type GlobalSearchResultItem,
} from "@/lib/search/global-search";

const makeItem = (overrides: Partial<GlobalSearchResultItem>): GlobalSearchResultItem => ({
  id: overrides.id ?? "item-1",
  category: overrides.category ?? "trailers",
  title: overrides.title ?? "PFC123",
  subtitle: overrides.subtitle ?? "Customer A",
  status: overrides.status ?? "active",
  href: overrides.href ?? "/dashboard/trailers/1",
  quickActionLabel: overrides.quickActionLabel ?? "Open",
  metadata: overrides.metadata,
});

describe("global-search service helpers", () => {
  it("matches case-insensitive and space-insensitive terms", () => {
    expect(matchesContains("pfc123", "PFC 123")).toBe(true);
    expect(matchesContains("P F C 1 2 3", "pfc123")).toBe(true);
    expect(matchesContains("bookingref77", "Booking Ref 77")).toBe(true);
    expect(matchesContains("ABC", "xyz")).toBe(false);
  });

  it("builds compact and spaced ilike patterns for bounded db filtering", () => {
    expect(buildIlikePatterns("P F C 1 2 3")).toEqual(["%P F C 1 2 3%", "%pfc123%"]);
    expect(buildIlikePatterns("PFC123")).toEqual(["%PFC123%", "%pfc123%"]);
  });

  it("ranks startsWith matches before contains matches", () => {
    const startsWith = makeItem({ id: "1", title: "PFC123", subtitle: "Alpha" });
    const containsOnly = makeItem({ id: "2", title: "Trailer PFC123", subtitle: "Bravo" });

    const response = buildResponse("pfc", 20, 0, [containsOnly, startsWith]);
    expect(response.results[0]?.id).toBe("1");
    expect(response.results[1]?.id).toBe("2");
  });

  it("caps returned results to limit 20", () => {
    const items = Array.from({ length: 50 }, (_, index) =>
      makeItem({
        id: String(index + 1),
        title: `PFC${String(index + 1).padStart(3, "0")}`,
      }),
    );

    const response = buildResponse("pfc", 20, 0, items);
    expect(response.results).toHaveLength(20);
    expect(response.hasMore).toBe(true);
  });

  it("matches outsourcing terms and exposes ownership metadata", async () => {
    const trailers = [
      {
        id: "t-company",
        trailer_number: "PRO100",
        customer: "Customer A",
        consignee: null,
        container_number: null,
        compound_position: "P01",
        operational_status: "active",
        load_status: "Loaded",
        trailer_source: "company",
        external_company: null,
        is_local: false,
        created_at: "2026-08-01T08:00:00.000Z",
      },
      {
        id: "t-outsourced",
        trailer_number: "PFC200",
        customer: "Customer B",
        consignee: null,
        container_number: null,
        compound_position: "P02",
        operational_status: "active",
        load_status: "Empty",
        trailer_source: "outsourced",
        external_company: "Carrier Z",
        is_local: false,
        created_at: "2026-08-01T09:00:00.000Z",
      },
      {
        id: "t-unknown",
        trailer_number: "UNK300",
        customer: "Customer C",
        consignee: null,
        container_number: null,
        compound_position: "P03",
        operational_status: "active",
        load_status: "Empty",
        trailer_source: null,
        external_company: null,
        is_local: false,
        created_at: "2026-08-01T10:00:00.000Z",
      },
    ];

    const makeQuery = (table: string, rows: Array<Record<string, unknown>>) => {
      const state = { table, rows, orFilter: "" };
      const builder = {
        select: () => builder,
        or: (value: string) => {
          state.orFilter = value;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        in: () => builder,
        eq: () => builder,
        then: (resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown) => {
          let filteredRows = state.rows;

          if (state.table === "trailers" && state.orFilter) {
            const normalizedFilter = state.orFilter.toLowerCase();

            if (normalizedFilter.includes("outsourcing") || normalizedFilter.includes("outsourced") || normalizedFilter.includes("external")) {
              filteredRows = filteredRows.filter((row) => {
                const source = String(row.trailer_source ?? "").toLowerCase();
                const externalCompany = String(row.external_company ?? "").toLowerCase();
                return source.includes("outsour") || source.includes("external") || externalCompany.length > 0;
              });
            }

            if (normalizedFilter.includes("company") && !normalizedFilter.includes("external")) {
              filteredRows = filteredRows.filter((row) => String(row.trailer_source ?? "").toLowerCase() === "company");
            }

            if (normalizedFilter.includes("pro100")) {
              filteredRows = filteredRows.filter((row) => String(row.trailer_number ?? "").toLowerCase() === "pro100");
            }
          }

          return Promise.resolve(resolve({ data: filteredRows, error: null }));
        },
      };

      return builder;
    };

    const supabase = {
      from: (table: string) => {
        if (table === "trailers") {
          return makeQuery(table, trailers);
        }

        return makeQuery(table, []);
      },
    };

    const outsourcingResult = await searchGlobalIndex(supabase as never, { query: "outsourcing" });
    expect(outsourcingResult.results.every((item) => item.metadata?.ownershipType === "outsourcing" || item.category !== "trailers")).toBe(true);

    const outsourcingTrailer = outsourcingResult.results.find((item) => item.id === "trailer:t-outsourced");
    expect(outsourcingTrailer?.metadata?.ownershipType).toBe("outsourcing");
  });
});
