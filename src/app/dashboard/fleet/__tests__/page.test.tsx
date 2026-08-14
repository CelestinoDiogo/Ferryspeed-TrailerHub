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

  it("loads immutable history only when the selected Job requests it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ units: [], jobs: [{ id: "job-a", job_reference: "JOB-001", status: "planned", driver_id: null, unit_id: null, trailer_id: null, trailer_number_snapshot: null, customer: null, booking_reference: null, collection_address: null, delivery_address: null, collection_at: null, delivery_at: null, notes: null, created_at: "2026-08-14T10:00:00.000Z" }], drivers: [], trailers: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [{ id: "event-a", event_type: "job_created", event_title: "Job created", event_description: "Initial Transport Job state recorded.", metadata: {}, created_by_user_id: null, created_at: "2026-08-14T10:00:00.000Z", previous_driver_id: null, new_driver_id: null, previous_unit_id: null, new_unit_id: null, previous_trailer_id: null, new_trailer_id: null, previous_status: null, new_status: "planned" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<FleetPage />);
    expect(await screen.findByText("JOB-001")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByRole("heading", { name: "History: JOB-001" })).toBeInTheDocument();
    expect(screen.getByText("Job created")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/fleet?jobId=job-a", expect.anything());
    expect(screen.queryByRole("button", { name: /delete|edit event|clear history/i })).not.toBeInTheDocument();
  });

  it("submits the Add Unit form with the canonical transport type and blank notes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ units: [], jobs: [], drivers: [], trailers: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<FleetPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Units" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Unit" }));
    fireEvent.change(screen.getByLabelText("Registration"), { target: { value: "unit test" } });
    fireEvent.change(screen.getByLabelText("Internal number"), { target: { value: "1" } });
    fireEvent.change(screen.getAllByLabelText("Transport type").at(-1)!, { target: { value: "tractor_only" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Unit" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({ entity: "unit", registration: "unit test", internalNumber: "1", unitType: "tractor_only", active: true, notes: "" });
  });
});
