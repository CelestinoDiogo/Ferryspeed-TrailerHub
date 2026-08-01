// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationalAlertsSection } from "@/components/dashboard/operational-alerts-section";
import type { OperationalAlertRow, OperationalAlertSummary } from "@/lib/operational-alerts";

afterEach(() => {
  cleanup();
});

const summary: OperationalAlertSummary = {
  totalActiveAlerts: 0,
  criticalCount: 0,
  highCount: 0,
  warningCount: 0,
  infoCount: 0,
  latestAlertAt: null,
  raw: null,
};

const makeAlert = (overrides: Partial<OperationalAlertRow> = {}): OperationalAlertRow => ({
  id: overrides.id ?? "alert-1",
  alert_key: overrides.alert_key ?? "compound:age:1",
  alert_type: overrides.alert_type ?? "compound_compound_age_requires_movement",
  severity: overrides.severity ?? "warning",
  status: overrides.status ?? "active",
  title: overrides.title ?? "Compound age requires movement",
  description: overrides.description ?? "Trailer has remained in compound for more than 48 hours.",
  trailer_id: overrides.trailer_id ?? "trailer-1",
  trailer_number: overrides.trailer_number ?? "PFC123",
  source_module: overrides.source_module ?? "compound",
  source_record_id: overrides.source_record_id ?? "trailer-1",
  metadata: overrides.metadata ?? {},
  acknowledged_at: overrides.acknowledged_at ?? null,
  acknowledged_by: overrides.acknowledged_by ?? null,
  resolved_at: overrides.resolved_at ?? null,
  resolved_by: overrides.resolved_by ?? null,
  resolution_note: overrides.resolution_note ?? null,
  dismissed_at: overrides.dismissed_at ?? null,
  dismissed_by: overrides.dismissed_by ?? null,
  created_at: overrides.created_at ?? "2026-08-01T10:00:00.000Z",
  updated_at: overrides.updated_at ?? "2026-08-01T10:00:00.000Z",
});

function renderPanel(props?: Partial<React.ComponentProps<typeof OperationalAlertsSection>>) {
  return render(
    <OperationalAlertsSection
      summary={summary}
      activeAlerts={[]}
      resolvedAlerts={[]}
      resolvedAlertsLoaded
      resolvedAlertsLoading={false}
      statusView="active"
      isLoading={false}
      isRefreshing={false}
      error={null}
      onStatusViewChange={() => {}}
      onRefresh={async () => {}}
      onAcknowledge={async () => {}}
      onResolve={async () => {}}
      onDismiss={async () => {}}
      {...props}
    />,
  );
}

describe("OperationalAlertsSection live loading states", () => {
  it("shows initial loading, then empty state after fetch resolves", async () => {
    const onRefresh = vi.fn(async () => {});
    const { rerender } = renderPanel({ isLoading: true, onRefresh });

    expect(screen.getByText("Loading alerts...")).toBeInTheDocument();

    rerender(
      <OperationalAlertsSection
        summary={summary}
        activeAlerts={[]}
        resolvedAlerts={[]}
        resolvedAlertsLoaded
        resolvedAlertsLoading={false}
        statusView="active"
        isLoading={false}
        isRefreshing={false}
        error={null}
        onStatusViewChange={() => {}}
        onRefresh={onRefresh}
        onAcknowledge={async () => {}}
        onResolve={async () => {}}
        onDismiss={async () => {}}
      />,
    );

    expect(screen.queryByText("Loading alerts...")).toBeNull();
    expect(screen.getByText("No active operational alerts.")).toBeInTheDocument();
  });

  it("renders alert rows after successful response", () => {
    renderPanel({ activeAlerts: [makeAlert()] });

    expect(screen.getAllByText("Compound age requires movement").length).toBeGreaterThan(0);
    expect(screen.queryByText("Loading alerts...")).toBeNull();
  });

  it("shows error state with retry on failure", () => {
    renderPanel({ error: "Unable to load operational alerts." });

    expect(screen.getByText("Unable to load operational alerts.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("manual refresh preserves existing list and does not show full loading placeholder", () => {
    renderPanel({
      activeAlerts: [makeAlert()],
      isLoading: false,
      isRefreshing: true,
    });

    expect(screen.getByText("Compound age requires movement")).toBeInTheDocument();
    expect(screen.queryByText("Loading alerts...")).toBeNull();
  });

  it("resolved tab loading does not depend on active initial loading flag", () => {
    renderPanel({
      statusView: "resolved",
      isLoading: true,
      resolvedAlertsLoading: false,
      resolvedAlerts: [],
    });

    expect(screen.queryByText("Loading alerts...")).toBeNull();
    expect(screen.getByText("No resolved operational alerts.")).toBeInTheDocument();
  });

  it("resets the severity filter when switching status views so active rows do not stay hidden", async () => {
    const user = userEvent.setup();
    const activeAlert = makeAlert({ id: "active-1", severity: "warning", status: "active", title: "Active warning" });
    const resolvedAlert = makeAlert({ id: "resolved-1", severity: "info", status: "resolved", title: "Resolved info" });

    const { rerender } = renderPanel({
      statusView: "resolved",
      activeAlerts: [activeAlert],
      resolvedAlerts: [resolvedAlert],
    });

    await user.click(screen.getByRole("button", { name: /Low/i }));
    expect(screen.getByText("Resolved info")).toBeInTheDocument();

    rerender(
      <OperationalAlertsSection
        summary={summary}
        activeAlerts={[activeAlert]}
        resolvedAlerts={[resolvedAlert]}
        resolvedAlertsLoaded
        resolvedAlertsLoading={false}
        statusView="active"
        isLoading={false}
        isRefreshing={false}
        error={null}
        onStatusViewChange={() => {}}
        onRefresh={async () => {}}
        onAcknowledge={async () => {}}
        onResolve={async () => {}}
        onDismiss={async () => {}}
      />,
    );

    expect(screen.getByText("Active warning")).toBeInTheDocument();
  });

  it("hides loading text after async completion in stateful harness", async () => {
    function Harness() {
      const [isLoading, setIsLoading] = React.useState(true);
      const [alerts, setAlerts] = React.useState<OperationalAlertRow[]>([]);

      React.useEffect(() => {
        const timer = window.setTimeout(() => {
          setAlerts([]);
          setIsLoading(false);
        }, 10);

        return () => window.clearTimeout(timer);
      }, []);

      return (
        <OperationalAlertsSection
          summary={summary}
          activeAlerts={alerts}
          resolvedAlerts={[]}
          resolvedAlertsLoaded
          resolvedAlertsLoading={false}
          statusView="active"
          isLoading={isLoading}
          isRefreshing={false}
          error={null}
          onStatusViewChange={() => {}}
          onRefresh={async () => {}}
          onAcknowledge={async () => {}}
          onResolve={async () => {}}
          onDismiss={async () => {}}
        />
      );
    }

    render(<Harness />);
    expect(screen.getByText("Loading alerts...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText("Loading alerts...")).toBeNull();
    });

    expect(screen.getAllByText("No active operational alerts.").length).toBeGreaterThan(0);
  });
});
