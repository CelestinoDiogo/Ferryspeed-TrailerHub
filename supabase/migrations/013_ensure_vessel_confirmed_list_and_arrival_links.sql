-- Ferryspeed TrailerHub - Migration 013
-- Ensures confirmed-list and arrival-link schema required by vessel workflow.
-- Forward-only patch migration (does not modify previous migrations).

alter table if exists public.vessel_operations
  add column if not exists list_status text,
  add column if not exists list_confirmed_at timestamptz,
  add column if not exists list_confirmed_by text;

update public.vessel_operations
set list_status = 'draft'
where list_status is null;

alter table if exists public.vessel_operations
  alter column list_status set default 'draft';

alter table if exists public.vessel_operations
  alter column list_status set not null;

alter table if exists public.vessel_operation_trailers
  add column if not exists arrival_status text,
  add column if not exists arrival_confirmed_at timestamptz,
  add column if not exists arrival_record_id uuid references public.trailers(id) on delete set null;

update public.vessel_operation_trailers
set arrival_status = 'expected'
where arrival_status is null;

alter table if exists public.vessel_operation_trailers
  alter column arrival_status set default 'expected';

alter table if exists public.vessel_operation_trailers
  alter column arrival_status set not null;

alter table if exists public.trailers
  add column if not exists source_vessel_operation_trailer_id uuid
  references public.vessel_operation_trailers(id) on delete set null;

create unique index if not exists idx_trailers_source_vessel_operation_trailer_id_unique
  on public.trailers(source_vessel_operation_trailer_id)
  where source_vessel_operation_trailer_id is not null;

create index if not exists idx_vessel_operations_list_status
  on public.vessel_operations(list_status);

create index if not exists idx_vessel_operation_trailers_arrival_status
  on public.vessel_operation_trailers(arrival_status);

create index if not exists idx_vessel_operation_trailers_arrival_record_id
  on public.vessel_operation_trailers(arrival_record_id);
