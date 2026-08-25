// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewDeliveryPage from "@/app/dashboard/deliveries/new/page";
import {
  DeliveryBookingAvailabilityError,
  TRAILER_ACTIVE_DELIVERY_BOOKING_MESSAGE,
} from "@/lib/delivery-booking-availability";

const pushMock = vi.hoisted(() => vi.fn());
const listActiveDriverOptionsMock = vi.hoisted(() => vi.fn());
const recordDeliveryAssignmentChangeMock = vi.hoisted(() => vi.fn());
const listTrailersAvailableForDeliveryBookingMock = vi.hoisted(() => vi.fn());
const createDeliveryBookingIfTrailerAvailableMock = vi.hoisted(() => vi.fn());

const state = vi.hoisted(() => ({
  insertedPayloads: [] as Array<Record<string, unknown>>,
  eventInserts: 0,
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

vi.mock("@/lib/delivery-booking-availability", async () => {
  const actual = await vi.importActual<typeof import("@/lib/delivery-booking-availability")>(
    "@/lib/delivery-booking-availability",
  );

  return {
    ...actual,
    listTrailersAvailableForDeliveryBooking: (...args: unknown[]) =>
      listTrailersAvailableForDeliveryBookingMock(...args),
    createDeliveryBookingIfTrailerAvailable: (...args: unknown[]) =>
      createDeliveryBookingIfTrailerAvailableMock(...args),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "trailer_events") {
        return {
          insert: vi.fn(() => {
            state.eventInserts += 1;
            return Promise.resolve({ error: null });
          }),
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
    state.eventInserts = 0;
    listActiveDriverOptionsMock.mockResolvedValue([
      { id: "driver-a", display_name: "Driver A", user_id: "user-a", active: true },
    ]);
    recordDeliveryAssignmentChangeMock.mockResolvedValue(undefined);
    listTrailersAvailableForDeliveryBookingMock.mockResolvedValue([
      {
        id: "trailer-a",
        trailer_number: "FS1001",
        container_number: null,
        customer: "Customer A",
        consignee: "Consignee A",
      },
    ]);
    createDeliveryBookingIfTrailerAvailableMock.mockImplementation(
      async (_client: unknown, payload: Record<string, unknown>) => {
        state.insertedPayloads.push(payload);
        return { id: "booking-a" };
      },
    );
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
        escort_required: false,
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

  it("lets the operator mark escort needed before creating a delivery", async () => {
    const { container } = render(<NewDeliveryPage />);
    const user = (await import("@testing-library/user-event")).default.setup();

    const selects = await screen.findAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "trailer-a" } });
    fireEvent.change(container.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: "2026-08-12" } });
    await user.click(within(screen.getByRole("group", { name: "Escort Needed" })).getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Delivery Booking" }));

    await waitFor(() => {
      expect(state.insertedPayloads[0]).toMatchObject({
        escort_required: true,
      });
    });
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

  it("does not offer a trailer that already has an active delivery booking", async () => {
    listTrailersAvailableForDeliveryBookingMock.mockResolvedValue([
      {
        id: "trailer-free",
        trailer_number: "FS1002",
        container_number: null,
        customer: "Customer B",
        consignee: null,
      },
    ]);

    render(<NewDeliveryPage />);

    expect(await screen.findByRole("option", { name: "FS1002" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /FS1001/ })).not.toBeInTheDocument();
  });

  it("surfaces the conflict and does not create a second booking when the trailer is already reserved", async () => {
    createDeliveryBookingIfTrailerAvailableMock.mockRejectedValue(new DeliveryBookingAvailabilityError());

    const { container } = render(<NewDeliveryPage />);

    const selects = await screen.findAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "trailer-a" } });
    fireEvent.change(container.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: "2026-08-13" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Delivery Booking" }));

    expect(await screen.findByText(TRAILER_ACTIVE_DELIVERY_BOOKING_MESSAGE)).toBeInTheDocument();
    expect(state.eventInserts).toBe(0);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
