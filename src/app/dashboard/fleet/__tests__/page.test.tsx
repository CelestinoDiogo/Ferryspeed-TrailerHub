// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FleetPage from "@/app/dashboard/fleet/page";

vi.mock("@/components/auth/permission-guard", () => ({ PermissionGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/lib/auth/use-current-user", () => ({ useCurrentUser: () => ({ roleKey: "administrator" }) }));
vi.mock("@/lib/voice/session", () => ({ getSessionToken: vi.fn().mockResolvedValue("token") }));

describe("Fleet / Transport admin", () => {
  it("loads Drivers, Units, and Transport Jobs sections without coupling entities", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ units: [], jobs: [], drivers: [{ id: "driver-a", display_name: "Driver A", active: true }], trailers: [] }), { status: 200 })));
    render(<FleetPage />);
    expect(await screen.findByRole("heading", { name: "Fleet / Transport" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "drivers" }));
    expect(screen.getByText("Driver A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Transport Jobs" }));
    expect(screen.getByRole("button", { name: "New Job" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "units" }));
    expect(screen.getByRole("button", { name: "Add Unit" })).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/fleet", expect.anything()));
  });
});
