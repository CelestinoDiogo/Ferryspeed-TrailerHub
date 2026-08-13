// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriverMobilePreview } from "@/components/mobile/driver-mobile-preview";

const fetchMock = vi.fn();

vi.mock("@/components/auth/permission-guard", () => ({ PermissionGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/lib/auth/use-current-user", () => ({ useCurrentUser: () => ({ fullName: "Admin User", email: "admin@example.com" }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { signOut: vi.fn() } } }));
vi.mock("@/lib/voice/session", () => ({ getSessionToken: () => Promise.resolve("token") }));

const task = {
  taskId: "booking-a", driverId: "driver-a", taskKind: "collection", bookingId: "booking-a", trailerId: "trailer-a",
  trailerNumber: "FS100", customer: "Customer A", consignee: null, location: "Dock 1", bookingReference: "BK-A", notes: null,
  status: "waiting_collection", deliveryDate: "2026-08-13", deliveryTime: "10:00:00", group: "current", nextAction: "COLLECTED",
  deliveredAt: null, collectedAt: null, waitingCollectionSince: "2026-08-12T08:00:00.000Z", collectedTemperatureC: null,
  driverAcknowledgedAt: "2026-08-12T07:00:00.000Z", driverAcknowledgedBy: "driver-user", temperature: { required: true },
  collectionAging: { level: "red", label: "Over 48h", waitingHours: 54, waitingSince: "2026-08-11T04:00:00.000Z", dueDate: null, isOverdue: true, overdueDays: 2 },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("preview-drivers")) return new Response(JSON.stringify({ drivers: [{ id: "driver-a", displayName: "Driver A" }, { id: "driver-b", displayName: "Driver B" }] }), { status: 200 });
    if (url.includes("/tasks?")) return new Response(JSON.stringify({ driver: { id: "driver-a", display_name: "Driver A" }, tasks: [task], mode: "preview", readOnly: true }), { status: 200 });
    if (url.includes("/instructions?")) return new Response(JSON.stringify({ recent: [{ id: "instruction-a", deliveryBookingId: "booking-a", trailerId: "trailer-a", trailerNumber: "FS100", instruction: "Stop and call operations", priority: "critical", createdAt: "2026-08-13T10:00:00.000Z", readAt: null }], mode: "preview", readOnly: true }), { status: 200 });
    return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
  });
});


afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DriverMobilePreview", () => {
  it.each(["administrator", "supervisor"] as const)("shows explicit selector state for %s", async (roleKey) => {
    render(<DriverMobilePreview roleKey={roleKey} />);
    expect(screen.getByText("Select a Driver to preview")).toBeInTheDocument();
    expect(screen.queryByText("Driver profile required")).not.toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Driver A" })).toBeInTheDocument();
    expect(screen.queryByText("You do not have permission to perform this action.")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/tasks"))).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/instructions"))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders a real selector authorization failure as an error", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: "You do not have permission to perform this action.",
      code: "RBAC_PERMISSION_DENIED",
    }), { status: 403 }));

    render(<DriverMobilePreview roleKey="administrator" />);

    expect(await screen.findByText("You do not have permission to perform this action.")).toBeInTheDocument();
  });

  it("loads only the explicitly selected Driver and clearly labels read-only preview", async () => {
    render(<DriverMobilePreview roleKey="administrator" />);
    fireEvent.change(await screen.findByLabelText("Active Driver"), { target: { value: "driver-a" } });

    expect(await screen.findByText("Previewing Driver: Driver A")).toBeInTheDocument();
    expect(screen.getAllByText("READ-ONLY PREVIEW").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Over 48h · 54h pending").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Temperature required on collection").length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("previewDriverId=driver-a"))).toBe(true);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(screen.queryByRole("button", { name: /ACKNOWLEDGE|COLLECTED|DELIVERED/ })).not.toBeInTheDocument();
  });

  it("keeps critical overlays visible but non-interactive", async () => {
    render(<DriverMobilePreview roleKey="supervisor" />);
    fireEvent.change(await screen.findByLabelText("Active Driver"), { target: { value: "driver-a" } });

    const overlay = await screen.findByRole("dialog", { name: "Operational alert overlay" });
    expect(within(overlay).getByText("Critical")).toBeInTheDocument();
    expect(within(overlay).getByText("Stop and call operations")).toBeInTheDocument();
    expect(within(overlay).getByText("READ-ONLY PREVIEW")).toBeInTheDocument();
    fireEvent.click(within(overlay).getByRole("button", { name: "Close Preview Alert" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Operational alert overlay" })).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("exits preview and clears selected Driver context", async () => {
    render(<DriverMobilePreview roleKey="administrator" />);
    fireEvent.change(await screen.findByLabelText("Active Driver"), { target: { value: "driver-a" } });
    expect(await screen.findByText("Previewing Driver: Driver A")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Exit Preview" }));
    await waitFor(() => expect(screen.getByText("Select a Driver to preview")).toBeInTheDocument());
    expect(screen.queryByText("FS100")).not.toBeInTheDocument();
  });
});