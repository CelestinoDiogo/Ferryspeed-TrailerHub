// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/login/page";

const { replaceMock, refreshMock, getSessionMock, getUserMock, signInMock, maybeSingleMock, searchParams } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  refreshMock: vi.fn(),
  getSessionMock: vi.fn(),
  getUserMock: vi.fn(),
  signInMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
  useSearchParams: () => searchParams,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      getUser: getUserMock,
      signInWithPassword: signInMock,
      onAuthStateChange: () => ({
        data: {
          subscription: {
            unsubscribe: vi.fn(),
          },
        },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: maybeSingleMock,
        }),
      }),
    }),
  },
}));

describe("LoginPage role-aware entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams.delete("returnTo");
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });

    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    getUserMock.mockResolvedValue({
      data: { user: { id: "driver-user" } },
      error: null,
    });
    maybeSingleMock.mockResolvedValue({
      data: { role_key: "driver", is_active: true },
      error: null,
    });
    signInMock.mockResolvedValue({
      data: {
        session: {
          access_token: "token",
          user: { id: "driver-user" },
        },
      },
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("sends a Driver to Driver Mobile after sign-in even when returnTo is Master Mobile", async () => {
    searchParams.set("returnTo", "/dashboard/mobile");

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "driver@ferryspeed.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-password" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign In" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/dashboard/driver");
    });

    expect(replaceMock).not.toHaveBeenCalledWith("/dashboard/mobile");
  });

  it("honors an explicit valid Driver returnTo after desktop sign-in", async () => {
    searchParams.set("returnTo", "/dashboard/driver");

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "driver@ferryspeed.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-password" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign In" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/dashboard/driver");
    });
  });

  it("keeps a desktop supervisor on the dashboard after sign-in", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { role_key: "supervisor", is_active: true },
      error: null,
    });
    getUserMock.mockResolvedValue({
      data: { user: { id: "supervisor-user" } },
      error: null,
    });
    signInMock.mockResolvedValue({
      data: {
        session: {
          access_token: "token",
          user: { id: "supervisor-user" },
        },
      },
      error: null,
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "supervisor@ferryspeed.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-password" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign In" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/dashboard");
    });
  });
});
