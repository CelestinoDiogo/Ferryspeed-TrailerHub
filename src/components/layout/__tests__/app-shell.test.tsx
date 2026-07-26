// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/app-shell";

afterEach(() => {
  cleanup();
});

vi.mock("@/components/layout/sidebar", () => ({
  Sidebar: ({ mobile = false }: { mobile?: boolean }) => (
    <div data-testid={mobile ? "sidebar-mobile" : "sidebar-desktop"}>{mobile ? "Mobile Sidebar" : "Desktop Sidebar"}</div>
  ),
}));

vi.mock("@/components/layout/top-header", () => ({
  TopHeader: ({ onMenuClick }: { onMenuClick: () => void }) => (
    <button type="button" onClick={onMenuClick}>
      Open navigation
    </button>
  ),
}));

describe("AppShell", () => {
  it("renders desktop sidebar wrapper and page content", () => {
    render(
      <AppShell>
        <div>Dashboard Content</div>
      </AppShell>,
    );

    expect(screen.getByTestId("sidebar-desktop")).toBeInTheDocument();
    expect(screen.getByText("Dashboard Content")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-mobile")).not.toBeInTheDocument();
  });

  it("keeps desktop sidebar mounted even when standalone display-mode is active", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(display-mode: standalone)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    render(
      <AppShell>
        <div>Standalone Desktop</div>
      </AppShell>,
    );

    expect(screen.getByTestId("sidebar-desktop")).toBeInTheDocument();
    expect(screen.getByText("Standalone Desktop")).toBeInTheDocument();
  });

  it("opens the mobile drawer sidebar from the header menu action", () => {
    render(
      <AppShell>
        <div>Dashboard Content</div>
      </AppShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByTestId("sidebar-mobile")).toBeInTheDocument();
  });
});
