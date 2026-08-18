-- Release 1.0 lifecycle authorization and export rollback hardening.
-- This migration changes contracts only and performs no operational data reconciliation.

begin;

create or replace function public.is_active_operational_staff(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.app_user_roles actor_role
    where actor_role.user_id = auth.uid()
      and actor_role.is_active = true
      and actor_role.role_key = any(p_roles)
  );
$$;

revoke execute on function public.is_active_operational_staff(text[]) from public;
revoke execute on function public.is_active_operational_staff(text[]) from anon;
grant execute on function public.is_active_operational_staff(text[]) to authenticated;
grant execute on function public.is_active_operational_staff(text[]) to service_role;

alter table public.trailers enable row level security;
alter table public.vessel_operations enable row level security;
alter table public.vessel_operation_trailers enable row level security;
alter table public.export_allocations enable row level security;
alter table public.delivery_bookings enable row level security;
alter table public.trailer_events enable row level security;
alter table public.trailer_activity_log enable row level security;

-- Remove legacy policies that make the canonical lifecycle writable by any caller.
drop policy if exists "Anyone can read trailers" on public.trailers;
drop policy if exists "Anyone can insert trailers" on public.trailers;
drop policy if exists "Anyone can update trailers" on public.trailers;
drop policy if exists "Allow public insert trailers" on public.trailers;
drop policy if exists "Authenticated users can read trailers" on public.trailers;
drop policy if exists "Authenticated users can insert trailers" on public.trailers;
drop policy if exists "Authenticated users can update trailers" on public.trailers;
drop policy if exists "Authenticated users can delete trailers" on public.trailers;

drop policy if exists "Allow vessel operations access" on public.vessel_operations;
drop policy if exists "Authenticated users can read vessel_operations" on public.vessel_operations;
drop policy if exists "Authenticated users can insert vessel_operations" on public.vessel_operations;
drop policy if exists "Authenticated users can update vessel_operations" on public.vessel_operations;
drop policy if exists "Authenticated users can delete vessel_operations" on public.vessel_operations;

drop policy if exists "Allow vessel trailer access" on public.vessel_operation_trailers;
drop policy if exists "Authenticated users can read vessel_operation_trailers" on public.vessel_operation_trailers;
drop policy if exists "Authenticated users can insert vessel_operation_trailers" on public.vessel_operation_trailers;
drop policy if exists "Authenticated users can update vessel_operation_trailers" on public.vessel_operation_trailers;
drop policy if exists "Authenticated users can delete vessel_operation_trailers" on public.vessel_operation_trailers;

drop policy if exists "Allow select export allocations" on public.export_allocations;
drop policy if exists "Allow insert export allocations" on public.export_allocations;
drop policy if exists "Allow update export allocations" on public.export_allocations;
drop policy if exists "Authenticated users can read export_allocations" on public.export_allocations;
drop policy if exists "Authenticated users can insert export_allocations" on public.export_allocations;
drop policy if exists "Authenticated users can update export_allocations" on public.export_allocations;
drop policy if exists "Authenticated users can delete export_allocations" on public.export_allocations;

drop policy if exists "Allow delivery bookings select" on public.delivery_bookings;
drop policy if exists "Allow delivery bookings insert" on public.delivery_bookings;
drop policy if exists "Allow delivery bookings update" on public.delivery_bookings;
drop policy if exists "Allow delivery bookings delete" on public.delivery_bookings;

drop policy if exists "Anyone can read trailer events" on public.trailer_events;
drop policy if exists "Anyone can insert trailer events" on public.trailer_events;
drop policy if exists "Authenticated users can read trailer_events" on public.trailer_events;
drop policy if exists "Authenticated users can insert trailer_events" on public.trailer_events;
drop policy if exists "Authenticated users can update trailer_events" on public.trailer_events;
drop policy if exists "Authenticated users can delete trailer_events" on public.trailer_events;

