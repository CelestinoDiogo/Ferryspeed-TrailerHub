// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppEntry } from "@/components/auth/app-entry";

const { replaceMock, refreshMock, getSessionMock, maybeSingleMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  refreshMock: vi.fn(),
  getSessionMock: vi.fn(),
  maybeSingleMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
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

describe("AppEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("sends an unauthenticated PWA open to login without a Master Mobile returnTo", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    render(<AppEntry />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/login");
    });

    expect(replaceMock).not.toHaveBeenCalledWith("/dashboard/mobile");
    expect(replaceMock).not.toHaveBeenCalledWith("/dashboard/driver");
  });

  it("routes a signed-in Driver from the PWA start URL to Driver Mobile", async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: "token",
          user: { id: "driver-user" },
        },
      },
      error: null,
    });
    maybeSingleMock.mockResolvedValue({
      data: { role_key: "driver", is_active: true },
      error: null,
    });

    render(<AppEntry />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/dashboard/driver");
    });

    expect(replaceMock).not.toHaveBeenCalledWith("/dashboard/mobile");
  });

  it("routes a signed-in supervisor from the PWA start URL to Master Mobile", async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: "token",
          user: { id: "supervisor-user" },
        },
      },
      error: null,
    });
    maybeSingleMock.mockResolvedValue({
      data: { role_key: "supervisor", is_active: true },
      error: null,
    });

    render(<AppEntry />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/dashboard/mobile");
    });

    expect(replaceMock).not.toHaveBeenCalledWith("/dashboard/driver");
  });
});
