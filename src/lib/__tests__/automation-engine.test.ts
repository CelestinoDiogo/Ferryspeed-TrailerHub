import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let runScheduledAutomationJobs: typeof import("@/lib/automation/engine").runScheduledAutomationJobs;

beforeAll(async () => {
  ({ runScheduledAutomationJobs } = await import("@/lib/automation/engine"));
});

type RuleRow = {
  id: string;
  name: string;
  description: string | null;
  trigger_event: string;
  conditions: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
  enabled: boolean;
  last_executed_at: string | null;
  execution_count: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const seededRules: RuleRow[] = [
  {
    id: "rule-dwell",
    name: "Dwell Monitoring Escalation",
    description: null,
    trigger_event: "scheduler_job",
    conditions: { schedulerJob: "dwell_monitoring", dwellTimeHours: 72 },
    actions: [{ type: "create_alert", severity: "warning" }],
    enabled: true,
    last_executed_at: null,
    execution_count: 0,
    created_by: "system",
    updated_by: "system",
    created_at: null,
    updated_at: null,
  },
  {
    id: "rule-inspection",
    name: "Pending Priority Inspection Escalation",
    description: null,
    trigger_event: "scheduler_job",
    conditions: { schedulerJob: "pending_inspections", priority: "priority", inspectionPending: 60 },
    actions: [{ type: "create_alert", severity: "high" }, { type: "send_notification" }],
    enabled: true,
    last_executed_at: null,
    execution_count: 0,
    created_by: "system",
    updated_by: "system",
    created_at: null,
    updated_at: null,
  },
  {
    id: "rule-export",
    name: "Overdue Export Follow-up",
    description: null,
    trigger_event: "scheduler_job",
    conditions: { schedulerJob: "overdue_exports", exportOverdue: true },
    actions: [{ type: "add_exception", severity: "warning" }, { type: "send_notification" }],
    enabled: true,
    last_executed_at: null,
    execution_count: 0,
    created_by: "system",
    updated_by: "system",
    created_at: null,
    updated_at: null,
  },
  {
    id: "rule-stock",
    name: "Stock Discrepancy Escalation",
    description: null,
    trigger_event: "scheduler_job",
    conditions: { schedulerJob: "stock_discrepancies" },
    actions: [{ type: "create_alert", severity: "high" }, { type: "refresh_kpi" }],
    enabled: true,
    last_executed_at: null,
    execution_count: 0,
    created_by: "system",
    updated_by: "system",
    created_at: null,
    updated_at: null,
  },
  {
    id: "rule-summary",
    name: "Daily Summary Task",
    description: null,
    trigger_event: "scheduler_job",
    conditions: { schedulerJob: "daily_summaries" },
    actions: [{ type: "generate_report_task", reportType: "daily_summary" }, { type: "send_notification" }],
    enabled: true,
    last_executed_at: null,
    execution_count: 0,
    created_by: "system",
    updated_by: "system",
    created_at: null,
    updated_at: null,
  },
];

const buildClient = () => {
  const executionInserts: Record<string, unknown>[] = [];
  const ruleUpdates: Record<string, unknown>[] = [];
  const trailerAuditInserts: Record<string, unknown>[] = [];

  const client = {
    from(table: string) {
      if (table === "automation_rules") {
        const filters: Record<string, unknown> = {};

        const query = {
          eq(column: string, value: unknown) {
            filters[column] = value;
            return query;
          },
          order() {
            const rows = seededRules.filter((row) => {
              if (filters.enabled !== undefined && row.enabled !== filters.enabled) {
                return false;
              }

              if (filters.trigger_event !== undefined && row.trigger_event !== filters.trigger_event) {
                return false;
              }

              if (filters.id !== undefined && row.id !== filters.id) {
                return false;
              }

              return true;
            });

            return Promise.resolve({ data: rows, error: null });
          },
          limit(count: number) {
            const rows = seededRules.filter((row) => {
              if (filters.enabled !== undefined && row.enabled !== filters.enabled) {
                return false;
              }

              if (filters.trigger_event !== undefined && row.trigger_event !== filters.trigger_event) {
                return false;
              }

              if (filters.id !== undefined && row.id !== filters.id) {
                return false;
              }

              return true;
            });

            return {
              maybeSingle() {
                return Promise.resolve({ data: rows.slice(0, count)[0] ?? null, error: null });
              },
            };
          },
        };

        return {
          select() {
            return query;
          },
          update(payload: Record<string, unknown>) {
            ruleUpdates.push(payload);
            return {
              eq() {
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "automation_rule_executions") {
        return {
          insert(payload: Record<string, unknown>) {
            executionInserts.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }

      if (table === "trailer_audit_log") {
        return {
          insert(payload: Record<string, unknown>) {
            trailerAuditInserts.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }

      if (table === "operational_alerts") {
        return {
          select() {
            return {
              eq() {
                return {
                  in() {
                    return Promise.resolve({ data: [], error: null });
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };

  return {
    client,
    executionInserts,
    ruleUpdates,
    trailerAuditInserts,
  };
};

describe("runScheduledAutomationJobs", () => {
  it("treats daily summary as a system event and avoids trailer audit inserts without trailer context", async () => {
    const { client, executionInserts, ruleUpdates, trailerAuditInserts } = buildClient();

    const summaries = await runScheduledAutomationJobs(client as never);

    expect(summaries).toHaveLength(5);

    const dailySummary = summaries.find((summary) => summary.triggerEvent === "scheduler_job" && summary.successCount === 1);
    expect(dailySummary).toBeDefined();

    expect(trailerAuditInserts).toHaveLength(0);

    const successLogs = executionInserts.filter((row) => row.outcome === "success");
    expect(successLogs).toHaveLength(1);
    expect(successLogs[0]).toMatchObject({
      rule_id: "rule-summary",
      trigger_event: "scheduler_job",
      outcome: "success",
      message: "Executed 2 action(s).",
    });

    expect(ruleUpdates).toHaveLength(1);
    expect(ruleUpdates[0]).toMatchObject({
      execution_count: 1,
    });

    const dailySummaryLogs = executionInserts.filter((row) => row.rule_id === "rule-summary");
    expect(dailySummaryLogs).toHaveLength(1);
    expect(dailySummaryLogs.filter((row) => row.outcome === "success")).toHaveLength(1);
    expect(dailySummaryLogs.filter((row) => row.outcome === "failed")).toHaveLength(0);
    expect(dailySummaryLogs.find((row) => row.outcome === "success")).toMatchObject({
      outcome: "success",
    });
  });
});