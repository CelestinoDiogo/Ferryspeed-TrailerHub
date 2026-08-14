// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FleetPage from "@/app/dashboard/fleet/page";

vi.mock("@/components/auth/permission-guard", () => ({ PermissionGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/lib/auth/use-current-user", () => ({ useCurrentUser: () => ({ roleKey: "administrator" }) }));
vi.mock("@/lib/voice/session", () => ({ getSessionToken: vi.fn().mockResolvedValue("token") }));

describe("Fleet / Transport admin", () => {
  afterEach(() => cleanup());

  it("loads Drivers, Units, and Transport Jobs sections without coupling entities", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ units: [], jobs: [], drivers: [{ id: "driver-a", display_name: "Driver A", active: true }], trailers: [] }), { status: 200 })));
    render(<FleetPage />);
    expect(await screen.findByRole("heading", { name: "Fleet / Transport" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Drivers" }));
    expect(screen.getByText("Driver A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Transport Jobs" }));
    expect(screen.getByRole("button", { name: "New Job" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Units" }));
    expect(screen.getByRole("button", { name: "Add Unit" })).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/fleet", expect.anything()));
  });

  it("keeps completed jobs available through the status filter", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      units: [{ id: "unit-a", registration: "FS01", internal_number: "U01", unit_type: "tractor_only", active: true, notes: null }],
      jobs: [{ id: "job-a", job_reference: "JOB-001", status: "completed", driver_id: null, unit_id: "unit-a", trailer_id: null, trailer_number_snapshot: null, customer: "Customer", booking_reference: "BOOK-1", collection_address: "Origin", delivery_address: "Destination", collection_at: null, delivery_at: null, notes: null, created_at: "2026-08-14T10:00:00.000Z" }],
      drivers: [],
      trailers: [],
    }), { status: 200 })));
    render(<FleetPage />);
    expect(await screen.findByRole("heading", { name: "Transport Jobs" })).toBeInTheDocument();
    expect(screen.queryByText("JOB-001")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Job status" }), { target: { value: "all" } });
    expect(screen.getByText("JOB-001")).toBeInTheDocument();
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(1);
  });
});
