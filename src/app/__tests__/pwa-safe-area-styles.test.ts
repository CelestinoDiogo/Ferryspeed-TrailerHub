import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("global safe-area styles", () => {
  it("defines safe-area inset variables and mobile helper classes", () => {
    const cssPath = path.resolve(process.cwd(), "src/app/globals.css");
    const css = readFileSync(cssPath, "utf8");

    expect(css).toContain("--safe-area-top: env(safe-area-inset-top, 0px);");
    expect(css).toContain("--safe-area-bottom: env(safe-area-inset-bottom, 0px);");
    expect(css).toContain(".mobile-safe-shell");
    expect(css).toContain(".mobile-safe-nav");
    expect(css).toContain(".mobile-safe-fab");
  });
});
