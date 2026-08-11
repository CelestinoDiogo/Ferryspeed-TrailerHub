// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/app-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/driver",
}));

vi.mock("@/components/layout/sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar-desktop">Desktop Sidebar</div>,
}));

vi.mock("@/components/layout/top-header", () => ({
  TopHeader: () => <div data-testid="top-header">Header</div>,
}));

describe("AppShell driver route", () => {
  it("bypasses desktop shell chrome for /dashboard/driver", () => {
    render(
      <AppShell>
        <div>Driver Dashboard Content</div>
      </AppShell>,
    );

    expect(screen.getByText("Driver Dashboard Content")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-desktop")).not.toBeInTheDocument();
    expect(screen.queryByTestId("top-header")).not.toBeInTheDocument();
  });
});
