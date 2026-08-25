// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeliveryDetailsPage from "@/app/dashboard/deliveries/[id]/page";

const navigationState = vi.hoisted(() => ({ edit: "1" as string | null }));
const listActiveDriverOptionsMock = vi.hoisted(() => vi.fn());
const recordDeliveryAssignmentChangeMock = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  booking: null as Record<string, unknown> | null,
  updatePayloads: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "booking-a" }),
  useSearchParams: () => ({ get: (key: string) => (key === "edit" ? navigationState.edit : null) }),
}));

vi.mock("@/lib/operational-readiness", () => ({
  calculateOperationalReadiness: () => ({ level: "ready", reason: "Ready", details: [] }),
  getReadinessColor: () => ({ border: "border-white/10", bg: "bg-slate-900/70", text: "text-slate-200" }),
  getReadinessEmoji: () => "✓",
  getReadinessLabel: () => "Ready",
  getLocalDateKey: () => "2026-08-12",
}));

vi.mock("@/lib/collection-aging", () => ({
  calculateCollectionAging: () => ({ waitingDays: 0, agingLevel: "none", agingLabel: "None", isOverdue: false, overdueDays: null }),
  agingColours: () => ({ border: "border-white/10", bg: "bg-slate-900/70", text: "text-slate-200", dot: "bg-slate-200" }),
}));

vi.mock("@/lib/delivery-driver-assignment", () => ({
  UNASSIGNED_DRIVER_LABEL: "Unassigned",
  formatAssignedDriverName: (value?: string | null) => value?.trim() || "Unassigned",
  listActiveDriverOptions: (...args: unknown[]) => listActiveDriverOptionsMock(...args),
  recordDeliveryAssignmentChange: (...args: unknown[]) => recordDeliveryAssignmentChangeMock(...args),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "delivery_bookings") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: state.booking, error: null })),
            })),
          })),
          update: vi.fn((payload: Record<string, unknown>) => {
            state.updatePayloads.push(payload);
            return {
              eq: vi.fn(async () => ({ error: null })),
            };
          }),
        };
      }

      if (table === "trailer_events") {
        return {
          insert: vi.fn(async () => ({ error: null })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

const makeBooking = (overrides?: Record<string, unknown>) => ({
  id: "booking-a",
  trailer_id: "trailer-a",
  driver_id: "driver-a",
  delivery_date: "2026-08-12",
  delivery_time: "09:00:00",
  customer: "Customer A",
  consignee: "Consignee A",
  delivery_location: "Dock A",
  booking_reference: "REF-A",
  escort_required: false,
  delivered_with_escort: false,
  status: "scheduled",
  notes: "Handle with care",
  created_at: "2026-08-12T08:00:00.000Z",
  updated_at: "2026-08-12T08:30:00.000Z",
  delivered_at: null,
  waiting_collection_since: null,
  collection_due_date: null,
  collected_at: null,
  demurrage_free_days: 0,
  demurrage_daily_rate: null,
  demurrage_currency: "GBP",
  demurrage_notes: null,
  driver: { display_name: "Driver A" },
  trailers: { trailer_number: "FS1001", container_number: null, compound_position: null, departure_date: null },
  ...overrides,
});

describe("DeliveryDetailsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    state.updatePayloads = [];
    navigationState.edit = "1";
    state.booking = makeBooking();
    listActiveDriverOptionsMock.mockResolvedValue([
      { id: "driver-a", display_name: "Driver A", user_id: "user-a", active: true },
      { id: "driver-b", display_name: "Driver B", user_id: "user-b", active: true },
    ]);
    recordDeliveryAssignmentChangeMock.mockResolvedValue(undefined);
  });

  it("shows current driver in edit mode and supports reassignment", async () => {
    render(<DeliveryDetailsPage />);

    const selects = await screen.findAllByRole("combobox");
    expect(selects[0]).toHaveValue("driver-a");

    fireEvent.change(selects[0], { target: { value: "driver-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(state.updatePayloads[0]).toMatchObject({ driver_id: "driver-b" });
    });

    expect(recordDeliveryAssignmentChangeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        previousDriverId: "driver-a",
        nextDriverId: "driver-b",
      }),
    );
  });

  it("supports removing the current driver assignment", async () => {
    render(<DeliveryDetailsPage />);

    const selects = await screen.findAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(state.updatePayloads[0]).toMatchObject({ driver_id: null });
    });

    expect(recordDeliveryAssignmentChangeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        previousDriverId: "driver-a",
        nextDriverId: null,
      }),
    );
  });

  it("renders unassigned clearly in detail view", async () => {
    navigationState.edit = null;
    state.booking = makeBooking({ driver_id: null, driver: null });

    render(<DeliveryDetailsPage />);

    expect((await screen.findAllByText("Assigned Driver")).length).toBeGreaterThan(0);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("shows Message Driver action when a driver is assigned", async () => {
    navigationState.edit = null;
    state.booking = makeBooking({
      driver_id: "driver-a",
      booking_reference: "REF-A",
      trailers: { trailer_number: "FS1001", container_number: null, compound_position: null, departure_date: null },
    });

    render(<DeliveryDetailsPage />);

    const messageDriverLink = await screen.findByRole("link", { name: "Message Driver" });
    expect(messageDriverLink).toHaveAttribute("href", expect.stringContaining("/dashboard/driver-communications?driverId=driver-a"));
    expect(messageDriverLink).toHaveAttribute("href", expect.stringContaining("deliveryBookingId=booking-a"));
  });
});