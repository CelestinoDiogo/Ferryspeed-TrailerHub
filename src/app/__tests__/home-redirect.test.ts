import { describe, expect, it, vi } from "vitest";
import Home from "@/app/page";

const redirectMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

describe("Home route", () => {
  it("routes users to /dashboard so dashboard auth/layout/sidebar are applied", () => {
    Home();
    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });
});
