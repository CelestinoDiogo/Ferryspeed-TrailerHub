// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PwaStatusCard } from "@/components/pwa/pwa-status-card";

afterEach(() => {
  cleanup();
});

describe("PwaStatusCard", () => {
  it("renders install call-to-action and supports dismiss", () => {
    const onInstall = vi.fn();
    const onDismissInstall = vi.fn();

    render(
      <PwaStatusCard
        showInstallAction
        showIosInstallGuide={false}
        isInstalled={false}
        updateAvailable={false}
        canApplyUpdate
        onInstall={onInstall}
        onDismissInstall={onDismissInstall}
        onApplyUpdate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Install TrailerHub" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onDismissInstall).toHaveBeenCalledTimes(1);
  });

  it("shows iOS guidance text when iOS install flow is needed", () => {
    render(
      <PwaStatusCard
        showInstallAction
        showIosInstallGuide
        isInstalled={false}
        updateAvailable={false}
        canApplyUpdate
        onInstall={vi.fn()}
        onDismissInstall={vi.fn()}
        onApplyUpdate={vi.fn()}
      />,
    );

    expect(screen.getByText("In Safari, open Share and choose Add to Home Screen.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install TrailerHub" })).not.toBeInTheDocument();
  });

  it("renders update action and reflects operational busy lock", () => {
    const onApplyUpdate = vi.fn();

    const { rerender } = render(
      <PwaStatusCard
        showInstallAction={false}
        showIosInstallGuide={false}
        isInstalled
        updateAvailable
        canApplyUpdate={false}
        onInstall={vi.fn()}
        onDismissInstall={vi.fn()}
        onApplyUpdate={onApplyUpdate}
      />,
    );

    expect(screen.getByRole("button", { name: "Sync or finish actions first" })).toBeDisabled();

    rerender(
      <PwaStatusCard
        showInstallAction={false}
        showIosInstallGuide={false}
        isInstalled
        updateAvailable
        canApplyUpdate
        onInstall={vi.fn()}
        onDismissInstall={vi.fn()}
        onApplyUpdate={onApplyUpdate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reload to update" }));
    expect(onApplyUpdate).toHaveBeenCalledTimes(1);
  });
});
