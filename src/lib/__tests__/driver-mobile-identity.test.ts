import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadCurrentUserRoleMock, loadActiveDriverForUserMock, loadDriverByIdMock } = vi.hoisted(() => ({
  loadCurrentUserRoleMock: vi.fn(),
  loadActiveDriverForUserMock: vi.fn(),
  loadDriverByIdMock: vi.fn(),
}));

vi.mock("@/lib/rbac/service", () => ({ loadCurrentUserRole: loadCurrentUserRoleMock }));
vi.mock("@/lib/driver-access", () => ({
  loadActiveDriverForUser: loadActiveDriverForUserMock,
  loadDriverById: loadDriverByIdMock,
}));

import { resolveDriverMobileReadContext } from "@/lib/driver-mobile-identity";

const activeDriver = { id: "driver-a", user_id: "driver-user", display_name: "Driver A", active: true };

describe("resolveDriverMobileReadContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves a Driver role from its own active profile", async () => {
    loadCurrentUserRoleMock.mockResolvedValue({ role_key: "driver", is_active: true });
    loadActiveDriverForUserMock.mockResolvedValue(activeDriver);

    await expect(resolveDriverMobileReadContext({} as never, "driver-user")).resolves.toMatchObject({
      roleKey: "driver",
      driver: activeDriver,
      isPreview: false,
    });
  });

  it("requires an active profile for a Driver role", async () => {
    loadCurrentUserRoleMock.mockResolvedValue({ role_key: "driver", is_active: true });
    loadActiveDriverForUserMock.mockResolvedValue(null);

    await expect(resolveDriverMobileReadContext({} as never, "driver-user")).rejects.toMatchObject({
      code: "DRIVER_PROFILE_REQUIRED",
    });
  });

  it.each(["administrator", "supervisor"])("does not auto-resolve a linked %s profile", async (roleKey) => {
    loadCurrentUserRoleMock.mockResolvedValue({ role_key: roleKey, is_active: true });

    await expect(resolveDriverMobileReadContext({} as never, "manager-user")).rejects.toMatchObject({
      code: "PREVIEW_DRIVER_REQUIRED",
    });
    expect(loadActiveDriverForUserMock).not.toHaveBeenCalled();
  });

  it("rejects a Driver-supplied preview identity", async () => {
    loadCurrentUserRoleMock.mockResolvedValue({ role_key: "driver", is_active: true });

    await expect(resolveDriverMobileReadContext({} as never, "driver-user", "driver-b")).rejects.toMatchObject({
      code: "PREVIEW_NOT_ALLOWED",
      status: 403,
    });
    expect(loadDriverByIdMock).not.toHaveBeenCalled();
  });

  it.each(["administrator", "supervisor"])("allows %s to select an active Driver", async (roleKey) => {
    loadCurrentUserRoleMock.mockResolvedValue({ role_key: roleKey, is_active: true });
    loadDriverByIdMock.mockResolvedValue(activeDriver);

    await expect(resolveDriverMobileReadContext({} as never, "manager-user", "driver-a")).resolves.toMatchObject({
      roleKey,
      driver: activeDriver,
      isPreview: true,
    });
  });

  it("rejects an invalid preview Driver", async () => {
    loadCurrentUserRoleMock.mockResolvedValue({ role_key: "administrator", is_active: true });
    loadDriverByIdMock.mockResolvedValue(null);

    await expect(resolveDriverMobileReadContext({} as never, "admin-user", "missing")).rejects.toMatchObject({
      code: "PREVIEW_DRIVER_INVALID",
    });
  });

  it("rejects an inactive preview Driver", async () => {
    loadCurrentUserRoleMock.mockResolvedValue({ role_key: "supervisor", is_active: true });
    loadDriverByIdMock.mockResolvedValue({ ...activeDriver, active: false });

    await expect(resolveDriverMobileReadContext({} as never, "supervisor-user", "driver-a")).rejects.toMatchObject({
      code: "PREVIEW_DRIVER_INACTIVE",
    });
  });
});
