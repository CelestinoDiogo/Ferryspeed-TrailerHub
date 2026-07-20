-- Align get_first_available_compound_position with occupancy logic used in app queries.
create or replace function public.get_first_available_compound_position()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select
    'P' || lpad(position_number::text, 2, '0')
  from generate_series(
    1,
    coalesce(
      (
        select physical_capacity
        from public.compound_settings
        order by created_at
        limit 1
      ),
      50
    )
  ) as position_number
  where not exists (
    select 1
    from public.trailers t
    where public.normalize_compound_position(t.compound_position)
          = 'P' || lpad(position_number::text, 2, '0')
      and t.departure_date is null
      and coalesce(t.active, true) = true
      and coalesce(t.is_local, false) = false
  )
  order by position_number
  limit 1;
$$;

grant execute
on function public.get_first_available_compound_position()
to authenticated, service_role;
