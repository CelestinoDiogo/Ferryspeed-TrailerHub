// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupervisorMobileDashboard } from "@/components/mobile/supervisor-mobile-dashboard";

type QueryRow = Record<string, unknown>;

let tableData: Record<string, QueryRow[]> = {};

const { getTrailerActivityMock, fetchMock, supabaseMock } = vi.hoisted(() => ({
  getTrailerActivityMock: vi.fn(),
  fetchMock: vi.fn(),
  supabaseMock: {
    from: vi.fn(),
    storage: {
      from: vi.fn(),
    },
    auth: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock("@/components/pwa/pwa-provider", () => ({
  usePwa: () => ({
    showInstallAction: false,
    showIosInstallGuide: false,
    isInstalled: false,
    updateAvailable: false,
    canApplyUpdate: true,
    dismissInstall: vi.fn(),
    promptInstall: vi.fn(),
    applyUpdate: vi.fn(),
    setOperationallyBusy: vi.fn(),
    installDismissed: false,
    isInstallSupported: false,
  }),
}));

class QueryMock {
  constructor(private readonly table: string) {}

  select() {
    return this;
  }

  is() {
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  in() {
    return this;
  }

  eq() {
    return this;
  }

  then<TResult1 = { data: QueryRow[]; error: null }>(
    onfulfilled?: ((value: { data: QueryRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
  ) {
    return Promise.resolve({ data: tableData[this.table] ?? [], error: null }).then(onfulfilled ?? undefined);
  }
}

vi.mock("@/components/ai/operations-assistant-drawer", () => ({
  OperationsAssistantDrawer: () => null,
}));

vi.mock("@/lib/auth/use-current-user", () => ({
  useCurrentUser: () => ({
    roleKey: "supervisor",
    fullName: "Supervisor One",
    email: "supervisor@example.com",
    isLoading: false,
  }),
}));

vi.mock("@/lib/auth/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/permissions")>("@/lib/auth/permissions");
  return {
    ...actual,
    canAccessModule: () => true,
    canPerformAction: () => true,
  };
});

vi.mock("@/lib/realtime/operational-realtime", () => ({
  useOperationalRealtime: () => undefined,
}));

vi.mock("@/lib/trailer-activity", () => ({
  getTrailerActivity: getTrailerActivityMock,
}));

vi.mock("@/lib/voice/session", () => ({
  getSessionToken: vi.fn().mockResolvedValue("token-1"),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

const buildBaseData = () => ({
  trailers: [
    {
      id: "trailer-1",
      trailer_number: "FS1234",
      customer: "Alpha Logistics",
      load_status: "Empty",
      operational_status: "Ready",
      compound_position: "P10",
      is_local: false,
      arrival_date: null,
      departure_date: null,
    },
    {
      id: "trailer-2",
      trailer_number: "FS2000",
      customer: "Bravo Freight",
      load_status: "Loaded",
      operational_status: "Arrived",
      compound_position: "P02",
      is_local: false,
      arrival_date: null,
      departure_date: null,
    },
  ],
  export_allocations: [],
  delivery_bookings: [],
  vessel_operation_trailers: [
    {
      id: "vt-1",
      vessel_operation_id: "op-1",
      trailer_id: "trailer-1",
      trailer_number: "FS1234",
      arrival_status: "expected",
      status: "expected",
      inspection_started_at: null,
      inspection_completed_at: null,
      expected_front_temperature: 2,
      expected_rear_temperature: 3,
      expected_temperature_unit: "C",
      has_temperature_alert: false,
      has_damage: false,
    },
    {
      id: "vt-2",
      vessel_operation_id: "op-2",
      trailer_id: "trailer-2",
      trailer_number: "FS2000",
      arrival_status: "arrived",
      status: "arrived",
      inspection_started_at: null,
      inspection_completed_at: null,
      expected_front_temperature: 2,
      expected_rear_temperature: 3,
      expected_temperature_unit: "C",
      has_temperature_alert: false,
      has_damage: false,
    },
  ],
});

const setOnlineState = (value: boolean) => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
};

describe("SupervisorMobileDashboard", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    tableData = buildBaseData();
    window.localStorage.clear();
    window.sessionStorage.clear();
    setOnlineState(true);
    fetchMock.mockReset();
    getTrailerActivityMock.mockResolvedValue([]);
    supabaseMock.from.mockImplementation((table: string) => new QueryMock(table));
    supabaseMock.storage.from.mockReturnValue({
      upload: vi.fn(),
      remove: vi.fn(),
    });
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { email: "supervisor@example.com", id: "user-1" } } } });
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window, "scrollTo", { configurable: true, value: vi.fn() });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  });

  it("loads correctly at a phone-sized viewport", async () => {
    render(<SupervisorMobileDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Core Operations")).toBeInTheDocument();
    });
    expect(screen.getByText("Master Mobile v1")).toBeInTheDocument();
  });

  it("restores tab, search, filter and sort state from session storage", async () => {
    window.sessionStorage.setItem(
      "trailerhub.mobile.ui-state.v1",
      JSON.stringify({
        activeTab: "compound",
        searchQuery: "FS1234",
        selectedTrailerId: "trailer-1",
        compoundFilter: "Alpha",
        compoundSort: "customer",
        scrollByTab: { compound: 120 },
      }),
    );

    render(<SupervisorMobileDashboard />);

    expect(await screen.findByText("Compound tools")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Filter by trailer, position or customer")).toHaveValue("Alpha");
    expect(screen.getAllByRole("combobox")[1]).toHaveValue("customer");
  });

  it("allows inspection progress save while blocking completion until required data is present", async () => {
    render(<SupervisorMobileDashboard />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: "Ops" }))[0]);
    await user.click(screen.getAllByRole("button", { name: /FS2000/i })[0]);
    await user.click(screen.getByRole("button", { name: "Open Mobile Inspection Panel" }));

    expect(await screen.findByText("Completion checklist")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Progress" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Complete" })).toBeDisabled();
  });
});