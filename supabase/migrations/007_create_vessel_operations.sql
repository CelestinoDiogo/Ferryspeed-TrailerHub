-- Ferryspeed TrailerHub — Migration 007
-- Creates vessel operations, expected trailer manifests and inspection support tables.
-- Execute this migration in Supabase before testing Vessel Operations.

create extension if not exists "pgcrypto";

create table if not exists public.vessel_operations (
  id uuid primary key default gen_random_uuid(),
  vessel_name text not null,
  sailing_reference text,
  origin_port text,
  port text,
  berth text,
  expected_arrival_at timestamptz,
  actual_arrival_at timestamptz,
  status text not null default 'planning',
  notes text,
  inspection_notes text,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vessel_operations
  add column if not exists vessel_name text,
  add column if not exists sailing_reference text,
  add column if not exists origin_port text,
  add column if not exists port text,
  add column if not exists berth text,
  add column if not exists expected_arrival_at timestamptz,
  add column if not exists actual_arrival_at timestamptz,
  add column if not exists status text not null default 'planning',
  add column if not exists notes text,
  add column if not exists inspection_notes text,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vessel_operations_status_check'
  ) then
    alter table public.vessel_operations
      add constraint vessel_operations_status_check
      check (status in ('planning', 'arriving', 'discharging', 'inspection', 'completed', 'cancelled'));
  end if;
end $$;

