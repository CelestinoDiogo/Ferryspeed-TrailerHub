-- Ferryspeed TrailerHub - Migration 016
-- Ensures vessel list confirmation RPC exists with correct signature,
-- idempotency guards, list metadata updates, and authenticated execute grants.

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
    raise exception 'Vessel operation not found.'
      using detail = format('No vessel_operations row for id %s.', p_vessel_operation_id),
            hint = 'Verify the operation id and refresh the page.';
  end if;

  if coalesce(v_operation.list_status, 'draft') = 'confirmed' then
    raise exception 'Vessel trailer list is already confirmed.'
      using detail = format('Operation %s was already confirmed at %s.', v_operation.id, coalesce(v_operation.list_confirmed_at::text, 'unknown time')),
            hint = 'Do not confirm twice. Refresh the page to see the confirmed state.';
  end if;

  if coalesce(v_operation.status, 'draft') = 'completed' then
    raise exception 'Completed vessel operations cannot be confirmed.'
      using detail = format('Operation %s has status completed.', v_operation.id),
            hint = 'Reopen or create a new operation if list confirmation is needed.';
  end if;

  update public.vessel_operations
  set
    list_status = 'confirmed',
    list_confirmed_at = now(),
    list_confirmed_by = coalesce(nullif(trim(p_confirmed_by), ''), list_confirmed_by, 'TrailerHub User'),
    updated_at = now()
  where id = p_vessel_operation_id;

  -- Only move expected list entries into the arrival queue.
  -- No active arrival records are created here.
  update public.vessel_operation_trailers
  set
    arrival_status = 'available_for_arrival',
    updated_at = now()
  where vessel_operation_id = p_vessel_operation_id
    and arrival_record_id is null
    and coalesce(arrival_status, 'expected') in ('expected', 'available_for_arrival')
    and coalesce(status, 'expected') not in ('cancelled', 'not_arrived', 'not_discharged');

  select *
  into v_operation
  from public.vessel_operations
  where id = p_vessel_operation_id;

  return v_operation;
end;
$$;

grant execute on function public.confirm_vessel_operation_list(uuid, text) to authenticated;
grant execute on function public.confirm_vessel_operation_list(uuid, text) to service_role;
