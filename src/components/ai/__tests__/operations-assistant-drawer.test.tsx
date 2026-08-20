// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/operations-command-centre",
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: "token" } }, error: null })),
      refreshSession: vi.fn(),
    },
  },
}));

import { OperationsAssistantDrawer } from "@/components/ai/operations-assistant-drawer";

const drawerSource = readFileSync(
  path.resolve(process.cwd(), "src/components/ai/operations-assistant-drawer.tsx"),
  "utf8",
);

afterEach(() => {
  cleanup();
});

describe("AI Operations assistant workspace", () => {
  it("uses a substantially wider desktop panel while keeping mobile full-width behavior", () => {
    expect(drawerSource).toContain("w-[min(92vw,80rem)]");
    expect(drawerSource).not.toContain("max-w-[640px]");
    expect(drawerSource).toContain("inset-x-0 bottom-0 top-[8vh]");
  });

  it("keeps a viewport-filling scrollable response region and an intact prompt", () => {
    render(<OperationsAssistantDrawer open onClose={() => undefined} />);

    expect(screen.getByRole("dialog", { name: "AI operations assistant" })).toBeInTheDocument();
    expect(screen.getByLabelText("Ask question")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Where is PRO810?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();

    const responseRegion = screen.getByText("No conversation yet. Ask an operational question to begin.").closest("div.min-h-0");
    expect(responseRegion?.className).toContain("flex-1");
    expect(responseRegion?.className).toContain("overflow-y-auto");
  });
});
