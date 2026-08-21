-- Allow export allocations to exist before a trailer is assigned.
-- trailer_number is already nullable; only trailer_id is required today.

alter table public.export_allocations
  alter column trailer_id drop not null;

comment on column public.export_allocations.trailer_id is
  'Linked trailer. Null means the export job is unassigned and waiting for an operator to select a trailer.';

-- Existing unique index idx_export_allocations_one_active_per_trailer on (trailer_id)
-- where status in ('allocated', 'delivered_empty', 'waiting_loading', 'collected_loaded')
-- already allows multiple NULLs in PostgreSQL. Leave it unchanged so assigned
-- trailers remain one-active-export-per-trailer.

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

  if v_allocation.trailer_id is null then
    raise exception 'Assign a trailer before continuing this operation.';
  end if;

  select t.id, t.trailer_number, t.compound_position, t.load_status
  into v_trailer
  from public.trailers t
  where t.id = v_allocation.trailer_id
  for update;

  if not found then
    raise exception 'Linked trailer not found.';
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

  update public.trailers
  set
    load_status = v_required_load_status,
    compound_position = case when p_target_status = 'delivered_empty' then null else compound_position end
  where id = v_allocation.trailer_id;

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
