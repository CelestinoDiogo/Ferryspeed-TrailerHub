-- Ferryspeed TrailerHub - Migration 042
-- Driver Mobile Sprint 3: immutable driver quick response events.

begin;

create table if not exists public.driver_operational_instruction_events (
  id uuid primary key default gen_random_uuid(),
  instruction_id uuid not null references public.driver_operational_instructions(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  delivery_booking_id uuid null references public.delivery_bookings(id) on delete set null,
  trailer_id uuid null references public.trailers(id) on delete set null,
  trailer_number text null,
  event_type text not null,
  message text null,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint driver_instruction_events_type_check
    check (event_type in ('ok', 'arrived', 'delayed', 'problem', 'call_me')),
  constraint driver_instruction_events_message_not_blank
    check (message is null or btrim(message) <> ''),
  constraint driver_instruction_events_trailer_number_not_blank
    check (trailer_number is null or btrim(trailer_number) <> '')
);

create index if not exists idx_driver_instruction_events_instruction_created
  on public.driver_operational_instruction_events (instruction_id, created_at desc);

create index if not exists idx_driver_instruction_events_driver_created
  on public.driver_operational_instruction_events (driver_id, created_at desc);

create index if not exists idx_driver_instruction_events_booking_created
  on public.driver_operational_instruction_events (delivery_booking_id, created_at desc)
  where delivery_booking_id is not null;

create index if not exists idx_driver_instruction_events_exceptions_created
  on public.driver_operational_instruction_events (created_at desc)
  where event_type in ('delayed', 'problem', 'call_me');

create or replace function public.normalize_driver_instruction_event_row()
returns trigger
language plpgsql
as $$
begin
  new.event_type := lower(btrim(new.event_type));

  if new.trailer_number is not null then
    new.trailer_number := nullif(upper(btrim(new.trailer_number)), '');
  end if;

  if new.message is not null then
    new.message := nullif(btrim(new.message), '');
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'Driver instruction response events are immutable.';
  end if;

  return new;
end;
$$;

drop trigger if exists driver_instruction_events_normalize_before_write on public.driver_operational_instruction_events;
create trigger driver_instruction_events_normalize_before_write
before insert or update on public.driver_operational_instruction_events
for each row
execute function public.normalize_driver_instruction_event_row();

alter table if exists public.driver_operational_instruction_events enable row level security;

drop policy if exists "Drivers can read own instruction response events" on public.driver_operational_instruction_events;
create policy "Drivers can read own instruction response events"
  on public.driver_operational_instruction_events
  for select
  to authenticated
  using (recipient_user_id = auth.uid());

drop policy if exists "Supervisors and admins can monitor instruction response events" on public.driver_operational_instruction_events;
create policy "Supervisors and admins can monitor instruction response events"
  on public.driver_operational_instruction_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_roles aur
      where aur.user_id = auth.uid()
        and aur.is_active = true
        and aur.role_key in ('administrator', 'supervisor')
    )
  );

drop policy if exists "Drivers can create own instruction response events" on public.driver_operational_instruction_events;
create policy "Drivers can create own instruction response events"
  on public.driver_operational_instruction_events
  for insert
  to authenticated
  with check (
    created_by_user_id = auth.uid()
    and recipient_user_id = auth.uid()
    and exists (
      select 1
      from public.drivers d
      where d.id = driver_id
        and d.user_id = auth.uid()
        and d.active = true
    )
    and exists (
      select 1
      from public.driver_operational_instructions i
      where i.id = instruction_id
        and i.driver_id = driver_id
        and i.recipient_user_id = recipient_user_id
        and (delivery_booking_id is null or i.delivery_booking_id = delivery_booking_id)
        and (trailer_id is null or i.trailer_id = trailer_id)
    )
  );

drop policy if exists "Direct updates to instruction response events are blocked" on public.driver_operational_instruction_events;
create policy "Direct updates to instruction response events are blocked"
  on public.driver_operational_instruction_events
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists "Deletes to instruction response events are blocked" on public.driver_operational_instruction_events;
create policy "Deletes to instruction response events are blocked"
  on public.driver_operational_instruction_events
  for delete
  to authenticated
  using (false);

grant select, insert on public.driver_operational_instruction_events to authenticated, service_role;

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
