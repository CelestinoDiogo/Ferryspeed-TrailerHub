-- Make Departure Undo one guarded physical-state and history transaction.
-- This migration defines behavior only and performs no operational data reconciliation.

begin;

create or replace function public.undo_trailer_departure(
  p_trailer_id uuid,
  p_expected_departure_at timestamptz,
  p_performed_by text default null
)
returns table (
  transitioned boolean,
  conflict_code text,
  trailer_id uuid,
  trailer_number text,
  restored_operational_status text,
  restored_compound_position text,
  load_status text,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_trailer record;
  v_event record;
  v_restored_status text;
  v_restored_position text;
  v_normalized_trailer_number text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and not public.is_active_operational_staff(array['administrator', 'supervisor', 'operator']) then
    raise exception 'Departure Undo permission denied.';
  end if;

  select trailer.id, trailer.trailer_number, trailer.departure_date, trailer.departure_time,
    trailer.compound_position, trailer.operational_status, trailer.load_status
  into v_trailer
  from public.trailers trailer
  where trailer.id = p_trailer_id
  for update;

  if not found then
    return query select false, 'not_found'::text, p_trailer_id, null::text, null::text, null::text, null::text, v_now;
    return;
  end if;

  if v_trailer.departure_date is null then
    return query select false, 'already_restored'::text, v_trailer.id, v_trailer.trailer_number,
      v_trailer.operational_status, v_trailer.compound_position, v_trailer.load_status, v_now;
    return;
  end if;

  if v_trailer.departure_date is distinct from p_expected_departure_at
    or lower(trim(coalesce(v_trailer.operational_status, ''))) <> 'departed' then
    return query select false, 'stale_state'::text, v_trailer.id, v_trailer.trailer_number,
      v_trailer.operational_status, v_trailer.compound_position, v_trailer.load_status, v_now;
    return;
  end if;

  select event.id, event.old_value, event.new_value, event.created_at
  into v_event
  from public.trailer_events event
  where event.trailer_id = v_trailer.id
    and event.event_type = 'departure_registered'
    and nullif(event.new_value ->> 'departure_date', '') is not null
    and (event.new_value ->> 'departure_date')::timestamptz = v_trailer.departure_date
  order by event.created_at desc, event.id desc
  limit 1;

  if not found then
    return query select false, 'history_not_found'::text, v_trailer.id, v_trailer.trailer_number,
      v_trailer.operational_status, v_trailer.compound_position, v_trailer.load_status, v_now;
    return;
  end if;

  v_restored_status := nullif(trim(v_event.old_value ->> 'operational_status'), '');
  v_restored_position := public.normalize_compound_position(v_event.old_value ->> 'compound_position');
  v_normalized_trailer_number := upper(regexp_replace(btrim(v_trailer.trailer_number), '\s+', ' ', 'g'));

  if nullif(trim(v_event.old_value ->> 'compound_position'), '') is not null
    and v_restored_position is null then
    return query select false, 'history_not_found'::text, v_trailer.id, v_trailer.trailer_number,
      v_trailer.operational_status, v_trailer.compound_position, v_trailer.load_status, v_now;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('active_trailer_number:' || v_normalized_trailer_number));

  if exists (
    select 1
    from public.trailers active_trailer
    where active_trailer.id <> v_trailer.id
      and active_trailer.departure_date is null
      and upper(regexp_replace(btrim(active_trailer.trailer_number), '\s+', ' ', 'g')) = v_normalized_trailer_number
  ) then
    return query select false, 'stale_state'::text, v_trailer.id, v_trailer.trailer_number,
      v_trailer.operational_status, v_trailer.compound_position, v_trailer.load_status, v_now;
    return;
  end if;

  if v_restored_position is not null then
    perform pg_advisory_xact_lock(hashtext('compound_position:' || v_restored_position));

    if exists (
      select 1
      from public.trailers occupied
      where occupied.id <> v_trailer.id
        and occupied.departure_date is null
        and coalesce(occupied.is_local, false) = false
        and public.normalize_compound_position(occupied.compound_position) = v_restored_position
    ) then
      return query select false, 'position_occupied'::text, v_trailer.id, v_trailer.trailer_number,
        v_trailer.operational_status, v_trailer.compound_position, v_trailer.load_status, v_now;
      return;
    end if;
  end if;

  begin
    update public.trailers
    set
      departure_date = null,
      departure_time = null,
      operational_status = v_restored_status,
      compound_position = v_restored_position
    where id = v_trailer.id;
  exception
    when unique_violation then
      return query select false, case when exists (
        select 1
        from public.trailers active_trailer
        where active_trailer.id <> v_trailer.id
          and active_trailer.departure_date is null
          and upper(regexp_replace(btrim(active_trailer.trailer_number), '\s+', ' ', 'g')) = v_normalized_trailer_number
      ) then 'stale_state' else 'position_occupied' end, v_trailer.id, v_trailer.trailer_number,
        v_trailer.operational_status, v_trailer.compound_position, v_trailer.load_status, v_now;
      return;
  end;

  insert into public.trailer_events (
    trailer_id, trailer_number, event_type, event_description, old_value, new_value, created_at, created_by
  ) values (
    v_trailer.id,
    v_trailer.trailer_number,
    'departure_undone',
    'Trailer departure was undone.',
    jsonb_build_object(
      'departure_date', v_trailer.departure_date,
      'departure_time', v_trailer.departure_time,
      'compound_position', v_trailer.compound_position,
      'operational_status', v_trailer.operational_status,
      'load_status', v_trailer.load_status
    ),
    jsonb_build_object(
      'departure_date', null,
      'departure_time', null,
      'compound_position', v_restored_position,
      'operational_status', v_restored_status,
      'load_status', v_trailer.load_status,
      'undo_target', 'departure_registered',
      'departure_event_id', v_event.id,
      'source_module', 'departure'
    ),
    v_now,
    p_performed_by
  );

  insert into public.trailer_activity_log (
    trailer_id, trailer_number, event_type, event_title, event_description,
    source_module, source_record_id, previous_status, new_status,
    previous_compound_position, new_compound_position, metadata, performed_by, created_at
  ) values (
    v_trailer.id,
    v_trailer.trailer_number,
    'movement_undone',
    'Departure undone',
    'Trailer departure was undone and its pre-departure state restored.',
    'operations',
    v_trailer.id,
    v_trailer.operational_status,
    v_restored_status,
    v_trailer.compound_position,
    v_restored_position,
    jsonb_build_object(
      'undo_target', 'departure_registered',
      'departure_event_id', v_event.id,
      'departure_date', v_trailer.departure_date,
      'load_status', v_trailer.load_status
    ),
    p_performed_by,
    v_now
  );

  return query select true, null::text, v_trailer.id, v_trailer.trailer_number,
    v_restored_status, v_restored_position, v_trailer.load_status, v_now;
end;
$$;

revoke execute on function public.undo_trailer_departure(uuid, timestamptz, text) from public;
revoke execute on function public.undo_trailer_departure(uuid, timestamptz, text) from anon;
grant execute on function public.undo_trailer_departure(uuid, timestamptz, text) to authenticated;
grant execute on function public.undo_trailer_departure(uuid, timestamptz, text) to service_role;

commit;
