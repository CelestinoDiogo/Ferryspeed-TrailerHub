// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OfflinePage from "@/app/offline/page";

describe("OfflinePage", () => {
  it("communicates offline safety and mobile recovery actions", () => {
    render(<OfflinePage />);

    expect(screen.getByRole("heading", { name: "You are offline" })).toBeInTheDocument();
    expect(screen.getByText("Driver and operational status actions require an online connection and are not queued offline yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Master Mobile" })).toHaveAttribute("href", "/dashboard/mobile");
  });
});
