// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VesselTrailerList } from "@/app/dashboard/vessel-operations/[id]/components/vessel-trailer-list";
import type { VesselOperationTrailerRecord } from "@/lib/vessel-operations";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/vessel-operations/op-1",
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/components/operations/trailer-operations-panel", () => ({ TrailerOperationsPanel: () => null }));
vi.mock("@/components/trailers/trailer-history-drawer", () => ({ TrailerHistoryDrawer: () => null }));

const makeTrailer = (overrides: Partial<VesselOperationTrailerRecord> = {}): VesselOperationTrailerRecord => ({
  id: "22222222-2222-4222-8222-222222222222",
  vessel_operation_id: "11111111-1111-4111-8111-111111111111",
  trailer_id: "33333333-3333-4333-8333-333333333333",
  trailer_number: "PFC01",
  status: "expected",
  arrival_status: "available_for_arrival",
  arrival_record_id: null,
  inspection_started_at: null,
  inspection_completed_at: null,
  ownership_type: "outsourcing",
  priority_level: "priority",
  planning_notes: "Keep historical plan",
  load_status: "Loaded",
  assigned_position: null,
  ...overrides,
});

const renderList = (trailer: VesselOperationTrailerRecord, overrides: Record<string, unknown> = {}) => {
  const props = {
    sortedTrailers: [trailer],
    operationStatus: "confirmed" as const,
    editable: false,
    isReadOnly: false,
    actioningTrailerId: null,
    onTogglePriority: vi.fn(),
    onRemoveTrailer: vi.fn(),
    onMarkArrived: vi.fn(),
    onMarkCancelled: vi.fn(),
    onMarkNoShow: vi.fn(),
    onUndoCancelled: vi.fn(),
    onUndoNoShow: vi.fn(),
    ...overrides,
  };
  render(<VesselTrailerList {...props} />);
  return props;
};

afterEach(() => cleanup());
beforeEach(() => window.history.replaceState({}, "", "/dashboard/vessel-operations/op-1"));

describe("VesselTrailerList cancellation", () => {
  it("shows Cancel directly and confirms with an optional reason", async () => {
    const user = userEvent.setup();
    const trailer = makeTrailer();
    const props = renderList(trailer);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Cancel this trailer from this vessel operation?" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /Reason/ }), "Changed sailing");
    await user.click(screen.getByRole("button", { name: "Confirm Cancel" }));

    expect(props.onMarkCancelled).toHaveBeenCalledWith(trailer, "Changed sailing");
  });

  it("hides Cancel after arrival or reception", () => {
    renderList(makeTrailer({ arrival_status: "arrived", status: "arrived", arrival_record_id: "arrival-1" }));
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Arrived" })).not.toBeInTheDocument();
  });

  it("keeps a cancelled row visible with Undo Cancel and no arrival action", async () => {
    const user = userEvent.setup();
    const trailer = makeTrailer({ arrival_status: "cancelled", status: "not_arrived", cancellation_reason: "Not shipped" });
    const props = renderList(trailer);

    expect(screen.getByRole("heading", { name: "PFC01" })).toBeInTheDocument();
    expect(screen.getByText("CANCELLED")).toBeInTheDocument();
    expect(screen.getByText("Priority: Priority")).toBeInTheDocument();
    expect(screen.getByText("Notes: Keep historical plan")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Arrived" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo Cancel" }));
    expect(props.onUndoCancelled).toHaveBeenCalledWith(trailer);
  });

  it("hides mutation actions for a read-only operation", () => {
    renderList(makeTrailer(), { isReadOnly: true });
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });
});