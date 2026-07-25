-- Ferryspeed TrailerHub - Migration 034
-- Add a single compound-movement RPC so yard interactions can reuse the server-side position checks.

create or replace function public.move_compound_trailer(
  p_trailer_id uuid,
  p_target_position text,
  p_moved_by text default null,
  p_reason text default null
)
returns public.trailers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trailer public.trailers;
  v_target text;
  v_capacity integer;
begin
  select *
  into v_trailer
  from public.trailers
  where id = p_trailer_id
  for update;

  if not found then
    raise exception 'Trailer not found.';
  end if;

  v_target := public.normalize_compound_position(p_target_position);
  if v_target is null then
    raise exception 'Invalid compound position %.', p_target_position;
  end if;

  select physical_capacity
  into v_capacity
  from public.compound_settings
  where compound_name = 'Main Compound'
  limit 1;

  v_capacity := least(coalesce(v_capacity, 50), 99);
  if (regexp_replace(v_target, '[^0-9]', '', 'g'))::integer < 1
     or (regexp_replace(v_target, '[^0-9]', '', 'g'))::integer > v_capacity then
    raise exception 'Position % is outside the configured compound capacity of %.', v_target, v_capacity;
  end if;

  if exists (
    select 1
    from public.trailers t
    where t.id <> v_trailer.id
      and t.departure_date is null
      and coalesce(t.active, true) = true
      and coalesce(t.is_local, false) = false
      and public.normalize_compound_position(t.compound_position) = v_target
  ) then
    raise exception 'Compound position % is already occupied.', v_target;
  end if;

  if public.normalize_compound_position(v_trailer.compound_position) = v_target then
    return v_trailer;
  end if;

  update public.trailers
  set
    compound_position = v_target,
    active = true,
    operational_status = coalesce(v_trailer.operational_status, 'in_compound')
  where id = v_trailer.id
  returning *
  into v_trailer;

  return v_trailer;
end;
$$;

grant execute
on function public.move_compound_trailer(uuid, text, text, text)
to authenticated;
