-- Additive Stock Check Found RPC.
-- Records physical presence only. Does not resolve live trailer rows,
-- Compound positions, load/status, or historical sessions.

begin;

create or replace function public.mark_compound_stock_check_present(
  p_stock_check_id uuid,
  p_trailer_number text,
  p_checked_by text
)
returns table (
  stock_check_id uuid,
  stock_check_item_id uuid,
  trailer_number text,
  result text,
  checked_total integer,
  present_total integer,
  expected_total integer,
  remaining_total integer
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_trailer_number text := upper(trim(coalesce(p_trailer_number, '')));
  v_checked_by text := nullif(trim(coalesce(p_checked_by, '')), '');
  v_session public.compound_stock_checks%rowtype;
  v_item public.compound_stock_check_items%rowtype;
  v_item_found boolean := false;
  v_trailer_id uuid;
  v_trailer_load_status text;
  v_trailer_operational_status text;
  v_result text;
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

  if p_stock_check_id is null then
    raise exception 'Stock check not found.';
  end if;

  if v_trailer_number = '' then
    raise exception 'Trailer number is required.';
  end if;

  select *
  into v_session
  from public.compound_stock_checks
  where id = p_stock_check_id
  for update;

  if not found then
    raise exception 'Stock check not found.';
  end if;

  if v_session.status = 'cancelled' then
    raise exception 'Stock check is cancelled and cannot be changed.';
  end if;

  if v_session.status = 'completed' then
    raise exception 'This stock check is already completed.';
  end if;

  if v_session.status is distinct from 'in_progress' then
    raise exception 'This stock check is no longer in progress.';
  end if;

  select *
  into v_item
  from public.compound_stock_check_items
  where stock_check_id = p_stock_check_id
    and upper(trim(trailer_number)) = v_trailer_number
  order by
    case when expected_in_compound is true then 0 else 1 end,
    created_at asc
  limit 1
  for update;

  v_item_found := found;

  select
    t.id,
    t.load_status,
    t.operational_status
  into
    v_trailer_id,
    v_trailer_load_status,
    v_trailer_operational_status
  from public.trailers t
  where upper(trim(t.trailer_number)) = v_trailer_number
  order by t.created_at asc
  limit 1;

  if v_item_found and v_item.physically_present is true then
    v_result := 'already_present';
  elsif v_item_found and v_item.expected_in_compound is true then
    update public.compound_stock_check_items
    set
      physically_present = true,
      checked_at = coalesce(checked_at, v_now),
      checked_by = coalesce(nullif(trim(checked_by), ''), v_checked_by),
      discrepancy_type = case
        when discrepancy_type is null or discrepancy_type in ('unchecked', 'missing') then 'matched'
        else discrepancy_type
      end,
      updated_at = v_now
    where id = v_item.id
    returning * into v_item;

    v_result := 'marked_present';
  elsif v_item_found then
    update public.compound_stock_check_items
    set
      expected_in_compound = false,
      physically_present = true,
      checked_at = coalesce(checked_at, v_now),
      checked_by = coalesce(nullif(trim(checked_by), ''), v_checked_by),
      discrepancy_type = 'unexpected',
      trailer_id = coalesce(trailer_id, v_trailer_id),
      updated_at = v_now
    where id = v_item.id
    returning * into v_item;

    v_result := 'unexpected';
  else
    begin
      insert into public.compound_stock_check_items (
        stock_check_id,
        trailer_id,
        trailer_number,
        expected_in_compound,
        physically_present,
        expected_position,
        actual_position,
        system_load_status,
        system_operational_status,
        discrepancy_type,
        checked_at,
        checked_by,
        resolution_status,
        created_at,
        updated_at
      )
      values (
        p_stock_check_id,
        v_trailer_id,
        v_trailer_number,
        false,
        true,
        null,
        null,
        v_trailer_load_status,
        v_trailer_operational_status,
        'unexpected',
        v_now,
        v_checked_by,
        'unresolved',
        v_now,
        v_now
      )
      returning * into v_item;
    exception
      when unique_violation then
        select *
        into v_item
        from public.compound_stock_check_items
        where stock_check_id = p_stock_check_id
          and upper(trim(trailer_number)) = v_trailer_number
        order by created_at asc
        limit 1
        for update;

        if not found then
          raise exception 'Unable to record stock check presence.';
        end if;

        if v_item.physically_present is true then
          v_result := 'already_present';
        elsif v_item.expected_in_compound is true then
          update public.compound_stock_check_items
          set
            physically_present = true,
            checked_at = coalesce(checked_at, v_now),
            checked_by = coalesce(nullif(trim(checked_by), ''), v_checked_by),
            discrepancy_type = case
              when discrepancy_type is null or discrepancy_type in ('unchecked', 'missing') then 'matched'
              else discrepancy_type
            end,
            updated_at = v_now
          where id = v_item.id
          returning * into v_item;
          v_result := 'marked_present';
        else
          update public.compound_stock_check_items
          set
            physically_present = true,
            checked_at = coalesce(checked_at, v_now),
            checked_by = coalesce(nullif(trim(checked_by), ''), v_checked_by),
            discrepancy_type = 'unexpected',
            updated_at = v_now
          where id = v_item.id
          returning * into v_item;
          v_result := 'unexpected';
        end if;
    end;

    if v_result is null then
      v_result := 'unexpected';
    end if;
  end if;

  update public.compound_stock_checks
  set
    checked_total = (
      select count(*)::integer
      from public.compound_stock_check_items
      where stock_check_id = p_stock_check_id
        and (physically_present is not null or checked_at is not null)
    ),
    present_total = (
      select count(*)::integer
      from public.compound_stock_check_items
      where stock_check_id = p_stock_check_id
        and physically_present is true
    ),
    missing_total = (
      select count(*)::integer
      from public.compound_stock_check_items
      where stock_check_id = p_stock_check_id
        and expected_in_compound is true
        and physically_present is false
    ),
    unexpected_total = (
      select count(*)::integer
      from public.compound_stock_check_items
      where stock_check_id = p_stock_check_id
        and expected_in_compound is false
        and physically_present is true
    ),
    wrong_position_total = (
      select count(*)::integer
      from public.compound_stock_check_items
      where stock_check_id = p_stock_check_id
        and physically_present is not null
        and nullif(trim(expected_position), '') is not null
        and nullif(trim(actual_position), '') is not null
        and upper(trim(expected_position)) is distinct from upper(trim(actual_position))
    ),
    wrong_status_total = (
      select count(*)::integer
      from public.compound_stock_check_items
      where stock_check_id = p_stock_check_id
        and physically_present is not null
        and discrepancy_type in ('wrong_status', 'wrong_load_status')
    ),
    updated_at = v_now
  where id = p_stock_check_id
  returning * into v_session;

  return query
  select
    v_session.id,
    v_item.id,
    coalesce(v_item.trailer_number, v_trailer_number),
    v_result,
    v_session.checked_total,
    v_session.present_total,
    v_session.expected_total,
    (
      select count(*)::integer
      from public.compound_stock_check_items
      where stock_check_id = p_stock_check_id
        and expected_in_compound is true
        and physically_present is distinct from true
    );
end;
$$;

revoke all on function public.mark_compound_stock_check_present(uuid, text, text) from public;
revoke all on function public.mark_compound_stock_check_present(uuid, text, text) from anon;
grant execute on function public.mark_compound_stock_check_present(uuid, text, text) to authenticated;
grant execute on function public.mark_compound_stock_check_present(uuid, text, text) to service_role;

commit;
