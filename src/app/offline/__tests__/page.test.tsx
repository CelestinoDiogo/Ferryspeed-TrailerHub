// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OfflinePage from "@/app/offline/page";

describe("OfflinePage", () => {
  it("communicates offline safety and mobile recovery actions", () => {
    render(<OfflinePage />);

    expect(screen.getByRole("heading", { name: "You are offline" })).toBeInTheDocument();
    expect(screen.getByText("Driver Mobile queues COLLECTED, DELIVERED, and instruction acknowledgements until the connection returns. Do not treat a pending action as completed until the server confirms it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Driver Mobile" })).toHaveAttribute("href", "/dashboard/driver");
    expect(screen.getByRole("link", { name: "Open Master Mobile" })).toHaveAttribute("href", "/dashboard/mobile");
  });
});
