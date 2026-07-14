import "server-only";
import { createHash } from "node:crypto";
import type { AIReportNarrative, VesselOperationalReportData, VesselOperationReportSnapshot } from "@/lib/reports/types";

export function stringifyRecommendations(recommendations: string[]): string {
  return recommendations
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
}

export function parseRecommendations(value?: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(objectValue[key])}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

export function buildSnapshotHash(data: VesselOperationalReportData): string {
  const payload = stableSerialize(data);
  return createHash("sha256").update(payload).digest("hex");
}

export function buildSnapshot(data: VesselOperationalReportData): VesselOperationReportSnapshot {
  return {
    snapshotHash: buildSnapshotHash(data),
    generatedAt: new Date().toISOString(),
    data,
  };
}

export function buildDeterministicNarrative(data: VesselOperationalReportData): AIReportNarrative {
  const pending = data.statistics.pendingTrailers;
  const failedTemps = data.statistics.temperatureExceptions;
  const damages = data.statistics.damagedTrailers;

  return {
    executiveSummary: `Operation ${data.operation.vesselName} currently reports ${data.statistics.arrivedTrailers} arrived trailers out of ${data.statistics.expectedTrailers} expected, with ${pending} pending.`,
    operationalAnalysis: `Inspection progress is ${data.statistics.completionPercentage}%. Recorded damage trailers: ${damages}. Temperature exceptions: ${failedTemps}. This narrative is deterministic fallback content generated without AI service output.`,
    recommendations: [
      pending > 0 ? "Prioritise closure of pending trailer arrivals." : "Maintain current arrival control process.",
      data.statistics.pendingInspections > 0
        ? "Complete all remaining inspections and update records before final approval."
        : "Keep inspection records up to date and auditable.",
      failedTemps > 0
        ? "Investigate failed temperature checks and document corrective action."
        : "Continue routine temperature verification for sensitive loads.",
    ],
    conclusion: "Operational facts are based on current Vessel Operation records and should be reviewed before approval.",
  };
}
