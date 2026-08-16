-- Canonical trailer physical load-state lifecycle.
-- This migration is additive and intentionally performs no data reconciliation.

begin;

create or replace function public.resolve_trailer_physical_load_status(
  p_existing_load_status text,
  p_incoming_load_status text
)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when p_incoming_load_status in ('Empty', 'Loaded') then p_incoming_load_status
    when p_existing_load_status in ('Empty', 'Loaded') then p_existing_load_status
    else null
  end;
$$;

revoke execute on function public.resolve_trailer_physical_load_status(text, text) from public;
revoke execute on function public.resolve_trailer_physical_load_status(text, text) from anon;
revoke execute on function public.resolve_trailer_physical_load_status(text, text) from authenticated;
grant execute on function public.resolve_trailer_physical_load_status(text, text) to service_role;

create or replace function public.confirm_vessel_trailer_arrival(
  p_vessel_operation_trailer_id uuid,
  p_received_at timestamptz,
  p_compound_position text,
  p_arrival_notes text,
  p_condition_on_arrival text,
  p_confirmed_by text,
  p_explicit_load_status text,
  p_customer text,
  p_destination text,
  p_trailer_source text,
  p_external_company text,
  p_is_local boolean
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row record;
  v_source_link_existing uuid;
  v_target_trailer record;
  v_target_trailer_id uuid;
  v_previous_load_status text;
  v_resolved_load_status text;
  v_source_note text;
  v_arrival_notes text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and not exists (
      select 1
      from public.app_user_roles actor_role
      where actor_role.user_id = auth.uid()
        and actor_role.is_active = true
        and actor_role.role_key in ('administrator', 'supervisor', 'operator')
    ) then
    raise exception 'Vessel arrival permission denied.';
  end if;

  if p_explicit_load_status is not null
    and p_explicit_load_status not in ('Empty', 'Loaded') then
    raise exception 'Physical load status must be Empty or Loaded.';
  end if;

  if p_destination is not null
    and p_destination not in ('compound', 'local', 'awaiting_position') then
    raise exception 'Invalid vessel reception destination.';
  end if;

  select vot.*, vo.list_status, vo.vessel_name, vo.sailing_reference
  into v_row
  from public.vessel_operation_trailers vot
  join public.vessel_operations vo on vo.id = vot.vessel_operation_id
  where vot.id = p_vessel_operation_trailer_id
  for update of vot, vo;

  if not found then
    raise exception 'Vessel operation trailer not found.';
  end if;

  if coalesce(v_row.list_status, 'draft') <> 'confirmed' then
    raise exception 'Vessel list is not confirmed.';
  end if;

  if coalesce(v_row.arrival_status, 'expected') = 'arrived' then
    raise exception 'Arrival already confirmed for this trailer.';
  end if;

  if v_row.arrival_record_id is not null then
    raise exception 'Arrival record already linked for this trailer.';
  end if;

  if coalesce(v_row.arrival_status, 'expected') <> 'available_for_arrival' then
    raise exception 'Trailer is not available for arrival confirmation.';
  end if;

  select id
  into v_source_link_existing
  from public.trailers
  where source_vessel_operation_trailer_id = v_row.id
  limit 1;

  if v_source_link_existing is not null then
    raise exception 'A trailer record already exists for this vessel trailer source link.';
  end if;

  select t.id, t.trailer_number, t.load_status
  into v_target_trailer
  from public.trailers t
  where upper(trim(t.trailer_number)) = upper(trim(v_row.trailer_number))
    and t.departure_date is null
  order by t.created_at desc
  limit 1
  for update;

  if found then
    v_target_trailer_id := v_target_trailer.id;
    v_previous_load_status := v_target_trailer.load_status;
  end if;

  if p_destination = 'compound' and nullif(trim(p_compound_position), '') is not null then
    perform pg_advisory_xact_lock(hashtext('compound_position:' || upper(trim(p_compound_position))));

    if exists (
      select 1
      from public.trailers t
      where t.id is distinct from v_target_trailer_id
        and t.departure_date is null
        and coalesce(t.is_local, false) = false
        and upper(trim(coalesce(t.compound_position, ''))) = upper(trim(p_compound_position))
    ) then
      raise exception 'Compound position is already occupied.';
    end if;
  end if;

  v_resolved_load_status := public.resolve_trailer_physical_load_status(
    v_previous_load_status,
    coalesce(p_explicit_load_status, v_row.load_status)
  );

  v_source_note := format(
    'Source vessel operation trailer: %s (%s / %s)',
    v_row.id,
    coalesce(v_row.vessel_name, 'Unknown Vessel'),
    coalesce(v_row.sailing_reference, '-')
  );

  v_arrival_notes := concat_ws(E'\n',
    nullif(trim(p_arrival_notes), ''),
    case when nullif(trim(p_condition_on_arrival), '') is not null then 'Condition on arrival: ' || trim(p_condition_on_arrival) else null end,
    v_source_note
  );

  if v_target_trailer_id is null then
    insert into public.trailers (
      trailer_number,
      load_status,
      load_description,
      customer,
      compound_position,
      notes,
      arrival_date,
      trailer_source,
      external_company,
      operational_status,
      source_vessel_operation_trailer_id,
      is_local
    )
    values (
      v_row.trailer_number,
      v_resolved_load_status,
      v_row.load_description,
      coalesce(nullif(trim(p_customer), ''), v_row.customer),
      case when p_destination = 'compound' then nullif(upper(trim(p_compound_position)), '') else null end,
      nullif(v_arrival_notes, ''),
      p_received_at::date,
      coalesce(nullif(trim(p_trailer_source), ''), 'company'),
      case when nullif(trim(p_trailer_source), '') = 'outsourced' then nullif(trim(p_external_company), '') else null end,
      case
        when p_destination = 'compound' then 'In Compound'
        when p_destination = 'local' then 'Local Trailer'
        when p_destination = 'awaiting_position' then 'Awaiting Position'
        else null
      end,
      v_row.id,
      coalesce(p_is_local, false)
    )
    returning id into v_target_trailer_id;
  else
    update public.trailers
    set
      source_vessel_operation_trailer_id = v_row.id,
      arrival_date = coalesce(arrival_date, p_received_at::date),
      load_status = v_resolved_load_status,
      load_description = coalesce(v_row.load_description, load_description),
      customer = coalesce(nullif(trim(p_customer), ''), v_row.customer, customer),
      compound_position = case
        when p_destination = 'compound' then coalesce(nullif(upper(trim(p_compound_position)), ''), compound_position)
        when p_destination in ('local', 'awaiting_position') then null
        else compound_position
      end,
      operational_status = case
        when p_destination = 'compound' then 'In Compound'
        when p_destination = 'local' then 'Local Trailer'
        when p_destination = 'awaiting_position' then 'Awaiting Position'
        else operational_status
      end,
      is_local = coalesce(p_is_local, is_local),
      trailer_source = coalesce(nullif(trim(p_trailer_source), ''), trailer_source),
      external_company = case
        when nullif(trim(p_trailer_source), '') = 'outsourced' then nullif(trim(p_external_company), '')
        when p_trailer_source is not null then null
        else external_company
      end,
      notes = concat_ws(E'\n', nullif(trim(notes), ''), nullif(v_arrival_notes, ''))
    where id = v_target_trailer_id;
  end if;

  update public.vessel_operation_trailers
  set
    trailer_id = v_target_trailer_id,
    arrival_record_id = v_target_trailer_id,
    arrival_status = 'arrived',
    arrival_confirmed_at = p_received_at,
    arrived_at = p_received_at,
    arrival_confirmed_by = coalesce(nullif(trim(p_confirmed_by), ''), 'TrailerHub User'),
    assigned_position = case when p_destination = 'compound' then nullif(upper(trim(p_compound_position)), '') else null end,
    position_assigned_at = case when p_destination = 'compound' and nullif(trim(p_compound_position), '') is not null then p_received_at else null end,
    status = case when status = 'expected' then 'arrived' else status end,
    updated_at = now()
  where id = v_row.id;

  insert into public.trailer_events (
    trailer_id, trailer_number, event_type, event_description, old_value, new_value, created_by
  )
  values (
    v_target_trailer_id,
    v_row.trailer_number,
    'vessel_arrival_confirmed',
    'Arrival confirmed from vessel expected list.',
    jsonb_build_object(
      'vessel_operation_trailer_id', v_row.id,
      'arrival_status', v_row.arrival_status,
      'arrival_record_id', v_row.arrival_record_id,
      'load_status', v_previous_load_status
    ),
    jsonb_build_object(
      'vessel_operation_trailer_id', v_row.id,
      'arrival_status', 'arrived',
      'arrival_record_id', v_target_trailer_id,
      'arrival_confirmed_at', p_received_at,
      'load_status', v_resolved_load_status,
      'source_module', 'vessel'
    ),
    coalesce(nullif(trim(p_confirmed_by), ''), 'TrailerHub User')
  );

  return v_target_trailer_id;
end;
$$;

create or replace function public.confirm_vessel_trailer_arrival(
  p_vessel_operation_trailer_id uuid,
  p_received_at timestamptz default now(),
  p_compound_position text default null,
  p_arrival_notes text default null,
  p_condition_on_arrival text default null,
  p_confirmed_by text default null
)
returns uuid
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.confirm_vessel_trailer_arrival(
    p_vessel_operation_trailer_id,
    p_received_at,
    p_compound_position,
    p_arrival_notes,
    p_condition_on_arrival,
    p_confirmed_by,
    null,
    null,
    case when nullif(trim(p_compound_position), '') is null then null else 'compound' end,
    null,
    null,
    null
  );
$$;

revoke execute on function public.confirm_vessel_trailer_arrival(uuid, timestamptz, text, text, text, text, text, text, text, text, text, boolean) from public;
revoke execute on function public.confirm_vessel_trailer_arrival(uuid, timestamptz, text, text, text, text, text, text, text, text, text, boolean) from anon;
grant execute on function public.confirm_vessel_trailer_arrival(uuid, timestamptz, text, text, text, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.confirm_vessel_trailer_arrival(uuid, timestamptz, text, text, text, text, text, text, text, text, text, boolean) to service_role;

revoke execute on function public.confirm_vessel_trailer_arrival(uuid, timestamptz, text, text, text, text) from public;
revoke execute on function public.confirm_vessel_trailer_arrival(uuid, timestamptz, text, text, text, text) from anon;
grant execute on function public.confirm_vessel_trailer_arrival(uuid, timestamptz, text, text, text, text) to authenticated;
grant execute on function public.confirm_vessel_trailer_arrival(uuid, timestamptz, text, text, text, text) to service_role;

create or replace function public.advance_export_allocation_load_lifecycle(
  p_allocation_id uuid,
  p_expected_current_status text,
  p_target_status text,
  p_performed_by text default null
)
returns table (
  transitioned boolean,
  trailer_id uuid,
  previous_compound_position text,
  previous_load_status text,
  new_load_status text,
  occurred_at timestamptz
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_allocation record;
  v_trailer record;
  v_required_load_status text;
  v_timestamp_column text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and not exists (
      select 1
      from public.app_user_roles actor_role
      where actor_role.user_id = auth.uid()
        and actor_role.is_active = true
        and actor_role.role_key in ('administrator', 'supervisor', 'operator')
    ) then
    raise exception 'Export lifecycle permission denied.';
  end if;

  select ea.* into v_allocation
  from public.export_allocations ea
  where ea.id = p_allocation_id
  for update;

  if not found or v_allocation.status is distinct from p_expected_current_status then
    return query select false, v_allocation.trailer_id, null::text, null::text, null::text, v_now;
    return;
  end if;

  if not (
    (v_allocation.status = 'allocated' and p_target_status = 'delivered_empty')
    or (v_allocation.status = 'delivered_empty' and p_target_status = 'waiting_loading')
    or (v_allocation.status = 'waiting_loading' and p_target_status = 'collected_loaded')
    or (v_allocation.status = 'collected_loaded' and p_target_status = 'completed')
  ) then
    raise exception 'Invalid export allocation lifecycle transition.';
  end if;

  if v_allocation.trailer_id is not null then
    select t.id, t.trailer_number, t.compound_position, t.load_status
    into v_trailer
    from public.trailers t
    where t.id = v_allocation.trailer_id
    for update;

    if not found then
      raise exception 'Linked trailer not found.';
    end if;
  end if;

  v_required_load_status := case
    when p_target_status = 'delivered_empty' then 'Empty'
    when p_target_status = 'collected_loaded' then 'Loaded'
    else v_trailer.load_status
  end;

  v_timestamp_column := case p_target_status
    when 'delivered_empty' then 'delivered_empty_at'
    when 'waiting_loading' then 'waiting_loading_at'
    when 'collected_loaded' then 'collected_loaded_at'
    when 'completed' then 'completed_at'
  end;

  execute format(
    'update public.export_allocations set status = $1, %I = $2, updated_at = $2 where id = $3',
    v_timestamp_column
  ) using p_target_status, v_now, v_allocation.id;

  if v_allocation.trailer_id is not null then
    update public.trailers
    set
      load_status = v_required_load_status,
      compound_position = case when p_target_status = 'delivered_empty' then null else compound_position end
    where id = v_allocation.trailer_id;
  end if;

  insert into public.trailer_events (
    trailer_id, trailer_number, event_type, event_description, old_value, new_value, created_by, created_at
  )
  values (
    v_allocation.trailer_id,
    coalesce(v_allocation.trailer_number, v_trailer.trailer_number, 'Unknown trailer'),
    'export_allocation_status_changed',
    format('Export allocation changed from %s to %s.', v_allocation.status, p_target_status),
    jsonb_build_object(
      'export_allocation_id', v_allocation.id,
      'status', v_allocation.status,
      'load_status', v_trailer.load_status,
      'compound_position', v_trailer.compound_position
    ),
    jsonb_build_object(
      'export_allocation_id', v_allocation.id,
      'status', p_target_status,
      'load_status', v_required_load_status,
      'compound_position', case when p_target_status = 'delivered_empty' then null else v_trailer.compound_position end,
      'source_module', 'export'
    ),
    p_performed_by,
    v_now
  );

  insert into public.trailer_activity_log (
    trailer_id, trailer_number, event_type, event_title, event_description,
    source_module, source_record_id, previous_status, new_status,
    previous_compound_position, new_compound_position, metadata, performed_by, created_at
  )
  values (
    v_allocation.trailer_id,
    coalesce(v_allocation.trailer_number, v_trailer.trailer_number, 'Unknown trailer'),
    'export_status_changed',
    'Export allocation status changed',
    format('Export allocation changed from %s to %s.', v_allocation.status, p_target_status),
    'export',
    v_allocation.id,
    v_allocation.status,
    p_target_status,
    v_trailer.compound_position,
    case when p_target_status = 'delivered_empty' then null else v_trailer.compound_position end,
    jsonb_build_object('previous_load_status', v_trailer.load_status, 'new_load_status', v_required_load_status),
    p_performed_by,
    v_now
  );

  return query select true, v_allocation.trailer_id, v_trailer.compound_position, v_trailer.load_status, v_required_load_status, v_now;
end;
$$;

revoke execute on function public.advance_export_allocation_load_lifecycle(uuid, text, text, text) from public;
revoke execute on function public.advance_export_allocation_load_lifecycle(uuid, text, text, text) from anon;
grant execute on function public.advance_export_allocation_load_lifecycle(uuid, text, text, text) to authenticated;
grant execute on function public.advance_export_allocation_load_lifecycle(uuid, text, text, text) to service_role;

-- Keep the currently deployed export clients working while preventing anonymous
-- callers from reaching the legacy transition RPCs during application rollout.
revoke execute on function public.set_export_allocation_delivered_empty(uuid, text) from public;
revoke execute on function public.set_export_allocation_delivered_empty(uuid, text) from anon;
grant execute on function public.set_export_allocation_delivered_empty(uuid, text) to authenticated;
grant execute on function public.set_export_allocation_delivered_empty(uuid, text) to service_role;

revoke execute on function public.undo_export_allocation_delivered_empty(uuid, text, text) from public;
revoke execute on function public.undo_export_allocation_delivered_empty(uuid, text, text) from anon;
grant execute on function public.undo_export_allocation_delivered_empty(uuid, text, text) to authenticated;
grant execute on function public.undo_export_allocation_delivered_empty(uuid, text, text) to service_role;

create or replace function public.complete_delivery_customer_collection(
  p_booking_id uuid,
  p_expected_current_status text,
  p_resulting_load_status text,
  p_collected_temperature_c numeric default null,
  p_performed_by text default null
)
returns public.delivery_bookings
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_booking public.delivery_bookings%rowtype;
  v_updated public.delivery_bookings%rowtype;
  v_trailer record;
begin
  if p_resulting_load_status not in ('Empty', 'Loaded') then
    raise exception 'Collection physical outcome must be Empty or Loaded.';
  end if;

  select * into v_booking
  from public.delivery_bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'Delivery booking not found.';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
    and not exists (
      select 1
      from public.app_user_roles actor_role
      where actor_role.user_id = auth.uid()
        and actor_role.is_active = true
        and actor_role.role_key in ('administrator', 'supervisor', 'operator')
    )
    and not exists (
      select 1
      from public.drivers assigned_driver
      where assigned_driver.id = v_booking.driver_id
        and assigned_driver.user_id = auth.uid()
        and assigned_driver.active = true
    ) then
    raise exception 'Delivery collection permission denied.';
  end if;

  if v_booking.status is distinct from p_expected_current_status
    or v_booking.status <> 'waiting_collection' then
    raise exception 'Delivery booking is not awaiting customer collection.';
  end if;

  if v_booking.temperature_required and p_collected_temperature_c is null then
    raise exception 'Temperature reading is required before marking this booking as collected.';
  end if;

  select t.id, t.trailer_number, t.load_status, t.compound_position
  into v_trailer
  from public.trailers t
  where t.id = v_booking.trailer_id
  for update;

  if not found then
    raise exception 'Linked trailer not found.';
  end if;

  update public.delivery_bookings
  set
    status = 'collected',
    collected_at = coalesce(collected_at, v_now),
    collected_temperature_c = coalesce(p_collected_temperature_c, collected_temperature_c),
    updated_at = v_now
  where id = v_booking.id
  returning * into v_updated;

  update public.trailers
  set load_status = p_resulting_load_status
  where id = v_booking.trailer_id;

  insert into public.trailer_events (
    trailer_id, trailer_number, event_type, event_description, old_value, new_value, created_by, created_at
  )
  values (
    v_booking.trailer_id,
    v_trailer.trailer_number,
    'trailer_collected',
    format('Trailer collected from customer with physical outcome %s.', p_resulting_load_status),
    jsonb_build_object('delivery_booking_id', v_booking.id, 'status', v_booking.status, 'load_status', v_trailer.load_status),
    jsonb_build_object('delivery_booking_id', v_booking.id, 'status', 'collected', 'load_status', p_resulting_load_status, 'source_module', 'delivery'),
    p_performed_by,
    v_now
  );

  insert into public.trailer_activity_log (
    trailer_id, trailer_number, event_type, event_title, event_description,
    source_module, source_record_id, previous_status, new_status,
    previous_compound_position, new_compound_position, metadata, performed_by, created_at
  )
  values (
    v_booking.trailer_id,
    v_trailer.trailer_number,
    'load_status_changed',
    'Customer collection completed',
    format('Trailer collected from customer as %s.', p_resulting_load_status),
    'delivery',
    v_booking.id,
    v_booking.status,
    'collected',
    v_trailer.compound_position,
    v_trailer.compound_position,
    jsonb_build_object('previous_load_status', v_trailer.load_status, 'new_load_status', p_resulting_load_status),
    p_performed_by,
    v_now
  );

  return v_updated;
end;
$$;

revoke execute on function public.complete_delivery_customer_collection(uuid, text, text, numeric, text) from public;
revoke execute on function public.complete_delivery_customer_collection(uuid, text, text, numeric, text) from anon;
grant execute on function public.complete_delivery_customer_collection(uuid, text, text, numeric, text) to authenticated;
grant execute on function public.complete_delivery_customer_collection(uuid, text, text, numeric, text) to service_role;

create or replace function public.change_stock_check_trailer_load_status(
  p_stock_check_id uuid,
  p_stock_check_item_id uuid,
  p_new_load_status text,
  p_changed_by text default null
)
returns table (
  stock_check_item_id uuid,
  trailer_id uuid,
  trailer_number text,
  previous_load_status text,
  new_load_status text,
  discrepancy_type text,
  resolution_status text
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_item record;
  v_trailer record;
  v_new_load_status text := initcap(lower(trim(p_new_load_status)));
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and not exists (
      select 1
      from public.app_user_roles actor_role
      where actor_role.user_id = auth.uid()
        and actor_role.is_active = true
        and actor_role.role_key in ('administrator', 'supervisor', 'operator')
    ) then
    raise exception 'Stock check permission denied.';
  end if;

  if v_new_load_status not in ('Empty', 'Loaded') then
    raise exception 'Physical load status must be Empty or Loaded.';
  end if;

  select i.* into v_item
  from public.compound_stock_check_items i
  join public.compound_stock_checks c on c.id = i.stock_check_id
  where i.id = p_stock_check_item_id
    and i.stock_check_id = p_stock_check_id
    and c.status = 'in_progress'
  for update of i;

  if not found or v_item.trailer_id is null then
    raise exception 'Open stock check item with linked trailer not found.';
  end if;

  select t.id, t.trailer_number, t.load_status into v_trailer
  from public.trailers t
  where t.id = v_item.trailer_id
  for update;

  if not found then
    raise exception 'Linked trailer not found.';
  end if;

  if v_trailer.load_status = v_new_load_status then
    return query
    select
      v_item.id,
      v_trailer.id,
      v_trailer.trailer_number,
      v_trailer.load_status,
      v_new_load_status,
      v_item.discrepancy_type,
      v_item.resolution_status;
    return;
  end if;

  update public.trailers
  set load_status = v_new_load_status
  where id = v_trailer.id;

  update public.compound_stock_check_items
  set
    system_load_status = v_new_load_status,
    discrepancy_type = case when discrepancy_type in ('wrong_status', 'wrong_load_status') then 'matched' else discrepancy_type end,
    resolution_status = 'resolved',
    resolution_action = 'load_status_changed',
    resolved_at = v_now,
    resolved_by = nullif(trim(p_changed_by), ''),
    updated_at = v_now
  where id = v_item.id
  returning * into v_item;

  update public.compound_stock_checks
  set
    wrong_status_total = (
      select count(*)::integer
      from public.compound_stock_check_items
      where stock_check_id = p_stock_check_id
        and discrepancy_type in ('wrong_status', 'wrong_load_status', 'allocated_but_present', 'delivered_but_present', 'cancelled_allocation')
        and resolution_status <> 'resolved'
    ),
    updated_at = v_now
  where id = p_stock_check_id;

  insert into public.trailer_events (
    trailer_id, trailer_number, event_type, event_description, old_value, new_value, created_by, created_at
  )
  values (
    v_trailer.id,
    v_trailer.trailer_number,
    'load_status_changed',
    'Canonical load status changed during Compound stock check.',
    jsonb_build_object('stock_check_id', p_stock_check_id, 'stock_check_item_id', v_item.id, 'load_status', v_trailer.load_status),
    jsonb_build_object('stock_check_id', p_stock_check_id, 'stock_check_item_id', v_item.id, 'load_status', v_new_load_status, 'source_module', 'stock_check'),
    p_changed_by,
    v_now
  );

  insert into public.trailer_activity_log (
    trailer_id, trailer_number, event_type, event_title, event_description,
    source_module, source_record_id, previous_status, new_status, metadata, performed_by, created_at
  )
  values (
    v_trailer.id,
    v_trailer.trailer_number,
    'load_status_changed',
    'Stock check load status changed',
    'Canonical load status changed during Compound stock check.',
    'stock_check',
    v_item.id,
    v_trailer.load_status,
    v_new_load_status,
    jsonb_build_object('stock_check_id', p_stock_check_id, 'previous_load_status', v_trailer.load_status, 'new_load_status', v_new_load_status),
    p_changed_by,
    v_now
  );

  return query
  select
    v_item.id,
    v_trailer.id,
    v_trailer.trailer_number,
    v_trailer.load_status,
    v_new_load_status,
    v_item.discrepancy_type,
    v_item.resolution_status;
end;
$$;

revoke execute on function public.change_stock_check_trailer_load_status(uuid, uuid, text, text) from public;
revoke execute on function public.change_stock_check_trailer_load_status(uuid, uuid, text, text) from anon;
grant execute on function public.change_stock_check_trailer_load_status(uuid, uuid, text, text) to authenticated;
grant execute on function public.change_stock_check_trailer_load_status(uuid, uuid, text, text) to service_role;

commit;