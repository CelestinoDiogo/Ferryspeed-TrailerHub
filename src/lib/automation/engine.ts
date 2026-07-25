import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  automationConditionsSchema,
  automationRuleInputSchema,
  automationRulePatchSchema,
  schedulerJobKeys,
  type AutomationAction,
  type AutomationConditions,
  type AutomationEventContext,
  type AutomationEventPayload,
  type AutomationExecutionSummary,
  type AutomationRuleExecutionRow,
  type AutomationRuleInput,
  type AutomationRulePatchInput,
  type AutomationRuleRow,
  type AutomationTriggerEvent,
  type SchedulerJobKey,
} from "@/lib/automation/types";
import { isExportAllocationOverdue, type ExportAllocationStatus } from "@/lib/export-allocation";
import { createOperationalAlert, runOperationalAlertDetection } from "@/lib/operational-alerts";
import { createTrailerActivity } from "@/lib/trailer-activity";

type AutomationClient = SupabaseClient<Database>;

type TrailerActivityRow = Database["public"]["Tables"]["trailer_activity_log"]["Row"];
type TrailerRow = Database["public"]["Tables"]["trailers"]["Row"];
type VesselTrailerRow = Database["public"]["Tables"]["vessel_operation_trailers"]["Row"];
type ExportAllocationRow = Database["public"]["Tables"]["export_allocations"]["Row"];
type TemperatureRow = Database["public"]["Tables"]["vessel_inspection_temperatures"]["Row"];

type ParsedRule = {
  row: AutomationRuleRow;
  conditions: AutomationConditions;
  actions: AutomationAction[];
};

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";
const EVENT_MAP: Record<string, AutomationTriggerEvent | null> = {
  arrived: "trailer_arrived",
  vessel_arrived: "trailer_arrived",
  inspection_completed: "inspection_completed",
  temperature_recorded: "temperature_recorded",
  damage_recorded: "damage_recorded",
  export_status_changed: "export_status_changed",
  compound_position_changed: "compound_position_changed",
  stock_check_confirmed: "stock_check_completed",
  stock_check_adjusted: "stock_check_completed",
};

const toStringArray = (value: string | string[]) => (Array.isArray(value) ? value : [value]);

const toJson = (value: unknown): Database["public"]["Tables"]["automation_rule_executions"]["Row"]["execution_payload"] => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJson(item));
  }

  if (typeof value === "object") {
    const normalized = Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, toJson(item)]);
    return Object.fromEntries(normalized);
  }

  return String(value);
};

const parseConditions = (value: unknown): AutomationConditions => {
  const parsed = automationConditionsSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
};

const parseActions = (value: unknown): AutomationAction[] => {
  const parsed = automationRuleInputSchema.shape.actions.safeParse(value);
  return parsed.success ? parsed.data : [];
};

const parseRule = (row: AutomationRuleRow): ParsedRule | null => {
  const conditions = parseConditions(row.conditions);
  const actions = parseActions(row.actions);
  if (actions.length === 0) {
    return null;
  }

  return { row, conditions, actions };
};

const getDwellHours = (trailer: TrailerRow | null) => {
  if (!trailer) {
    return 0;
  }

  const source = trailer.arrival_date ?? trailer.created_at;
  if (!source) {
    return 0;
  }

  const startedAt = new Date(source).getTime();
  if (!Number.isFinite(startedAt)) {
    return 0;
  }

  return Math.max(0, (Date.now() - startedAt) / 3_600_000);
};

const isInspectionPending = (vesselTrailer: VesselTrailerRow | null) => {
  if (!vesselTrailer) {
    return false;
  }

  const arrived = normalizeText(vesselTrailer.arrival_status) === "arrived" || normalizeText(vesselTrailer.status) === "arrived";
  return arrived && !vesselTrailer.inspection_completed_at;
};

const getInspectionPendingMinutes = (vesselTrailer: VesselTrailerRow | null) => {
  if (!vesselTrailer || !isInspectionPending(vesselTrailer)) {
    return 0;
  }

  const source = vesselTrailer.arrival_confirmed_at ?? vesselTrailer.arrived_at;
  if (!source) {
    return 0;
  }

  const startedAt = new Date(source).getTime();
  if (!Number.isFinite(startedAt)) {
    return 0;
  }

  return Math.max(0, (Date.now() - startedAt) / 60_000);
};

