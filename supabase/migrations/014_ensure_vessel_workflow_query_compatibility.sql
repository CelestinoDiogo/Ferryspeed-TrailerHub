-- Ferryspeed TrailerHub - Migration 014
-- Consolidated compatibility patch for vessel workflow query columns.
-- This migration is forward-only and does not modify previous migrations.

alter table if exists public.vessel_operations
  add column if not exists vessel_name text,
  add column if not exists sailing_reference text,
  add column if not exists origin_port text,
  add column if not exists berth text,
  add column if not exists expected_arrival_at timestamptz,
  add column if not exists actual_arrival_at timestamptz,
  add column if not exists status text,
  add column if not exists list_status text,
  add column if not exists list_confirmed_at timestamptz,
  add column if not exists list_confirmed_by text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.vessel_operations
set list_status = 'draft'
where list_status is null;

alter table if exists public.vessel_operations
  alter column status set default 'planning';

alter table if exists public.vessel_operations
  alter column list_status set default 'draft';

alter table if exists public.vessel_operation_trailers
  add column if not exists vessel_operation_id uuid,
  add column if not exists trailer_id uuid,
  add column if not exists trailer_number text,
  add column if not exists customer text,
  add column if not exists booking_reference text,
  add column if not exists load_status text,
  add column if not exists load_description text,
  add column if not exists temperature_required text,
  add column if not exists priority_level text,
  add column if not exists priority_reason text,
  add column if not exists planned_destination text,
  add column if not exists planning_notes text,
  add column if not exists status text,
  add column if not exists arrived_at timestamptz,
  add column if not exists arrival_status text,
  add column if not exists arrival_confirmed_at timestamptz,
  add column if not exists arrival_record_id uuid,
  add column if not exists arrival_confirmed_by text,
  add column if not exists inspection_started_at timestamptz,
  add column if not exists inspection_completed_at timestamptz,
  add column if not exists position_assigned_at timestamptz,
  add column if not exists assigned_position text,
  add column if not exists has_damage boolean,
  add column if not exists has_temperature_alert boolean,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.vessel_operation_trailers
set arrival_status = 'expected'
where arrival_status is null;

alter table if exists public.vessel_operation_trailers
  alter column status set default 'expected';

alter table if exists public.vessel_operation_trailers
  alter column arrival_status set default 'expected';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vessel_operation_trailers_arrival_record_id_fkey'
  ) then
    alter table public.vessel_operation_trailers
      add constraint vessel_operation_trailers_arrival_record_id_fkey
      foreign key (arrival_record_id) references public.trailers(id) on delete set null;
  end if;
end $$;

alter table if exists public.vessel_inspection_damages
  add column if not exists vessel_operation_id uuid,
  add column if not exists vessel_operation_trailer_id uuid,
  add column if not exists damage_type text,
  add column if not exists damage_location text,
  add column if not exists severity text,
  add column if not exists description text,
  add column if not exists recorded_at timestamptz,
  add column if not exists recorded_by text;

alter table if exists public.vessel_inspection_temperatures
  add column if not exists vessel_operation_id uuid,
  add column if not exists vessel_operation_trailer_id uuid,
  add column if not exists temperature_value numeric,
  add column if not exists unit text,
  add column if not exists reading_point text,
  add column if not exists notes text,
  add column if not exists out_of_range boolean,
  add column if not exists recorded_at timestamptz,
  add column if not exists recorded_by text;

update public.vessel_inspection_temperatures
set out_of_range = false
where out_of_range is null;

alter table if exists public.vessel_inspection_temperatures
  alter column out_of_range set default false;

alter table if exists public.vessel_inspection_photos
  add column if not exists vessel_operation_id uuid,
  add column if not exists vessel_operation_trailer_id uuid,
  add column if not exists category text,
  add column if not exists storage_path text,
  add column if not exists file_name text,
  add column if not exists description text,
  add column if not exists uploaded_at timestamptz,
  add column if not exists uploaded_by text;

create index if not exists idx_vessel_operations_list_status_compat
  on public.vessel_operations(list_status);

create index if not exists idx_vessel_operation_trailers_temperature_required_compat
  on public.vessel_operation_trailers(temperature_required);

create index if not exists idx_vessel_operation_trailers_arrival_status_compat
  on public.vessel_operation_trailers(arrival_status);

create index if not exists idx_vessel_inspection_damages_trailer_compat
  on public.vessel_inspection_damages(vessel_operation_trailer_id);

create index if not exists idx_vessel_inspection_temperatures_trailer_compat
  on public.vessel_inspection_temperatures(vessel_operation_trailer_id);

create index if not exists idx_vessel_inspection_photos_trailer_compat
  on public.vessel_inspection_photos(vessel_operation_trailer_id);
