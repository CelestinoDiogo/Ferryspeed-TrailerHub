import { describe, expect, it } from "vitest";
import { canAccessModule, canPerformAction } from "@/lib/auth/permissions";

describe("driver mobile permissions", () => {
  it("allows driver mobile access for drivers", () => {
    expect(canAccessModule("driver", "driver_mobile")).toBe(true);
  });

  it("keeps driver access limited to the driver mobile module", () => {
    expect(canAccessModule("driver", "settings")).toBe(false);
  });

  it("preserves supervisor access to operational modules", () => {
    expect(canAccessModule("supervisor", "dashboard")).toBe(true);
    expect(canPerformAction("supervisor", "arrivals", "create")).toBe(true);
  });
});