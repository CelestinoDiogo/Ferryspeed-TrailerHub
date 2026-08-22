// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardAuthGuard } from "@/components/auth/dashboard-auth-guard";

const useCurrentUserMock = vi.hoisted(() => vi.fn());
const canAccessModuleMock = vi.hoisted(() => vi.fn());

const { replaceMock, refreshMock, getSessionMock, onAuthStateChangeMock, signOutMock, pathnameState } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  refreshMock: vi.fn(),
  getSessionMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
  signOutMock: vi.fn(),
  pathnameState: { value: "/dashboard/driver" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
  usePathname: () => pathnameState.value,
}));

vi.mock("@/lib/auth/use-current-user", () => ({
  useCurrentUser: () => useCurrentUserMock(),
}));

vi.mock("@/lib/auth/permissions", () => ({
  canAccessModule: canAccessModuleMock,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
      signOut: signOutMock,
    },
  },
}));

describe("DashboardAuthGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameState.value = "/dashboard/driver";

    useCurrentUserMock.mockReturnValue({
      userId: "driver-user",
      roleKey: "driver",
      loadError: null,
      isLoading: false,
    });

    canAccessModuleMock.mockReturnValue(true);

    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: "token",
          user: { id: "driver-user" },
        },
      },
      error: null,
    });

    onAuthStateChangeMock.mockReturnValue({
      data: {
        subscription: {
          unsubscribe: vi.fn(),
        },
      },
    });

    signOutMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("allows a correctly authorized driver to reach dashboard driver route", async () => {
    render(
      <DashboardAuthGuard>
        <div>Driver Content</div>
      </DashboardAuthGuard>,
    );

    await waitFor(() => {
      expect(screen.getByText("Driver Content")).toBeInTheDocument();
    });

    expect(canAccessModuleMock).toHaveBeenCalledWith("driver", "driver_mobile");
  });

  it("renders access denied when route permission check fails on the role home", async () => {
    canAccessModuleMock.mockReturnValue(false);

    render(
      <DashboardAuthGuard>
        <div>Driver Content</div>
      </DashboardAuthGuard>,
    );

    await waitFor(() => {
      expect(screen.getByText("Access denied")).toBeInTheDocument();
    });

    expect(screen.queryByText("Driver Content")).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalledWith("/dashboard/driver");
  });

  it("redirects a Driver off Master Mobile onto Driver Mobile instead of Access Denied", async () => {
    pathnameState.value = "/dashboard/mobile";
    canAccessModuleMock.mockImplementation((roleKey: string, moduleKey: string) => roleKey === "driver" && moduleKey === "driver_mobile");

    render(
      <DashboardAuthGuard>
        <div>Master Mobile</div>
      </DashboardAuthGuard>,
    );

    await waitFor(() => {
      expect(screen.getByText("Opening your workspace")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/dashboard/driver");
    });

    expect(screen.queryByText("Access denied")).not.toBeInTheDocument();
    expect(screen.queryByText("Master Mobile")).not.toBeInTheDocument();
  });

  it("keeps sign out visible in denied state and signs out to login", async () => {
    canAccessModuleMock.mockReturnValue(false);

    render(
      <DashboardAuthGuard>
        <div>Driver Content</div>
      </DashboardAuthGuard>,
    );

    const signOutButton = await screen.findByRole("button", { name: "Sign Out" });
    fireEvent.click(signOutButton);

    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalledTimes(1);
      expect(replaceMock).toHaveBeenCalledWith("/login");
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
  });
});
