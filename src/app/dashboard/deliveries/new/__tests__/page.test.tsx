// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewDeliveryPage from "@/app/dashboard/deliveries/new/page";

const pushMock = vi.hoisted(() => vi.fn());
const listActiveDriverOptionsMock = vi.hoisted(() => vi.fn());
const recordDeliveryAssignmentChangeMock = vi.hoisted(() => vi.fn());

const state = vi.hoisted(() => ({
  insertedPayloads: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/lib/calendar-utils", () => ({
  parseDateParam: (value: string | null) => value,
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
      if (table === "trailers") {
        const chain = {
          select: vi.fn(() => chain),
          is: vi.fn(() => chain),
          order: vi.fn(async () => ({
            data: [
              {
                id: "trailer-a",
                trailer_number: "FS1001",
                container_number: null,
                customer: "Customer A",
                consignee: "Consignee A",
              },
            ],
            error: null,
          })),
        };

        return chain;
      }

      if (table === "delivery_bookings") {
        return {
          insert: vi.fn((payload: Record<string, unknown>) => {
            state.insertedPayloads.push(payload);
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({ data: { id: "booking-a" }, error: null })),
              })),
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

describe("NewDeliveryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    state.insertedPayloads = [];
    listActiveDriverOptionsMock.mockResolvedValue([
      { id: "driver-a", display_name: "Driver A", user_id: "user-a", active: true },
    ]);
    recordDeliveryAssignmentChangeMock.mockResolvedValue(undefined);
  });

  it("shows assigned driver selector and persists selected driver id on create", async () => {
    const { container } = render(<NewDeliveryPage />);

    const selects = await screen.findAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "trailer-a" } });
    fireEvent.change(selects[1], { target: { value: "driver-a" } });
    fireEvent.change(container.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: "2026-08-12" } });

    expect(screen.getByRole("option", { name: "Driver A" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create Delivery Booking" }));

    await waitFor(() => {
      expect(state.insertedPayloads[0]).toMatchObject({
        trailer_id: "trailer-a",
        driver_id: "driver-a",
      });
    });

    expect(recordDeliveryAssignmentChangeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: "booking-a",
        nextDriverId: "driver-a",
      }),
    );
    expect(pushMock).toHaveBeenCalledWith("/dashboard/deliveries?saved=1");
  });

  it("keeps delivery creation valid when no driver is assigned", async () => {
    const { container } = render(<NewDeliveryPage />);

    const selects = await screen.findAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "trailer-a" } });
    fireEvent.change(container.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: "2026-08-13" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Delivery Booking" }));

    await waitFor(() => {
      expect(state.insertedPayloads[0]).toMatchObject({
        trailer_id: "trailer-a",
        driver_id: null,
      });
    });

    expect(recordDeliveryAssignmentChangeMock).not.toHaveBeenCalled();
  });
});