const isOverdueByHours = (expectedAt?: string | null, hours = 0) => {
  if (!expectedAt) {
    return false;
  }

  const expectedMs = new Date(expectedAt).getTime();
  if (!Number.isFinite(expectedMs)) {
    return false;
  }

  return Date.now() - expectedMs >= hours * 3_600_000;
};

const evaluateConditions = (conditions: AutomationConditions, context: AutomationEventContext) => {
  if (conditions.schedulerJob) {
    if (context.payload.schedulerJob !== conditions.schedulerJob) {
      return false;
    }
  }

  if (conditions.priority) {
    const allowed = Array.isArray(conditions.priority)
      ? conditions.priority.map((value) => normalizeText(value))
      : [normalizeText(conditions.priority)];
    const current = normalizeText(context.vesselTrailer?.priority_level ?? null);
    if (!allowed.includes(current)) {
      return false;
    }
  }

  if (conditions.customer) {
    const allowed = toStringArray(conditions.customer).map((value) => normalizeText(value));
    const current = normalizeText(context.trailer?.customer ?? context.vesselTrailer?.customer ?? null);
    if (!allowed.includes(current)) {
      return false;
    }
  }

  if (conditions.trailerType) {
    const allowed = toStringArray(conditions.trailerType).map((value) => normalizeText(value));
    const current = normalizeText(context.trailer?.trailer_type ?? null);
    if (!allowed.includes(current)) {
      return false;
    }
  }

  if (conditions.temperatureThreshold && context.latestTemperature?.temperature_value !== null) {
    const current = context.latestTemperature?.temperature_value ?? null;
    if (typeof current === "number") {
      if (typeof conditions.temperatureThreshold.min === "number" && current < conditions.temperatureThreshold.min) {
        return false;
      }

      if (typeof conditions.temperatureThreshold.max === "number" && current > conditions.temperatureThreshold.max) {
        return false;
      }
    }
  } else if (conditions.temperatureThreshold) {
    return false;
  }

  if (typeof conditions.dwellTimeHours === "number") {
    if (getDwellHours(context.trailer) < conditions.dwellTimeHours) {
      return false;
    }
  }

  if (typeof conditions.inspectionPending === "boolean") {
    if (conditions.inspectionPending !== isInspectionPending(context.vesselTrailer)) {
      return false;
    }
  }

  if (typeof conditions.inspectionPending === "number") {
    if (!isInspectionPending(context.vesselTrailer)) {
      return false;
    }

    if (getInspectionPendingMinutes(context.vesselTrailer) < conditions.inspectionPending) {
      return false;
    }
  }

  if (typeof conditions.exportOverdue === "boolean") {
    const overdue = Boolean(
      context.exportAllocation
      && isExportAllocationOverdue({
        status: context.exportAllocation.status as ExportAllocationStatus,
        expected_return_at: context.exportAllocation.expected_return_at,
      }),
    );
    if (overdue !== conditions.exportOverdue) {
      return false;
    }
  }

  if (typeof conditions.exportOverdue === "number") {
    if (!context.exportAllocation) {
      return false;
    }

    if (!isOverdueByHours(context.exportAllocation.expected_return_at, conditions.exportOverdue)) {
      return false;
    }
  }

  return true;
};

const resolveAlertTitle = (action: AutomationAction, payload: AutomationEventPayload) => {
  if (action.title) {
    return action.title;
  }

  return `Automation rule triggered for ${payload.triggerEvent.replace(/_/g, " ")}`;
};

const resolveAlertDescription = (action: AutomationAction, payload: AutomationEventPayload) => {
  if (action.description) {
    return action.description;
  }

  return `Automation engine executed on trigger ${payload.triggerEvent}.`;
};

