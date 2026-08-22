import { describe, expect, it } from "vitest";
import Home from "@/app/page";
import { AppEntry } from "@/components/auth/app-entry";

describe("Home", () => {
  it("uses the role-aware app entry instead of a hardcoded dashboard redirect", () => {
    const tree = Home();
    expect(tree.type).toBe(AppEntry);
  });
});
