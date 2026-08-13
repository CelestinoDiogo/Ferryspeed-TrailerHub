import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadCurrentUserRoleMock, requireRbacPermissionMock } = vi.hoisted(() => ({
  loadCurrentUserRoleMock: vi.fn(),
  requireRbacPermissionMock: vi.fn(),
}));

vi.mock("@/lib/rbac/service", () => ({ loadCurrentUserRole: loadCurrentUserRoleMock }));
vi.mock("@/lib/rbac/route", () => ({ requireRbacPermission: requireRbacPermissionMock }));

import { requireDriverMobileReadAccess } from "@/lib/driver-mobile-read-access";

describe("requireDriverMobileReadAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["administrator", "supervisor"])("allows active %s preview reads without mutable Driver permission rows", async (roleKey) => {
    loadCurrentUserRoleMock.mockResolvedValue({ role_key: roleKey, is_active: true });

    await expect(requireDriverMobileReadAccess({} as never, "manager-user")).resolves.toMatchObject({ role_key: roleKey });
    expect(requireRbacPermissionMock).not.toHaveBeenCalled();
  });

  it("preserves existing RBAC enforcement for a real Driver", async () => {
    loadCurrentUserRoleMock.mockResolvedValue({ role_key: "driver", is_active: true });

    await requireDriverMobileReadAccess({} as never, "driver-user");
    expect(requireRbacPermissionMock).toHaveBeenCalledWith({}, "driver-user", "driver_mobile", "view");
  });

  it("rejects non-preview operational roles", async () => {
    loadCurrentUserRoleMock.mockResolvedValue({ role_key: "operator", is_active: true });

    await expect(requireDriverMobileReadAccess({} as never, "operator-user")).rejects.toMatchObject({
      code: "PREVIEW_NOT_ALLOWED",
      status: 403,
    });
  });

  it("preserves inactive-profile denial through existing RBAC", async () => {
    loadCurrentUserRoleMock.mockResolvedValue({ role_key: "administrator", is_active: false });
    requireRbacPermissionMock.mockRejectedValue(new Error("inactive"));

    await expect(requireDriverMobileReadAccess({} as never, "inactive-user")).rejects.toThrow("inactive");
  });
});