const executeAction = async (client: AutomationClient, rule: ParsedRule, action: AutomationAction, context: AutomationEventContext) => {
  const trailerId = context.trailer?.id ?? context.vesselTrailer?.trailer_id ?? context.payload.trailerId ?? null;
  const trailerNumber = context.trailer?.trailer_number ?? context.vesselTrailer?.trailer_number ?? context.payload.trailerNumber ?? null;
  const sourceRecordId = context.payload.sourceRecordId ?? context.vesselTrailer?.id ?? context.exportAllocation?.id ?? null;

  if (action.type === "create_alert" || action.type === "add_exception") {
    const result = await createOperationalAlert(
      {
        alertKey: `automation:${rule.row.id}:${context.payload.triggerEvent}:${sourceRecordId ?? "none"}`,
        severity: action.severity ?? (action.type === "add_exception" ? "warning" : "info"),
        title: resolveAlertTitle(action, context.payload),
        description: resolveAlertDescription(action, context.payload),
        trailerId,
        trailerNumber,
        sourceModule: action.sourceModule ?? "operations",
        sourceRecordId,
        metadata: {
          automation_rule_id: rule.row.id,
          trigger_event: context.payload.triggerEvent,
          action_type: action.type,
          scheduler_job: context.payload.schedulerJob ?? null,
        },
        performedBy: "Automation Engine",
      },
      client,
    );

    if (!result.ok) {
      throw new Error(result.error);
    }

    return;
  }

  if (action.type === "highlight_trailer") {
    if (!trailerNumber) {
      return;
    }

    await createTrailerActivity({
      supabaseClient: client,
      trailerId,
      trailerNumber,
      eventType: "note_added",
      eventTitle: "Automation highlight",
      eventDescription: action.highlightLabel ?? "Trailer highlighted by automation rule.",
      sourceModule: "system",
      sourceRecordId: sourceRecordId ?? rule.row.id,
      metadata: {
        automation_rule_id: rule.row.id,
        trigger_event: context.payload.triggerEvent,
      },
      performedBy: "Automation Engine",
    });

    return;
  }

  if (action.type === "refresh_kpi") {
    const result = await runOperationalAlertDetection(client);
    if (!result.ok) {
      throw new Error(result.error);
    }

    return;
  }

  if (action.type === "send_notification") {
    const { error } = await client.from("trailer_audit_log").insert({
      trailer_id: trailerId,
      trailer_number: trailerNumber,
      event_type: "automation_notification",
      description: resolveAlertDescription(action, context.payload),
      previous_value: null,
      new_value: {
        automation_rule_id: rule.row.id,
        trigger_event: context.payload.triggerEvent,
      },
      source_module: "operations",
      performed_by: "Automation Engine",
      performed_at: new Date().toISOString(),
    });

    if (error) {
      throw new Error(error.message || "Unable to create automation notification.");
    }

    return;
  }

  if (action.type === "generate_report_task") {
    if (!trailerNumber) {
      return;
    }

    await createTrailerActivity({
      supabaseClient: client,
      trailerId,
      trailerNumber,
      eventType: "note_added",
      eventTitle: "Automation report task",
      eventDescription: `Generated report task: ${action.reportType ?? "operational_summary"}`,
      sourceModule: "system",
      sourceRecordId: rule.row.id,
      metadata: {
        automation_rule_id: rule.row.id,
        report_type: action.reportType ?? "operational_summary",
        trigger_event: context.payload.triggerEvent,
      },
      performedBy: "Automation Engine",
    });
  }
};

const insertExecutionLog = async (
  client: AutomationClient,
  rule: AutomationRuleRow,
  payload: AutomationEventPayload,
  outcome: "success" | "skipped" | "failed",
  message: string,
  affectedEntityType: string | null,
  affectedEntityId: string | null,
) => {
  const insertPayload: Database["public"]["Tables"]["automation_rule_executions"]["Insert"] = {
    rule_id: rule.id,
    trigger_event: payload.triggerEvent,
    outcome,
    message,
    affected_entity_type: affectedEntityType,
    affected_entity_id: affectedEntityId,
    source_activity_id: payload.sourceActivityId ?? null,
    execution_payload: toJson({
      trailer_id: payload.trailerId ?? null,
      trailer_number: payload.trailerNumber ?? null,
      source_record_id: payload.sourceRecordId ?? null,
      scheduler_job: payload.schedulerJob ?? null,
      metadata: payload.metadata ?? {},
    }),
    executed_at: new Date().toISOString(),
  };

  const { error } = await client.from("automation_rule_executions").insert(insertPayload);
  if (error) {
    if (error.code === "23505") {
      return false;
    }

    throw new Error(error.message || "Unable to insert automation execution log.");
  }

  if (outcome === "success") {
    const { error: updateError } = await client
      .from("automation_rules")
      .update({
        last_executed_at: new Date().toISOString(),
        execution_count: rule.execution_count + 1,
      })
      .eq("id", rule.id);

    if (updateError) {
      throw new Error(updateError.message || "Unable to update automation rule execution counters.");
    }
  }

  return true;
};

