import type { AutomationExecutionSummary } from "@/lib/automation/types";
import type { SchedulerRuleDescriptor } from "@/lib/automation/engine";

const buildFailedSummary = (): AutomationExecutionSummary => ({
  triggerEvent: "scheduler_job",
  processedRules: 1,
  successCount: 0,
  skippedCount: 0,
  failedCount: 1,
});

type ChildRunResponse = {
  summary?: AutomationExecutionSummary;
  error?: string;
};

export async function dispatchSchedulerRules(
  request: Request,
  rules: SchedulerRuleDescriptor[],
): Promise<AutomationExecutionSummary[]> {
  const token = process.env.AUTOMATION_SCHEDULER_TOKEN;
  if (!token) {
    throw new Error("Missing AUTOMATION_SCHEDULER_TOKEN.");
  }

  const endpoint = new URL("/api/automation/scheduler/rule", request.url).toString();
  const summaries: AutomationExecutionSummary[] = [];

  for (const rule of rules) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-automation-token": token,
        },
        body: JSON.stringify(rule),
      });

      const payload = (await response.json().catch(() => ({}))) as ChildRunResponse;
      if (!response.ok || !payload.summary) {
        summaries.push(buildFailedSummary());
        continue;
      }

      summaries.push(payload.summary);
    } catch {
      summaries.push(buildFailedSummary());
    }
  }

  return summaries;
}
