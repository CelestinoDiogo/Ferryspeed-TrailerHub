// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TopHeader } from "@/components/layout/top-header";

const userState = {
  userId: "user-a",
  fullName: "Admin User",
  email: "admin@example.com",
  roleKey: "administrator" as const,
  isActive: true,
};

vi.mock("@/components/ai/operations-assistant-drawer", () => ({
  OperationsAssistantDrawer: () => null,
}));

vi.mock("@/components/layout/operations-tools-button", () => ({
  OperationsToolsButton: () => <button type="button">tools</button>,
}));

vi.mock("@/components/layout/operations-tools-drawer", () => ({
  OperationsToolsDrawer: () => null,
}));

vi.mock("@/components/layout/realtime-operations-center", () => ({
  RealtimeOperationsCenter: () => null,
}));

vi.mock("@/components/search/global-search", () => ({
  GlobalSearch: () => <div>search</div>,
}));

vi.mock("@/lib/auth/roles", () => ({
  toRoleLabel: () => "Administrator",
}));

vi.mock("@/lib/auth/use-current-user", () => ({
  useCurrentUser: () => userState,
}));

describe("TopHeader user status", () => {
  it("shows active status for an active administrator", () => {
    userState.isActive = true;

    render(<TopHeader title="Operations Command" subtitle="" onMenuClick={() => {}} />);

    expect(screen.getByText("Administrator • Active")).toBeInTheDocument();
  });

  it("shows inactive status for an inactive administrator", () => {
    userState.isActive = false;

    render(<TopHeader title="Operations Command" subtitle="" onMenuClick={() => {}} />);

    expect(screen.getByText("Administrator • Inactive")).toBeInTheDocument();
  });
});
