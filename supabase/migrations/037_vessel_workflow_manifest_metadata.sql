-- Ferryspeed TrailerHub - Migration 037
-- Hardened workflow metadata migration for vessel operations.

begin;

alter table if exists public.vessel_operations
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by text,
  add column if not exists final_locked_at timestamptz;

alter table if exists public.vessel_operation_trailers
  add column if not exists ownership_type text,
  add column if not exists trailer_source text,
  add column if not exists external_company text,
  add column if not exists added_after_confirmation boolean,
  add column if not exists added_after_confirmation_at timestamptz,
  add column if not exists added_after_confirmation_by text,
  add column if not exists manifest_change_reason text;

alter table if exists public.vessel_operation_trailers
  alter column ownership_type set default 'unknown',
  alter column added_after_confirmation set default false;

-- Drop prior ownership/source constraints before normalization updates.
alter table if exists public.vessel_operation_trailers
  drop constraint if exists vessel_operation_trailers_ownership_type_check,
  drop constraint if exists vessel_operation_trailers_source_check;

-- Drop legacy check constraints that reference ownership_type or trailer_source.
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'vessel_operation_trailers'
      and c.contype = 'c'
      and (
        pg_get_constraintdef(c.oid) ilike '%ownership_type%'
        or pg_get_constraintdef(c.oid) ilike '%trailer_source%'
      )
  loop
    execute format('alter table public.vessel_operation_trailers drop constraint if exists %I', constraint_row.conname);
  end loop;
end $$;

-- Normalize ownership/source values before constraints are (re)applied.
update public.vessel_operation_trailers vot
set
  trailer_source = case
    when lower(trim(coalesce(
      nullif(trim(vot.trailer_source), ''),
      nullif(trim(t.trailer_source), ''),
      case when coalesce(t.is_local, false) then 'local' else null end,
      ''
    ))) in ('company', 'fleet', 'internal', 'owned') then 'company'
    when lower(trim(coalesce(
      nullif(trim(vot.trailer_source), ''),
      nullif(trim(t.trailer_source), ''),
      case when coalesce(t.is_local, false) then 'local' else null end,
      ''
    ))) in ('outsourced', 'outsourcing', 'external', 'supplier') then 'outsourced'
    when lower(trim(coalesce(
      nullif(trim(vot.trailer_source), ''),
      nullif(trim(t.trailer_source), ''),
      case when coalesce(t.is_local, false) then 'local' else null end,
      ''
    ))) = 'local' then 'local'
    when lower(trim(coalesce(
      nullif(trim(vot.trailer_source), ''),
      nullif(trim(t.trailer_source), ''),
      case when coalesce(t.is_local, false) then 'local' else null end,
      ''
    ))) = '' then 'unknown'
    else 'unknown'
  end,
  external_company = coalesce(
    nullif(trim(vot.external_company), ''),
    nullif(trim(t.external_company), '')
  ),
  ownership_type = case
    when lower(trim(coalesce(vot.ownership_type, ''))) in ('company', 'outsourcing') then lower(trim(coalesce(vot.ownership_type, '')))
    when coalesce(
      nullif(trim(vot.external_company), ''),
      nullif(trim(t.external_company), '')
    ) is not null then 'outsourcing'
    when lower(trim(coalesce(
      nullif(trim(vot.trailer_source), ''),
      nullif(trim(t.trailer_source), ''),
      case when coalesce(t.is_local, false) then 'local' else null end,
      ''
    ))) in ('outsourced', 'outsourcing', 'external', 'supplier') then 'outsourcing'
    when lower(trim(coalesce(
      nullif(trim(vot.trailer_source), ''),
      nullif(trim(t.trailer_source), ''),
      case when coalesce(t.is_local, false) then 'local' else null end,
      ''
    ))) in ('company', 'fleet', 'internal', 'owned') then 'company'
    when coalesce(t.is_local, false) is true then 'unknown'
    when lower(trim(coalesce(
      nullif(trim(vot.trailer_source), ''),
      nullif(trim(t.trailer_source), ''),
      case when coalesce(t.is_local, false) then 'local' else null end,
      ''
    ))) = 'local' then 'unknown'
    else 'unknown'
  end,
  added_after_confirmation = coalesce(vot.added_after_confirmation, false)
from public.trailers t
where t.id = vot.trailer_id;

