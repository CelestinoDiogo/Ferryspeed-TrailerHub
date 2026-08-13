// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriverMobileEntry } from "@/components/mobile/driver-mobile-entry";

const useCurrentUserMock = vi.fn();

vi.mock("@/lib/auth/use-current-user", () => ({ useCurrentUser: () => useCurrentUserMock() }));
vi.mock("@/components/mobile/driver-mobile-jobs-dashboard", () => ({ DriverMobileJobsDashboard: () => <div>REAL DRIVER DASHBOARD</div> }));
vi.mock("@/components/mobile/driver-mobile-preview", () => ({ DriverMobilePreview: ({ roleKey }: { roleKey: string }) => <div>PREVIEW {roleKey}</div> }));

afterEach(() => cleanup());

describe("DriverMobileEntry", () => {
  it.each(["administrator", "supervisor"])("never mounts Driver operational mode for %s", (roleKey) => {
    useCurrentUserMock.mockReturnValue({ roleKey, isLoading: false });
    render(<DriverMobileEntry />);

    expect(screen.getByText(`PREVIEW ${roleKey}`)).toBeInTheDocument();
    expect(screen.queryByText("REAL DRIVER DASHBOARD")).not.toBeInTheDocument();
  });

  it("preserves the existing operational dashboard for Driver role", () => {
    useCurrentUserMock.mockReturnValue({ roleKey: "driver", isLoading: false });
    render(<DriverMobileEntry />);
    expect(screen.getByText("REAL DRIVER DASHBOARD")).toBeInTheDocument();
  });
});
