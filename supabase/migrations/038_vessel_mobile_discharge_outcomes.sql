-- Ferryspeed TrailerHub - Migration 038
-- Add mobile discharge terminal outcomes and metadata for vessel operation trailers.

begin;

alter table if exists public.vessel_operation_trailers
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists cancellation_reason text,
  add column if not exists no_show_at timestamptz,
  add column if not exists no_show_by text,
  add column if not exists no_show_reason text;

-- Remove only legacy/prior check constraints that are directly tied to
-- discharge outcome fields before any normalization updates.
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
        c.conname in (
          'vessel_operation_trailers_status_mobile_outcomes_check',
          'vessel_operation_trailers_arrival_status_mobile_outcomes_check'
        )
        or pg_get_constraintdef(c.oid) ~* '(^|[^a-z_])status([^a-z_]|$)'
        or pg_get_constraintdef(c.oid) ~* '(^|[^a-z_])arrival_status([^a-z_]|$)'
        or pg_get_constraintdef(c.oid) ~* '(^|[^a-z_])cancelled(_at|_by)?([^a-z_]|$)'
        or pg_get_constraintdef(c.oid) ~* '(^|[^a-z_])canceled([^a-z_]|$)'
        or pg_get_constraintdef(c.oid) ~* '(^|[^a-z_])cancellation_reason([^a-z_]|$)'
        or pg_get_constraintdef(c.oid) ~* '(^|[^a-z_])no_show(_at|_by|_reason)?([^a-z_]|$)'
        or exists (
          select 1
          from unnest(c.conkey) as key_col(attnum)
          join pg_attribute a
            on a.attrelid = t.oid
           and a.attnum = key_col.attnum
          where a.attname in (
            'status',
            'arrival_status',
            'cancelled_at',
            'cancelled_by',
            'cancellation_reason',
            'no_show_at',
            'no_show_by',
            'no_show_reason'
          )
        )
      )
  loop
    execute format('alter table public.vessel_operation_trailers drop constraint if exists %I', constraint_row.conname);
  end loop;
end $$;

-- Normalize status casing/spacing first.
update public.vessel_operation_trailers
set
  status = lower(replace(trim(status), ' ', '_'))
where status is not null;

update public.vessel_operation_trailers
set
  arrival_status = lower(replace(trim(arrival_status), ' ', '_'))
where arrival_status is not null;

-- Normalize known legacy variants to canonical values.
update public.vessel_operation_trailers
set status = 'cancelled'
where status = 'canceled';

update public.vessel_operation_trailers
set arrival_status = 'cancelled'
where arrival_status = 'canceled';

update public.vessel_operation_trailers
set status = 'available_for_arrival'
where status = 'availableforarrival';

update public.vessel_operation_trailers
set arrival_status = 'available_for_arrival'
where arrival_status = 'availableforarrival';

update public.vessel_operation_trailers
set status = 'not_discharged'
where status in ('notdischarged', 'not_discharge', 'notdischarge');

update public.vessel_operation_trailers
set arrival_status = 'not_discharged'
where arrival_status in ('notdischarged', 'not_discharge', 'notdischarge');

-- Preserve no_show as a canonical terminal outcome and backfill timestamp.
update public.vessel_operation_trailers
set
  status = 'no_show',
  arrival_status = 'no_show',
  no_show_at = coalesce(no_show_at, updated_at, created_at, now())
where status = 'no_show'
   or arrival_status = 'no_show';

-- Preserve cancelled as a canonical terminal outcome and backfill timestamp.
update public.vessel_operation_trailers
set
  status = 'cancelled',
  arrival_status = 'cancelled',
  cancelled_at = coalesce(cancelled_at, updated_at, created_at, now())
where status = 'cancelled'
   or arrival_status = 'cancelled'
   or status = 'canceled'
   or arrival_status = 'canceled';

-- Guard: fail clearly if unsupported legacy values remain after normalization.
do $$
declare
  unsupported_status text;
  unsupported_arrival_status text;
begin
  select string_agg(value, ', ' order by value)
  into unsupported_status
  from (
    select distinct coalesce(status, '<null>') as value
    from public.vessel_operation_trailers
    where status is null
       or status not in (
         'expected',
         'available_for_arrival',
         'arrived',
         'inspection_pending',
         'inspection_in_progress',
         'inspected',
         'positioned',
         'not_arrived',
         'not_discharged',
         'cancelled',
         'no_show'
       )
  ) s;

  select string_agg(value, ', ' order by value)
  into unsupported_arrival_status
  from (
    select distinct coalesce(arrival_status, '<null>') as value
    from public.vessel_operation_trailers
    where arrival_status is null
       or arrival_status not in (
         'expected',
         'available_for_arrival',
         'arrived',
         'not_arrived',
         'not_discharged',
         'cancelled',
         'no_show'
       )
  ) s;

  if unsupported_status is not null then
    raise exception 'Unsupported vessel_operation_trailers.status values remain after normalization: %', unsupported_status;
  end if;

  if unsupported_arrival_status is not null then
    raise exception 'Unsupported vessel_operation_trailers.arrival_status values remain after normalization: %', unsupported_arrival_status;
  end if;
end $$;

-- Ensure canonical check names can always be recreated safely.
alter table if exists public.vessel_operation_trailers
  drop constraint if exists vessel_operation_trailers_status_mobile_outcomes_check,
  drop constraint if exists vessel_operation_trailers_arrival_status_mobile_outcomes_check;

alter table if exists public.vessel_operation_trailers
  add constraint vessel_operation_trailers_status_mobile_outcomes_check
  check (
    status in (
      'expected',
      'available_for_arrival',
      'arrived',
      'inspection_pending',
      'inspection_in_progress',
      'inspected',
      'positioned',
      'not_arrived',
      'not_discharged',
      'cancelled',
      'no_show'
    )
  );

alter table if exists public.vessel_operation_trailers
  add constraint vessel_operation_trailers_arrival_status_mobile_outcomes_check
  check (
    arrival_status in (
      'expected',
      'available_for_arrival',
      'arrived',
      'not_arrived',
      'not_discharged',
      'cancelled',
      'no_show'
    )
  );

create index if not exists idx_vessel_operation_trailers_arrival_status_mobile
  on public.vessel_operation_trailers (vessel_operation_id, arrival_status);

commit;
