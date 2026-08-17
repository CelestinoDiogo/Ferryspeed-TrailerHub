-- Allow the explicit Mark Arrived step to precede vessel reception.
-- A linked arrival_record_id remains the authoritative completed-reception guard.

begin;

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

  if v_row.arrival_record_id is not null then
    raise exception 'Arrival record already linked for this trailer.';
  end if;

  if coalesce(v_row.arrival_status, 'expected') not in ('available_for_arrival', 'arrived') then
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

revoke execute on function public.confirm_vessel_trailer_arrival(uuid, timestamptz, text, text, text, text, text, text, text, text, text, boolean) from public;
revoke execute on function public.confirm_vessel_trailer_arrival(uuid, timestamptz, text, text, text, text, text, text, text, text, text, boolean) from anon;
grant execute on function public.confirm_vessel_trailer_arrival(uuid, timestamptz, text, text, text, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.confirm_vessel_trailer_arrival(uuid, timestamptz, text, text, text, text, text, text, text, text, text, boolean) to service_role;

commit;