const resolveTriggerFromActivity = (row: TrailerActivityRow): AutomationTriggerEvent | null => {
  const event = normalizeText(row.event_type);
  return EVENT_MAP[event] ?? null;
};

const loadEventContext = async (client: AutomationClient, payload: AutomationEventPayload): Promise<AutomationEventContext> => {
  const trailerQuery = payload.trailerId
    ? client
        .from("trailers")
        .select("*")
        .eq("id", payload.trailerId)
        .maybeSingle()
    : payload.trailerNumber
      ? client
          .from("trailers")
          .select("*")
          .ilike("trailer_number", payload.trailerNumber)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null });

  const vesselTrailerQuery = payload.trailerId || payload.trailerNumber
    ? client
        .from("vessel_operation_trailers")
        .select("*")
        .or(
          [
            payload.trailerId ? `trailer_id.eq.${payload.trailerId}` : null,
            payload.trailerNumber ? `trailer_number.ilike.${payload.trailerNumber}` : null,
          ]
            .filter(Boolean)
            .join(","),
        )
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const exportQuery = payload.trailerId || payload.trailerNumber
    ? client
        .from("export_allocations")
        .select("*")
        .or(
          [
            payload.trailerId ? `trailer_id.eq.${payload.trailerId}` : null,
            payload.trailerNumber ? `trailer_number.ilike.${payload.trailerNumber}` : null,
          ]
            .filter(Boolean)
            .join(","),
        )
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const temperatureQuery = payload.trailerId || payload.trailerNumber
    ? client
        .from("vessel_inspection_temperatures")
        .select("*")
        .or(
          [
            payload.trailerId ? `trailer_id.eq.${payload.trailerId}` : null,
            payload.trailerNumber ? `trailer_number.ilike.${payload.trailerNumber}` : null,
          ]
            .filter(Boolean)
            .join(","),
        )
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const [trailerResult, vesselTrailerResult, exportResult, temperatureResult] = await Promise.all([
    trailerQuery,
    vesselTrailerQuery,
    exportQuery,
    temperatureQuery,
  ]);

  const firstError = trailerResult.error ?? vesselTrailerResult.error ?? exportResult.error ?? temperatureResult.error;
  if (firstError) {
    throw new Error(firstError.message || "Unable to load automation event context.");
  }

  return {
    payload,
    trailer: (trailerResult.data ?? null) as TrailerRow | null,
    vesselTrailer: (vesselTrailerResult.data ?? null) as VesselTrailerRow | null,
    exportAllocation: (exportResult.data ?? null) as ExportAllocationRow | null,
    latestTemperature: (temperatureResult.data ?? null) as TemperatureRow | null,
  };
};

const executeRuleForPayload = async (client: AutomationClient, rule: ParsedRule, payload: AutomationEventPayload) => {
  const context = await loadEventContext(client, payload);
  const affectedEntityType = context.trailer ? "trailer" : context.vesselTrailer ? "vessel_trailer" : null;
  const affectedEntityId = context.trailer?.id ?? context.vesselTrailer?.id ?? null;

  const matches = evaluateConditions(rule.conditions, context);
  if (!matches) {
    await insertExecutionLog(
      client,
      rule.row,
      payload,
      "skipped",
      "Conditions did not match.",
      affectedEntityType,
      affectedEntityId,
    );
    return "skipped" as const;
  }

  try {
    for (const action of rule.actions) {
      await executeAction(client, rule, action, context);
    }

    await insertExecutionLog(
      client,
      rule.row,
      payload,
      "success",
      `Executed ${rule.actions.length} action(s).`,
      affectedEntityType,
      affectedEntityId,
    );
    return "success" as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automation rule action failed.";
    await insertExecutionLog(client, rule.row, payload, "failed", message, affectedEntityType, affectedEntityId);
    return "failed" as const;
  }
};

const loadEnabledRules = async (client: AutomationClient, triggerEvent: AutomationTriggerEvent) => {
  const { data, error } = await client
    .from("automation_rules")
    .select("*")
    .eq("enabled", true)
    .eq("trigger_event", triggerEvent)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message || "Unable to load automation rules.");
  }

  return ((data ?? []) as AutomationRuleRow[])
    .map((row) => parseRule(row))
    .filter((rule): rule is ParsedRule => Boolean(rule));
};

