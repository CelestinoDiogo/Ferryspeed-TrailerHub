// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DashboardMobilePage from "@/app/dashboard/mobile/page";

vi.mock("@/components/mobile/supervisor-mobile-dashboard", () => ({
  SupervisorMobileDashboard: () => <div data-testid="supervisor-mobile-dashboard">Supervisor Mobile Dashboard</div>,
}));

describe("DashboardMobilePage", () => {
  it("renders mobile dashboard content without injecting desktop sidebar component at page level", () => {
    render(<DashboardMobilePage />);

    expect(screen.getByTestId("supervisor-mobile-dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Desktop Sidebar")).not.toBeInTheDocument();
  });
});
