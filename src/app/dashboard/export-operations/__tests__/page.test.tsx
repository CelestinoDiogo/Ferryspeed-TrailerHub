// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDateKey } from "@/lib/operational-readiness";

const mockLoadExportAllocationsForReport = vi.fn();
let searchParamsValue = "";

const { replaceMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => "/dashboard/export-operations",
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}));

vi.mock("@/lib/reports/report-data", () => ({
  loadExportAllocationsForReport: (...args: unknown[]) => mockLoadExportAllocationsForReport(...args),
}));

vi.mock("@/lib/voice/session", () => ({
  getSessionToken: vi.fn(async () => "token-123"),
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

describe("Export operations header cards", () => {
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
        id: "a-customer",
        trailer_id: "t-outsourcing",
        trailer_number: "PFC200",
        customer: "Customer B",
        status: "delivered_empty",
        priority: "high",
        collection_date: getLocalDateKey(),
      },
      {
        id: "a-completed",
        trailer_id: "t-company",
        trailer_number: "PRO300",
        customer: "Customer C",
        status: "completed",
        priority: "urgent",
        collection_date: getLocalDateKey(),
      },
    ]);
  });

  it("filters to active allocations from the Active card", async () => {
    searchParamsValue = "history=today&status=active";

    render(<ExportOperationsPage />);

    expect(await screen.findByText("2 allocations")).toBeInTheDocument();
    expect(screen.getAllByText("PRO100").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PFC200").length).toBeGreaterThan(0);
    expect(screen.queryByText("PRO300")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Active/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("filters to at-customer allocations from the At Customer card", async () => {
    searchParamsValue = "history=today&status=at_customer";

    render(<ExportOperationsPage />);

    expect(await screen.findByText("1 allocation")).toBeInTheDocument();
    expect(screen.getAllByText("PFC200").length).toBeGreaterThan(0);
    expect(screen.queryByText("PRO100")).not.toBeInTheDocument();
    expect(screen.queryByText("PRO300")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /At Customer/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("filters to completed allocations from the Completed card", async () => {
    searchParamsValue = "history=today&status=completed";

    render(<ExportOperationsPage />);

    expect(await screen.findByText("1 allocation")).toBeInTheDocument();
    expect(screen.getAllByText("PRO300").length).toBeGreaterThan(0);
    expect(screen.queryByText("PRO100")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Completed/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("resets to all allocations from the Total Allocations card", async () => {
    searchParamsValue = "history=today";

    render(<ExportOperationsPage />);

    expect(await screen.findByText("3 allocations")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Total Allocations/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows unassigned allocations as Trailer to be selected and still counts them as Active", async () => {
    mockLoadExportAllocationsForReport.mockResolvedValue([
      {
        id: "a-unassigned",
        trailer_id: null,
        trailer_number: null,
        customer: "Blank Trailer Customer",
        status: "allocated",
        priority: "normal",
        collection_date: getLocalDateKey(),
      },
    ]);
    searchParamsValue = "history=today";

    render(<ExportOperationsPage />);

    expect(await screen.findByText("1 allocation")).toBeInTheDocument();
    expect(screen.getAllByText("Trailer to be selected").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Assign a trailer before continuing this operation.").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Delivered Empty" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Active/ })).toHaveTextContent("1");
  });

  it("keeps existing customer filters when a header card is clicked", async () => {
    searchParamsValue = "history=today&customer=Customer%20A";

    render(<ExportOperationsPage />);
    const user = userEvent.setup();

    expect(await screen.findByText("1 allocation")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Active/ }));

    expect(replaceMock).toHaveBeenCalled();
    const nextUrl = String(replaceMock.mock.calls.at(-1)?.[0] ?? "");
    expect(nextUrl).toContain("status=active");
    expect(nextUrl).toContain("customer=Customer");
  });

  it("toggles the same header card back to all allocations", async () => {
    searchParamsValue = "history=today&status=completed&customer=Customer%20C";

    render(<ExportOperationsPage />);
    const user = userEvent.setup();

    expect(await screen.findByText("1 allocation")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Completed/ }));

    const nextUrl = String(replaceMock.mock.calls.at(-1)?.[0] ?? "");
    expect(nextUrl).not.toContain("status=completed");
    expect(nextUrl).toContain("customer=Customer");
  });
});

describe("Export operations escort filtering", () => {
  beforeEach(() => {
    mockLoadExportAllocationsForReport.mockResolvedValue([
      {
        id: "a-none",
        trailer_id: "t-company",
        trailer_number: "PRO100",
        customer: "Customer A",
        status: "allocated",
        priority: "normal",
        collection_date: getLocalDateKey(),
        escort_needed: false,
        delivered_with_escort: false,
      },
      {
        id: "a-needed",
        trailer_id: "t-outsourcing",
        trailer_number: "PFC200",
        customer: "Customer B",
        status: "allocated",
        priority: "high",
        collection_date: getLocalDateKey(),
        escort_needed: true,
        delivered_with_escort: false,
      },
      {
        id: "a-delivered",
        trailer_id: "t-company",
        trailer_number: "PRO300",
        customer: "Customer C",
        status: "delivered_empty",
        priority: "normal",
        collection_date: getLocalDateKey(),
        escort_needed: true,
        delivered_with_escort: true,
      },
    ]);
  });

  it("defaults escort allocations to no escort needed", async () => {
    searchParamsValue = "history=today";

    render(<ExportOperationsPage />);

    expect(await screen.findByText("3 allocations")).toBeInTheDocument();
    expect(screen.getByLabelText("Escort")).toHaveValue("all");
    expect(screen.getAllByText("ESCORT")).toHaveLength(2);
  });

  it("filters to escort needed allocations", async () => {
    searchParamsValue = "history=today&escort=needed";

    render(<ExportOperationsPage />);

    expect(await screen.findByText("2 allocations")).toBeInTheDocument();
    expect(screen.getAllByText("PFC200").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PRO300").length).toBeGreaterThan(0);
    expect(screen.queryByText("PRO100")).not.toBeInTheDocument();
  });

  it("filters to deliveries completed with escort", async () => {
    searchParamsValue = "history=today&escort=delivered";

    render(<ExportOperationsPage />);

    expect(await screen.findByText("1 allocation")).toBeInTheDocument();
    expect(screen.getAllByText("PRO300").length).toBeGreaterThan(0);
    expect(screen.queryByText("PRO100")).not.toBeInTheDocument();
    expect(screen.queryByText("PFC200")).not.toBeInTheDocument();
  });

  it("filters to no escort allocations", async () => {
    searchParamsValue = "history=today&escort=none";

    render(<ExportOperationsPage />);

    expect(await screen.findByText("1 allocation")).toBeInTheDocument();
    expect(screen.getAllByText("PRO100").length).toBeGreaterThan(0);
    expect(screen.queryByText("PFC200")).not.toBeInTheDocument();
    expect(screen.queryByText("PRO300")).not.toBeInTheDocument();
  });
});