-- Also normalize rows with no valid linked trailer row (NULL or orphan trailer_id).
update public.vessel_operation_trailers vot
set
  trailer_source = case
    when lower(trim(coalesce(vot.trailer_source, ''))) in ('company', 'fleet', 'internal', 'owned') then 'company'
    when lower(trim(coalesce(vot.trailer_source, ''))) in ('outsourced', 'outsourcing', 'external', 'supplier') then 'outsourced'
    when lower(trim(coalesce(vot.trailer_source, ''))) = 'local' then 'local'
    when lower(trim(coalesce(vot.trailer_source, ''))) = '' then 'unknown'
    else 'unknown'
  end,
  ownership_type = case
    when lower(trim(coalesce(vot.ownership_type, ''))) in ('company', 'outsourcing') then lower(trim(coalesce(vot.ownership_type, '')))
    when nullif(trim(coalesce(vot.external_company, '')), '') is not null then 'outsourcing'
    when lower(trim(coalesce(vot.trailer_source, ''))) in ('outsourced', 'outsourcing', 'external', 'supplier') then 'outsourcing'
    when lower(trim(coalesce(vot.trailer_source, ''))) in ('company', 'fleet', 'internal', 'owned') then 'company'
    when lower(trim(coalesce(vot.trailer_source, ''))) = 'local' then 'unknown'
    else 'unknown'
  end,
  added_after_confirmation = coalesce(vot.added_after_confirmation, false)
where not exists (
  select 1
  from public.trailers t
  where t.id = vot.trailer_id
);

-- Canonical sweep to ensure no non-canonical values remain before constraints.
update public.vessel_operation_trailers
set trailer_source = case
  when lower(trim(coalesce(trailer_source, ''))) in ('company', 'fleet', 'internal', 'owned') then 'company'
  when lower(trim(coalesce(trailer_source, ''))) in ('outsourced', 'outsourcing', 'external', 'supplier') then 'outsourced'
  when lower(trim(coalesce(trailer_source, ''))) = 'local' then 'local'
  else 'unknown'
end;

update public.vessel_operation_trailers
set ownership_type = case
  when lower(trim(coalesce(ownership_type, ''))) in ('company', 'outsourcing') then lower(trim(coalesce(ownership_type, '')))
  when nullif(trim(coalesce(external_company, '')), '') is not null then 'outsourcing'
  when trailer_source = 'outsourced' then 'outsourcing'
  when trailer_source = 'company' then 'company'
  when trailer_source = 'local' then 'unknown'
  else 'unknown'
end;

update public.vessel_operation_trailers
set ownership_type = 'unknown'
where ownership_type is null;

update public.vessel_operation_trailers
set added_after_confirmation = false
where added_after_confirmation is null;

-- Legacy status backfill: strictly greater-than confirmation timestamp only.
update public.vessel_operation_trailers vot
set
  added_after_confirmation = true,
  added_after_confirmation_at = coalesce(vot.added_after_confirmation_at, vot.created_at),
  manifest_change_reason = coalesce(vot.manifest_change_reason, 'Added after confirmation')
from public.vessel_operations vo
where vo.id = vot.vessel_operation_id
  and vo.list_confirmed_at is not null
  and vot.created_at is not null
  and vot.created_at > vo.list_confirmed_at;

update public.vessel_operations
set
  completed_at = coalesce(completed_at, updated_at, created_at, now()),
  final_locked_at = coalesce(
    final_locked_at,
    completed_at,
    updated_at,
    created_at,
    now()
  )
where status = 'completed';

-- Ensure columns comply with intended nullability after backfill.
alter table if exists public.vessel_operation_trailers
  alter column ownership_type set not null,
  alter column added_after_confirmation set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'vessel_operation_trailers'
      and c.conname = 'vessel_operation_trailers_ownership_type_check'
  ) then
    alter table public.vessel_operation_trailers
      add constraint vessel_operation_trailers_ownership_type_check
      check (ownership_type in ('company', 'outsourcing', 'unknown'));
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'vessel_operation_trailers'
      and c.conname = 'vessel_operation_trailers_source_check'
  ) then
    alter table public.vessel_operation_trailers
      add constraint vessel_operation_trailers_source_check
      check (trailer_source is null or trailer_source in ('company', 'outsourced', 'unknown', 'local'));
  end if;
end $$;

create index if not exists idx_vessel_operation_trailers_added_after_confirmation
  on public.vessel_operation_trailers (vessel_operation_id, added_after_confirmation);

create index if not exists idx_vessel_operation_trailers_ownership_type
  on public.vessel_operation_trailers (ownership_type);

commit;