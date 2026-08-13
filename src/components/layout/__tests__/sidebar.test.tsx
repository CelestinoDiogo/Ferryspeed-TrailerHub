// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
  });

  it("keeps unauthorized role behavior by hiding dashboard navigation items", () => {
    state.roleKey = "driver";
    render(<Sidebar />);

    expect(screen.queryByRole("link", { name: /^Dashboard$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Master Mobile/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Driver Mobile/i })).not.toBeInTheDocument();
  });
});
