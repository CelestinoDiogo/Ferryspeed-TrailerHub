// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeliveriesPage from "@/app/dashboard/deliveries/page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/components/print/print-button", () => ({ PrintButton: () => <button type="button">Print</button> }));
vi.mock("@/components/print/print-filters", () => ({ PrintFilters: () => <div /> }));
vi.mock("@/components/print/print-header", () => ({ PrintHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/print/print-report-layout", () => ({ PrintReportLayout: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/print/report-print-layout", () => ({ ReportPrintLayout: ({ screen }: { screen: React.ReactNode }) => <>{screen}</> }));
vi.mock("@/components/print/print-summary", () => ({ PrintSummary: () => <div /> }));
vi.mock("@/components/print/print-table", () => ({ PrintTable: () => <div /> }));

vi.mock("@/lib/operational-readiness", () => ({
  getDateKey: () => "2026-08-13",
  getLocalDateKey: () => "2026-08-12",
  calculateOperationalReadiness: () => ({ level: "ready", reason: "Ready", details: [] }),
  getReadinessColor: () => ({ border: "border-white/10", bg: "bg-slate-900/70", text: "text-slate-200" }),
  getReadinessEmoji: () => "✓",
  getReadinessLabel: () => "Ready",
}));

vi.mock("@/lib/collection-aging", () => ({
  calculateCollectionAging: () => ({ waitingDays: 0, agingLevel: "none", agingLabel: "None", isOverdue: false, overdueDays: null }),
  agingColours: () => ({ border: "border-white/10", bg: "bg-slate-900/70", text: "text-slate-200", dot: "bg-slate-200" }),
  compareCollections: () => 0,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const rows = [
        {
          id: "booking-a",
          trailer_id: "trailer-a",
          driver_id: "driver-a",
          delivery_date: "2026-08-13",
          delivery_time: "09:00:00",
          customer: "Customer A",
          consignee: null,
          delivery_location: "Dock A",
          booking_reference: "REF-A",
          escort_required: false,
          status: "scheduled",
          notes: null,
          created_at: "2026-08-12T08:00:00.000Z",
          delivered_at: null,
          waiting_collection_since: null,
          collection_due_date: null,
          collected_at: null,
          demurrage_free_days: null,
          demurrage_daily_rate: null,
          demurrage_currency: null,
          demurrage_notes: null,
          driver: { display_name: "Driver A" },
          trailers: { trailer_number: "FS1001", container_number: null, compound_position: null, departure_date: null },
        },
        {
          id: "booking-b",
          trailer_id: "trailer-b",
          driver_id: null,
          delivery_date: "2026-08-13",
          delivery_time: "10:00:00",
          customer: "Customer B",
          consignee: null,
          delivery_location: "Dock B",
          booking_reference: "REF-B",
          escort_required: false,
          status: "scheduled",
          notes: null,
          created_at: "2026-08-12T08:00:00.000Z",
          delivered_at: null,
          waiting_collection_since: null,
          collection_due_date: null,
          collected_at: null,
          demurrage_free_days: null,
          demurrage_daily_rate: null,
          demurrage_currency: null,
          demurrage_notes: null,
          driver: null,
          trailers: { trailer_number: "FS1002", container_number: null, compound_position: null, departure_date: null },
        },
      ];

      const chain = {
        select: vi.fn(() => chain),
        order: vi.fn(() => chain),
        then: (resolve: (value: { data: typeof rows; error: null }) => void) => {
          resolve({ data: rows, error: null });
        },
      };

      return chain;
    },
  },
}));

describe("DeliveriesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows assigned driver names and unassigned state in the deliveries list", async () => {
    render(<DeliveriesPage />);

    expect(await screen.findByText("Driver A")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();

    const messageLinks = await screen.findAllByRole("link", { name: "Message Driver" });
    expect(messageLinks.length).toBeGreaterThan(0);
    expect(messageLinks[0]).toHaveAttribute("href", expect.stringContaining("/dashboard/driver-communications?driverId=driver-a"));
  });
});