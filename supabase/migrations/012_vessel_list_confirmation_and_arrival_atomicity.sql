-- Ferryspeed TrailerHub — Migration 012
-- Adds explicit vessel list confirmation workflow and atomic arrival confirmation guards.

alter table if exists public.vessel_operations
  add column if not exists list_status text not null default 'draft',
  add column if not exists list_confirmed_at timestamptz,
  add column if not exists list_confirmed_by text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vessel_operations_list_status_check'
  ) then
    alter table public.vessel_operations
      add constraint vessel_operations_list_status_check
      check (list_status in ('draft', 'confirmed', 'reopened'));
  end if;
end $$;

alter table if exists public.vessel_operation_trailers
  add column if not exists arrival_status text not null default 'expected',
  add column if not exists arrival_confirmed_at timestamptz,
  add column if not exists arrival_record_id uuid references public.trailers(id) on delete set null;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'vessel_operation_trailers'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%arrival_status%'
  loop
    execute format('alter table public.vessel_operation_trailers drop constraint if exists %I', constraint_row.conname);
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vessel_operation_trailers_arrival_status_v2_check'
  ) then
    alter table public.vessel_operation_trailers
      add constraint vessel_operation_trailers_arrival_status_v2_check
      check (arrival_status in ('expected', 'available_for_arrival', 'arrived', 'cancelled', 'not_discharged'));
  end if;
end $$;

alter table if exists public.trailers
  add column if not exists source_vessel_operation_trailer_id uuid
  references public.vessel_operation_trailers(id) on delete set null;

create unique index if not exists trailers_source_vessel_operation_trailer_unique
  on public.trailers(source_vessel_operation_trailer_id)
  where source_vessel_operation_trailer_id is not null;

create index if not exists idx_vessel_operation_trailers_arrival_queue
  on public.vessel_operation_trailers(vessel_operation_id, arrival_status)
  where arrival_record_id is null;

create or replace function public.confirm_vessel_operation_list(
  p_vessel_operation_id uuid,
  p_confirmed_by text default null
)
returns public.vessel_operations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.vessel_operations;
begin
  select *
  into v_operation
  from public.vessel_operations
  where id = p_vessel_operation_id
  for update;

  if not found then
    raise exception 'Vessel operation not found.';
  end if;

  update public.vessel_operations
  set
    list_status = 'confirmed',
    list_confirmed_at = now(),
    list_confirmed_by = coalesce(nullif(p_confirmed_by, ''), list_confirmed_by, 'TrailerHub User'),
    updated_at = now()
  where id = p_vessel_operation_id;

  update public.vessel_operation_trailers
  set
    arrival_status = 'available_for_arrival',
    updated_at = now()
  where vessel_operation_id = p_vessel_operation_id
    and coalesce(status, 'expected') not in ('cancelled')
    and coalesce(arrival_status, 'expected') in ('expected', 'available_for_arrival')
    and arrival_record_id is null;

  select *
  into v_operation
  from public.vessel_operations
  where id = p_vessel_operation_id;

  return v_operation;
end;
$$;

create or replace function public.reopen_vessel_operation_list(
  p_vessel_operation_id uuid,
  p_reopened_by text default null
)
returns public.vessel_operations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.vessel_operations;
begin
  select *
  into v_operation
  from public.vessel_operations
  where id = p_vessel_operation_id
  for update;

  if not found then
    raise exception 'Vessel operation not found.';
  end if;

  update public.vessel_operations
  set
    list_status = 'reopened',
    updated_at = now()
  where id = p_vessel_operation_id;

  update public.vessel_operation_trailers
  set
    arrival_status = 'expected',
    updated_at = now()
  where vessel_operation_id = p_vessel_operation_id
    and coalesce(arrival_status, 'expected') = 'available_for_arrival'
    and arrival_record_id is null
    and coalesce(status, 'expected') not in ('cancelled', 'not_discharged');

  select *
  into v_operation
  from public.vessel_operations
  where id = p_vessel_operation_id;

  return v_operation;
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
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_source_link_existing uuid;
  v_target_trailer_id uuid;
  v_source_note text;
  v_arrival_notes text;
begin
  select
    vot.*,
    vo.list_status,
    vo.vessel_name,
    vo.sailing_reference
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

  select id
  into v_target_trailer_id
  from public.trailers
  where upper(trim(trailer_number)) = upper(trim(v_row.trailer_number))
    and departure_date is null
  order by created_at desc
  limit 1
  for update;

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
      source_vessel_operation_trailer_id,
      is_local
    )
    values (
      v_row.trailer_number,
      coalesce(v_row.load_status, 'Empty'),
      v_row.load_description,
      v_row.customer,
      nullif(trim(p_compound_position), ''),
      nullif(v_arrival_notes, ''),
      p_received_at::date,
      'company',
      v_row.id,
      false
    )
    returning id into v_target_trailer_id;
  else
    update public.trailers
    set
      source_vessel_operation_trailer_id = v_row.id,
      arrival_date = coalesce(arrival_date, p_received_at::date),
      load_status = coalesce(v_row.load_status, load_status),
      load_description = coalesce(v_row.load_description, load_description),
      customer = coalesce(v_row.customer, customer),
      compound_position = coalesce(nullif(trim(p_compound_position), ''), compound_position),
      notes = concat_ws(E'\n', nullif(trim(notes), ''), nullif(v_arrival_notes, ''))
    where id = v_target_trailer_id;
  end if;

  update public.vessel_operation_trailers
  set
    arrival_record_id = v_target_trailer_id,
    arrival_status = 'arrived',
    arrival_confirmed_at = p_received_at,
    arrived_at = p_received_at,
    arrival_confirmed_by = coalesce(nullif(trim(p_confirmed_by), ''), 'TrailerHub User'),
    status = case when status = 'expected' then 'arrived' else status end,
    updated_at = now()
  where id = v_row.id;

  insert into public.trailer_events (
    trailer_id,
    trailer_number,
    event_type,
    event_description,
    old_value,
    new_value
  )
  values (
    v_target_trailer_id,
    v_row.trailer_number,
    'vessel_arrival_confirmed',
    'Arrival confirmed from vessel expected list.',
    jsonb_build_object(
      'vessel_operation_trailer_id',
      v_row.id,
      'arrival_status',
      v_row.arrival_status,
      'arrival_record_id',
      v_row.arrival_record_id
    ),
    jsonb_build_object(
      'vessel_operation_trailer_id',
      v_row.id,
      'arrival_status',
      'arrived',
      'arrival_record_id',
      v_target_trailer_id,
      'arrival_confirmed_at',
      p_received_at
    )
  );

  return v_target_trailer_id;
end;
$$;

grant execute on function public.confirm_vessel_operation_list(uuid, text) to authenticated;
grant execute on function public.reopen_vessel_operation_list(uuid, text) to authenticated;
grant execute on function public.confirm_vessel_trailer_arrival(uuid, timestamptz, text, text, text, text) to authenticated;
