"use client";

import { useEffect, useMemo, useState } from "react";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { SettingsNav } from "@/components/settings/settings-nav";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { fetchRbacJson } from "@/lib/rbac/client-fetch";
import {
  automationActionSchema,
  automationConditionsSchema,
  automationTriggerEvents,
  type AutomationRuleExecutionRow,
  type AutomationRuleRow,
} from "@/lib/automation/types";

type AutomationRulesResponse = {
  rules: AutomationRuleRow[];
  executions: AutomationRuleExecutionRow[];
};

type RunAutomationResponse = {
  mode: "events" | "scheduler";
  summaries: Array<{
    triggerEvent: string;
    processedRules: number;
    successCount: number;
    skippedCount: number;
    failedCount: number;
  }>;
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const toPrettyJson = (value: unknown) => JSON.stringify(value, null, 2);

const toStatusBadge = (enabled: boolean) =>
  enabled
    ? "rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"
    : "rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700";

export default function SettingsAutomationPage() {
  const { roleKey } = useCurrentUser();
  const [rules, setRules] = useState<AutomationRuleRow[]>([]);
  const [executions, setExecutions] = useState<AutomationRuleExecutionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunningEvents, setIsRunningEvents] = useState(false);
  const [isRunningScheduler, setIsRunningScheduler] = useState(false);
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [jsonEditors, setJsonEditors] = useState<Record<string, { conditions: string; actions: string }>>({});

  const loadData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const payload = await fetchRbacJson<AutomationRulesResponse>("/api/settings/automation-rules");
      setRules(payload.rules ?? []);
      setExecutions(payload.executions ?? []);
      setJsonEditors(
        Object.fromEntries(
          (payload.rules ?? []).map((rule) => [
            rule.id,
            {
              conditions: toPrettyJson(rule.conditions),
              actions: toPrettyJson(rule.actions),
            },
          ]),
        ),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load automation centre.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, []);

  const groupedExecutions = useMemo(() => {
    const map = new Map<string, AutomationRuleExecutionRow[]>();
    executions.forEach((row) => {
      const current = map.get(row.rule_id) ?? [];
      current.push(row);
      map.set(row.rule_id, current);
    });

    return map;
  }, [executions]);

  const updateRuleField = (ruleId: string, field: "name" | "description" | "trigger_event", value: string) => {
    setRules((current) =>
      current.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              [field]: field === "description" ? value : value,
            }
          : rule,
      ),
    );
  };

  const updateJsonField = (ruleId: string, field: "conditions" | "actions", value: string) => {
    setJsonEditors((current) => ({
      ...current,
      [ruleId]: {
        conditions: current[ruleId]?.conditions ?? "{}",
        actions: current[ruleId]?.actions ?? "[]",
        [field]: value,
      },
    }));
  };

  const saveRule = async (rule: AutomationRuleRow) => {
    setSavingRuleId(rule.id);
    setError(null);
    setMessage(null);

    try {
      const editor = jsonEditors[rule.id];
      const parsedConditions = automationConditionsSchema.parse(JSON.parse(editor?.conditions ?? "{}"));
      const parsedActions = automationActionSchema.array().min(1).parse(JSON.parse(editor?.actions ?? "[]"));

      const payload = await fetchRbacJson<{ rule: AutomationRuleRow }>("/api/settings/automation-rules", {
        method: "PATCH",
        body: JSON.stringify({
          ruleId: rule.id,
          name: rule.name,
          description: rule.description,
          triggerEvent: rule.trigger_event,
          conditions: parsedConditions,
          actions: parsedActions,
          enabled: rule.enabled,
        }),
      });

      setRules((current) => current.map((item) => (item.id === rule.id ? payload.rule : item)));
      setJsonEditors((current) => ({
        ...current,
        [rule.id]: {
          conditions: toPrettyJson(payload.rule.conditions),
          actions: toPrettyJson(payload.rule.actions),
        },
      }));
      setMessage(`Rule saved: ${payload.rule.name}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save rule.");
    } finally {
      setSavingRuleId(null);
    }
  };

  const toggleRule = async (rule: AutomationRuleRow, enabled: boolean) => {
    setSavingRuleId(rule.id);
    setError(null);
    setMessage(null);

    try {
      const payload = await fetchRbacJson<{ rule: AutomationRuleRow }>("/api/settings/automation-rules", {
        method: "PATCH",
        body: JSON.stringify({
          ruleId: rule.id,
          enabled,
        }),
      });

      setRules((current) => current.map((item) => (item.id === rule.id ? payload.rule : item)));
      setMessage(`Rule ${enabled ? "enabled" : "disabled"}: ${payload.rule.name}`);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Unable to update rule state.");
    } finally {
      setSavingRuleId(null);
    }
  };

  const runAutomation = async (mode: "events" | "scheduler") => {
    setError(null);
    setMessage(null);
    if (mode === "events") {
      setIsRunningEvents(true);
    } else {
      setIsRunningScheduler(true);
    }

    try {
      const payload = await fetchRbacJson<RunAutomationResponse>("/api/settings/automation-rules/run", {
        method: "POST",
        body: JSON.stringify({ mode }),
      });

      const processed = payload.summaries.reduce((total, item) => total + item.processedRules, 0);
      const successes = payload.summaries.reduce((total, item) => total + item.successCount, 0);
      const failures = payload.summaries.reduce((total, item) => total + item.failedCount, 0);
      setMessage(`Automation run complete (${mode}): processed ${processed}, success ${successes}, failed ${failures}.`);
      await loadData();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Unable to run automation.");
    } finally {
      setIsRunningEvents(false);
      setIsRunningScheduler(false);
    }
  };

  return (
    <PermissionGuard roleKey={roleKey} moduleKey="settings" action="view">
      <div className="space-y-6">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-700">Settings</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900">Automation Centre</h1>
          <p className="mt-2 text-sm text-slate-600">
            Configure workflow rules, execute scheduler jobs, and inspect rule execution outcomes.
          </p>
          <div className="mt-5">
            <SettingsNav />
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isRunningEvents}
              onClick={() => {
                void runAutomation("events");
              }}
              className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-100 disabled:opacity-60"
            >
              {isRunningEvents ? "Running event queue..." : "Run Event Queue"}
            </button>
            <button
              type="button"
              disabled={isRunningScheduler}
              onClick={() => {
                void runAutomation("scheduler");
              }}
              className="rounded-xl border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-200 disabled:opacity-60"
            >
              {isRunningScheduler ? "Running scheduler jobs..." : "Run Scheduler Jobs"}
            </button>
          </div>
        </section>

        <section className="space-y-4">
          {isLoading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Loading rules...</div>
          ) : (
            rules.map((rule) => {
              const latestExecution = groupedExecutions.get(rule.id)?.[0] ?? null;
              const editor = jsonEditors[rule.id] ?? {
                conditions: toPrettyJson(rule.conditions),
                actions: toPrettyJson(rule.actions),
              };

              return (
                <article key={rule.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Rule</p>
                      <input
                        value={rule.name}
                        onChange={(event) => updateRuleField(rule.id, "name", event.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                      />
                      <textarea
                        value={rule.description ?? ""}
                        onChange={(event) => updateRuleField(rule.id, "description", event.target.value)}
                        rows={2}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={toStatusBadge(rule.enabled)}>{rule.enabled ? "Enabled" : "Disabled"}</span>
                      <button
                        type="button"
                        disabled={savingRuleId === rule.id || rule.enabled}
                        onClick={() => {
                          void toggleRule(rule, true);
                        }}
                        className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-50"
                      >
                        Enable
                      </button>
                      <button
                        type="button"
                        disabled={savingRuleId === rule.id || !rule.enabled}
                        onClick={() => {
                          void toggleRule(rule, false);
                        }}
                        className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50"
                      >
                        Disable
                      </button>
                      <button
                        type="button"
                        disabled={savingRuleId === rule.id}
                        onClick={() => {
                          void saveRule(rule);
                        }}
                        className="rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-700 disabled:opacity-50"
                      >
                        {savingRuleId === rule.id ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-3">
                    <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Trigger
                      <select
                        value={rule.trigger_event}
                        onChange={(event) => updateRuleField(rule.id, "trigger_event", event.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                      >
                        {automationTriggerEvents.map((trigger) => (
                          <option key={trigger} value={trigger}>
                            {trigger.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="text-xs text-slate-600">
                      <p className="font-semibold uppercase tracking-[0.14em] text-slate-500">Last Execution</p>
                      <p className="mt-1">{formatDateTime(rule.last_executed_at)}</p>
                    </div>
                    <div className="text-xs text-slate-600">
                      <p className="font-semibold uppercase tracking-[0.14em] text-slate-500">Execution Count</p>
                      <p className="mt-1">{rule.execution_count}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Conditions JSON
                      <textarea
                        value={editor.conditions}
                        onChange={(event) => updateJsonField(rule.id, "conditions", event.target.value)}
                        rows={10}
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Actions JSON
                      <textarea
                        value={editor.actions}
                        onChange={(event) => updateJsonField(rule.id, "actions", event.target.value)}
                        rows={10}
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800"
                      />
                    </label>
                  </div>

                  {latestExecution ? (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <p className="font-semibold">Latest outcome: {latestExecution.outcome}</p>
                      <p className="mt-1">{latestExecution.message ?? "-"}</p>
                      <p className="mt-1">{formatDateTime(latestExecution.executed_at)}</p>
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Execution Log</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm text-slate-700">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.16em] text-slate-500">
                  <th className="px-2 py-2 font-semibold">Rule</th>
                  <th className="px-2 py-2 font-semibold">Trigger</th>
                  <th className="px-2 py-2 font-semibold">Outcome</th>
                  <th className="px-2 py-2 font-semibold">Affected Entity</th>
                  <th className="px-2 py-2 font-semibold">Execution Time</th>
                </tr>
              </thead>
              <tbody>
                {executions.length === 0 ? (
                  <tr>
                    <td className="px-2 py-3 text-sm text-slate-500" colSpan={5}>
                      No executions recorded yet.
                    </td>
                  </tr>
                ) : (
                  executions.map((row) => {
                    const rule = rules.find((item) => item.id === row.rule_id);
                    return (
                      <tr key={row.id} className="border-b border-slate-100 align-top">
                        <td className="px-2 py-3 text-xs text-slate-800">{rule?.name ?? row.rule_id}</td>
                        <td className="px-2 py-3 text-xs text-slate-700">{row.trigger_event.replace(/_/g, " ")}</td>
                        <td className="px-2 py-3 text-xs font-semibold text-slate-800">{row.outcome}</td>
                        <td className="px-2 py-3 text-xs text-slate-700">
                          {row.affected_entity_type ?? "-"}
                          {row.affected_entity_id ? ` (${row.affected_entity_id})` : ""}
                        </td>
                        <td className="px-2 py-3 text-xs text-slate-600">{formatDateTime(row.executed_at)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </PermissionGuard>
  );
}