create table if not exists public.vessel_operation_trailers (
  id uuid primary key default gen_random_uuid(),
  vessel_operation_id uuid not null references public.vessel_operations(id) on delete cascade,
  trailer_id uuid references public.trailers(id) on delete set null,
  trailer_number text not null,
  customer text,
  booking_reference text,
  load_status text,
  load_description text,
  temperature_required text,
  priority text not null default 'no_priority',
  priority_level text not null default 'normal',
  priority_reason text,
  planned_destination text,
  planning_notes text,
  status text not null default 'expected',
  arrival_status text not null default 'expected',
  arrived_at timestamptz,
  arrival_confirmed_by text,
  actual_arrival_at timestamptz,
  inspection_status text not null default 'pending',
  inspection_started_at timestamptz,
  inspection_completed_at timestamptz,
  damage_status text not null default 'not_checked',
  has_damage boolean not null default false,
  has_temperature_alert boolean not null default false,
  position_assigned_at timestamptz,
  assigned_position text,
  notes text,
  inspection_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vessel_operation_trailers
  add column if not exists trailer_id uuid references public.trailers(id) on delete set null,
  add column if not exists trailer_number text,
  add column if not exists customer text,
  add column if not exists booking_reference text,
  add column if not exists load_status text,
  add column if not exists load_description text,
  add column if not exists temperature_required text,
  add column if not exists priority text not null default 'no_priority',
  add column if not exists priority_level text not null default 'normal',
  add column if not exists priority_reason text,
  add column if not exists planned_destination text,
  add column if not exists planning_notes text,
  add column if not exists status text not null default 'expected',
  add column if not exists arrival_status text not null default 'expected',
  add column if not exists arrived_at timestamptz,
  add column if not exists arrival_confirmed_by text,
  add column if not exists actual_arrival_at timestamptz,
  add column if not exists inspection_status text not null default 'pending',
  add column if not exists inspection_started_at timestamptz,
  add column if not exists inspection_completed_at timestamptz,
  add column if not exists damage_status text not null default 'not_checked',
  add column if not exists has_damage boolean not null default false,
  add column if not exists has_temperature_alert boolean not null default false,
  add column if not exists position_assigned_at timestamptz,
  add column if not exists assigned_position text,
  add column if not exists notes text,
  add column if not exists inspection_notes text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vessel_operation_trailers_priority_level_check'
  ) then
    alter table public.vessel_operation_trailers
      add constraint vessel_operation_trailers_priority_level_check
      check (priority_level in ('priority', 'normal'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'vessel_operation_trailers_priority_check'
  ) then
    alter table public.vessel_operation_trailers
      add constraint vessel_operation_trailers_priority_check
      check (priority in ('priority', 'no_priority'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'vessel_operation_trailers_status_check'
  ) then
    alter table public.vessel_operation_trailers
      add constraint vessel_operation_trailers_status_check
      check (status in ('expected', 'arrived', 'inspection_pending', 'inspection_in_progress', 'inspected', 'positioned', 'cancelled'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'vessel_operation_trailers_arrival_status_check'
  ) then
    alter table public.vessel_operation_trailers
      add constraint vessel_operation_trailers_arrival_status_check
      check (arrival_status in ('expected', 'arrived'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'vessel_operation_trailers_inspection_status_check'
  ) then
    alter table public.vessel_operation_trailers
      add constraint vessel_operation_trailers_inspection_status_check
      check (inspection_status in ('pending', 'in_progress', 'completed'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'vessel_operation_trailers_damage_status_check'
  ) then
    alter table public.vessel_operation_trailers
      add constraint vessel_operation_trailers_damage_status_check
      check (damage_status in ('not_checked', 'clear', 'damaged'));
  end if;
end $$;

create table if not exists public.vessel_inspection_damages (
  id uuid primary key default gen_random_uuid(),
  vessel_operation_id uuid not null references public.vessel_operations(id) on delete cascade,
  vessel_operation_trailer_id uuid not null references public.vessel_operation_trailers(id) on delete cascade,
  damage_type text,
  damage_location text,
  severity text,
  description text,
  recorded_at timestamptz not null default now(),
  recorded_by text,
  created_at timestamptz not null default now()
);

alter table public.vessel_inspection_damages
  add column if not exists damage_type text,
  add column if not exists damage_location text,
  add column if not exists severity text,
  add column if not exists description text,
  add column if not exists recorded_at timestamptz not null default now(),
  add column if not exists recorded_by text,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.vessel_inspection_temperatures (
  id uuid primary key default gen_random_uuid(),
  vessel_operation_id uuid not null references public.vessel_operations(id) on delete cascade,
  vessel_operation_trailer_id uuid not null references public.vessel_operation_trailers(id) on delete cascade,
  temperature_value numeric,
  unit text,
  reading_point text,
  notes text,
  out_of_range boolean not null default false,
  recorded_at timestamptz not null default now(),
  recorded_by text,
  created_at timestamptz not null default now()
);

alter table public.vessel_inspection_temperatures
  add column if not exists temperature_value numeric,
  add column if not exists unit text,
  add column if not exists reading_point text,
  add column if not exists notes text,
  add column if not exists out_of_range boolean not null default false,
  add column if not exists recorded_at timestamptz not null default now(),
  add column if not exists recorded_by text,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.vessel_inspection_photos (
  id uuid primary key default gen_random_uuid(),
  vessel_operation_id uuid not null references public.vessel_operations(id) on delete cascade,
  vessel_operation_trailer_id uuid not null references public.vessel_operation_trailers(id) on delete cascade,
  category text,
  storage_path text,
  file_name text,
  description text,
  uploaded_at timestamptz not null default now(),
  uploaded_by text,
  created_at timestamptz not null default now()
);

alter table public.vessel_inspection_photos
  add column if not exists category text,
  add column if not exists storage_path text,
  add column if not exists file_name text,
  add column if not exists description text,
  add column if not exists uploaded_at timestamptz not null default now(),
  add column if not exists uploaded_by text,
  add column if not exists created_at timestamptz not null default now();

create index if not exists idx_vessel_operations_expected_arrival_at
  on public.vessel_operations (expected_arrival_at);

create index if not exists idx_vessel_operations_status
  on public.vessel_operations (status);

create index if not exists idx_vessel_operation_trailers_vessel_operation_id
  on public.vessel_operation_trailers (vessel_operation_id);

create index if not exists idx_vessel_operation_trailers_trailer_number
  on public.vessel_operation_trailers (trailer_number);

create index if not exists idx_vessel_operation_trailers_arrival_status
  on public.vessel_operation_trailers (arrival_status);

create index if not exists idx_vessel_operation_trailers_priority
  on public.vessel_operation_trailers (priority);

create index if not exists idx_vessel_operation_trailers_status
  on public.vessel_operation_trailers (status);

create index if not exists idx_vessel_inspection_damages_operation
  on public.vessel_inspection_damages (vessel_operation_id, vessel_operation_trailer_id);

create index if not exists idx_vessel_inspection_temperatures_operation
  on public.vessel_inspection_temperatures (vessel_operation_id, vessel_operation_trailer_id);

create index if not exists idx_vessel_inspection_photos_operation
  on public.vessel_inspection_photos (vessel_operation_id, vessel_operation_trailer_id);

alter table public.vessel_operations enable row level security;
alter table public.vessel_operation_trailers enable row level security;
alter table public.vessel_inspection_damages enable row level security;
alter table public.vessel_inspection_temperatures enable row level security;
alter table public.vessel_inspection_photos enable row level security;

drop policy if exists "Authenticated users can read vessel_operations" on public.vessel_operations;
drop policy if exists "Authenticated users can insert vessel_operations" on public.vessel_operations;
drop policy if exists "Authenticated users can update vessel_operations" on public.vessel_operations;
drop policy if exists "Authenticated users can delete vessel_operations" on public.vessel_operations;

create policy "Authenticated users can read vessel_operations"
  on public.vessel_operations
  for select
  to authenticated
  using (true);

create policy "Authenticated users can insert vessel_operations"
  on public.vessel_operations
  for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update vessel_operations"
  on public.vessel_operations
  for update
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can delete vessel_operations"
  on public.vessel_operations
  for delete
  to authenticated
  using (true);

drop policy if exists "Authenticated users can read vessel_operation_trailers" on public.vessel_operation_trailers;
drop policy if exists "Authenticated users can insert vessel_operation_trailers" on public.vessel_operation_trailers;
drop policy if exists "Authenticated users can update vessel_operation_trailers" on public.vessel_operation_trailers;
drop policy if exists "Authenticated users can delete vessel_operation_trailers" on public.vessel_operation_trailers;

create policy "Authenticated users can read vessel_operation_trailers"
  on public.vessel_operation_trailers
  for select
  to authenticated
  using (true);

create policy "Authenticated users can insert vessel_operation_trailers"
  on public.vessel_operation_trailers
  for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update vessel_operation_trailers"
  on public.vessel_operation_trailers
  for update
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can delete vessel_operation_trailers"
  on public.vessel_operation_trailers
  for delete
  to authenticated
  using (true);

drop policy if exists "Authenticated users can read vessel_inspection_damages" on public.vessel_inspection_damages;
drop policy if exists "Authenticated users can insert vessel_inspection_damages" on public.vessel_inspection_damages;
drop policy if exists "Authenticated users can update vessel_inspection_damages" on public.vessel_inspection_damages;
drop policy if exists "Authenticated users can delete vessel_inspection_damages" on public.vessel_inspection_damages;

create policy "Authenticated users can read vessel_inspection_damages"
  on public.vessel_inspection_damages
  for select
  to authenticated
  using (true);

create policy "Authenticated users can insert vessel_inspection_damages"
  on public.vessel_inspection_damages
  for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update vessel_inspection_damages"
  on public.vessel_inspection_damages
  for update
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can delete vessel_inspection_damages"
  on public.vessel_inspection_damages
  for delete
  to authenticated
  using (true);

drop policy if exists "Authenticated users can read vessel_inspection_temperatures" on public.vessel_inspection_temperatures;
drop policy if exists "Authenticated users can insert vessel_inspection_temperatures" on public.vessel_inspection_temperatures;
drop policy if exists "Authenticated users can update vessel_inspection_temperatures" on public.vessel_inspection_temperatures;
drop policy if exists "Authenticated users can delete vessel_inspection_temperatures" on public.vessel_inspection_temperatures;

create policy "Authenticated users can read vessel_inspection_temperatures"
  on public.vessel_inspection_temperatures
  for select
  to authenticated
  using (true);

create policy "Authenticated users can insert vessel_inspection_temperatures"
  on public.vessel_inspection_temperatures
  for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update vessel_inspection_temperatures"
  on public.vessel_inspection_temperatures
  for update
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can delete vessel_inspection_temperatures"
  on public.vessel_inspection_temperatures
  for delete
  to authenticated
  using (true);

drop policy if exists "Authenticated users can read vessel_inspection_photos" on public.vessel_inspection_photos;
drop policy if exists "Authenticated users can insert vessel_inspection_photos" on public.vessel_inspection_photos;
drop policy if exists "Authenticated users can update vessel_inspection_photos" on public.vessel_inspection_photos;
drop policy if exists "Authenticated users can delete vessel_inspection_photos" on public.vessel_inspection_photos;

create policy "Authenticated users can read vessel_inspection_photos"
  on public.vessel_inspection_photos
  for select
  to authenticated
  using (true);

create policy "Authenticated users can insert vessel_inspection_photos"
  on public.vessel_inspection_photos
  for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update vessel_inspection_photos"
  on public.vessel_inspection_photos
  for update
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can delete vessel_inspection_photos"
  on public.vessel_inspection_photos
  for delete
  to authenticated
  using (true);