drop policy if exists "Authenticated users can read trailer_activity_log" on public.trailer_activity_log;
drop policy if exists "Authenticated users can insert trailer_activity_log" on public.trailer_activity_log;
drop policy if exists "Authenticated users can update trailer_activity_log" on public.trailer_activity_log;
drop policy if exists "Authenticated users can delete trailer_activity_log" on public.trailer_activity_log;

create policy "Operational staff can read trailers"
  on public.trailers for select to authenticated
  using (
    public.is_active_operational_staff(array['administrator', 'supervisor', 'operator'])
    or exists (
      select 1
      from public.delivery_bookings assigned_booking
      join public.drivers assigned_driver on assigned_driver.id = assigned_booking.driver_id
      where assigned_booking.trailer_id = trailers.id
        and assigned_driver.user_id = auth.uid()
        and assigned_driver.active = true
    )
  );
create policy "Operational staff can insert trailers"
  on public.trailers for insert to authenticated
  with check (public.is_active_operational_staff(array['administrator', 'supervisor', 'operator']));
create policy "Operational staff can update trailers"
  on public.trailers for update to authenticated
  using (public.is_active_operational_staff(array['administrator', 'supervisor', 'operator']))
  with check (public.is_active_operational_staff(array['administrator', 'supervisor', 'operator']));
create policy "Managers can delete trailers"
  on public.trailers for delete to authenticated
  using (public.is_active_operational_staff(array['administrator', 'supervisor']));

create policy "Operational staff can read vessel operations"
  on public.vessel_operations for select to authenticated
  using (public.is_active_operational_staff(array['administrator', 'supervisor', 'operator']));
create policy "Operational staff can insert vessel operations"
  on public.vessel_operations for insert to authenticated
  with check (public.is_active_operational_staff(array['administrator', 'supervisor', 'operator']));
create policy "Operational staff can update vessel operations"
  on public.vessel_operations for update to authenticated
  using (public.is_active_operational_staff(array['administrator', 'supervisor', 'operator']))
  with check (public.is_active_operational_staff(array['administrator', 'supervisor', 'operator']));
create policy "Managers can delete vessel operations"
  on public.vessel_operations for delete to authenticated
  using (public.is_active_operational_staff(array['administrator', 'supervisor']));

create policy "Operational staff can read vessel trailers"
  on public.vessel_operation_trailers for select to authenticated
  using (public.is_active_operational_staff(array['administrator', 'supervisor', 'operator']));
create policy "Operational staff can insert vessel trailers"
  on public.vessel_operation_trailers for insert to authenticated
  with check (public.is_active_operational_staff(array['administrator', 'supervisor', 'operator']));
create policy "Operational staff can update vessel trailers"
  on public.vessel_operation_trailers for update to authenticated
  using (public.is_active_operational_staff(array['administrator', 'supervisor', 'operator']))
  with check (public.is_active_operational_staff(array['administrator', 'supervisor', 'operator']));
create policy "Managers can delete vessel trailers"
  on public.vessel_operation_trailers for delete to authenticated
  using (public.is_active_operational_staff(array['administrator', 'supervisor']));

create policy "Operational staff can read export allocations"
  on public.export_allocations for select to authenticated
  using (public.is_active_operational_staff(array['administrator', 'supervisor', 'operator']));
create policy "Operational staff can insert export allocations"
  on public.export_allocations for insert to authenticated
  with check (public.is_active_operational_staff(array['administrator', 'supervisor', 'operator']));
create policy "Operational staff can update export allocations"
  on public.export_allocations for update to authenticated
  using (public.is_active_operational_staff(array['administrator', 'supervisor', 'operator']))
  with check (public.is_active_operational_staff(array['administrator', 'supervisor', 'operator']));
create policy "Managers can delete export allocations"
  on public.export_allocations for delete to authenticated
  using (public.is_active_operational_staff(array['administrator', 'supervisor']));

