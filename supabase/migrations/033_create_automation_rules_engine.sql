-- Ferryspeed TrailerHub - Migration 033
-- Workflow Automation & Rules Engine

begin;

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text null,
  trigger_event text not null,
  conditions jsonb not null default '{}'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  last_executed_at timestamptz null,
  execution_count bigint not null default 0,
  created_by text null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_rules_name_not_blank check (btrim(name) <> ''),
  constraint automation_rules_trigger_event_check check (
    trigger_event in (
      'trailer_arrived',
      'inspection_completed',
      'temperature_recorded',
      'damage_recorded',
      'export_status_changed',
      'compound_position_changed',
      'stock_check_completed',
      'scheduler_job'
    )
  )
);

create table if not exists public.automation_rule_executions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  trigger_event text not null,
  outcome text not null,
  message text null,
  affected_entity_type text null,
  affected_entity_id text null,
  source_activity_id uuid null,
  execution_payload jsonb not null default '{}'::jsonb,
  executed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint automation_rule_executions_outcome_check check (outcome in ('success', 'skipped', 'failed'))
);

create unique index if not exists automation_rule_executions_rule_source_activity_idx
  on public.automation_rule_executions(rule_id, source_activity_id)
  where source_activity_id is not null;

create index if not exists automation_rules_trigger_enabled_idx
  on public.automation_rules(trigger_event, enabled);

create index if not exists automation_rule_executions_rule_time_idx
  on public.automation_rule_executions(rule_id, executed_at desc);

create index if not exists automation_rule_executions_trigger_time_idx
  on public.automation_rule_executions(trigger_event, executed_at desc);

create or replace function public.touch_automation_rule_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists automation_rules_touch_updated_at on public.automation_rules;
create trigger automation_rules_touch_updated_at
before update on public.automation_rules
for each row
execute function public.touch_automation_rule_updated_at();

alter table if exists public.automation_rules enable row level security;
alter table if exists public.automation_rule_executions enable row level security;

drop policy if exists "Authenticated users can read automation_rules" on public.automation_rules;
create policy "Authenticated users can read automation_rules"
  on public.automation_rules
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert automation_rules" on public.automation_rules;
create policy "Authenticated users can insert automation_rules"
  on public.automation_rules
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update automation_rules" on public.automation_rules;
create policy "Authenticated users can update automation_rules"
  on public.automation_rules
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can read automation_rule_executions" on public.automation_rule_executions;
create policy "Authenticated users can read automation_rule_executions"
  on public.automation_rule_executions
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert automation_rule_executions" on public.automation_rule_executions;
create policy "Authenticated users can insert automation_rule_executions"
  on public.automation_rule_executions
  for insert
  to authenticated
  with check (true);

grant select, insert, update on public.automation_rules to authenticated, service_role;
grant select, insert on public.automation_rule_executions to authenticated, service_role;

insert into public.automation_rules (name, description, trigger_event, conditions, actions, enabled, created_by, updated_by)
values
  (
    'Dwell Monitoring Escalation',
    'Create warning alerts when compound dwell exceeds threshold.',
    'scheduler_job',
    '{"schedulerJob":"dwell_monitoring","dwellTimeHours":72}'::jsonb,
    '[{"type":"create_alert","severity":"warning","title":"Automation dwell monitoring","description":"Trailer dwell exceeded automation threshold."}]'::jsonb,
    true,
    'system',
    'system'
  ),
  (
    'Pending Priority Inspection Escalation',
    'Create alerts for priority trailers still pending inspection.',
    'scheduler_job',
    '{"schedulerJob":"pending_inspections","priority":"priority","inspectionPending":60}'::jsonb,
    '[{"type":"create_alert","severity":"high","title":"Priority inspection pending","description":"Priority trailer inspection remains pending."},{"type":"send_notification"}]'::jsonb,
    true,
    'system',
    'system'
  ),
  (
    'Overdue Export Follow-up',
    'Flag overdue export allocations and add exceptions.',
    'scheduler_job',
    '{"schedulerJob":"overdue_exports","exportOverdue":true}'::jsonb,
    '[{"type":"add_exception","severity":"warning","title":"Overdue export","description":"Export allocation is overdue."},{"type":"send_notification"}]'::jsonb,
    true,
    'system',
    'system'
  ),
  (
    'Stock Discrepancy Escalation',
    'Escalate unresolved stock discrepancies after stock checks complete.',
    'scheduler_job',
    '{"schedulerJob":"stock_discrepancies"}'::jsonb,
    '[{"type":"create_alert","severity":"high","title":"Stock discrepancy follow-up","description":"Stock discrepancy requires review."},{"type":"refresh_kpi"}]'::jsonb,
    true,
    'system',
    'system'
  ),
  (
    'Daily Summary Task',
    'Create summary task events for daily operational reviews.',
    'scheduler_job',
    '{"schedulerJob":"daily_summaries"}'::jsonb,
    '[{"type":"generate_report_task","reportType":"daily_summary"},{"type":"send_notification"}]'::jsonb,
    true,
    'system',
    'system'
  )
on conflict do nothing;

commit;
