begin;

create table if not exists public.operational_alert_settings (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default true,
  compound_dwell_warning_days integer not null default 7,
  compound_dwell_critical_days integer not null default 14,
  compound_occupancy_warning_percent integer not null default 80,
  compound_occupancy_critical_percent integer not null default 90,
  priority_inspection_pending_minutes integer not null default 60,
  temperature_alerts_enabled boolean not null default true,
  inspection_missing_photos_enabled boolean not null default true,
  stock_check_discrepancies_enabled boolean not null default true,
  export_waiting_collection_hours integer not null default 24,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.operational_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null,
  severity text not null,
  status text not null default 'active',
  title text not null,
  description text null,
  trailer_id uuid null references public.trailers(id) on delete set null,
  trailer_number text null,
  source_module text not null,
  source_record_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  acknowledged_at timestamptz null,
  acknowledged_by text null,
  resolved_at timestamptz null,
  resolved_by text null,
  resolution_note text null,
  dismissed_at timestamptz null,
  dismissed_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operational_alerts_status_check check (status in ('active', 'acknowledged', 'resolved', 'dismissed')),
  constraint operational_alerts_severity_check check (severity in ('critical', 'high', 'warning', 'info')),
  constraint operational_alerts_alert_key_not_blank check (btrim(alert_key) <> ''),
  constraint operational_alerts_title_not_blank check (btrim(title) <> ''),
  constraint operational_alerts_source_module_not_blank check (btrim(source_module) <> '')
);

alter table if exists public.operational_alerts
  add column if not exists resolution_note text null;

create or replace function public.normalize_operational_alert_row()
returns trigger
language plpgsql
as $$
begin
  new.alert_key := btrim(new.alert_key);
  new.severity := lower(btrim(new.severity));
  new.status := lower(btrim(coalesce(new.status, 'active')));
  new.title := btrim(new.title);

  if new.description is not null then
    new.description := nullif(btrim(new.description), '');
  end if;

  if new.trailer_number is not null then
    new.trailer_number := nullif(upper(btrim(new.trailer_number)), '');
  end if;

  new.source_module := btrim(new.source_module);

  if new.resolution_note is not null then
    new.resolution_note := nullif(btrim(new.resolution_note), '');
  end if;

  if new.acknowledged_by is not null then
    new.acknowledged_by := nullif(btrim(new.acknowledged_by), '');
  end if;

  if new.resolved_by is not null then
    new.resolved_by := nullif(btrim(new.resolved_by), '');
  end if;

  if new.dismissed_by is not null then
    new.dismissed_by := nullif(btrim(new.dismissed_by), '');
  end if;

  if new.metadata is null then
    new.metadata := '{}'::jsonb;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists operational_alerts_normalize_before_write on public.operational_alerts;
create trigger operational_alerts_normalize_before_write
before insert or update on public.operational_alerts
for each row
execute function public.normalize_operational_alert_row();

create index if not exists operational_alerts_active_lookup_idx
  on public.operational_alerts (status, severity, created_at desc);

create index if not exists operational_alerts_trailer_lookup_idx
  on public.operational_alerts (trailer_id, created_at desc);

create index if not exists operational_alerts_source_lookup_idx
  on public.operational_alerts (alert_key, source_module, source_record_id);

do $$
declare
  duplicate_summary text;
begin
  with duplicate_rows as (
    select
      alert_key,
      coalesce(source_record_id::text, '00000000-0000-0000-0000-000000000000') as source_record_key,
      coalesce(trailer_id::text, '00000000-0000-0000-0000-000000000000') as trailer_key,
      count(*) as duplicate_count,
      json_agg(
        json_build_object(
          'id', id,
          'alert_key', alert_key,
          'severity', severity,
          'status', status,
          'source_module', source_module,
          'source_record_id', source_record_id,
          'trailer_id', trailer_id,
          'created_at', created_at
        )
        order by created_at desc, id
      ) as rows
    from public.operational_alerts
    where status in ('active', 'acknowledged')
    group by alert_key, coalesce(source_record_id::text, '00000000-0000-0000-0000-000000000000'), coalesce(trailer_id::text, '00000000-0000-0000-0000-000000000000')
    having count(*) > 1
  )
  select coalesce(json_agg(duplicate_rows), '[]'::json)::text
  into duplicate_summary
  from duplicate_rows;

  if duplicate_summary <> '[]' then
    raise exception using
      message = 'Operational alert stabilization aborted: duplicate active alerts exist.',
      detail = duplicate_summary,
      hint = 'Review the duplicate rows, resolve them manually, then rerun the migration.';
  end if;
end;
$$;

