// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalSearch } from "@/components/search/global-search";

const searchGlobalMock = vi.fn();

vi.mock("@/lib/search/global-search-client", () => ({
  searchGlobal: (...args: unknown[]) => searchGlobalMock(...args),
}));

const defaultResponse = {
  query: "pfc",
  normalizedQuery: "pfc",
  limit: 20,
  offset: 0,
  totalMatched: 1,
  hasMore: false,
  results: [
    {
      id: "trailer:1",
      category: "trailers" as const,
      title: "PFC123",
      subtitle: "Customer A",
      status: "active",
      href: "/dashboard/trailers/1",
      quickActionLabel: "Open trailer",
    },
  ],
  groups: [
    {
      category: "trailers" as const,
      label: "Trailers",
      count: 1,
      items: [
        {
          id: "trailer:1",
          category: "trailers" as const,
          title: "PFC123",
          subtitle: "Customer A",
          status: "active",
          href: "/dashboard/trailers/1",
          quickActionLabel: "Open trailer",
        },
      ],
    },
  ],
};

describe("GlobalSearch", () => {
  beforeEach(() => {
    searchGlobalMock.mockResolvedValue(defaultResponse);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("opens with Ctrl+K, focuses input, and closes with Escape", async () => {
    render(<GlobalSearch mode="desktop" />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByLabelText("Search");

    expect(screen.getByRole("dialog", { name: "Global search" })).toBeInTheDocument();
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Global search" })).not.toBeInTheDocument();
    });
  });

  it("recovers from corrupted localStorage data", async () => {
    window.localStorage.setItem("trailerhub.global-search.recent.v1", "{");
    window.localStorage.setItem("trailerhub.global-search.history.v1", "not-json");

    render(<GlobalSearch mode="desktop" />);
    fireEvent.click(screen.getByRole("button", { name: "Open global search" }));

    expect(await screen.findByText("No recent searches yet.")).toBeInTheDocument();
    expect(screen.getByText("Search history is empty.")).toBeInTheDocument();
  });

  it("de-duplicates recent searches and caps to 10", async () => {
    searchGlobalMock.mockResolvedValue({ ...defaultResponse, results: [], groups: [] });

    render(<GlobalSearch mode="desktop" />);
    fireEvent.click(screen.getByRole("button", { name: "Open global search" }));

    const input = await screen.findByLabelText("Search");

    for (let index = 1; index <= 11; index += 1) {
      fireEvent.change(input, { target: { value: `PFC ${index}` } });
      fireEvent.keyDown(input, { key: "Enter" });
    }

    fireEvent.change(input, { target: { value: "PFC 5" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const storedRecent = JSON.parse(window.localStorage.getItem("trailerhub.global-search.recent.v1") ?? "[]") as Array<{ query: string }>;
    const pfc5Count = storedRecent.filter((entry) => entry.query === "PFC 5").length;

    expect(storedRecent).toHaveLength(10);
    expect(pfc5Count).toBe(1);
  });
});
