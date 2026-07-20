-- Idempotent RPCs for export allocation compound transitions.
-- These functions keep export status and physical compound position in sync.

create or replace function public.set_export_allocation_delivered_empty(
  p_allocation_id uuid,
  p_expected_current_status text
)
returns table (
  transitioned boolean,
  trailer_id uuid,
  previous_compound_position text
)
language plpgsql
security invoker
as $$
declare
  v_now timestamptz := now();
  v_allocation record;
  v_trailer record;
  v_previous_compound_position text;
begin
  select ea.id, ea.trailer_id, ea.trailer_number, ea.status, ea.customer
  into v_allocation
  from public.export_allocations ea
  where ea.id = p_allocation_id
  for update;

  if not found then
    return query select false, null::uuid, null::text;
    return;
  end if;

  if v_allocation.status is distinct from p_expected_current_status then
    return query select false, v_allocation.trailer_id, null::text;
    return;
  end if;

  if v_allocation.status = 'delivered_empty' then
    return query select false, v_allocation.trailer_id, null::text;
    return;
  end if;

  if v_allocation.trailer_id is not null then
    select t.id, t.trailer_number, t.compound_position
    into v_trailer
    from public.trailers t
    where t.id = v_allocation.trailer_id
    for update;

    v_previous_compound_position := v_trailer.compound_position;
  else
    v_previous_compound_position := null;
  end if;

  update public.export_allocations
  set
    status = 'delivered_empty',
    delivered_empty_at = v_now,
    updated_at = v_now
  where id = v_allocation.id;

  if v_allocation.trailer_id is not null then
    -- Keep trailer active and linked; only remove from physical compound position.
    update public.trailers
    set compound_position = null
    where id = v_allocation.trailer_id;
  end if;

  -- Single movement/history entry for this transition.
  insert into public.trailer_events (
    trailer_id,
    trailer_number,
    event_type,
    event_description,
    old_value,
    new_value,
    created_at
  )
  select
    v_allocation.trailer_id,
    coalesce(v_allocation.trailer_number, v_trailer.trailer_number, 'Unknown trailer'),
    'export_allocation_status_changed',
    format('Empty trailer delivered to %s.', coalesce(nullif(trim(v_allocation.customer), ''), 'customer')),
    jsonb_build_object(
      'export_allocation_id', v_allocation.id,
      'status', v_allocation.status,
      'movement', jsonb_build_object(
        'reason', 'export_departure',
        'previous_compound_position', v_previous_compound_position,
        'new_compound_position', null
      )
    ),
    jsonb_build_object(
      'export_allocation_id', v_allocation.id,
      'status', 'delivered_empty',
      'movement', jsonb_build_object(
        'reason', 'export_departure',
        'previous_compound_position', v_previous_compound_position,
        'new_compound_position', null
      )
    ),
    v_now
  where not exists (
    select 1
    from public.trailer_events te
    where te.trailer_id is not distinct from v_allocation.trailer_id
      and te.event_type = 'export_allocation_status_changed'
      and te.old_value ->> 'export_allocation_id' = v_allocation.id::text
      and te.new_value ->> 'status' = 'delivered_empty'
  );

  return query select true, v_allocation.trailer_id, v_previous_compound_position;
end;
$$;

grant execute on function public.set_export_allocation_delivered_empty(uuid, text) to authenticated;

create or replace function public.undo_export_allocation_delivered_empty(
  p_allocation_id uuid,
  p_expected_current_status text default 'delivered_empty',
  p_preferred_compound_position text default null
)
returns table (
  transitioned boolean,
  trailer_id uuid,
  restored_compound_position text,
  fallback_position_used boolean
)
language plpgsql
security invoker
as $$
declare
  v_now timestamptz := now();
  v_allocation record;
  v_trailer record;
  v_previous_compound_position text;
  v_preferred text;
  v_target text;
  v_fallback boolean := false;