create unique index if not exists operational_alerts_active_dedupe_idx
  on public.operational_alerts (
    alert_key,
    coalesce(source_record_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(trailer_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status in ('active', 'acknowledged');

create or replace view public.operational_alert_summary
with (security_invoker = true)
as
select
  count(*) filter (where status in ('active', 'acknowledged'))::bigint as total_active_alerts,
  count(*) filter (where status in ('active', 'acknowledged') and severity = 'critical')::bigint as critical_count,
  count(*) filter (where status in ('active', 'acknowledged') and severity = 'high')::bigint as high_count,
  count(*) filter (where status in ('active', 'acknowledged') and severity = 'warning')::bigint as warning_count,
  count(*) filter (where status in ('active', 'acknowledged') and severity = 'info')::bigint as info_count,
  max(created_at) filter (where status in ('active', 'acknowledged')) as latest_alert_at
from public.operational_alerts;

alter table if exists public.operational_alert_settings enable row level security;
alter table if exists public.operational_alerts enable row level security;

drop policy if exists "Authenticated users can read operational_alert_settings" on public.operational_alert_settings;
create policy "Authenticated users can read operational_alert_settings"
  on public.operational_alert_settings
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can read operational_alerts" on public.operational_alerts;
create policy "Authenticated users can read operational_alerts"
  on public.operational_alerts
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert operational_alerts" on public.operational_alerts;
create policy "Authenticated users can insert operational_alerts"
  on public.operational_alerts
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update operational_alerts" on public.operational_alerts;
create policy "Authenticated users can update operational_alerts"
  on public.operational_alerts
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can delete operational_alerts" on public.operational_alerts;
create policy "Authenticated users can delete operational_alerts"
  on public.operational_alerts
  for delete
  to authenticated
  using (false);

grant select on public.operational_alert_settings to authenticated, service_role;
grant select, insert, update on public.operational_alerts to authenticated, service_role;
grant select on public.operational_alert_summary to authenticated, service_role;

create or replace function public.acknowledge_operational_alert(
  p_operational_alert_id uuid,
  p_acknowledged_by text default null
)
returns public.operational_alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert public.operational_alerts%rowtype;
  v_actor text := nullif(btrim(coalesce(p_acknowledged_by, '')), '');
begin
  update public.operational_alerts
  set
    status = 'acknowledged',
    acknowledged_at = coalesce(acknowledged_at, now()),
    acknowledged_by = coalesce(v_actor, acknowledged_by),
    updated_at = now()
  where id = p_operational_alert_id
    and status = 'active'
  returning * into v_alert;

  if found then
    return v_alert;
  end if;

  select * into v_alert
  from public.operational_alerts
  where id = p_operational_alert_id
  limit 1;

  if found then
    return v_alert;
  end if;

  raise exception 'Operational alert % was not found.', p_operational_alert_id;
end;
$$;

create or replace function public.resolve_operational_alert(
  p_operational_alert_id uuid,
  p_resolved_by text default null,
  p_resolution_note text default null
)
returns public.operational_alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert public.operational_alerts%rowtype;
  v_actor text := nullif(btrim(coalesce(p_resolved_by, '')), '');
  v_note text := nullif(btrim(coalesce(p_resolution_note, '')), '');
begin
  update public.operational_alerts
  set
    status = 'resolved',
    resolved_at = coalesce(resolved_at, now()),
    resolved_by = coalesce(v_actor, resolved_by),
    resolution_note = coalesce(v_note, resolution_note),
    updated_at = now()
  where id = p_operational_alert_id
    and status in ('active', 'acknowledged')
  returning * into v_alert;

  if found then
    return v_alert;
  end if;

  select * into v_alert
  from public.operational_alerts
  where id = p_operational_alert_id
  limit 1;

  if found then
    return v_alert;
  end if;

  raise exception 'Operational alert % was not found.', p_operational_alert_id;
end;
$$;

create or replace function public.dismiss_operational_alert(
  p_operational_alert_id uuid,
  p_dismissed_by text default null,
  p_dismissal_reason text default null
)
returns public.operational_alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert public.operational_alerts%rowtype;
  v_actor text := nullif(btrim(coalesce(p_dismissed_by, '')), '');
  v_reason text := nullif(btrim(coalesce(p_dismissal_reason, '')), '');
begin
  update public.operational_alerts
  set
    status = 'dismissed',
    dismissed_at = coalesce(dismissed_at, now()),
    dismissed_by = coalesce(v_actor, dismissed_by),
    resolution_note = coalesce(v_reason, resolution_note),
    updated_at = now()
  where id = p_operational_alert_id
    and status in ('active', 'acknowledged')
  returning * into v_alert;

  if found then
    return v_alert;
  end if;

  select * into v_alert
  from public.operational_alerts
  where id = p_operational_alert_id
  limit 1;

  if found then
    return v_alert;
  end if;

  raise exception 'Operational alert % was not found.', p_operational_alert_id;
end;
$$;

grant execute on function public.acknowledge_operational_alert(uuid, text) to authenticated, service_role;
grant execute on function public.resolve_operational_alert(uuid, text, text) to authenticated, service_role;
grant execute on function public.dismiss_operational_alert(uuid, text, text) to authenticated, service_role;

commit;