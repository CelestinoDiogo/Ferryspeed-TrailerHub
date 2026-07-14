-- Ferryspeed TrailerHub — Migration 008
-- Adds only the missing vessel workflow columns required by the current application code.
-- Execute this in Supabase before testing the full Vessel Operations workflow.

alter table if exists public.vessel_operations
  add column if not exists berth text;

alter table if exists public.vessel_operation_trailers
  add column if not exists load_status text,
  add column if not exists temperature_required text;

alter table if exists public.vessel_inspection_damages
  add column if not exists vessel_operation_id uuid references public.vessel_operations(id) on delete cascade,
  add column if not exists vessel_operation_trailer_id uuid references public.vessel_operation_trailers(id) on delete cascade;

alter table if exists public.vessel_inspection_temperatures
  add column if not exists vessel_operation_id uuid references public.vessel_operations(id) on delete cascade,
  add column if not exists vessel_operation_trailer_id uuid references public.vessel_operation_trailers(id) on delete cascade,
  add column if not exists unit text,
  add column if not exists out_of_range boolean not null default false;

alter table if exists public.vessel_inspection_photos
  add column if not exists vessel_operation_id uuid references public.vessel_operations(id) on delete cascade,
  add column if not exists vessel_operation_trailer_id uuid references public.vessel_operation_trailers(id) on delete cascade;

create index if not exists idx_vessel_inspection_damages_vessel_operation_id
  on public.vessel_inspection_damages (vessel_operation_id);

create index if not exists idx_vessel_inspection_damages_vessel_operation_trailer_id
  on public.vessel_inspection_damages (vessel_operation_trailer_id);

create index if not exists idx_vessel_inspection_temperatures_vessel_operation_id
  on public.vessel_inspection_temperatures (vessel_operation_id);

create index if not exists idx_vessel_inspection_temperatures_vessel_operation_trailer_id
  on public.vessel_inspection_temperatures (vessel_operation_trailer_id);

create index if not exists idx_vessel_inspection_photos_vessel_operation_id
  on public.vessel_inspection_photos (vessel_operation_id);

create index if not exists idx_vessel_inspection_photos_vessel_operation_trailer_id
  on public.vessel_inspection_photos (vessel_operation_trailer_id);