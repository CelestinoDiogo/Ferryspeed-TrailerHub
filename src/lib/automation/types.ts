import { z } from "zod";
import type { Database } from "@/lib/database.types";

export const automationTriggerEvents = [
  "trailer_arrived",
  "inspection_completed",
  "temperature_recorded",
  "damage_recorded",
  "export_status_changed",
  "compound_position_changed",
  "stock_check_completed",
  "scheduler_job",
] as const;

export const schedulerJobKeys = [
  "dwell_monitoring",
  "pending_inspections",
  "overdue_exports",
  "stock_discrepancies",
  "daily_summaries",
] as const;

export type SchedulerJobKey = (typeof schedulerJobKeys)[number];
export type AutomationTriggerEvent = (typeof automationTriggerEvents)[number];

export type AutomationRuleRow = Database["public"]["Tables"]["automation_rules"]["Row"];
export type AutomationRuleExecutionRow = Database["public"]["Tables"]["automation_rule_executions"]["Row"];

export const automationActionTypeSchema = z.enum([
  "create_alert",
  "highlight_trailer",
  "refresh_kpi",
  "send_notification",
  "generate_report_task",
  "add_exception",
]);

export const automationActionSchema = z
  .object({
    type: automationActionTypeSchema,
    severity: z.enum(["critical", "high", "warning", "info"]).optional(),
    title: z.string().trim().min(1).max(180).optional(),
    description: z.string().trim().min(1).max(500).optional(),
    sourceModule: z.string().trim().min(1).max(60).optional(),
    reportType: z.string().trim().min(1).max(80).optional(),
    highlightLabel: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export const automationConditionsSchema = z
  .object({
    priority: z.union([z.literal("priority"), z.literal("normal"), z.array(z.string().trim().min(1).max(80)).min(1)]).optional(),
    customer: z.union([z.string().trim().min(1).max(180), z.array(z.string().trim().min(1).max(180)).min(1)]).optional(),
    trailerType: z.union([z.string().trim().min(1).max(120), z.array(z.string().trim().min(1).max(120)).min(1)]).optional(),
    temperatureThreshold: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
      })
      .strict()
      .optional(),
    dwellTimeHours: z.number().min(0).max(24 * 365).optional(),
    inspectionPending: z.union([z.boolean(), z.number().min(1).max(24 * 60)]).optional(),
    exportOverdue: z.union([z.boolean(), z.number().min(1).max(24 * 365)]).optional(),
    schedulerJob: z.enum(schedulerJobKeys).optional(),
  })
  .strict();

export const automationRuleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(400).nullable().optional(),
    triggerEvent: z.enum(automationTriggerEvents),
    conditions: automationConditionsSchema.default({}),
    actions: z.array(automationActionSchema).min(1),
    enabled: z.boolean().default(true),
  })
  .strict();

export const automationRulePatchSchema = z
  .object({
    ruleId: z.string().uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(400).nullable().optional(),
    triggerEvent: z.enum(automationTriggerEvents).optional(),
    conditions: automationConditionsSchema.optional(),
    actions: z.array(automationActionSchema).min(1).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export type AutomationAction = z.infer<typeof automationActionSchema>;
export type AutomationConditions = z.infer<typeof automationConditionsSchema>;
export type AutomationRuleInput = z.infer<typeof automationRuleInputSchema>;
export type AutomationRulePatchInput = z.infer<typeof automationRulePatchSchema>;

export type AutomationEventPayload = {
  triggerEvent: AutomationTriggerEvent;
  sourceActivityId?: string | null;
  schedulerJob?: SchedulerJobKey;
  trailerId?: string | null;
  trailerNumber?: string | null;
  sourceRecordId?: string | null;
  metadata?: Record<string, unknown>;
};

export type AutomationEventContext = {
  payload: AutomationEventPayload;
  trailer: Database["public"]["Tables"]["trailers"]["Row"] | null;
  vesselTrailer: Database["public"]["Tables"]["vessel_operation_trailers"]["Row"] | null;
  exportAllocation: Database["public"]["Tables"]["export_allocations"]["Row"] | null;
  latestTemperature: Database["public"]["Tables"]["vessel_inspection_temperatures"]["Row"] | null;
};

export type AutomationExecutionOutcome = "success" | "skipped" | "failed";

export type AutomationExecutionSummary = {
  triggerEvent: AutomationTriggerEvent;
  processedRules: number;
  successCount: number;
  skippedCount: number;
  failedCount: number;
};
