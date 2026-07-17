import "server-only";
import type { AIReportNarrative, VesselOperationalReportData } from "@/lib/reports/types";

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
