// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DashboardDriverPage from "@/app/dashboard/driver/page";

vi.mock("@/components/mobile/driver-mobile-entry", () => ({
  DriverMobileEntry: () => <div data-testid="driver-mobile-entry">Driver Mobile Entry</div>,
}));

describe("DashboardDriverPage", () => {
  it("renders the role-aware Driver Mobile entry", () => {
    render(<DashboardDriverPage />);

    expect(screen.getByTestId("driver-mobile-entry")).toBeInTheDocument();
  });
});
