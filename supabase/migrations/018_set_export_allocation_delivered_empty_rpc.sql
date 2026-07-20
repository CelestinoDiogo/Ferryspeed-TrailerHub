-- Atomically move export allocation to delivered_empty and clear trailer compound position.
create or replace function public.set_export_allocation_delivered_empty(
  p_allocation_id uuid,
  p_expected_current_status text default 'allocated'
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
  v_trailer_id uuid;
  v_previous_compound_position text;
begin
  update public.export_allocations
  set
    status = 'delivered_empty',
    delivered_empty_at = v_now,
    updated_at = v_now
  where id = p_allocation_id
    and status = p_expected_current_status
  returning export_allocations.trailer_id into v_trailer_id;

  if not found then
    return query
    select false, null::uuid, null::text;
    return;
  end if;

  if v_trailer_id is not null then
    select t.compound_position
    into v_previous_compound_position
    from public.trailers t
    where t.id = v_trailer_id
    for update;

    update public.trailers
    set
      compound_position = null
    where id = v_trailer_id;
  end if;

  return query
  select true, v_trailer_id, v_previous_compound_position;
end;
$$;

grant execute on function public.set_export_allocation_delivered_empty(uuid, text) to authenticated;
