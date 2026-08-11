// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DashboardDriverPage from "@/app/dashboard/driver/page";

vi.mock("@/components/mobile/driver-mobile-dashboard", () => ({
  DriverMobileDashboard: () => <div data-testid="driver-mobile-dashboard">Driver Mobile Dashboard</div>,
}));

describe("DashboardDriverPage", () => {
  it("renders the driver mobile dashboard component", () => {
    render(<DashboardDriverPage />);

    expect(screen.getByTestId("driver-mobile-dashboard")).toBeInTheDocument();
  });
});