-- Keep the role-aware delivery policies from Migration 037 and remove only legacy public bypasses.

create policy "Operational staff can read trailer events"
  on public.trailer_events for select to authenticated
  using (
    public.is_active_operational_staff(array['administrator', 'supervisor', 'operator'])
    or exists (
      select 1
      from public.delivery_bookings assigned_booking
      join public.drivers assigned_driver on assigned_driver.id = assigned_booking.driver_id
      where assigned_booking.trailer_id = trailer_events.trailer_id
        and assigned_driver.user_id = auth.uid()
        and assigned_driver.active = true
    )
  );
create policy "Operational staff can insert trailer events"
  on public.trailer_events for insert to authenticated
  with check (
    public.is_active_operational_staff(array['administrator', 'supervisor', 'operator'])
    or exists (
      select 1
      from public.delivery_bookings assigned_booking
      join public.drivers assigned_driver on assigned_driver.id = assigned_booking.driver_id
      where assigned_booking.trailer_id = trailer_events.trailer_id
        and assigned_driver.user_id = auth.uid()
        and assigned_driver.active = true
        and trailer_events.event_type in ('driver_task_acknowledged', 'delivery_status_changed', 'delivery_completed')
        and trailer_events.new_value ->> 'driver_id' = assigned_driver.id::text
        and trailer_events.new_value ->> 'user_id' = auth.uid()::text
    )
  );

create policy "Operational staff can read trailer activity"
  on public.trailer_activity_log for select to authenticated
  using (
    public.is_active_operational_staff(array['administrator', 'supervisor', 'operator'])
    or exists (
      select 1
      from public.delivery_bookings assigned_booking
      join public.drivers assigned_driver on assigned_driver.id = assigned_booking.driver_id
      where assigned_booking.id = trailer_activity_log.source_record_id
        and assigned_driver.user_id = auth.uid()
        and assigned_driver.active = true
        and trailer_activity_log.source_module = 'delivery'
    )
  );
create policy "Operational staff can insert trailer activity"
  on public.trailer_activity_log for insert to authenticated
  with check (
    public.is_active_operational_staff(array['administrator', 'supervisor', 'operator'])
    or exists (
      select 1
      from public.delivery_bookings assigned_booking
      join public.drivers assigned_driver on assigned_driver.id = assigned_booking.driver_id
      where assigned_booking.id = trailer_activity_log.source_record_id
        and assigned_driver.user_id = auth.uid()
        and assigned_driver.active = true
        and trailer_activity_log.source_module = 'delivery'
    )
  );

revoke all on table public.trailers, public.vessel_operations, public.vessel_operation_trailers,
  public.export_allocations, public.delivery_bookings, public.trailer_events, public.trailer_activity_log from public;
revoke all on table public.trailers, public.vessel_operations, public.vessel_operation_trailers,
  public.export_allocations, public.delivery_bookings, public.trailer_events, public.trailer_activity_log from anon;
grant select, insert, update, delete on table public.trailers, public.vessel_operations,
  public.vessel_operation_trailers, public.export_allocations, public.delivery_bookings to authenticated;
grant select, insert on table public.trailer_events, public.trailer_activity_log to authenticated;
revoke update, delete on table public.trailer_events from authenticated;
revoke update, delete on table public.trailer_activity_log from authenticated;
grant all on table public.trailers, public.vessel_operations, public.vessel_operation_trailers,
  public.export_allocations, public.delivery_bookings, public.trailer_events, public.trailer_activity_log to service_role;

-- The function already checks staff-or-assigned-driver ownership. Definer execution
-- lets that guarded path update canonical trailer state after direct table access is narrowed.
alter function public.complete_delivery_customer_collection(uuid, text, text, numeric, text) security definer;
alter function public.complete_delivery_customer_collection(uuid, text, text, numeric, text)
  set search_path = pg_catalog, public;

