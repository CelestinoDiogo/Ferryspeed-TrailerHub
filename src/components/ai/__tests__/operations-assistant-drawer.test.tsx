// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const SUGGESTED_QUESTIONS = [
  "Show waiting trailers",
  "Where is PRO810?",
  "Show priority trailers",
  "Show compound occupancy",
  "Show damaged trailers",
  "Show temperature alerts",
  "Summarise today's operation",
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AI Operations assistant workspace", () => {
  it("presents the desktop assistant as a bounded centered modal rather than a full-width panel", () => {
    expect(drawerSource).toContain("createPortal");
    expect(drawerSource).toContain('role="dialog"');
    expect(drawerSource).toContain("md:flex md:items-center md:justify-center");
    expect(drawerSource).toContain("md:w-[min(78vw,1080px)]");
    expect(drawerSource).toContain("md:h-[88vh]");
    expect(drawerSource).toContain("md:max-h-[min(90vh,100%)]");
    expect(drawerSource).toContain("md:rounded-3xl");
    expect(drawerSource).not.toContain("md:w-[min(92vw,80rem)]");
    expect(drawerSource).not.toContain("max-w-[640px]");

    render(<OperationsAssistantDrawer open onClose={() => undefined} />);

    const dialog = screen.getByRole("dialog", { name: "AI operations assistant" });
    expect(dialog).toHaveAttribute("data-assistant-presentation", "desktop-modal");
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.querySelector("[data-assistant-backdrop='true']")).toBeInTheDocument();
    expect(dialog.querySelector("[data-assistant-surface='desktop-modal']")?.className).toContain("md:w-[min(78vw,1080px)]");
  });

  it("keeps a viewport-filling scrollable response region and an intact prompt", () => {
    render(<OperationsAssistantDrawer open onClose={() => undefined} />);

    expect(screen.getByRole("dialog", { name: "AI operations assistant" })).toBeInTheDocument();
    expect(screen.getByLabelText("Ask question")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Where is PRO810?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close AI assistant" })).toBeInTheDocument();

    const responseRegion = screen.getByText("No conversation yet. Ask an operational question to begin.").closest("div.min-h-0");
    expect(responseRegion?.className).toContain("flex-1");
    expect(responseRegion?.className).toContain("overflow-y-auto");
    expect(responseRegion).toHaveAttribute("data-assistant-conversation", "true");
  });

  it("keeps the question input below the conversation area", () => {
    render(<OperationsAssistantDrawer open onClose={() => undefined} />);

    const dialog = screen.getByRole("dialog", { name: "AI operations assistant" });
    const conversation = dialog.querySelector("[data-assistant-conversation='true']");
    const input = dialog.querySelector("[data-assistant-input='true']");

    expect(conversation).toBeInTheDocument();
    expect(input).toBeInTheDocument();
    expect(input?.className).toContain("shrink-0");
    expect(conversation && input && (conversation.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  });

  it("keeps all existing suggested operational actions", () => {
    render(<OperationsAssistantDrawer open onClose={() => undefined} />);

    for (const question of SUGGESTED_QUESTIONS) {
      expect(screen.getByRole("button", { name: question })).toBeInTheDocument();
    }
  });

  it("preserves the mobile sheet presentation", () => {
    expect(drawerSource).toContain("inset-x-0 bottom-0 top-[8vh]");
    expect(drawerSource).toContain("rounded-t-3xl");
    expect(drawerSource).toContain("w-[min(92vw,80rem)]");

    render(<OperationsAssistantDrawer open onClose={() => undefined} mobile />);

    const dialog = screen.getByRole("dialog", { name: "AI operations assistant" });
    expect(dialog).toHaveAttribute("data-assistant-presentation", "mobile-sheet");
    expect(dialog.querySelector("[data-assistant-surface='mobile-sheet']")?.className).toContain("inset-x-0");
    expect(dialog.querySelector("[data-assistant-surface='mobile-sheet']")?.className).toContain("top-[8vh]");
    expect(screen.getByRole("button", { name: "Close AI assistant" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("does not change the AI assistant API request contract", async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      void url;
      void options;
      return {
        ok: true,
        json: async () => ({
          intent: "find_trailer",
          title: "Trailer PRO810",
          summary: "PRO810 is Loaded at A12.",
          answer: "PRO810 is Loaded at A12.",
          resultType: "trailer",
          data: [],
          links: [],
          sourceModules: ["trailers"],
          queriedAt: "2026-08-20T08:00:00.000Z",
          items: [
            {
              trailerNumber: "PRO810",
              status: "Loaded",
              compoundPosition: "A12",
              customer: "Acme",
              detail: "Load Loaded · Active",
            },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<OperationsAssistantDrawer open onClose={() => undefined} />);

    await user.type(screen.getByLabelText("Ask question"), "Where is PRO810?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("expected the assistant to call fetch");
    }
    const [url, options] = firstCall;
    if (!options) {
      throw new Error("expected fetch request options");
    }
    expect(url).toBe("/api/ai-assistant");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual(expect.objectContaining({
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    }));

    const body = JSON.parse(String(options.body)) as { question: string; context: { pathname?: string } };
    expect(body.question).toBe("Where is PRO810?");
    expect(body.context).toEqual(expect.objectContaining({
      pathname: "/dashboard/operations-command-centre",
    }));

    expect(screen.getByText("PRO810 is Loaded at A12.")).toBeInTheDocument();
    expect(screen.getByText("PRO810")).toBeInTheDocument();
    expect(screen.getByText("Loaded")).toBeInTheDocument();
    expect(screen.getByText("A12")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();

    const assistantCard = screen.getByText("PRO810 is Loaded at A12.").closest("article");
    expect(assistantCard?.className).not.toMatch(/max-h-/);
  });
});
