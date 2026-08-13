-- Ferryspeed TrailerHub - Migration 044
-- Repair immutable Driver Communication response event security in place.

begin;

alter table public.driver_operational_instruction_events
  drop constraint if exists driver_instruction_events_type_check;

alter table public.driver_operational_instruction_events
  add constraint driver_instruction_events_type_check
  check (event_type in ('ok', 'arrived', 'completed', 'delayed', 'problem', 'call_me'))
  not valid;

alter table public.driver_operational_instruction_events
  validate constraint driver_instruction_events_type_check;

drop policy if exists "Drivers can create own instruction response events"
  on public.driver_operational_instruction_events;

create policy "Drivers can create own instruction response events"
  on public.driver_operational_instruction_events
  for insert
  to authenticated
  with check (
    public.driver_operational_instruction_events.created_by_user_id = auth.uid()
    and public.driver_operational_instruction_events.recipient_user_id = auth.uid()
    and exists (
      select 1
      from public.app_user_roles as driver_role
      where driver_role.user_id = auth.uid()
        and driver_role.role_key = 'driver'
        and driver_role.is_active = true
    )
    and exists (
      select 1
      from public.driver_operational_instructions as parent_instruction
      join public.drivers as owned_driver
        on owned_driver.id = parent_instruction.driver_id
      where parent_instruction.id = public.driver_operational_instruction_events.instruction_id
        and parent_instruction.driver_id = public.driver_operational_instruction_events.driver_id
        and parent_instruction.recipient_user_id = public.driver_operational_instruction_events.recipient_user_id
        and owned_driver.id = public.driver_operational_instruction_events.driver_id
        and owned_driver.user_id = auth.uid()
        and owned_driver.active = true
        and parent_instruction.delivery_booking_id
          is not distinct from public.driver_operational_instruction_events.delivery_booking_id
        and parent_instruction.trailer_id
          is not distinct from public.driver_operational_instruction_events.trailer_id
        and parent_instruction.trailer_number
          is not distinct from public.driver_operational_instruction_events.trailer_number
    )
  );

revoke all privileges on table public.driver_operational_instruction_events from anon;

revoke update, delete, truncate, references, trigger
  on table public.driver_operational_instruction_events
  from authenticated;

grant select, insert
  on table public.driver_operational_instruction_events
  to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'driver_operational_instruction_events'
  ) then
    execute 'alter publication supabase_realtime add table public.driver_operational_instruction_events';
  end if;
end;
$$;

commit;
