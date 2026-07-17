-- Ferryspeed TrailerHub - Migration 015
-- Simplifies vessel workflow statuses to Draft/Confirmed/Completed and
-- Expected/Arrived/Inspected/Not Arrived without removing existing columns.

update public.vessel_operations
set status = case
  when status in ('draft', 'confirmed', 'completed') then status
  when status = 'planning' then 'draft'
  when status in ('arriving', 'discharging', 'inspection') then 'confirmed'
  when status = 'cancelled' then 'completed'
  else 'draft'
end;

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
      and t.relname = 'vessel_operations'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format('alter table public.vessel_operations drop constraint if exists %I', constraint_row.conname);
  end loop;
end $$;

alter table public.vessel_operations
  add constraint vessel_operations_status_simplified_check
  check (status in ('draft', 'confirmed', 'completed'));

update public.vessel_operation_trailers
set status = case
  when status in ('expected', 'arrived', 'inspected', 'not_arrived') then status
  when status in ('available_for_arrival') then 'expected'
  when status in ('inspection_pending', 'inspection_in_progress') then 'arrived'
  when status in ('positioned') then 'inspected'
  when status in ('cancelled', 'not_discharged') then 'not_arrived'
  else 'expected'
end,
arrival_status = case
  when arrival_status in ('expected', 'arrived', 'not_arrived') then arrival_status
  when arrival_status in ('available_for_arrival') then 'expected'
  when arrival_status in ('cancelled', 'not_discharged') then 'not_arrived'
  else 'expected'
end;

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
        pg_get_constraintdef(c.oid) ilike '%status%'
        or pg_get_constraintdef(c.oid) ilike '%arrival_status%'
      )
  loop
    execute format('alter table public.vessel_operation_trailers drop constraint if exists %I', constraint_row.conname);
  end loop;
end $$;

alter table public.vessel_operation_trailers
  add constraint vessel_operation_trailers_status_simplified_check
  check (status in ('expected', 'arrived', 'inspected', 'not_arrived'));

alter table public.vessel_operation_trailers
  add constraint vessel_operation_trailers_arrival_status_simplified_check
  check (arrival_status in ('expected', 'arrived', 'not_arrived'));
