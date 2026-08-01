begin;

create table if not exists public.operational_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null,
  alert_type text not null,
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
  updated_at timestamptz not null default now()
);

alter table if exists public.operational_alerts
  add column if not exists alert_key text,
  add column if not exists alert_type text,
  add column if not exists severity text,
  add column if not exists status text,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists trailer_id uuid,
  add column if not exists trailer_number text,
  add column if not exists source_module text,
  add column if not exists source_record_id uuid,
  add column if not exists metadata jsonb,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by text,
  add column if not exists resolution_note text,
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

alter table if exists public.operational_alerts
  alter column metadata set default '{}'::jsonb,
  alter column status set default 'active',
  alter column created_at set default now(),
  alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'operational_alerts_trailer_id_fkey'
      and conrelid = 'public.operational_alerts'::regclass
  ) then
    alter table public.operational_alerts
      add constraint operational_alerts_trailer_id_fkey
      foreign key (trailer_id) references public.trailers(id) on delete set null;
  end if;
end;
$$;

update public.operational_alerts
set
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now()),
  metadata = coalesce(metadata, '{}'::jsonb),
  source_module = coalesce(nullif(btrim(source_module), ''), 'unknown'),
  title = coalesce(nullif(btrim(title), ''), 'Untitled alert'),
  trailer_number = nullif(upper(btrim(trailer_number)), ''),
  description = nullif(btrim(description), ''),
  resolution_note = nullif(btrim(resolution_note), ''),
  acknowledged_by = nullif(btrim(acknowledged_by), ''),
  resolved_by = nullif(btrim(resolved_by), ''),
  dismissed_by = nullif(btrim(dismissed_by), '');

alter table if exists public.operational_alerts
  drop constraint if exists operational_alerts_status_valid,
  drop constraint if exists operational_alerts_status_check,
  drop constraint if exists operational_alerts_severity_valid,
  drop constraint if exists operational_alerts_severity_check;

drop index if exists public.operational_alerts_unique_active_source_idx;
drop index if exists public.operational_alerts_active_dedupe_idx;

update public.operational_alerts
set
  status = 'resolved',
  resolved_at = coalesce(resolved_at, updated_at, created_at, now()),
  updated_at = now()
where lower(btrim(coalesce(status, ''))) = 'closed';

update public.operational_alerts
set
  status = 'active',
  updated_at = now()
where lower(btrim(coalesce(status, ''))) in ('acknowledged', 'open', 'new', 'pending');

update public.operational_alerts
set
  status = 'active',
  updated_at = now()
where lower(btrim(coalesce(status, ''))) not in ('active', 'resolved', 'dismissed');

update public.operational_alerts
set
  severity = case lower(btrim(coalesce(severity, '')))
    when 'critical' then 'critical'
    when 'high' then 'high'
    when 'warning' then 'warning'
    when 'info' then 'info'
    else 'warning'
  end,
  updated_at = now();

update public.operational_alerts
set
  alert_type = coalesce(
    nullif(btrim(alert_type), ''),
    concat_ws('_',
      coalesce(nullif(regexp_replace(lower(btrim(source_module)), '[^a-z0-9]+', '_', 'g'), ''), 'unknown'),
      coalesce(nullif(regexp_replace(lower(btrim(title)), '[^a-z0-9]+', '_', 'g'), ''), 'untitled')
    )
  ),
  alert_key = coalesce(
    nullif(btrim(alert_key), ''),
    concat_ws(':',
      coalesce(nullif(btrim(source_module), ''), 'unknown'),
      coalesce(nullif(regexp_replace(lower(btrim(title)), '[^a-z0-9]+', '_', 'g'), ''), 'untitled'),
      coalesce(source_record_id::text, trailer_id::text, id::text)
    )
  ),
  updated_at = now();

update public.operational_alerts
set
  alert_type = lower(regexp_replace(btrim(alert_type), '[^a-z0-9_]+', '_', 'g')),
  alert_key = btrim(alert_key),
  source_module = btrim(source_module),
  title = btrim(title),
  updated_at = now();

alter table if exists public.operational_alerts
  alter column alert_key set not null,
  alter column alert_type set not null,
  alter column severity set not null,
  alter column status set not null,
  alter column title set not null,
  alter column source_module set not null,
  alter column metadata set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

alter table if exists public.operational_alerts
  drop constraint if exists operational_alerts_alert_key_not_blank,
  drop constraint if exists operational_alerts_title_not_blank,
  drop constraint if exists operational_alerts_source_module_not_blank,
  drop constraint if exists operational_alerts_alert_type_not_blank,
  drop constraint if exists operational_alerts_unique_active_source_idx;

