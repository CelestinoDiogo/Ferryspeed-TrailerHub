// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadCompoundReportData = vi.fn();
const mockUseOperationalRealtime = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/compound",
  useRouter: () => ({
    replace: vi.fn(),
  }),
}));

vi.mock("@/lib/realtime/operational-realtime", () => ({
  useOperationalRealtime: (...args: unknown[]) => mockUseOperationalRealtime(...args),
}));

vi.mock("@/lib/reports/report-data", () => ({
  loadCompoundReportData: (...args: unknown[]) => mockLoadCompoundReportData(...args),
}));

const mockFrom = vi.fn((table: string) => {
  const rowsByTable: Record<string, Array<Record<string, unknown>>> = {
    vessel_operation_trailers: [],
    vessel_operations: [],
    trailer_activity_log: [],
  };

  const rows = rowsByTable[table] ?? [];
  const chain = {
    select: () => chain,
    order: () => chain,
    limit: () => chain,
    in: () => chain,
    then: (resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown) =>
      Promise.resolve(resolve({ data: rows, error: null })),
  };

  return chain;
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
  },
}));

import CompoundPage from "@/app/dashboard/compound/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  mockLoadCompoundReportData.mockResolvedValue({
    trailersData: [
      {
        id: "t-company",
        trailer_number: "PRO100",
        load_status: "Loaded",
        customer: "Customer A",
        consignee: null,
        container_number: null,
        compound_position: "P01",
        departure_date: null,
        is_local: false,
        trailer_source: "company",
        external_company: null,
      },
      {
        id: "t-outsourcing",
        trailer_number: "PFC200",
        load_status: "Loaded",
        customer: "Customer B",
        consignee: null,
        container_number: null,
        compound_position: "P02",
        departure_date: null,
        is_local: false,
        trailer_source: "outsourced",
        external_company: "Carrier Z",
      },
    ],
    bookingsData: [],
    exportAllocationsData: [],
  });
});

describe("Compound ownership filter", () => {
  it("filters shown trailers by ownership", async () => {
    render(<CompoundPage />);

    expect(await screen.findByText("2 trailers shown")).toBeInTheDocument();

    const select = screen.getAllByRole("combobox").find((element) =>
      Array.from((element as HTMLSelectElement).options).some((option) => option.value === "outsourcing"),
    ) as HTMLSelectElement | undefined;

    expect(select).toBeDefined();

    fireEvent.change(select as HTMLSelectElement, { target: { value: "outsourcing" } });

    await waitFor(() => {
      expect(screen.getByText("1 trailers shown")).toBeInTheDocument();
    });
  });
});
