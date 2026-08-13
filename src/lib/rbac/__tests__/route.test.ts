import { beforeEach, describe, expect, it, vi } from "vitest";

const { evaluatePermissionMock } = vi.hoisted(() => ({
  evaluatePermissionMock: vi.fn(),
}));

vi.mock("@/lib/rbac/service", () => ({
  ensureCurrentUserRole: vi.fn(),
  evaluatePermission: evaluatePermissionMock,
}));

import { requireRbacPermission } from "@/lib/rbac/route";

describe("requireRbacPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows successful permission decisions", async () => {
    evaluatePermissionMock.mockResolvedValue({ allowed: true });

    await expect(requireRbacPermission({} as never, "user-a", "settings", "view")).resolves.toBeUndefined();
  });

  it.each([
    ["PROFILE_INACTIVE", "RBAC_PROFILE_INACTIVE", "Your application profile is inactive."],
    ["PROFILE_MISSING", "RBAC_PROFILE_MISSING", "Application profile is missing for this account."],
    ["STATIC_PERMISSION_DENIED", "RBAC_PERMISSION_DENIED", "You do not have permission to perform this action."],
    ["DB_PERMISSION_DENIED", "RBAC_PERMISSION_DENIED", "You do not have permission to perform this action."],
  ])("maps %s to %s", async (reason, code, message) => {
    evaluatePermissionMock.mockResolvedValue({ allowed: false, reason });

    await expect(requireRbacPermission({} as never, "user-a", "settings", "view")).rejects.toMatchObject({
      status: 403,
      code,
      message,
    });
  });
});