with ranked_active as (
  select
    id,
    row_number() over (
      partition by
        alert_key,
        coalesce(source_record_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(trailer_id, '00000000-0000-0000-0000-000000000000'::uuid)
      order by
        (case when description is not null then 1 else 0 end)
          + (
            case
              when jsonb_typeof(metadata) = 'object'
              then (
                select count(*)
                from jsonb_object_keys(metadata)
              )
              else 0
            end
          ) desc,
        created_at asc,
        id asc
    ) as rn,
    first_value(id) over (
      partition by
        alert_key,
        coalesce(source_record_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(trailer_id, '00000000-0000-0000-0000-000000000000'::uuid)
      order by
        (case when description is not null then 1 else 0 end)
          + (
            case
              when jsonb_typeof(metadata) = 'object'
              then (
                select count(*)
                from jsonb_object_keys(metadata)
              )
              else 0
            end
          ) desc,
        created_at asc,
        id asc
    ) as keep_id
  from public.operational_alerts
  where status = 'active'
),
duplicate_groups as (
  select
    keep_id,
    jsonb_agg(id order by id) filter (where rn > 1) as duplicate_ids
  from ranked_active
  group by keep_id
  having count(*) > 1
)
update public.operational_alerts keep
set
  metadata = coalesce(keep.metadata, '{}'::jsonb) || jsonb_build_object('superseded_alert_ids', duplicate_groups.duplicate_ids),
  updated_at = now()
from duplicate_groups
where keep.id = duplicate_groups.keep_id
  and duplicate_groups.duplicate_ids is not null;

with ranked_active as (
  select
    id,
    row_number() over (
      partition by
        alert_key,
        coalesce(source_record_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(trailer_id, '00000000-0000-0000-0000-000000000000'::uuid)
      order by
        (case when description is not null then 1 else 0 end)
          + (
            case
              when jsonb_typeof(metadata) = 'object'
              then (
                select count(*)
                from jsonb_object_keys(metadata)
              )
              else 0
            end
          ) desc,
        created_at asc,
        id asc
    ) as rn,
    first_value(id) over (
      partition by
        alert_key,
        coalesce(source_record_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(trailer_id, '00000000-0000-0000-0000-000000000000'::uuid)
      order by
        (case when description is not null then 1 else 0 end)
          + (
            case
              when jsonb_typeof(metadata) = 'object'
              then (
                select count(*)
                from jsonb_object_keys(metadata)
              )
              else 0
            end
          ) desc,
        created_at asc,
        id asc
    ) as keep_id
  from public.operational_alerts
  where status = 'active'
)
update public.operational_alerts duplicate_row
set
  status = 'resolved',
  resolved_at = coalesce(duplicate_row.resolved_at, now()),
  resolved_by = coalesce(duplicate_row.resolved_by, 'system:migration_036'),
  resolution_note = concat_ws(' | ', nullif(duplicate_row.resolution_note, ''), format('Superseded duplicate active alert during migration 036. Kept alert %s.', ranked_active.keep_id::text)),
  updated_at = now()
from ranked_active
where duplicate_row.id = ranked_active.id
  and ranked_active.rn > 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'operational_alerts_status_check'
      and conrelid = 'public.operational_alerts'::regclass
  ) then
    alter table public.operational_alerts
      add constraint operational_alerts_status_check
      check (status in ('active', 'resolved', 'dismissed'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'operational_alerts_severity_check'
      and conrelid = 'public.operational_alerts'::regclass
  ) then
    alter table public.operational_alerts
      add constraint operational_alerts_severity_check
      check (severity in ('critical', 'high', 'warning', 'info'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'operational_alerts_alert_key_not_blank'
      and conrelid = 'public.operational_alerts'::regclass
  ) then
    alter table public.operational_alerts
      add constraint operational_alerts_alert_key_not_blank
      check (btrim(alert_key) <> '');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'operational_alerts_alert_type_not_blank'
      and conrelid = 'public.operational_alerts'::regclass
  ) then
    alter table public.operational_alerts
      add constraint operational_alerts_alert_type_not_blank
      check (btrim(alert_type) <> '');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'operational_alerts_title_not_blank'
      and conrelid = 'public.operational_alerts'::regclass
  ) then
    alter table public.operational_alerts
      add constraint operational_alerts_title_not_blank
      check (btrim(title) <> '');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'operational_alerts_source_module_not_blank'
      and conrelid = 'public.operational_alerts'::regclass
  ) then
    alter table public.operational_alerts
      add constraint operational_alerts_source_module_not_blank
      check (btrim(source_module) <> '');
  end if;
end;
$$;

drop index if exists public.operational_alerts_unique_active_source_idx;
drop index if exists public.operational_alerts_active_dedupe_idx;

create unique index if not exists operational_alerts_active_dedupe_idx
  on public.operational_alerts (
    alert_key,
    coalesce(source_record_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(trailer_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'active';

create index if not exists operational_alerts_active_lookup_idx
  on public.operational_alerts (status, severity, created_at desc);

create index if not exists operational_alerts_trailer_lookup_idx
  on public.operational_alerts (trailer_id, created_at desc);

create index if not exists operational_alerts_source_lookup_idx
  on public.operational_alerts (alert_key, source_module, source_record_id);

create or replace function public.normalize_operational_alert_row()
returns trigger
language plpgsql
as $$
begin
  new.alert_key := btrim(new.alert_key);
  new.alert_type := lower(regexp_replace(btrim(new.alert_type), '[^a-z0-9_]+', '_', 'g'));
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

drop view if exists public.operational_alert_summary;

create view public.operational_alert_summary
with (security_invoker = true)
as
select
  count(*) filter (where status = 'active')::bigint as total_active_alerts,
  count(*) filter (where status = 'active' and severity = 'critical')::bigint as critical_count,
  count(*) filter (where status = 'active' and severity = 'high')::bigint as high_count,
  count(*) filter (where status = 'active' and severity = 'warning')::bigint as warning_count,
  count(*) filter (where status = 'active' and severity = 'info')::bigint as info_count,
  max(created_at) filter (where status = 'active') as latest_alert_at
from public.operational_alerts;

alter table if exists public.operational_alerts enable row level security;

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

grant select, insert, update on public.operational_alerts to authenticated, service_role;
grant select on public.operational_alert_summary to authenticated, service_role;

drop function if exists public.acknowledge_operational_alert(uuid, text);
drop function if exists public.resolve_operational_alert(uuid, text, text);
drop function if exists public.dismiss_operational_alert(uuid, text, text);

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

grant execute on function public.acknowledge_operational_alert(uuid, text) to authenticated, service_role;
grant execute on function public.resolve_operational_alert(uuid, text, text) to authenticated, service_role;
grant execute on function public.dismiss_operational_alert(uuid, text, text) to authenticated, service_role;

commit;
