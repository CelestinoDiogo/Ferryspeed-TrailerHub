-- Ferryspeed TrailerHub - Migration 048
-- Fleet / Transport append-only history. Migration is additive and must be applied separately.

begin;

create table if not exists public.transport_job_events (
  id uuid primary key default gen_random_uuid(),
  transport_job_id uuid not null references public.transport_jobs(id) on delete restrict,
  event_type text not null,
  event_title text not null,
  event_description text null,
  previous_driver_id uuid null references public.drivers(id) on delete set null,
  new_driver_id uuid null references public.drivers(id) on delete set null,
  previous_unit_id uuid null references public.fleet_transport_units(id) on delete set null,
  new_unit_id uuid null references public.fleet_transport_units(id) on delete set null,
  previous_trailer_id uuid null references public.trailers(id) on delete set null,
  new_trailer_id uuid null references public.trailers(id) on delete set null,
  previous_status text null,
  new_status text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint transport_job_events_type_check check (event_type in (
    'job_created', 'driver_assigned', 'driver_reassigned', 'driver_unassigned',
    'unit_assigned', 'unit_reassigned', 'unit_unassigned',
    'trailer_assigned', 'trailer_reassigned', 'trailer_unassigned',
    'status_changed', 'job_started', 'job_completed', 'job_cancelled', 'job_updated'
  )),
  constraint transport_job_events_status_check check (
    previous_status is null or previous_status in ('planned', 'assigned', 'in_progress', 'completed', 'cancelled')
  ),
  constraint transport_job_events_new_status_check check (
    new_status is null or new_status in ('planned', 'assigned', 'in_progress', 'completed', 'cancelled')
  )
);

create index if not exists transport_job_events_job_created_idx
  on public.transport_job_events(transport_job_id, created_at desc);
create index if not exists transport_job_events_created_by_idx
  on public.transport_job_events(created_by_user_id);

create or replace function public.prevent_transport_job_event_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'Transport job events are immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists transport_job_events_immutable on public.transport_job_events;
create trigger transport_job_events_immutable
before update or delete on public.transport_job_events
for each row execute function public.prevent_transport_job_event_mutation();

alter table public.transport_job_events enable row level security;
drop policy if exists "Fleet users can read transport job events" on public.transport_job_events;
create policy "Fleet users can read transport job events"
  on public.transport_job_events for select to authenticated
  using (exists (select 1 from public.app_user_roles r where r.user_id = auth.uid() and r.is_active and r.role_key in ('administrator', 'supervisor', 'operator')));
drop policy if exists "Direct transport job event inserts are blocked" on public.transport_job_events;
create policy "Direct transport job event inserts are blocked"
  on public.transport_job_events for insert to authenticated with check (false);
drop policy if exists "Direct transport job event updates are blocked" on public.transport_job_events;
create policy "Direct transport job event updates are blocked"
  on public.transport_job_events for update to authenticated using (false) with check (false);
drop policy if exists "Direct transport job event deletes are blocked" on public.transport_job_events;
create policy "Direct transport job event deletes are blocked"
  on public.transport_job_events for delete to authenticated using (false);

revoke all privileges on table public.transport_job_events from anon;
revoke insert, update, delete, truncate, references, trigger on table public.transport_job_events from authenticated;
grant select on public.transport_job_events to authenticated;
grant all on public.transport_job_events to service_role;