export async function listAutomationRules(client: AutomationClient) {
  const { data, error } = await client.from("automation_rules").select("*").order("created_at", { ascending: true });
  if (error) {
    throw new Error(error.message || "Unable to load automation rules.");
  }

  return (data ?? []) as AutomationRuleRow[];
}

export async function listAutomationExecutions(client: AutomationClient, limit = 120) {
  const { data, error } = await client
    .from("automation_rule_executions")
    .select("*")
    .order("executed_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 500)));

  if (error) {
    throw new Error(error.message || "Unable to load automation execution log.");
  }

  return (data ?? []) as AutomationRuleExecutionRow[];
}

export async function createAutomationRule(client: AutomationClient, input: AutomationRuleInput, actor: string) {
  const parsed = automationRuleInputSchema.parse(input);
  const insertPayload: Database["public"]["Tables"]["automation_rules"]["Insert"] = {
    name: parsed.name,
    description: parsed.description ?? null,
    trigger_event: parsed.triggerEvent,
    conditions: parsed.conditions,
    actions: parsed.actions,
    enabled: parsed.enabled,
    created_by: actor,
    updated_by: actor,
  };

  const { data, error } = await client.from("automation_rules").insert(insertPayload).select("*").single();
  if (error || !data) {
    throw new Error(error?.message || "Unable to create automation rule.");
  }

  return data as AutomationRuleRow;
}

export async function updateAutomationRule(client: AutomationClient, input: AutomationRulePatchInput, actor: string) {
  const parsed = automationRulePatchSchema.parse(input);

  const patch: Database["public"]["Tables"]["automation_rules"]["Update"] = {
    updated_by: actor,
  };

  if (typeof parsed.name === "string") patch.name = parsed.name;
  if (parsed.description !== undefined) patch.description = parsed.description;
  if (parsed.triggerEvent) patch.trigger_event = parsed.triggerEvent;
  if (parsed.conditions) patch.conditions = parsed.conditions;
  if (parsed.actions) patch.actions = parsed.actions;
  if (typeof parsed.enabled === "boolean") patch.enabled = parsed.enabled;

  const { data, error } = await client.from("automation_rules").update(patch).eq("id", parsed.ruleId).select("*").single();
  if (error || !data) {
    throw new Error(error?.message || "Unable to update automation rule.");
  }

  return data as AutomationRuleRow;
}

export async function runAutomationEvent(client: AutomationClient, payload: AutomationEventPayload): Promise<AutomationExecutionSummary> {
  const rules = await loadEnabledRules(client, payload.triggerEvent);

  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const rule of rules) {
    const result = await executeRuleForPayload(client, rule, payload);
    if (result === "success") successCount += 1;
    if (result === "skipped") skippedCount += 1;
    if (result === "failed") failedCount += 1;
  }

  return {
    triggerEvent: payload.triggerEvent,
    processedRules: rules.length,
    successCount,
    skippedCount,
    failedCount,
  };
}

export async function runAutomationForRecentActivityEvents(client: AutomationClient, limit = 120) {
  const { data, error } = await client
    .from("trailer_activity_log")
    .select("id, trailer_id, trailer_number, event_type, source_record_id, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 500)));

  if (error) {
    throw new Error(error.message || "Unable to load trailer activity for automation processing.");
  }

  const activityRows = (data ?? []) as Pick<TrailerActivityRow, "id" | "trailer_id" | "trailer_number" | "event_type" | "source_record_id" | "metadata" | "created_at">[];

  const summaries: AutomationExecutionSummary[] = [];

  for (const row of activityRows) {
    const triggerEvent = resolveTriggerFromActivity(row as TrailerActivityRow);
    if (!triggerEvent) {
      continue;
    }

    const summary = await runAutomationEvent(client, {
      triggerEvent,
      sourceActivityId: row.id,
      trailerId: row.trailer_id,
      trailerNumber: row.trailer_number,
      sourceRecordId: row.source_record_id,
      metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    });

    summaries.push(summary);
  }

  return summaries;
}

export async function runScheduledAutomationJobs(client: AutomationClient) {
  const jobs = [...schedulerJobKeys] as SchedulerJobKey[];
  const summaries: AutomationExecutionSummary[] = [];

  for (const job of jobs) {
    const summary = await runAutomationEvent(client, {
      triggerEvent: "scheduler_job",
      schedulerJob: job,
      metadata: {
        scheduler_job: job,
        executed_at: new Date().toISOString(),
      },
    });

    summaries.push(summary);
  }

  return summaries;
}