create or replace function public.undo_export_allocation_load_lifecycle(
  p_allocation_id uuid,
  p_expected_current_status text,
  p_performed_by text default null
)
returns table (
  transitioned boolean,
  trailer_id uuid,
  previous_status text,
  restored_compound_position text,
  fallback_position_used boolean,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_allocation record;
  v_trailer record;
  v_previous_status text;
  v_previous_position text;
  v_target_position text;
  v_target_load_status text;
  v_trailer_number text;
  v_previous_load_status text;
  v_previous_compound_position text;
  v_fallback boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and not public.is_active_operational_staff(array['administrator', 'supervisor', 'operator']) then
    raise exception 'Export lifecycle permission denied.';
  end if;

  select allocation.* into v_allocation
  from public.export_allocations allocation
  where allocation.id = p_allocation_id
  for update;

  if not found or v_allocation.status is distinct from p_expected_current_status then
    return query select false, v_allocation.trailer_id, null::text, null::text, false, v_now;
    return;
  end if;

  v_previous_status := case v_allocation.status
    when 'delivered_empty' then 'allocated'
    when 'waiting_loading' then 'delivered_empty'
    when 'collected_loaded' then 'waiting_loading'
    when 'completed' then 'collected_loaded'
    else null
  end;

  if v_allocation.status = 'cancelled' then
    select event.old_value ->> 'status' into v_previous_status
    from public.trailer_events event
    where event.event_type = 'export_allocation_cancelled'
      and event.old_value ->> 'export_allocation_id' = v_allocation.id::text
      and event.old_value ->> 'status' in ('allocated', 'delivered_empty', 'waiting_loading', 'collected_loaded')
    order by event.created_at desc
    limit 1;
  end if;

  if v_previous_status is null then
    raise exception 'Invalid export allocation rollback transition.';
  end if;

  if v_allocation.trailer_id is not null then
    select trailer.id, trailer.trailer_number, trailer.compound_position, trailer.load_status
    into v_trailer
    from public.trailers trailer
    where trailer.id = v_allocation.trailer_id
    for update;

    if not found then
      raise exception 'Linked trailer not found.';
    end if;

    v_trailer_number := v_trailer.trailer_number;
    v_previous_load_status := v_trailer.load_status;
    v_previous_compound_position := v_trailer.compound_position;
  end if;

  if v_allocation.status = 'delivered_empty' and v_previous_status = 'allocated' and v_allocation.trailer_id is not null then
    select event.old_value -> 'movement' ->> 'previous_compound_position'
    into v_previous_position
    from public.trailer_events event
    where event.event_type = 'export_allocation_status_changed'
      and event.old_value ->> 'export_allocation_id' = v_allocation.id::text
      and event.new_value ->> 'status' = 'delivered_empty'
    order by event.created_at desc
    limit 1;

    v_target_position := upper(trim(coalesce(v_previous_position, '')));
    if v_target_position !~ '^P(0[1-9]|[1-4][0-9]|50)$' or exists (
      select 1 from public.trailers occupied
      where occupied.id <> v_allocation.trailer_id
        and occupied.departure_date is null
        and coalesce(occupied.is_local, false) = false
        and upper(trim(coalesce(occupied.compound_position, ''))) = v_target_position
    ) then
      v_target_position := null;
    end if;

    if v_target_position is null then
      select candidate.position into v_target_position
      from (
        select 'P' || lpad(slot::text, 2, '0') position
        from generate_series(1, 50) slot
      ) candidate
      where not exists (
        select 1 from public.trailers occupied
        where occupied.id <> v_allocation.trailer_id
          and occupied.departure_date is null
          and coalesce(occupied.is_local, false) = false
          and upper(trim(coalesce(occupied.compound_position, ''))) = candidate.position
      )
      order by candidate.position
      limit 1;
      v_fallback := true;
    end if;

    if v_target_position is null then
      raise exception 'No available compound position to restore trailer after undo.';
    end if;

    perform pg_advisory_xact_lock(hashtext('compound_position:' || v_target_position));

    if exists (
      select 1 from public.trailers occupied
      where occupied.id <> v_allocation.trailer_id
        and occupied.departure_date is null
        and coalesce(occupied.is_local, false) = false
        and upper(trim(coalesce(occupied.compound_position, ''))) = v_target_position
    ) then
      raise exception 'Compound position is already occupied.';
    end if;
  end if;

  v_target_load_status := case
    when v_allocation.status = 'collected_loaded' then 'Empty'
    when v_previous_status = 'collected_loaded' then 'Loaded'
    else v_previous_load_status
  end;

  update public.export_allocations
  set
    status = v_previous_status,
    delivered_empty_at = case when v_allocation.status = 'delivered_empty' then null else delivered_empty_at end,
    waiting_loading_at = case when v_allocation.status = 'waiting_loading' then null else waiting_loading_at end,
    collected_loaded_at = case when v_allocation.status = 'collected_loaded' then null else collected_loaded_at end,
    completed_at = case when v_allocation.status = 'completed' then null else completed_at end,
    cancelled_at = case when v_allocation.status = 'cancelled' then null else cancelled_at end,
    updated_at = v_now
  where id = v_allocation.id;

  if v_allocation.trailer_id is not null then
    update public.trailers
    set
      load_status = v_target_load_status,
      compound_position = case
        when v_allocation.status = 'delivered_empty' and v_previous_status = 'allocated' then v_target_position
        else compound_position
      end
    where id = v_allocation.trailer_id;
  end if;

  insert into public.trailer_events (
    trailer_id, trailer_number, event_type, event_description, old_value, new_value, created_by, created_at
  ) values (
    v_allocation.trailer_id,
    coalesce(v_allocation.trailer_number, v_trailer_number, 'Unknown trailer'),
    'export_allocation_status_changed',
    format('Export allocation rollback changed %s to %s.', v_allocation.status, v_previous_status),
    jsonb_build_object(
      'export_allocation_id', v_allocation.id,
      'status', v_allocation.status,
      'load_status', v_previous_load_status,
      'compound_position', v_previous_compound_position
    ),
    jsonb_build_object(
      'export_allocation_id', v_allocation.id,
      'status', v_previous_status,
      'load_status', v_target_load_status,
      'compound_position', coalesce(v_target_position, v_previous_compound_position),
      'source_module', 'export',
      'rollback', true
    ),
    p_performed_by,
    v_now
  );

  insert into public.trailer_activity_log (
    trailer_id, trailer_number, event_type, event_title, event_description,
    source_module, source_record_id, previous_status, new_status,
    previous_compound_position, new_compound_position, metadata, performed_by, created_at
  ) values (
    v_allocation.trailer_id,
    coalesce(v_allocation.trailer_number, v_trailer_number, 'Unknown trailer'),
    'export_status_changed',
    'Export allocation rollback',
    format('Export allocation rollback changed %s to %s.', v_allocation.status, v_previous_status),
    'export',
    v_allocation.id,
    v_allocation.status,
    v_previous_status,
    v_previous_compound_position,
    coalesce(v_target_position, v_previous_compound_position),
    jsonb_build_object(
      'previous_load_status', v_previous_load_status,
      'new_load_status', v_target_load_status,
      'fallback_position_used', v_fallback,
      'rollback', true
    ),
    p_performed_by,
    v_now
  );

  return query select true, v_allocation.trailer_id, v_previous_status, v_target_position, v_fallback, v_now;
end;
$$;

revoke execute on function public.undo_export_allocation_load_lifecycle(uuid, text, text) from public;
revoke execute on function public.undo_export_allocation_load_lifecycle(uuid, text, text) from anon;
grant execute on function public.undo_export_allocation_load_lifecycle(uuid, text, text) to authenticated;
grant execute on function public.undo_export_allocation_load_lifecycle(uuid, text, text) to service_role;

commit;
