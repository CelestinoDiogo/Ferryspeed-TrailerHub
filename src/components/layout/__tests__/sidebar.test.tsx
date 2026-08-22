// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/layout/sidebar";

const { state } = vi.hoisted(() => ({
  state: {
    roleKey: "supervisor" as "administrator" | "supervisor" | "operator" | "driver" | null,
  },
}));

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt ?? ""} />,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/lib/auth/use-current-user", () => ({
  useCurrentUser: () => ({ roleKey: state.roleKey }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signOut: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

afterEach(() => {
  cleanup();
});

describe("Sidebar", () => {
  beforeEach(() => {
    state.roleKey = "supervisor";
  });

  it("shows sidebar navigation including Master Mobile for authorized roles", () => {
    render(<Sidebar />);

    expect(screen.getByRole("link", { name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Master Mobile/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Driver Mobile/i })).toHaveAttribute("href", "/dashboard/driver");
    expect(screen.getByRole("link", { name: /Driver Communications/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /History & Reports/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Reports Hub" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Export Operations" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Deliveries" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Collections" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Departures" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Compound" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Fleet / Transport" })).not.toBeInTheDocument();
  });

  it("expands and collapses the consolidated History & Reports group", () => {
    render(<Sidebar />);
    const toggle = screen.getByRole("button", { name: /History & Reports/i });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Reports Hub" })).toHaveAttribute("href", "/dashboard/reports");
    expect(screen.getByRole("link", { name: "Operational Summary" })).toHaveAttribute("href", "/dashboard/reports/operational-summary");
    expect(screen.getByRole("link", { name: "Historical Reports" })).toHaveAttribute("href", "/dashboard/reports/historical");
    expect(screen.getByRole("link", { name: "Trailers Stopped >3 Days" })).toHaveAttribute("href", "/dashboard/reports/stopped-trailers");
    expect(screen.getByRole("link", { name: "Arrivals Report" })).toHaveAttribute("href", "/dashboard/arrivals");
    expect(screen.getByRole("link", { name: "Departures Report" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Deliveries Report" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Collections Report" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Compound Snapshot" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Compound Activity" })).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Reports Hub" })).not.toBeInTheDocument();
  });

  it("keeps unauthorized role behavior by hiding dashboard navigation items", () => {
    state.roleKey = "driver";
    render(<Sidebar />);

    expect(screen.queryByRole("link", { name: /^Dashboard$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Master Mobile/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Driver Mobile/i })).toHaveAttribute("href", "/dashboard/driver");
    expect(screen.queryByRole("link", { name: /Driver Communications/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /History & Reports/i })).not.toBeInTheDocument();
  });

  it("does not advertise manager-only Driver Communications to Operators", () => {
    state.roleKey = "operator";
    render(<Sidebar />);

    expect(screen.queryByRole("link", { name: /Driver Communications/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Dashboard$/i })).toBeInTheDocument();
  });
});
