// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ReportsPage from "@/app/dashboard/reports/page";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));

describe("Reports hub", () => {
  it("renders navigation-only links without loading report data", () => {
    render(<ReportsPage />);
    expect(screen.getByRole("heading", { name: "Reports" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Export Operations Report/i })).toHaveAttribute("href", "/dashboard/export-operations");
    expect(screen.getByRole("link", { name: /Compound Activity/i })).toHaveAttribute("href", "/dashboard/compound/history");
    expect(screen.getAllByRole("link")).toHaveLength(7);
  });
});
