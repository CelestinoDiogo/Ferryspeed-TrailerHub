// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadReport = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "op-1" }),
}));

vi.mock("@/lib/reports/report-data", () => ({
  loadVesselOperationSummaryAndPrintReportData: (...args: unknown[]) => mockLoadReport(...args),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    },
  },
}));

import VesselSummaryPage from "@/app/dashboard/vessel-operations/[id]/summary/page";
import VesselOperationPrintPage from "@/app/dashboard/vessel-operations/[id]/print/page";

const makeReport = (overrides?: { photoUrl?: string | null; includePhotos?: boolean; photoCount?: number }) => ({
  operation: {
    id: "op-1",
    vesselName: "MV Atlas",
    voyageReference: "VOY-1",
    expectedArrivalAt: "2026-08-01T09:00:00.000Z",
    actualArrivalAt: "2026-08-01T09:10:00.000Z",
    operationStartedAt: "2026-08-01T08:00:00.000Z",
    operationCompletedAt: null,
    confirmedAt: "2026-08-01T08:30:00.000Z",
    completedAt: null,
    operator: "Operator",
    port: "Dover",
    berth: "B1",
    status: "in_progress",
    listStatus: "confirmed",
    listConfirmedAt: "2026-08-01T08:30:00.000Z",
    listConfirmedBy: "Operator",
    notes: null,
  },
  statistics: {
    totalTrailers: 1,
    expectedTrailers: 1,
    arrivedTrailers: 1,
    pendingTrailers: 0,
    notDischargedTrailers: 0,
    priorityTrailers: 0,
    inspectedTrailers: 1,
    pendingInspections: 0,
    damagedTrailers: 0,
    temperatureAlertTrailers: 0,
    temperatureChecks: 0,
    temperatureExceptions: 0,
    completionPercentage: 100,
  },
  performance: {
    averageInspectionTimeMinutes: 10,
    arrivalCompletionPercent: 100,
    priorityCompletionPercent: 100,
    temperatureCompliancePercent: null,
    photosCapturedPercent: 100,
    damageIncidencePercent: 0,
    compoundOccupancyImpactPercent: 100,
    exportTurnaroundHours: null,
  },
  trailers: [
    {
      id: "vt-1",
      trailerNumber: "PRO100",
      customer: "Customer A",
      bookingReference: "BR-1",
      loadStatus: "Loaded",
      priority: "normal",
      ownershipType: "outsourcing",
      arrivalStatus: "Arrived",
      arrivalStatusRaw: "arrived",
      arrivedAt: "2026-08-01T09:20:00.000Z",
      arrivalTime: "2026-08-01T09:20:00.000Z",
      inspectionStatus: "inspected",
      inspectionCompletedAt: "2026-08-01T09:30:00.000Z",
      receptionStatus: "Received in Compound",
      compoundPosition: "P01",
      damageStatus: "clear",
      overallCondition: "good",
      hasDamage: false,
      hasTemperatureAlert: false,
      temperatureResult: "not_assessed",
      expectedFrontTemperature: null,
      expectedRearTemperature: null,
      frontTemperature: null,
      rearTemperature: null,
      temperatureUnit: "C",
      operationalStatus: "inspected",
      notes: null,
      boatCheckNotes: null,
      receptionNotes: null,
      damageDetails: null,
      photos: [
        ...Array.from({ length: overrides?.photoCount ?? 1 }, (_, index) => ({
          id: `photo-${index + 1}`,
          url:
            overrides?.photoUrl !== undefined
              ? overrides.photoUrl
              : "https://mdbkgdpwzhoazrvogfxo.supabase.co/storage/v1/object/sign/vessel-inspection-photos/vessel-inspections/op-1/photo-1.jpg?token=redacted-token",
          caption: `Inspection photo ${index + 1}`,
          trailerNumber: "PRO100",
          recordedAt: "2026-08-01T09:35:00.000Z",
          category: "inspection",
          fileName: `photo-${index + 1}.jpg`,
          description: "Door latch check",
          uploadedBy: "Inspector A",
        })),
      ],
    },
  ],
  damages: [],
  photos: Array.from({ length: overrides?.photoCount ?? 1 }, (_, index) => ({
    id: `photo-${index + 1}`,
    trailerId: "vt-1",
    trailerNumber: "PRO100",
    url:
      overrides?.photoUrl !== undefined
        ? overrides.photoUrl
        : "https://mdbkgdpwzhoazrvogfxo.supabase.co/storage/v1/object/sign/vessel-inspection-photos/vessel-inspections/op-1/photo-1.jpg?token=redacted-token",
    caption: `Inspection photo ${index + 1}`,
    recordedAt: "2026-08-01T09:35:00.000Z",
    category: "inspection",
    fileName: `photo-${index + 1}.jpg`,
    description: "Door latch check",
    uploadedBy: "Inspector A",
  })).filter(() => overrides?.includePhotos !== false),
  temperatures: [],
  exceptions: [],
  operationalAlerts: [],
  exportActivity: {
    allocationsAffected: 0,
    waitingLoading: 0,
    waitingCollection: 0,
    overdue: 0,
    completed: 0,
    averageTurnaroundHours: null,
    sampleAllocations: [],
  },
  timelineSummary: {
    totalEvents: 0,
    firstEventAt: null,
    lastEventAt: null,
    topEventTypes: [],
  },
  timeline: [],
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

beforeEach(() => {
  mockLoadReport.mockResolvedValue(makeReport());
});

describe("Summary and print photo rendering", () => {
  it("renders signed Supabase image URLs in native img tags", async () => {
    render(<VesselSummaryPage />);

    expect(await screen.findByText("Inspection Photos")).toBeInTheDocument();

    const summaryImage = screen.getByAltText("Inspection photo 1") as HTMLImageElement;
    expect(summaryImage.tagName).toBe("IMG");
    expect(summaryImage.src).toContain("mdbkgdpwzhoazrvogfxo.supabase.co/storage/v1/object/sign");

    cleanup();
    render(<VesselOperationPrintPage />);

    expect(await screen.findByText("Inspection Photos")).toBeInTheDocument();
    const printImage = screen.getByAltText("Inspection photo 1") as HTMLImageElement;
    expect(printImage.tagName).toBe("IMG");
    expect(printImage.src).toContain("mdbkgdpwzhoazrvogfxo.supabase.co/storage/v1/object/sign");
  });

  it("renders photo section in Summary with metadata and contain-fit image", async () => {
    render(<VesselSummaryPage />);

    expect(await screen.findByText("Inspection Photos")).toBeInTheDocument();
    expect(screen.getByText("Category: inspection")).toBeInTheDocument();
    expect(screen.getByText("Description: Door latch check")).toBeInTheDocument();
    expect(screen.getByText("Uploaded by: Inspector A")).toBeInTheDocument();

    const image = screen.getByAltText("Inspection photo 1");
    expect(image.className).toContain("object-contain");
  });

  it("renders photo section in Print with metadata and contain-fit image", async () => {
    render(<VesselOperationPrintPage />);

    expect(await screen.findByText("Inspection Photos")).toBeInTheDocument();
    expect(screen.getByText("Trailer: PRO100")).toBeInTheDocument();
    expect(screen.getByText("Category: inspection")).toBeInTheDocument();
    expect(screen.getByText("Description: Door latch check")).toBeInTheDocument();
    expect(screen.getByText("Uploaded by: Inspector A")).toBeInTheDocument();

    const image = screen.getByAltText("Inspection photo 1");
    expect(image.className).toContain("object-contain");
  });

  it("renders multiple inspection photos", async () => {
    mockLoadReport.mockResolvedValueOnce(makeReport({ photoCount: 2 }));

    render(<VesselOperationPrintPage />);

    expect(await screen.findByText("Inspection Photos")).toBeInTheDocument();
    const renderedImages = screen.getAllByRole("img", { name: /inspection photo/i });
    expect(renderedImages.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Print image readiness behavior", () => {
  it("waits for images before enabling print button", async () => {
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { get: () => false });
    vi.spyOn(document, "querySelectorAll").mockReturnValue([img] as unknown as NodeListOf<HTMLImageElement>);

    render(<VesselOperationPrintPage />);

    expect(await screen.findByRole("button", { name: "Preparing Photos..." })).toBeDisabled();

    fireEvent.load(img);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Print Report" })).toBeEnabled();
    });
  });

  it("treats image load failure as settled", async () => {
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { get: () => false });
    vi.spyOn(document, "querySelectorAll").mockReturnValue([img] as unknown as NodeListOf<HTMLImageElement>);

    render(<VesselOperationPrintPage />);

    expect(await screen.findByRole("button", { name: "Preparing Photos..." })).toBeDisabled();

    fireEvent.error(img);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Print Report" })).toBeEnabled();
    });
  });

  it("releases print button after timeout", async () => {
    vi.useFakeTimers();

    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { get: () => false });
    vi.spyOn(document, "querySelectorAll").mockReturnValue([img] as unknown as NodeListOf<HTMLImageElement>);

    render(<VesselOperationPrintPage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Preparing Photos..." })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6001);
    });

    expect(screen.getByRole("button", { name: "Print Report" })).toBeEnabled();
  });

  it("does not delay printing when there are zero photos", async () => {
    mockLoadReport.mockResolvedValueOnce(makeReport({ includePhotos: false }));

    render(<VesselOperationPrintPage />);

    expect(await screen.findByRole("button", { name: "Print Report" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Preparing Photos..." })).not.toBeInTheDocument();
  });

  it("one broken image does not block all printing", async () => {
    const imgOne = document.createElement("img");
    const imgTwo = document.createElement("img");
    Object.defineProperty(imgOne, "complete", { get: () => false });
    Object.defineProperty(imgTwo, "complete", { get: () => false });

    vi.spyOn(document, "querySelectorAll").mockReturnValue([imgOne, imgTwo] as unknown as NodeListOf<HTMLImageElement>);

    render(<VesselOperationPrintPage />);

    expect(await screen.findByRole("button", { name: "Preparing Photos..." })).toBeDisabled();

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.error(imgOne);
    fireEvent.load(imgTwo);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Print Report" })).toBeEnabled();
    });
  });
});
