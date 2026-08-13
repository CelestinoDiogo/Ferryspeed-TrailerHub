// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DashboardDriverPage from "@/app/dashboard/driver/page";

vi.mock("@/components/mobile/driver-mobile-jobs-dashboard", () => ({
  DriverMobileJobsDashboard: () => <div data-testid="driver-mobile-jobs-dashboard">Driver Mobile Jobs Dashboard</div>,
}));

describe("DashboardDriverPage", () => {
  it("renders the driver mobile jobs dashboard component", () => {
    render(<DashboardDriverPage />);

    expect(screen.getByTestId("driver-mobile-jobs-dashboard")).toBeInTheDocument();
  });
});
