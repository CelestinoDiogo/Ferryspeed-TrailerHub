import { describe, expect, it } from "vitest";
import {
  getOfflineFallbackPath,
  shouldBypassServiceWorkerRequest,
  shouldHandleAsStaticShellAsset,
  shouldServeOfflineFallback,
} from "@/lib/pwa/service-worker-rules";
import { PWA_ICON_PATHS } from "@/lib/pwa/config";

describe("service-worker-rules", () => {
  it("bypasses mutating methods, external origins, and auth/api paths", () => {
    const origin = "https://trailerhub.example";

    expect(
      shouldBypassServiceWorkerRequest({
        method: "POST",
        url: new URL("https://trailerhub.example/dashboard/mobile"),
        currentOrigin: origin,
      }),
    ).toBe(true);

    expect(
      shouldBypassServiceWorkerRequest({
        method: "GET",
        url: new URL("https://supabase.example/rest/v1/trailers"),
        currentOrigin: origin,
      }),
    ).toBe(true);

    expect(
      shouldBypassServiceWorkerRequest({
        method: "GET",
        url: new URL("https://trailerhub.example/api/mobile-actions"),
        currentOrigin: origin,
      }),
    ).toBe(true);
  });

  it("allows same-origin GET app routes to be handled", () => {
    expect(
      shouldBypassServiceWorkerRequest({
        method: "GET",
        url: new URL("https://trailerhub.example/dashboard/mobile"),
        currentOrigin: "https://trailerhub.example",
      }),
    ).toBe(false);
  });

  it("only marks intended static shell assets as cacheable", () => {
    expect(shouldHandleAsStaticShellAsset("/_next/static/chunks/app.js")).toBe(true);
    expect(shouldHandleAsStaticShellAsset("/sw.js")).toBe(true);
    expect(shouldHandleAsStaticShellAsset(PWA_ICON_PATHS.favicon)).toBe(true);
    expect(shouldHandleAsStaticShellAsset("/api/mobile-actions")).toBe(false);
  });

  it("serves offline fallback only for navigation requests", () => {
    expect(shouldServeOfflineFallback("navigate")).toBe(true);
    expect(shouldServeOfflineFallback("same-origin")).toBe(false);
    expect(getOfflineFallbackPath()).toBe("/offline");
  });
});
