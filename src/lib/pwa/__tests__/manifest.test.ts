import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import {
  PWA_APP_NAME,
  PWA_BACKGROUND_COLOR,
  PWA_DESCRIPTION,
  PWA_ICON_PATHS,
  PWA_SCOPE,
  PWA_SHORT_NAME,
  PWA_START_URL,
  PWA_THEME_COLOR,
} from "@/lib/pwa/config";

describe("manifest", () => {
  it("returns expected core PWA metadata", () => {
    const result = manifest();

    expect(result.name).toBe(PWA_APP_NAME);
    expect(result.short_name).toBe(PWA_SHORT_NAME);
    expect(result.description).toBe(PWA_DESCRIPTION);
    expect(result.start_url).toBe(PWA_START_URL);
    expect(result.scope).toBe(PWA_SCOPE);
    expect(result.display).toBe("standalone");
    expect(result.orientation).toBe("portrait-primary");
    expect(result.background_color).toBe(PWA_BACKGROUND_COLOR);
    expect(result.theme_color).toBe(PWA_THEME_COLOR);
    expect(result.categories).toEqual(["business", "productivity", "utilities"]);
  });

  it("includes primary and maskable icons", () => {
    const icons = manifest().icons ?? [];

    expect(icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: PWA_ICON_PATHS.icon192, sizes: "192x192", type: "image/png" }),
        expect.objectContaining({ src: PWA_ICON_PATHS.icon512, sizes: "512x512", type: "image/png" }),
        expect.objectContaining({ src: PWA_ICON_PATHS.maskable192, sizes: "192x192", type: "image/png", purpose: "maskable" }),
        expect.objectContaining({ src: PWA_ICON_PATHS.maskable512, sizes: "512x512", type: "image/png", purpose: "maskable" }),
      ]),
    );
  });
});
