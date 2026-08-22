import { describe, expect, it } from "vitest";
import {
  createInstallDismissedUntil,
  isInstallDismissed,
  isIosInstallEligible,
  isStandaloneDisplay,
  readInstallDismissedUntil,
  resolvePostLoginPath,
} from "@/lib/pwa/install-state";

describe("install-state", () => {
  it("detects standalone display when any standalone source is true", () => {
    expect(isStandaloneDisplay({ matchMediaStandalone: true, navigatorStandalone: false })).toBe(true);
    expect(isStandaloneDisplay({ matchMediaStandalone: false, navigatorStandalone: true })).toBe(true);
    expect(isStandaloneDisplay({ matchMediaStandalone: false, navigatorStandalone: false })).toBe(false);
  });

  it("identifies iOS Safari install eligibility", () => {
    expect(
      isIosInstallEligible({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        matchMediaStandalone: false,
      }),
    ).toBe(true);

    expect(
      isIosInstallEligible({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.0.0 Mobile/15E148 Safari/604.1",
        matchMediaStandalone: false,
      }),
    ).toBe(false);
  });

  it("parses and evaluates install dismissal windows", () => {
    expect(readInstallDismissedUntil(null)).toBeNull();
    expect(readInstallDismissedUntil("not-a-number")).toBeNull();
    expect(readInstallDismissedUntil("12345")).toBe(12345);

    const dismissedUntil = createInstallDismissedUntil(1000, 5000);
    expect(dismissedUntil).toBe(6000);
    expect(isInstallDismissed(dismissedUntil, 4000)).toBe(true);
    expect(isInstallDismissed(dismissedUntil, 7000)).toBe(false);
  });

  it("resolves post-login route with returnTo guard, role fallback, and standalone home", () => {
    expect(resolvePostLoginPath({ returnTo: "/dashboard/mobile?tab=more", standalone: false })).toBe("/dashboard/mobile?tab=more");
    expect(resolvePostLoginPath({ returnTo: "https://example.com/phish", standalone: false })).toBe("/dashboard");
    expect(resolvePostLoginPath({ returnTo: "", standalone: true })).toBe("/dashboard/mobile");
    expect(
      resolvePostLoginPath({
        returnTo: "/dashboard/mobile",
        standalone: true,
        roleKey: "driver",
        isActive: true,
      }),
    ).toBe("/dashboard/driver");
    expect(
      resolvePostLoginPath({
        returnTo: null,
        standalone: false,
        roleKey: "supervisor",
      }),
    ).toBe("/dashboard");
  });
});
