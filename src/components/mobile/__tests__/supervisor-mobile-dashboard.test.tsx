// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupervisorMobileDashboard } from "@/components/mobile/supervisor-mobile-dashboard";

type QueryRow = Record<string, unknown>;

const speechRecognitionState = vi.hoisted(() => ({
  supported: false,
  isListening: false,
  transcript: "",
  interimTranscript: "",
  error: null as string | null,
}));

const speechSynthesisMock = vi.hoisted(() => ({
  cancel: vi.fn(),
  resume: vi.fn(),
  speak: vi.fn(),
  getVoices: vi.fn(),
}));

vi.mock("@/lib/voice/speech-recognition", () => ({
  useSpeechRecognition: () => ({
    isSupported: speechRecognitionState.supported,
    isListening: speechRecognitionState.isListening,
    transcript: speechRecognitionState.transcript,
    interimTranscript: speechRecognitionState.interimTranscript,
    error: speechRecognitionState.error,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    resetTranscript: vi.fn(),
  }),
}));

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

  not() {
    return this;
  }

  neq() {
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
      trailer_number: "FS1001",
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
      trailer_number: "FS1002",
      customer: "Bravo Freight",
      load_status: "Loaded",
      operational_status: "Arrived",
      compound_position: "P02",
      is_local: false,
      arrival_date: null,
      departure_date: null,
    },
    {
      id: "trailer-3",
      trailer_number: "FS1003",
      customer: "Delta Haulage",
      load_status: "Loaded",
      operational_status: "Arrived",
      compound_position: "P03",
      is_local: false,
      arrival_date: null,
      departure_date: null,
    },
    {
      id: "trailer-4",
      trailer_number: "FS1004",
      customer: "Echo Cargo",
      load_status: "Empty",
      operational_status: "Ready",
      compound_position: "P04",
      is_local: false,
      arrival_date: null,
      departure_date: null,
    },
    {
      id: "trailer-5",
      trailer_number: "FS1005",
      customer: "Foxtrot Movers",
      load_status: "Loaded",
      operational_status: "Ready",
      compound_position: "P05",
      is_local: false,
      arrival_date: null,
      departure_date: null,
    },
    {
      id: "trailer-6",
      trailer_number: "FS2001",
      customer: "Harbor Trans",
      load_status: "Empty",
      operational_status: "Ready",
      compound_position: "P06",
      is_local: false,
      arrival_date: null,
      departure_date: null,
    },
    {
      id: "trailer-7",
      trailer_number: "FS2002",
      customer: "Harbor Trans",
      load_status: "Loaded",
      operational_status: "Arrived",
      compound_position: "P07",
      is_local: false,
      arrival_date: null,
      departure_date: null,
    },
  ],
  export_allocations: [],
  delivery_bookings: [],
  vessel_operations: [
    {
      id: "op-1",
      vessel_name: "MV Caledonia",
      sailing_reference: "SAIL-100",
      status: "confirmed",
      list_status: "confirmed",
      final_locked_at: null,
      updated_at: "2026-08-01T09:00:00.000Z",
    },
    {
      id: "op-2",
      vessel_name: "MV Hebrides",
      sailing_reference: "SAIL-200",
      status: "confirmed",
      list_status: "confirmed",
      final_locked_at: null,
      updated_at: "2026-08-01T08:00:00.000Z",
    },
  ],
  vessel_operation_trailers: [
    {
      id: "vt-1",
      vessel_operation_id: "op-1",
      trailer_id: "trailer-1",
      trailer_number: "FS1001",
      arrival_status: "expected",
      status: "expected",
      inspection_started_at: null,
      inspection_completed_at: null,
      expected_front_temperature: null,
      expected_rear_temperature: null,
      expected_temperature_unit: "C",
      has_temperature_alert: false,
      has_damage: false,
    },
    {
      id: "vt-2",
      vessel_operation_id: "op-1",
      trailer_id: "trailer-2",
      trailer_number: "FS1002",
      arrival_status: "arrived",
      status: "arrived",
      priority_level: "priority",
      inspection_started_at: null,
      inspection_completed_at: null,
      expected_front_temperature: 2,
      expected_rear_temperature: 3,
      expected_temperature_unit: "C",
      has_temperature_alert: false,
      has_damage: false,
    },
    {
      id: "vt-3",
      vessel_operation_id: "op-1",
      trailer_id: "trailer-3",
      trailer_number: "FS1003",
      arrival_status: "arrived",
      status: "arrived",
      inspection_started_at: "2026-08-01T07:00:00.000Z",
      inspection_completed_at: "2026-08-01T07:30:00.000Z",
      expected_front_temperature: null,
      expected_rear_temperature: null,
      expected_temperature_unit: "C",
      has_temperature_alert: false,
      has_damage: true,
    },
    {
      id: "vt-4",
      vessel_operation_id: "op-1",
      trailer_id: "trailer-4",
      trailer_number: "FS1004",
      arrival_status: "expected",
      status: "expected",
      inspection_started_at: null,
      inspection_completed_at: null,
      expected_front_temperature: null,
      expected_rear_temperature: null,
      expected_temperature_unit: "C",
      temperature_required: "required",
      has_temperature_alert: false,
      has_damage: false,
    },
    {
      id: "vt-5",
      vessel_operation_id: "op-1",
      trailer_id: "trailer-5",
      trailer_number: "FS1005",
      arrival_status: "expected",
      status: "expected",
      inspection_started_at: null,
      inspection_completed_at: null,
      expected_front_temperature: 5,
      expected_rear_temperature: null,
      expected_temperature_unit: "C",
      has_temperature_alert: true,
      has_damage: false,
    },
    {
      id: "vt-6",
      vessel_operation_id: "op-2",
      trailer_id: "trailer-6",
      trailer_number: "FS2001",
      arrival_status: "expected",
      status: "expected",
      inspection_started_at: null,
      inspection_completed_at: null,
      expected_front_temperature: null,
      expected_rear_temperature: null,
      expected_temperature_unit: "C",
      has_temperature_alert: false,
      has_damage: false,
    },
    {
      id: "vt-7",
      vessel_operation_id: "op-2",
      trailer_id: "trailer-7",
      trailer_number: "FS2002",
      arrival_status: "arrived",
      status: "arrived",
      inspection_started_at: null,
      inspection_completed_at: null,
      expected_front_temperature: null,
      expected_rear_temperature: null,
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
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    tableData = buildBaseData();
    speechRecognitionState.supported = false;
    speechRecognitionState.isListening = false;
    speechRecognitionState.transcript = "";
    speechRecognitionState.interimTranscript = "";
    speechRecognitionState.error = null;
    speechSynthesisMock.cancel.mockReset();
    speechSynthesisMock.resume.mockReset();
    speechSynthesisMock.speak.mockReset();
    speechSynthesisMock.getVoices.mockReset();
    speechSynthesisMock.getVoices.mockReturnValue([]);
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
    supabaseMock.auth.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: "token-123",
          user: { email: "supervisor@example.com", id: "user-1" },
        },
      },
    });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "success", message: "Action completed." }),
    });
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: speechSynthesisMock,
    });
    class MockSpeechSynthesisUtterance {
      text: string;

      lang = "";

      rate = 1;

      pitch = 1;

      voice: SpeechSynthesisVoice | null = null;

      constructor(text: string) {
        this.text = text;
      }
    }

    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
      configurable: true,
      value: MockSpeechSynthesisUtterance,
    });
    Object.defineProperty(window, "scrollTo", { configurable: true, value: vi.fn() });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    window.sessionStorage.clear();
  });

  const openVesselWorkspace = async () => {
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Vessel Operations" }));
    await screen.findByText("Active Vessel Workspace");
    return user;
  };

  const getTrailerCard = (trailerNumber: string) => {
    const title = screen.getByText(trailerNumber);
    const card = title.closest("article");
    expect(card).not.toBeNull();
    return card as HTMLElement;
  };

  const getActionBody = (callIndex: number) => {
    const [, requestInit] = fetchMock.mock.calls[callIndex] as [string, RequestInit];
    return JSON.parse(String(requestInit.body)) as {
      action: {
        actionType: string;
        payload: Record<string, unknown>;
      };
    };
  };

  const triggerVoiceCommand = async (
    user: ReturnType<typeof userEvent.setup>,
    rerender: (ui: ReactElement) => void,
    recognizedText: string,
    expectSpeech = true,
  ) => {
    speechRecognitionState.supported = true;
    speechRecognitionState.transcript = recognizedText;
    speechRecognitionState.interimTranscript = "";
    rerender(<SupervisorMobileDashboard />);
    await user.click(screen.getByRole("button", { name: "Start push to talk" }));

    speechRecognitionState.isListening = true;
    rerender(<SupervisorMobileDashboard />);

    speechRecognitionState.isListening = false;
    rerender(<SupervisorMobileDashboard />);

    if (expectSpeech) {
      await waitFor(() => {
        expect(speechSynthesisMock.speak).toHaveBeenCalled();
      });
    }
  };

  it("renders vessel workspace queue, counts, and vessel selection", async () => {
    render(<SupervisorMobileDashboard />);
    const user = await openVesselWorkspace();

    const workspace = screen.getByText("Active Vessel Workspace").closest("section") as HTMLElement;
    expect(workspace).toBeInTheDocument();
    expect(within(workspace).getByText("Total", { selector: "p" }).closest("div")).toHaveTextContent("5");
    expect(within(workspace).getByText("Arrived", { selector: "p" }).closest("div")).toHaveTextContent("2");
    expect(within(workspace).getByText("Remaining", { selector: "p" }).closest("div")).toHaveTextContent("3");
    expect(within(workspace).getByText("Insp. Pending", { selector: "p" }).closest("div")).toHaveTextContent("1");
    const priorityCountLabel = within(workspace)
      .getAllByText("Priority", { selector: "p" })
      .find((node) => node.className.includes("tracking-[0.08em]"));
    expect(priorityCountLabel).toBeDefined();
    expect(priorityCountLabel?.closest("div")).toHaveTextContent("1");

    expect(screen.getByText("FS1001")).toBeInTheDocument();
    expect(screen.queryByText("FS2001")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /MV Hebrides/i }));
    expect(await screen.findByText("FS2001")).toBeInTheDocument();
    expect(screen.queryByText("FS1001")).not.toBeInTheDocument();
  });

  it("keeps a cancelled vessel row visible and disables Arrived", async () => {
    const baseData = buildBaseData();
    baseData.vessel_operation_trailers.push({
      id: "vt-cancelled",
      vessel_operation_id: "op-1",
      trailer_id: "trailer-cancelled",
      trailer_number: "PFC-CANCELLED",
      arrival_status: "cancelled",
      status: "not_arrived",
      inspection_started_at: null,
      inspection_completed_at: null,
      expected_front_temperature: null,
      expected_rear_temperature: null,
      expected_temperature_unit: "C",
      has_temperature_alert: false,
      has_damage: false,
    });
    tableData = baseData;

    render(<SupervisorMobileDashboard />);
    await openVesselWorkspace();

    const card = getTrailerCard("PFC-CANCELLED");
    expect(within(card).getByText("cancelled")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Arrived" })).toBeDisabled();
  });

  it("keeps vessel counts scoped to the selected operation when vessel names repeat", async () => {
    tableData = {
      ...buildBaseData(),
      vessel_operations: [
        {
          id: "op-1",
          vessel_name: "MV ISLANDER",
          sailing_reference: "ISL-100",
          status: "confirmed",
          list_status: "confirmed",
          final_locked_at: null,
          updated_at: "2026-08-01T09:00:00.000Z",
        },
        {
          id: "op-2",
          vessel_name: "MV ISLANDER",
          sailing_reference: "ISL-200",
          status: "confirmed",
          list_status: "confirmed",
          final_locked_at: null,
          updated_at: "2026-08-01T08:00:00.000Z",
        },
      ],
    };

    render(<SupervisorMobileDashboard />);
    const user = await openVesselWorkspace();

    expect(screen.getByRole("button", { name: /ISL-100/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ISL-200/i })).toBeInTheDocument();
    expect(screen.getByText("FS1001")).toBeInTheDocument();
    expect(screen.queryByText("FS2001")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /ISL-200/i }));
    expect(await screen.findByText("FS2001")).toBeInTheDocument();
    expect(screen.queryByText("FS1001")).not.toBeInTheDocument();

    const workspace = screen.getByText("Active Vessel Workspace").closest("section") as HTMLElement;
    expect(within(workspace).getByText("Total", { selector: "p" }).closest("div")).toHaveTextContent("2");
    expect(within(workspace).getByText("Arrived", { selector: "p" }).closest("div")).toHaveTextContent("1");
    expect(within(workspace).getByText("Remaining", { selector: "p" }).closest("div")).toHaveTextContent("1");
  });

  it("applies vessel quick filters for all workflow buckets", async () => {
    render(<SupervisorMobileDashboard />);
    const user = await openVesselWorkspace();

    expect(screen.getByText("FS1001")).toBeInTheDocument();
    expect(screen.getByText("FS1005")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pending Arrival" }));
    expect(screen.getByText("FS1001")).toBeInTheDocument();
    expect(screen.getByText("FS1004")).toBeInTheDocument();
    expect(screen.getByText("FS1005")).toBeInTheDocument();
    expect(screen.queryByText("FS1002")).not.toBeInTheDocument();
    expect(screen.queryByText("FS1003")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Inspection Pending" }));
    expect(screen.getByText("FS1002")).toBeInTheDocument();
    expect(screen.queryByText("FS1001")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Priority" }));
    expect(screen.getByText("FS1002")).toBeInTheDocument();
    expect(screen.queryByText("FS1004")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Temperature Required" }));
    expect(screen.getByText("FS1002")).toBeInTheDocument();
    expect(screen.getByText("FS1004")).toBeInTheDocument();
    expect(screen.getByText("FS1005")).toBeInTheDocument();
    expect(screen.queryByText("FS1001")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Alerts" }));
    expect(screen.getByText("FS1003")).toBeInTheDocument();
    expect(screen.getByText("FS1005")).toBeInTheDocument();
    expect(screen.queryByText("FS1001")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("FS1001")).toBeInTheDocument();
    expect(screen.getByText("FS1005")).toBeInTheDocument();
  });

  it("submits ARRIVED using the mobile action contract and enforces per-trailer busy scope", async () => {
    render(<SupervisorMobileDashboard />);
    const user = await openVesselWorkspace();

    let resolveFetch: (value: { ok: boolean; json: () => Promise<{ status: string; message: string }> }) => void = () => undefined;
    fetchMock.mockImplementationOnce(
      () => new Promise<{ ok: boolean; json: () => Promise<{ status: string; message: string }> }>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const expectedCard = getTrailerCard("FS1001");
    const expectedArrivedButton = within(expectedCard).getByRole("button", { name: "Arrived" });
    const alreadyArrivedCard = getTrailerCard("FS1002");
    const ineligibleArrivedButton = within(alreadyArrivedCard).getByRole("button", { name: "Arrived" });
    const secondExpectedCard = getTrailerCard("FS1004");
    const secondExpectedArrivedButton = within(secondExpectedCard).getByRole("button", { name: "Arrived" });

    expect(expectedArrivedButton).toBeEnabled();
    expect(ineligibleArrivedButton).toBeDisabled();
    expect(secondExpectedArrivedButton).toBeEnabled();

    await user.click(expectedArrivedButton);
    expect(await within(expectedCard).findByRole("button", { name: "Updating..." })).toBeDisabled();
    await user.click(within(expectedCard).getByRole("button", { name: "Updating..." }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = getActionBody(0);
    expect(requestBody.action.actionType).toBe("MARK_ARRIVED");
    expect(requestBody.action.payload).toMatchObject({
      vesselTrailerId: "vt-1",
      trailerNumber: "FS1001",
      operationId: "op-1",
    });

    expect(secondExpectedArrivedButton).toBeEnabled();

    resolveFetch({
      ok: true,
      json: async () => ({ status: "success", message: "Arrival confirmed." }),
    });

    await waitFor(() => {
      expect(screen.getByText("Arrival confirmed.")).toBeInTheDocument();
    });
  });

  it("opens inline inspection panel, saves progress, and closes without leaving vessel workspace", async () => {
    render(<SupervisorMobileDashboard />);
    const user = await openVesselWorkspace();

    const inspectionCard = getTrailerCard("FS1002");
    await user.click(within(inspectionCard).getByRole("button", { name: "Inspect" }));

    expect(await screen.findByRole("dialog", { name: "Inspection panel" })).toBeInTheDocument();
    expect(screen.getByText("Photo capture / upload")).toBeInTheDocument();
    expect(screen.getByText("Expected front: 2 C")).toBeInTheDocument();
    expect(screen.getByText("Expected rear: 3 C")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Actual front/i), "1.5");
    await user.type(screen.getByLabelText(/Actual rear/i), "2.5");
    await user.selectOptions(screen.getByLabelText("Damage"), "yes");
    await user.type(screen.getByLabelText("Damage details"), "Minor panel dent");
    await user.type(screen.getByLabelText("Notes"), "Checked at berth 2");
    await user.click(screen.getByRole("button", { name: "Save Progress" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const requestBody = getActionBody(0);
    expect(requestBody.action.actionType).toBe("SAVE_INSPECTION_PROGRESS");
    expect(requestBody.action.payload).toMatchObject({
      vesselTrailerId: "vt-2",
      trailerNumber: "FS1002",
      frontTemperature: 1.5,
      rearTemperature: 2.5,
      unit: "C",
      notes: "Checked at berth 2",
      damage: {
        hasDamage: true,
        damageDescription: "Minor panel dent",
      },
    });

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Inspection panel" })).not.toBeInTheDocument();
    });

    expect(screen.getByText("Active Vessel Workspace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /MV Caledonia/i })).toBeInTheDocument();
    expect(screen.getByText("FS1001")).toBeInTheDocument();
  }, 15000);

  it("preserves selected vessel and queue filter after row action refetch", async () => {
    render(<SupervisorMobileDashboard />);
    const user = await openVesselWorkspace();

    await user.click(screen.getByRole("button", { name: /MV Hebrides/i }));
    expect(await screen.findByText("FS2001")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pending Arrival" }));
    expect(screen.getByText("FS2001")).toBeInTheDocument();
    expect(screen.queryByText("FS2002")).not.toBeInTheDocument();

    const op2ExpectedCard = getTrailerCard("FS2001");
    await user.click(within(op2ExpectedCard).getByRole("button", { name: "Arrived" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText("FS2001")).not.toBeInTheDocument();
    expect(screen.queryByText("FS2002")).not.toBeInTheDocument();
    expect(screen.queryByText("FS1001")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pending Arrival" })).toBeInTheDocument();
  });

  it("moves a trailer from pending arrival to inspection pending after Arrived", async () => {
    render(<SupervisorMobileDashboard />);
    const user = await openVesselWorkspace();

    await user.click(screen.getByRole("button", { name: "Pending Arrival" }));
    expect(screen.getByText("FS1001")).toBeInTheDocument();
    expect(screen.queryByText("FS1002")).not.toBeInTheDocument();

    await user.click(within(getTrailerCard("FS1001")).getByRole("button", { name: "Arrived" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText("FS1001")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Inspection Pending" }));
    expect(screen.getByText("FS1001")).toBeInTheDocument();
    expect(screen.getByText("FS1002")).toBeInTheDocument();
    expect(screen.getAllByText("FS1001")).toHaveLength(1);
  });

  it("keeps inspected trailers out of inspection pending", async () => {
    render(<SupervisorMobileDashboard />);
    const user = await openVesselWorkspace();

    await user.click(screen.getByRole("button", { name: "Inspection Pending" }));
    expect(screen.getByText("FS1002")).toBeInTheDocument();
    expect(screen.queryByText("FS1003")).not.toBeInTheDocument();
  });

  it("keeps touch workflow usable when speech recognition is unsupported", async () => {
    render(<SupervisorMobileDashboard />);
    const user = await openVesselWorkspace();

    expect(screen.getByText("Speech recognition unavailable. Use touch controls.")).toBeInTheDocument();

    const expectedCard = getTrailerCard("FS1001");
    const arrivedButton = within(expectedCard).getByRole("button", { name: "Arrived" });
    expect(arrivedButton).toBeEnabled();
    await user.click(arrivedButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("speaks a direct test phrase from the voice card", async () => {
    render(<SupervisorMobileDashboard />);
    const user = await openVesselWorkspace();

    await user.click(screen.getByRole("button", { name: "Test voice output" }));

    expect(speechSynthesisMock.speak).toHaveBeenCalledTimes(1);
    const utterance = speechSynthesisMock.speak.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect((utterance as { text: string }).text).toBe("Ferryspeed voice test.");
    expect((utterance as { lang: string }).lang).toBe("en-GB");
    expect(screen.getByText("Voice output: Speaking")).toBeInTheDocument();
  });

  it("shows voice output lifecycle status when synthesis reports start and end", async () => {
    speechSynthesisMock.speak.mockImplementationOnce((utterance: SpeechSynthesisUtterance) => {
      utterance.onstart?.(new Event("start") as unknown as SpeechSynthesisEvent);
      utterance.onend?.(new Event("end") as unknown as SpeechSynthesisEvent);
    });

    render(<SupervisorMobileDashboard />);
    const user = await openVesselWorkspace();

    await user.click(screen.getByRole("button", { name: "Test voice output" }));

    expect(screen.getByText("Voice output: Completed")).toBeInTheDocument();
  });

  it("shows an error status when synthesis reports an error", async () => {
    speechSynthesisMock.speak.mockImplementationOnce((utterance: SpeechSynthesisUtterance) => {
      utterance.onerror?.({ error: "interrupted" } as SpeechSynthesisErrorEvent);
    });

    render(<SupervisorMobileDashboard />);
    const user = await openVesselWorkspace();

    await user.click(screen.getByRole("button", { name: "Test voice output" }));

    expect(screen.getByText("Voice output: Error")).toBeInTheDocument();
    expect(screen.getByText("interrupted")).toBeInTheDocument();
  });

  it("speaks successful lookup results in English by default", async () => {
    const view = render(<SupervisorMobileDashboard />);
    const user = await openVesselWorkspace();

    await triggerVoiceCommand(user, view.rerender, "FS1001");

    const utterance = speechSynthesisMock.speak.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect((utterance as { text: string }).text).toContain("FS1001. Customer Alpha Logistics.");
    expect((utterance as { text: string }).text).toContain("Pending arrival.");
    expect((utterance as { lang: string }).lang).toBe("en-GB");
  });

  it("speaks successful lookup results in Portuguese when selected", async () => {
    const view = render(<SupervisorMobileDashboard />);
    const user = await openVesselWorkspace();
    await user.selectOptions(screen.getByLabelText("Voice recognition language"), "pt-PT");

    await triggerVoiceCommand(user, view.rerender, "FS1002");

    const utterance = speechSynthesisMock.speak.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect((utterance as { text: string }).text).toContain("FS1002. Cliente Bravo Freight.");
    expect((utterance as { text: string }).text).toContain("Temperatura requerida.");
    expect((utterance as { text: string }).text).toContain("Prioridade.");
    expect((utterance as { text: string }).text).toContain("Chegou, inspeção pendente.");
    expect((utterance as { lang: string }).lang).toBe("pt-PT");
  });

  it("respects the mute toggle while still allowing recognition", async () => {
    window.localStorage.setItem("trailerhub.voice.responses.enabled", "0");
    const view = render(<SupervisorMobileDashboard />);
    const user = await openVesselWorkspace();

    await triggerVoiceCommand(user, view.rerender, "FS1001", false);

    expect(speechSynthesisMock.speak).not.toHaveBeenCalled();
  });

  it("speaks arrived only after successful confirmation and stays silent on failure", async () => {
    const view = render(<SupervisorMobileDashboard />);
    const user = await openVesselWorkspace();

    await triggerVoiceCommand(user, view.rerender, "Mark FS1001 arrived");

    const successUtterance = speechSynthesisMock.speak.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect((successUtterance as { text: string }).text).toBe("FS1001 marked arrived.");

    speechSynthesisMock.speak.mockReset();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Arrival failed." }),
    });

    speechRecognitionState.transcript = "Mark FS1004 arrived";
    speechRecognitionState.isListening = true;
    await user.click(screen.getByRole("button", { name: "Start push to talk" }));
    view.rerender(<SupervisorMobileDashboard />);
    speechRecognitionState.isListening = false;
    view.rerender(<SupervisorMobileDashboard />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    expect(speechSynthesisMock.speak).not.toHaveBeenCalled();
  });

  it("does not break when speech synthesis is unsupported", async () => {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: undefined,
    });

    const view = render(<SupervisorMobileDashboard />);
    const user = await openVesselWorkspace();

    await triggerVoiceCommand(user, view.rerender, "FS1001", false);
  });

  it("does not require a manual check-read click on departures instruction cards", async () => {
    render(<SupervisorMobileDashboard />);
    const user = userEvent.setup();

    const departuresButtons = await screen.findAllByRole("button", { name: "Departures" });
    await user.click(departuresButtons[0]);
    await screen.findByText("Departures Mobile Access");

    expect(screen.queryByRole("button", { name: "Check Read" })).not.toBeInTheDocument();
  });

  it("shows assigned driver context and quick presets on departure instruction cards", async () => {
    tableData = {
      ...buildBaseData(),
      delivery_bookings: [
        {
          id: "booking-a",
          trailer_id: "trailer-1",
          driver_id: "driver-a",
          delivery_date: "2026-08-01",
          status: "scheduled",
          drivers: { display_name: "Driver A" },
        },
      ],
    };

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/operations/driver-instructions") && method === "GET") {
        return {
          ok: true,
          json: async () => ({ instructions: [] }),
        };
      }

      if (url.includes("/api/operations/driver-instructions") && method === "POST") {
        return {
          ok: true,
          json: async () => ({
            instruction: {
              createdAt: "2026-08-01T09:00:00.000Z",
              readAt: null,
            },
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({ status: "success", message: "Action completed." }),
      };
    });

    render(<SupervisorMobileDashboard />);
    const user = userEvent.setup();

    const departuresButtons = await screen.findAllByRole("button", { name: "Departures" });
    await user.click(departuresButtons[0]);
    await screen.findByText("Departures Mobile Access");

    expect(screen.getByText("Driver: Driver A")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Priority" }));

    const textbox = screen.getByPlaceholderText("Send message / instruction") as HTMLTextAreaElement;
    expect(textbox.value).toContain("Priority");

    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/operations/driver-instructions",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("keeps Master Mobile navigation tabs available", async () => {
    render(<SupervisorMobileDashboard />);

    expect(await screen.findByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vessel" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Compound" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Departures" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Exports" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("shows reservation state on Compound without exposing write actions", async () => {
    tableData = {
      ...buildBaseData(),
      delivery_bookings: [
        {
          id: "booking-reserved",
          trailer_id: "trailer-1",
          driver_id: null,
          delivery_date: "2026-08-01",
          status: "scheduled",
        },
      ],
      export_allocations: [
        {
          id: "export-reserved",
          trailer_id: "trailer-2",
          trailer_number: "FS1002",
          customer: "Bravo Freight",
          priority: "normal",
          status: "allocated",
          updated_at: "2026-08-01T09:00:00.000Z",
        },
      ],
    };

    render(<SupervisorMobileDashboard />);
    const user = userEvent.setup();
    const compoundButtons = await screen.findAllByRole("button", { name: "Compound" });
    await user.click(compoundButtons[compoundButtons.length - 1]);

    const deliveryCard = getTrailerCard("FS1001");
    expect(within(deliveryCard).getByText("Reserved - Delivery")).toBeInTheDocument();
    expect(within(deliveryCard).queryByRole("button", { name: /Move|Load/i })).not.toBeInTheDocument();

    const exportCard = getTrailerCard("FS1002");
    expect(within(exportCard).getByText("Reserved - Export")).toBeInTheDocument();
  });

  it("blocks Confirm Departure for reserved trailers and keeps eligible confirm in the list", async () => {
    tableData = {
      ...buildBaseData(),
      delivery_bookings: [
        {
          id: "booking-reserved",
          trailer_id: "trailer-1",
          driver_id: "driver-a",
          delivery_date: "2026-08-01",
          status: "on_delivery",
          drivers: { display_name: "Driver A" },
        },
      ],
      export_allocations: [
        {
          id: "export-reserved",
          trailer_id: "trailer-2",
          trailer_number: "FS1002",
          customer: "Bravo Freight",
          priority: "normal",
          status: "allocated",
          updated_at: "2026-08-01T09:00:00.000Z",
        },
      ],
    };

    render(<SupervisorMobileDashboard />);
    const user = userEvent.setup();
    const departuresButtons = await screen.findAllByRole("button", { name: "Departures" });
    await user.click(departuresButtons[0]);
    await screen.findByText("Departures Mobile Access");

    expect(within(getTrailerCard("FS1001")).getByRole("button", { name: "Reserved - Delivery" })).toBeDisabled();
    expect(within(getTrailerCard("FS1002")).getByRole("button", { name: "Reserved - Export" })).toBeDisabled();
    expect(within(getTrailerCard("FS1004")).getByRole("button", { name: "Confirm Departure" })).toBeEnabled();
  });

  it("confirms an eligible departure without leaving the Departures tab", async () => {
    render(<SupervisorMobileDashboard />);
    const user = userEvent.setup();
    const departuresButtons = await screen.findAllByRole("button", { name: "Departures" });
    await user.click(departuresButtons[0]);
    await screen.findByText("Departures Mobile Access");

    await user.click(within(getTrailerCard("FS1004")).getByRole("button", { name: "Confirm Departure" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/mobile-actions",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("CONFIRM_DEPARTURE"),
        }),
      );
    });

    expect(screen.getByText("Departures Mobile Access")).toBeInTheDocument();
    expect(screen.getByText("FS1004 departed.")).toBeInTheDocument();
  });

  it("locks Confirm Departure while the write is in progress", async () => {
    let resolveConfirm: (value: { ok: boolean; json: () => Promise<{ status: string; message: string }> }) => void = () => undefined;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/mobile-actions") && (init?.method ?? "GET") === "POST") {
        return new Promise<{ ok: boolean; json: () => Promise<{ status: string; message: string }> }>((resolve) => {
          resolveConfirm = resolve;
        });
      }

      return {
        ok: true,
        json: async () => ({ status: "success", message: "Action completed." }),
      };
    });

    render(<SupervisorMobileDashboard />);
    const user = userEvent.setup();
    const departuresButtons = await screen.findAllByRole("button", { name: "Departures" });
    await user.click(departuresButtons[0]);
    await screen.findByText("Departures Mobile Access");

    const confirmButton = within(getTrailerCard("FS1004")).getByRole("button", { name: "Confirm Departure" });
    await user.click(confirmButton);

    const lockedButton = await within(getTrailerCard("FS1004")).findByRole("button", { name: "Updating..." });
    expect(lockedButton).toBeDisabled();
    await user.click(lockedButton);

    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/mobile-actions"))).toHaveLength(1);

    resolveConfirm({
      ok: true,
      json: async () => ({ status: "success", message: "FS1004 departed." }),
    });

    await waitFor(() => {
      expect(screen.getByText("Departures Mobile Access")).toBeInTheDocument();
    });
  });
});