create or replace function public.require_fleet_transport_actor(actor_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if actor_id is null or actor_id <> auth.uid() or not exists (
    select 1 from public.app_user_roles r
    where r.user_id = actor_id and r.is_active and r.role_key in ('administrator', 'supervisor')
  ) then
    raise exception 'Fleet transport mutation is not authorized.' using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.require_fleet_transport_actor(uuid) to authenticated;

create or replace function public.create_transport_job_with_event(p_payload jsonb, actor_id uuid)
returns public.transport_jobs language plpgsql security definer set search_path = public as $$
declare
  created_job public.transport_jobs;
begin
  perform public.require_fleet_transport_actor(actor_id);
  insert into public.transport_jobs (
    job_reference, status, driver_id, unit_id, trailer_id, trailer_number_snapshot,
    customer, booking_reference, collection_address, delivery_address, collection_at,
    delivery_at, notes, completed_at, cancelled_at
  ) values (
    p_payload->>'job_reference', coalesce(nullif(p_payload->>'status', ''), case when (p_payload->>'driver_id') is not null or (p_payload->>'unit_id') is not null then 'assigned' else 'planned' end),
    nullif(p_payload->>'driver_id', '')::uuid, nullif(p_payload->>'unit_id', '')::uuid, nullif(p_payload->>'trailer_id', '')::uuid,
    nullif(p_payload->>'trailer_number_snapshot', ''), nullif(p_payload->>'customer', ''), nullif(p_payload->>'booking_reference', ''),
    nullif(p_payload->>'collection_address', ''), nullif(p_payload->>'delivery_address', ''), nullif(p_payload->>'collection_at', '')::timestamptz,
    nullif(p_payload->>'delivery_at', '')::timestamptz, nullif(p_payload->>'notes', ''),
    case when p_payload->>'status' = 'completed' then now() end, case when p_payload->>'status' = 'cancelled' then now() end
  ) returning * into created_job;

  insert into public.transport_job_events (transport_job_id, event_type, event_title, event_description, new_driver_id, new_unit_id, new_trailer_id, new_status, metadata, created_by_user_id)
  values (created_job.id, 'job_created', 'Job created', 'Initial Transport Job state recorded.', created_job.driver_id, created_job.unit_id, created_job.trailer_id, created_job.status,
    jsonb_build_object('job_reference', created_job.job_reference, 'customer', created_job.customer), actor_id);
  return created_job;
end;
$$;

grant execute on function public.create_transport_job_with_event(jsonb, uuid) to authenticated;

create or replace function public.update_transport_job_with_event(p_job_id uuid, p_payload jsonb, actor_id uuid)
returns public.transport_jobs language plpgsql security definer set search_path = public as $$
declare
  before_job public.transport_jobs;
  after_job public.transport_jobs;
  changed_fields jsonb := '[]'::jsonb;
  event_type text;
  event_title text;
  assignment_description text;
  old_driver text;
  new_driver text;
  old_unit text;
  new_unit text;
  old_trailer text;
  new_trailer text;
begin
  perform public.require_fleet_transport_actor(actor_id);
  select * into before_job from public.transport_jobs where id = p_job_id for update;
  if not found then raise exception 'Transport Job not found.' using errcode = 'P0002'; end if;

  update public.transport_jobs set
    job_reference = p_payload->>'job_reference', status = p_payload->>'status', driver_id = nullif(p_payload->>'driver_id', '')::uuid,
    unit_id = nullif(p_payload->>'unit_id', '')::uuid, trailer_id = nullif(p_payload->>'trailer_id', '')::uuid,
    trailer_number_snapshot = nullif(p_payload->>'trailer_number_snapshot', ''), customer = nullif(p_payload->>'customer', ''),
    booking_reference = nullif(p_payload->>'booking_reference', ''), collection_address = nullif(p_payload->>'collection_address', ''),
    delivery_address = nullif(p_payload->>'delivery_address', ''), collection_at = nullif(p_payload->>'collection_at', '')::timestamptz,
    delivery_at = nullif(p_payload->>'delivery_at', '')::timestamptz, notes = nullif(p_payload->>'notes', ''),
    completed_at = case when p_payload->>'status' = 'completed' then coalesce(before_job.completed_at, now()) else null end,
    cancelled_at = case when p_payload->>'status' = 'cancelled' then coalesce(before_job.cancelled_at, now()) else null end
  where id = p_job_id returning * into after_job;

  select d.display_name into old_driver from public.drivers d where d.id = before_job.driver_id;
  select d.display_name into new_driver from public.drivers d where d.id = after_job.driver_id;
  select coalesce(u.registration, u.internal_number) into old_unit from public.fleet_transport_units u where u.id = before_job.unit_id;
  select coalesce(u.registration, u.internal_number) into new_unit from public.fleet_transport_units u where u.id = after_job.unit_id;
  select t.trailer_number into old_trailer from public.trailers t where t.id = before_job.trailer_id;
  select t.trailer_number into new_trailer from public.trailers t where t.id = after_job.trailer_id;

  if before_job.driver_id is distinct from after_job.driver_id then
    event_type := case when before_job.driver_id is null then 'driver_assigned' when after_job.driver_id is null then 'driver_unassigned' else 'driver_reassigned' end;
    insert into public.transport_job_events (transport_job_id, event_type, event_title, event_description, previous_driver_id, new_driver_id, metadata, created_by_user_id)
    values (p_job_id, event_type, replace(initcap(replace(event_type, '_', ' ')), 'Driver ', 'Driver '), coalesce(old_driver, 'Unassigned') || ' -> ' || coalesce(new_driver, 'Unassigned'), before_job.driver_id, after_job.driver_id, jsonb_build_object('previous_label', old_driver, 'new_label', new_driver), actor_id);
  end if;
  if before_job.unit_id is distinct from after_job.unit_id then
    event_type := case when before_job.unit_id is null then 'unit_assigned' when after_job.unit_id is null then 'unit_unassigned' else 'unit_reassigned' end;
    insert into public.transport_job_events (transport_job_id, event_type, event_title, event_description, previous_unit_id, new_unit_id, metadata, created_by_user_id)
    values (p_job_id, event_type, initcap(replace(event_type, '_', ' ')), coalesce(old_unit, 'Unassigned') || ' -> ' || coalesce(new_unit, 'Unassigned'), before_job.unit_id, after_job.unit_id, jsonb_build_object('previous_label', old_unit, 'new_label', new_unit), actor_id);
  end if;
  if before_job.trailer_id is distinct from after_job.trailer_id then
    event_type := case when before_job.trailer_id is null then 'trailer_assigned' when after_job.trailer_id is null then 'trailer_unassigned' else 'trailer_reassigned' end;
    insert into public.transport_job_events (transport_job_id, event_type, event_title, event_description, previous_trailer_id, new_trailer_id, metadata, created_by_user_id)
    values (p_job_id, event_type, initcap(replace(event_type, '_', ' ')), coalesce(old_trailer, 'Unassigned') || ' -> ' || coalesce(new_trailer, 'Unassigned'), before_job.trailer_id, after_job.trailer_id, jsonb_build_object('previous_label', old_trailer, 'new_label', new_trailer), actor_id);
  end if;
  if before_job.status is distinct from after_job.status then
    event_type := case after_job.status when 'in_progress' then 'job_started' when 'completed' then 'job_completed' when 'cancelled' then 'job_cancelled' else 'status_changed' end;
    insert into public.transport_job_events (transport_job_id, event_type, event_title, event_description, previous_status, new_status, created_by_user_id)
    values (p_job_id, event_type, initcap(replace(event_type, '_', ' ')), before_job.status || ' -> ' || after_job.status, before_job.status, after_job.status, actor_id);
  end if;

  if before_job.job_reference is distinct from after_job.job_reference then changed_fields := changed_fields || '["job_reference"]'::jsonb; end if;
  if before_job.customer is distinct from after_job.customer then changed_fields := changed_fields || '["customer"]'::jsonb; end if;
  if before_job.booking_reference is distinct from after_job.booking_reference then changed_fields := changed_fields || '["booking_reference"]'::jsonb; end if;
  if before_job.collection_address is distinct from after_job.collection_address then changed_fields := changed_fields || '["collection_address"]'::jsonb; end if;
  if before_job.delivery_address is distinct from after_job.delivery_address then changed_fields := changed_fields || '["delivery_address"]'::jsonb; end if;
  if before_job.collection_at is distinct from after_job.collection_at then changed_fields := changed_fields || '["collection_at"]'::jsonb; end if;
  if before_job.delivery_at is distinct from after_job.delivery_at then changed_fields := changed_fields || '["delivery_at"]'::jsonb; end if;
  if before_job.notes is distinct from after_job.notes then changed_fields := changed_fields || '["notes"]'::jsonb; end if;
  if jsonb_array_length(changed_fields) > 0 then
    insert into public.transport_job_events (transport_job_id, event_type, event_title, event_description, metadata, created_by_user_id)
    values (p_job_id, 'job_updated', 'Job updated', 'Operational fields changed.', jsonb_build_object('changed_fields', changed_fields), actor_id);
  end if;
  return after_job;
end;
$$;

grant execute on function public.update_transport_job_with_event(uuid, jsonb, uuid) to authenticated;

commit;
