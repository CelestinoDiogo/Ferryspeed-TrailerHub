import { describe, expect, it } from "vitest";
import {
  APP_ENTRY_PATH,
  DESKTOP_HOME_PATH,
  DRIVER_HOME_PATH,
  MASTER_MOBILE_PATH,
  canRoleAccessPath,
  resolveRoleAwareEntryPath,
  resolveRoleHomePath,
} from "@/lib/auth/app-entry-path";
import { canAccessModule } from "@/lib/auth/permissions";

describe("role-aware app entry path", () => {
  it("sends an installed PWA Driver to Driver Mobile, not Master Mobile", () => {
    expect(
      resolveRoleAwareEntryPath({
        roleKey: "driver",
        isActive: true,
        returnTo: null,
        standalone: true,
      }),
    ).toBe(DRIVER_HOME_PATH);

    expect(
      resolveRoleAwareEntryPath({
        roleKey: "driver",
        isActive: true,
        returnTo: MASTER_MOBILE_PATH,
        standalone: true,
      }),
    ).toBe(DRIVER_HOME_PATH);
  });

  it("does not honor Master Mobile returnTo after an unauthenticated Driver signs in", () => {
    expect(
      resolveRoleAwareEntryPath({
        roleKey: "driver",
        isActive: true,
        returnTo: "/dashboard/mobile",
        standalone: true,
      }),
    ).toBe(DRIVER_HOME_PATH);
  });

  it("keeps supervisor and administrator on Master Mobile for installed PWA entry", () => {
    expect(
      resolveRoleAwareEntryPath({
        roleKey: "supervisor",
        isActive: true,
        returnTo: null,
        standalone: true,
      }),
    ).toBe(MASTER_MOBILE_PATH);

    expect(
      resolveRoleAwareEntryPath({
        roleKey: "administrator",
        isActive: true,
        returnTo: null,
        standalone: true,
      }),
    ).toBe(MASTER_MOBILE_PATH);
  });

  it("honors an explicit valid Driver returnTo", () => {
    expect(
      resolveRoleAwareEntryPath({
        roleKey: "driver",
        isActive: true,
        returnTo: "/dashboard/driver?job=next",
        standalone: false,
      }),
    ).toBe("/dashboard/driver?job=next");
  });

  it("falls back when returnTo is unauthorized, including driver-communications collision", () => {
    expect(
      resolveRoleAwareEntryPath({
        roleKey: "driver",
        isActive: true,
        returnTo: "/dashboard/driver-communications",
        standalone: false,
      }),
    ).toBe(DRIVER_HOME_PATH);

    expect(
      resolveRoleAwareEntryPath({
        roleKey: "driver",
        isActive: true,
        returnTo: "/dashboard/settings/users",
        standalone: true,
      }),
    ).toBe(DRIVER_HOME_PATH);

    expect(
      resolveRoleAwareEntryPath({
        roleKey: "driver",
        isActive: true,
        returnTo: APP_ENTRY_PATH,
        standalone: true,
      }),
    ).toBe(DRIVER_HOME_PATH);
  });

  it("does not create a redirect loop between role home and unauthorized returnTo", () => {
    const first = resolveRoleAwareEntryPath({
      roleKey: "driver",
      isActive: true,
      returnTo: MASTER_MOBILE_PATH,
      standalone: true,
    });
    const second = resolveRoleAwareEntryPath({
      roleKey: "driver",
      isActive: true,
      returnTo: first,
      standalone: true,
    });

    expect(first).toBe(DRIVER_HOME_PATH);
    expect(second).toBe(DRIVER_HOME_PATH);
    expect(resolveRoleHomePath({ roleKey: "driver", isActive: true, standalone: true })).toBe(DRIVER_HOME_PATH);
  });

  it("leaves desktop supervisor login on the desktop dashboard", () => {
    expect(
      resolveRoleAwareEntryPath({
        roleKey: "supervisor",
        isActive: true,
        returnTo: null,
        standalone: false,
      }),
    ).toBe(DESKTOP_HOME_PATH);

    expect(
      resolveRoleAwareEntryPath({
        roleKey: "supervisor",
        isActive: true,
        returnTo: DESKTOP_HOME_PATH,
        standalone: false,
      }),
    ).toBe(DESKTOP_HOME_PATH);
  });

  it("does not weaken Driver Mobile authorization", () => {
    expect(canAccessModule("driver", "driver_mobile")).toBe(true);
    expect(canAccessModule("driver", "dashboard")).toBe(false);
    expect(canRoleAccessPath("driver", MASTER_MOBILE_PATH)).toBe(false);
    expect(canRoleAccessPath("driver", DRIVER_HOME_PATH)).toBe(true);
    expect(canRoleAccessPath("supervisor", MASTER_MOBILE_PATH)).toBe(true);
    expect(canRoleAccessPath("supervisor", DRIVER_HOME_PATH)).toBe(true);
  });
});