begin
  select ea.id, ea.trailer_id, ea.trailer_number, ea.status
  into v_allocation
  from public.export_allocations ea
  where ea.id = p_allocation_id
  for update;

  if not found then
    return query select false, null::uuid, null::text, false;
    return;
  end if;

  if v_allocation.status is distinct from p_expected_current_status then
    return query select false, v_allocation.trailer_id, null::text, false;
    return;
  end if;

  if v_allocation.status <> 'delivered_empty' then
    return query select false, v_allocation.trailer_id, null::text, false;
    return;
  end if;

  if v_allocation.trailer_id is null then
    update public.export_allocations
    set
      status = 'allocated',
      delivered_empty_at = null,
      updated_at = v_now
    where id = v_allocation.id;

    return query select true, null::uuid, null::text, false;
    return;
  end if;

  select t.id, t.trailer_number
  into v_trailer
  from public.trailers t
  where t.id = v_allocation.trailer_id
  for update;

  select te.old_value -> 'movement' ->> 'previous_compound_position'
  into v_previous_compound_position
  from public.trailer_events te
  where te.trailer_id = v_allocation.trailer_id
    and te.event_type = 'export_allocation_status_changed'
    and te.old_value ->> 'export_allocation_id' = v_allocation.id::text
    and te.new_value ->> 'status' = 'delivered_empty'
  order by te.created_at desc
  limit 1;

  v_preferred := upper(trim(coalesce(p_preferred_compound_position, v_previous_compound_position, '')));
  if v_preferred !~ '^P[0-9]{2}$' then
    v_preferred := null;
  end if;

  if v_preferred is not null and exists (
    select 1
    from public.trailers t
    where t.id <> v_allocation.trailer_id
      and t.departure_date is null
      and coalesce(t.is_local, false) = false
      and upper(trim(coalesce(t.compound_position, ''))) = v_preferred
  ) then
    v_preferred := null;
  end if;

  if v_preferred is null then
    select candidate.position
    into v_target
    from (
      select 'P' || lpad(gs::text, 2, '0') as position
      from generate_series(1, 50) gs
    ) candidate
    where not exists (
      select 1
      from public.trailers t
      where t.id <> v_allocation.trailer_id
        and t.departure_date is null
        and coalesce(t.is_local, false) = false
        and upper(trim(coalesce(t.compound_position, ''))) = candidate.position
    )
    order by candidate.position
    limit 1;

    v_fallback := true;
  else
    v_target := v_preferred;
  end if;

  if v_target is null then
    return query select false, v_allocation.trailer_id, null::text, false;
    return;
  end if;

  update public.export_allocations
  set
    status = 'allocated',
    delivered_empty_at = null,
    updated_at = v_now
  where id = v_allocation.id;

  -- Return trailer to compound while keeping it active and linked.
  update public.trailers
  set compound_position = v_target
  where id = v_allocation.trailer_id;

  insert into public.trailer_events (
    trailer_id,
    trailer_number,
    event_type,
    event_description,
    old_value,
    new_value,
    created_at
  )
  values (
    v_allocation.trailer_id,
    coalesce(v_allocation.trailer_number, v_trailer.trailer_number, 'Unknown trailer'),
    'export_allocation_status_changed',
    'Export allocation status changed from Delivered Empty to Allocated.',
    jsonb_build_object(
      'export_allocation_id', v_allocation.id,
      'status', 'delivered_empty',
      'movement', jsonb_build_object(
        'reason', 'export_undo_return',
        'previous_compound_position', v_previous_compound_position,
        'restored_compound_position', v_target,
        'fallback_position_used', v_fallback
      )
    ),
    jsonb_build_object(
      'export_allocation_id', v_allocation.id,
      'status', 'allocated',
      'movement', jsonb_build_object(
        'reason', 'export_undo_return',
        'previous_compound_position', v_previous_compound_position,
        'restored_compound_position', v_target,
        'fallback_position_used', v_fallback
      )
    ),
    v_now
  );

  return query select true, v_allocation.trailer_id, v_target, v_fallback;
end;
$$;

grant execute on function public.undo_export_allocation_delivered_empty(uuid, text, text) to authenticated;
