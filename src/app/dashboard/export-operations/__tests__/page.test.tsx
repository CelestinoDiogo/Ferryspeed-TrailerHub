// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadExportAllocationsForReport = vi.fn();
let searchParamsValue = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard/export-operations",
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}));

vi.mock("@/lib/reports/report-data", () => ({
  loadExportAllocationsForReport: (...args: unknown[]) => mockLoadExportAllocationsForReport(...args),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "trailers") {
        const chain = {
          select: () => chain,
          in: () => Promise.resolve({
            data: [
              {
                id: "t-company",
                trailer_source: "company",
                external_company: null,
                is_local: false,
                trailer_number: "PRO100",
              },
              {
                id: "t-outsourcing",
                trailer_source: "outsourced",
                external_company: "Carrier Z",
                is_local: false,
                trailer_number: "PFC200",
              },
            ],
            error: null,
          }),
        };

        return chain;
      }

      const noop = {
        select: () => noop,
        in: () => noop,
        eq: () => noop,
        is: () => noop,
        neq: () => noop,
        single: () => Promise.resolve({ data: null, error: null }),
        update: () => noop,
        insert: () => Promise.resolve({ data: null, error: null }),
        order: () => noop,
        limit: () => noop,
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve(resolve({ data: [], error: null })),
      };

      return noop;
    },
  },
}));

import ExportOperationsPage from "@/app/dashboard/export-operations/page";

beforeEach(() => {
  mockLoadExportAllocationsForReport.mockResolvedValue([
    {
      id: "a-company",
      trailer_id: "t-company",
      trailer_number: "PRO100",
      customer: "Customer A",
      status: "allocated",
      priority: "normal",
      collection_date: "2026-08-01",
    },
    {
      id: "a-outsourcing",
      trailer_id: "t-outsourcing",
      trailer_number: "PFC200",
      customer: "Customer B",
      status: "allocated",
      priority: "normal",
      collection_date: "2026-08-01",
    },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  searchParamsValue = "";
});

describe("Export operations ownership filtering", () => {
  it("shows all allocations by default", async () => {
    searchParamsValue = "history=today";

    render(<ExportOperationsPage />);

    expect(await screen.findByText("2 allocations")).toBeInTheDocument();
  });

  it("applies ownership filter from URL query", async () => {
    searchParamsValue = "history=today&ownership=outsourcing";

    render(<ExportOperationsPage />);

    expect(await screen.findByText("1 allocation")).toBeInTheDocument();
    expect(screen.getAllByText("PFC200").length).toBeGreaterThan(0);
    expect(screen.queryByText("PRO100")).not.toBeInTheDocument();
  });
});
