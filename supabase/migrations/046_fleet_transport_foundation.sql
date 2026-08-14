-- Ferryspeed TrailerHub - Migration 046
-- Fleet / Transport foundation. Reuses public.drivers; no Driver Mobile integration.

begin;

create table if not exists public.fleet_transport_units (
  id uuid primary key default gen_random_uuid(),
  registration text not null,
  internal_number text not null,
  unit_type text not null default 'other',
  active boolean not null default true,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fleet_units_registration_not_blank check (btrim(registration) <> ''),
  constraint fleet_units_internal_number_not_blank check (btrim(internal_number) <> ''),
  constraint fleet_units_type_check check (unit_type in ('tractor_only', 'curtain_sider', 'reefer', 'flatbed', 'rigid', 'other')),
  constraint fleet_units_registration_unique unique (registration),
  constraint fleet_units_internal_number_unique unique (internal_number)
);

create table if not exists public.transport_jobs (
  id uuid primary key default gen_random_uuid(),
  job_reference text not null,
  status text not null default 'planned',
  driver_id uuid null references public.drivers(id) on delete set null,
  unit_id uuid null references public.fleet_transport_units(id) on delete set null,
  trailer_id uuid null references public.trailers(id) on delete set null,
  trailer_number_snapshot text null,
  customer text null,
  booking_reference text null,
  collection_address text null,
  delivery_address text null,
  collection_at timestamptz null,
  delivery_at timestamptz null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  cancelled_at timestamptz null,
  constraint transport_jobs_reference_not_blank check (btrim(job_reference) <> ''),
  constraint transport_jobs_status_check check (status in ('planned', 'assigned', 'in_progress', 'completed', 'cancelled')),
  constraint transport_jobs_completion_pair_check check ((status = 'completed' and completed_at is not null) or (status <> 'completed')),
  constraint transport_jobs_cancel_pair_check check ((status = 'cancelled' and cancelled_at is not null) or (status <> 'cancelled'))
);

create index if not exists transport_jobs_status_idx on public.transport_jobs(status, created_at desc);
create index if not exists transport_jobs_driver_idx on public.transport_jobs(driver_id, created_at desc);
create index if not exists transport_jobs_unit_idx on public.transport_jobs(unit_id, created_at desc);
create index if not exists transport_jobs_trailer_idx on public.transport_jobs(trailer_id, created_at desc);

create or replace function public.touch_fleet_transport_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists fleet_units_touch_updated_at on public.fleet_transport_units;
create trigger fleet_units_touch_updated_at before update on public.fleet_transport_units for each row execute function public.touch_fleet_transport_updated_at();
drop trigger if exists transport_jobs_touch_updated_at on public.transport_jobs;
create trigger transport_jobs_touch_updated_at before update on public.transport_jobs for each row execute function public.touch_fleet_transport_updated_at();

alter table public.fleet_transport_units enable row level security;
alter table public.transport_jobs enable row level security;

drop policy if exists "Fleet users can read units" on public.fleet_transport_units;
create policy "Fleet users can read units" on public.fleet_transport_units for select to authenticated using (exists (select 1 from public.app_user_roles r where r.user_id = auth.uid() and r.is_active and r.role_key in ('administrator','supervisor','operator')));
drop policy if exists "Fleet managers can create units" on public.fleet_transport_units;
create policy "Fleet managers can create units" on public.fleet_transport_units for insert to authenticated with check (exists (select 1 from public.app_user_roles r where r.user_id = auth.uid() and r.is_active and r.role_key in ('administrator','supervisor')));
drop policy if exists "Fleet managers can update units" on public.fleet_transport_units;
create policy "Fleet managers can update units" on public.fleet_transport_units for update to authenticated using (exists (select 1 from public.app_user_roles r where r.user_id = auth.uid() and r.is_active and r.role_key in ('administrator','supervisor'))) with check (exists (select 1 from public.app_user_roles r where r.user_id = auth.uid() and r.is_active and r.role_key in ('administrator','supervisor')));

drop policy if exists "Fleet users can read transport jobs" on public.transport_jobs;
create policy "Fleet users can read transport jobs" on public.transport_jobs for select to authenticated using (exists (select 1 from public.app_user_roles r where r.user_id = auth.uid() and r.is_active and r.role_key in ('administrator','supervisor','operator')));
drop policy if exists "Fleet managers can create transport jobs" on public.transport_jobs;
create policy "Fleet managers can create transport jobs" on public.transport_jobs for insert to authenticated with check (exists (select 1 from public.app_user_roles r where r.user_id = auth.uid() and r.is_active and r.role_key in ('administrator','supervisor')));
drop policy if exists "Fleet managers can update transport jobs" on public.transport_jobs;
create policy "Fleet managers can update transport jobs" on public.transport_jobs for update to authenticated using (exists (select 1 from public.app_user_roles r where r.user_id = auth.uid() and r.is_active and r.role_key in ('administrator','supervisor'))) with check (exists (select 1 from public.app_user_roles r where r.user_id = auth.uid() and r.is_active and r.role_key in ('administrator','supervisor')));

grant select on public.fleet_transport_units, public.transport_jobs to authenticated;
grant insert, update on public.fleet_transport_units, public.transport_jobs to authenticated;
grant all on public.fleet_transport_units, public.transport_jobs to service_role;

insert into public.app_permission_modules (module_key, label) values ('fleet_transport', 'Fleet / Transport') on conflict (module_key) do update set label = excluded.label, updated_at = now();
insert into public.app_role_permissions (role_key, module_key, can_view, can_create, can_edit, can_delete, can_reports)
values ('administrator','fleet_transport',true,true,true,true,true), ('supervisor','fleet_transport',true,true,true,false,true), ('operator','fleet_transport',true,false,false,false,false)
on conflict (role_key,module_key) do update set can_view=excluded.can_view, can_create=excluded.can_create, can_edit=excluded.can_edit, can_delete=excluded.can_delete, can_reports=excluded.can_reports, updated_at=now();

commit;
