/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsUsersPage from "@/app/dashboard/settings/users/page";

vi.mock("@/components/auth/permission-guard", () => ({
  PermissionGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/settings/settings-nav", () => ({
  SettingsNav: () => <div data-testid="settings-nav" />,
}));

vi.mock("@/lib/auth/use-current-user", () => ({
  useCurrentUser: () => ({
    roleKey: "administrator",
    isLoading: false,
    userId: "admin-a",
    email: "admin@example.com",
    fullName: "Admin One",
    isActive: true,
    loadError: null,
  }),
}));

const fetchRbacJsonMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rbac/client-fetch", () => ({
  fetchRbacJson: fetchRbacJsonMock,
}));

const initialUsers = [
  {
    userId: "user-a",
    email: "driver@example.com",
    displayName: "Driver One",
    roleKey: null,
    isActive: null,
    lastSignInAt: "2026-08-12T00:00:00.000Z",
    driverLinked: false,
  },
];

const promotedUsers = [
  {
    userId: "user-a",
    email: "driver@example.com",
    displayName: "Driver One",
    roleKey: "driver",
    isActive: true,
    lastSignInAt: "2026-08-12T10:00:00.000Z",
    driverLinked: true,
  },
];

describe("SettingsUsersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    let getUsersCallCount = 0;
    fetchRbacJsonMock.mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === "/api/settings/users" && (!init || init.method === undefined || init.method === "GET")) {
        getUsersCallCount += 1;
        return { users: getUsersCallCount > 1 ? promotedUsers : initialUsers };
      }

      if (input === "/api/settings/users" && init?.method === "PATCH") {
        return {
          user: promotedUsers[0],
          auditEvent: {
            userId: "user-a",
            previousRole: "operator",
            newRole: "driver",
            previousIsActive: true,
            newIsActive: true,
            changedBy: "admin-a",
            changedAt: "2026-08-12T10:00:00.000Z",
          },
        };
      }

      throw new Error(`Unexpected request: ${input}`);
    });
  });

  it("refreshes and shows a promoted driver role after assigning an unassigned user", async () => {
    render(<SettingsUsersPage />);

    expect((await screen.findByRole("combobox") as HTMLSelectElement).value).toBe("");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "driver" } });

    await waitFor(() => {
      expect(screen.queryByText("User role updated successfully.")).not.toBeNull();
    });

    await waitFor(() => {
      expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("driver");
    });

    expect(fetchRbacJsonMock).toHaveBeenCalledWith("/api/settings/users");
    expect(fetchRbacJsonMock).toHaveBeenCalledWith(
      "/api/settings/users",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});
