// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VesselTrailerList } from "@/app/dashboard/vessel-operations/[id]/components/vessel-trailer-list";
import type { VesselOperationTrailerRecord } from "@/lib/vessel-operations";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/vessel-operations/op-1",
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/components/operations/trailer-operations-panel", () => ({
  TrailerOperationsPanel: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>Trailer operations panel</div> : null),
}));
vi.mock("@/components/trailers/trailer-history-drawer", () => ({ TrailerHistoryDrawer: () => null }));

const boatCheckPage = readFileSync(join(process.cwd(), "src/app/dashboard/vessel-operations/[id]/boat-check/[vesselTrailerId]/page.tsx"), "utf8");
const persistHelper = readFileSync(join(process.cwd(), "src/lib/operations/persist-inspection-damage.ts"), "utf8");
const trailerListSource = readFileSync(join(process.cwd(), "src/app/dashboard/vessel-operations/[id]/components/vessel-trailer-list.tsx"), "utf8");

const makeTrailer = (overrides: Partial<VesselOperationTrailerRecord> = {}): VesselOperationTrailerRecord => ({
  id: "vt-check-1",
  vessel_operation_id: "op-1",
  trailer_id: "trailer-1",
  trailer_number: "DDA13-12",
  status: "arrived",
  arrival_status: "arrived",
  discharged_at: "2026-08-25T07:00:00.000Z",
  arrived_at: "2026-08-25T07:00:00.000Z",
  arrival_record_id: "arrival-1",
  arrival_confirmed_at: "2026-08-25T07:10:00.000Z",
  inspection_started_at: null,
  inspection_completed_at: null,
  ownership_type: "company",
  priority_level: "normal",
  planning_notes: "Ready for checks",
  load_status: "Loaded",
  assigned_position: "P12",
  has_damage: false,
  has_temperature_alert: false,
  ...overrides,
});

const renderList = (trailer: VesselOperationTrailerRecord, overrides: Record<string, unknown> = {}) => {
  render(
    <VesselTrailerList
      sortedTrailers={[trailer]}
      operationStatus="confirmed"
      editable={false}
      isReadOnly={false}
      actioningTrailerId={null}
      onTogglePriority={vi.fn()}
      onRemoveTrailer={vi.fn()}
      onMarkArrived={vi.fn()}
      onMarkCancelled={vi.fn()}
      onMarkNoShow={vi.fn()}
      onUndoCancelled={vi.fn()}
      onUndoNoShow={vi.fn()}
      {...overrides}
    />,
  );
};

afterEach(() => cleanup());
beforeEach(() => window.history.replaceState({}, "", "/dashboard/vessel-operations/op-1"));

describe("VesselTrailerList trailer check action", () => {
  it("shows Trailer Check for an arrived, reception-confirmed trailer awaiting inspection", () => {
    renderList(makeTrailer());

    const trailerCheck = screen.getByRole("link", { name: "Trailer Check" });
    expect(trailerCheck).toHaveAttribute(
      "href",
      "/dashboard/vessel-operations/op-1/boat-check/vt-check-1?returnTo=%2Fdashboard%2Fvessel-operations%2Fop-1",
    );
    expect(screen.getByRole("button", { name: "Open Workspace" })).toBeInTheDocument();
    expect(screen.getByText("More Actions")).toBeInTheDocument();
  });

  it("keeps Trailer Check as the primary action when inspection is already in progress", () => {
    renderList(makeTrailer({ inspection_started_at: "2026-08-25T07:20:00.000Z" }));

    expect(screen.getByRole("link", { name: "Trailer Check" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Inspection" })).not.toBeInTheDocument();
  });

  it("shows Trailer Check on Checks-stage trailers even when reception is still pending", () => {
    renderList(makeTrailer({
      arrival_record_id: null,
      arrival_confirmed_at: null,
      assigned_position: null,
      inspection_started_at: "2026-08-25T07:20:00.000Z",
    }), { onConfirmReception: vi.fn() });

    expect(screen.getByRole("link", { name: "Trailer Check" })).toHaveAttribute(
      "href",
      expect.stringContaining("/boat-check/vt-check-1"),
    );
    expect(screen.getByRole("button", { name: "Confirm Reception" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Workspace" })).toBeInTheDocument();
  });

  it("opens the existing boat-check inspection UI instead of the workspace panel", () => {
    renderList(makeTrailer());

    const trailerCheck = screen.getByRole("link", { name: "Trailer Check" });
    expect(trailerCheck).toHaveAttribute("href", expect.stringContaining("/boat-check/vt-check-1"));
    expect(screen.queryByText("Trailer operations panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Workspace" }));
    expect(screen.getByText("Trailer operations panel")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Trailer Check" })).toBeInTheDocument();
  });

  it("does not show Trailer Check on a completed inspection", () => {
    renderList(makeTrailer({
      status: "inspected",
      inspection_completed_at: "2026-08-25T07:40:00.000Z",
    }));

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "completed" } });

    expect(screen.getByText("DDA13-12")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Trailer Check" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Inspection" })).toBeInTheDocument();
  });

  it("does not show Trailer Check on cancelled trailers", () => {
    renderList(makeTrailer({
      arrival_status: "cancelled",
      status: "not_arrived",
      arrival_record_id: null,
      discharged_at: null,
    }));
    expect(screen.queryByRole("link", { name: "Trailer Check" })).not.toBeInTheDocument();
  });

  it("does not show Trailer Check before the trailer is discharged", () => {
    renderList(makeTrailer({
      status: "expected",
      arrival_status: "available_for_arrival",
      arrival_record_id: null,
      arrival_confirmed_at: null,
      discharged_at: null,
      arrived_at: null,
      assigned_position: null,
    }));
    expect(screen.queryByRole("link", { name: "Trailer Check" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arrived" })).toBeInTheDocument();
  });

  it("reuses the canonical boat-check save path and returns to the vessel list after save", () => {
    expect(trailerListSource).toContain("Trailer Check");
    expect(trailerListSource).toContain("/boat-check/${trailer.id}?returnTo=");
    expect(trailerListSource).toContain("Open Workspace");
    expect(trailerListSource).not.toContain('primaryAction === "start_inspection"');

    expect(boatCheckPage).toContain("persistVesselInspectionDamage");
    expect(boatCheckPage).toContain("router.replace(returnTo)");
    expect(boatCheckPage).toContain("vessel_inspection_temperatures");
    expect(boatCheckPage).toContain("has_temperature_alert");
    expect(boatCheckPage).toContain("has_damage");
    expect(persistHelper).toContain("buildInspectionDamageInsertPayload");
  });
});
