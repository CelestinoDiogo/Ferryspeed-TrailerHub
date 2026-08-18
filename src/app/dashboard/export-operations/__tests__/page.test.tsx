// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDateKey } from "@/lib/operational-readiness";

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
                trailer_source: "company",
                external_company: null,
                is_local: false,
                trailer_number: "PFC200",
                source_vessel_operation_trailer_id: "vt-outsourcing",
              },
            ],
            error: null,
          }),
        };

        return chain;
      }

      if (table === "vessel_operation_trailers") {
        const chain = {
          select: () => chain,
          in: () => Promise.resolve({
            data: [{ id: "vt-outsourcing", ownership_type: "outsourcing", trailer_source: "outsourced", external_company: "Carrier Z" }],
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
      collection_date: getLocalDateKey(),
    },
    {
      id: "a-outsourcing",
      trailer_id: "t-outsourcing",
      trailer_number: "PFC200",
      customer: "Customer B",
      haulier: "Haulier B",
      priority: "high",
      booking_reference: "REF-B",
      status: "allocated",
      collection_date: getLocalDateKey(),
    },
    {
      id: "a-third",
      trailer_id: "t-company",
      trailer_number: "PRO300",
      customer: "Customer C",
      haulier: "Haulier C",
      priority: "urgent",
      booking_reference: "REF-C",
      status: "completed",
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

  it("keeps historical vessel ownership when the linked global trailer later says company", async () => {
    searchParamsValue = "history=today&ownership=outsourcing";

    render(<ExportOperationsPage />);

    expect(await screen.findByText("1 allocation")).toBeInTheDocument();
    expect(screen.getAllByText("PFC200").length).toBeGreaterThan(0);
  });

  it("combines multiple customers into one consolidated filtered view", async () => {
    searchParamsValue = `history=custom&start=2026-08-01&end=${getLocalDateKey()}&customer=Customer%20A&customer=Customer%20B`;

    render(<ExportOperationsPage />);

    expect(await screen.findByText("2 allocations")).toBeInTheDocument();
    expect(screen.getAllByText("PRO100").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PFC200").length).toBeGreaterThan(0);
    expect(screen.queryByText("PRO300")).not.toBeInTheDocument();
  });

  it("applies deterministic custom date range, priority, and haulier filters", async () => {
    searchParamsValue = `history=custom&start=2026-08-01&end=${getLocalDateKey()}&priority=high&haulier=Haulier%20B`;

    render(<ExportOperationsPage />);

    expect(await screen.findByText("1 allocation")).toBeInTheDocument();
    expect(screen.getAllByText("PFC200").length).toBeGreaterThan(0);
    expect(screen.queryByText("PRO100")).not.toBeInTheDocument();
    expect(screen.queryByText("PRO300")).not.toBeInTheDocument();
  });

  it("keeps Print / Export usable for the current filtered report", async () => {
    searchParamsValue = "history=today&ownership=outsourcing";

    render(<ExportOperationsPage />);

    expect(await screen.findByText("1 allocation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print / Export" })).toBeEnabled();
    expect(screen.getAllByText("PFC200").length).toBeGreaterThan(0);
    expect(screen.queryByText("PRO100")).not.toBeInTheDocument();
    expect(document.getElementById("print-report-root")).toHaveTextContent("PFC200");
    expect(document.getElementById("print-report-root")).not.toHaveTextContent("PRO100");
  });

  it("allows printing an empty filtered report instead of hiding the action", async () => {
    searchParamsValue = "history=today&ownership=outsourcing&customer=Missing";

    render(<ExportOperationsPage />);

    expect(await screen.findByText("0 allocations")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print / Export" })).toBeEnabled();
  });
});
