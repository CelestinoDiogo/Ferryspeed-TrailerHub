-- Ferryspeed TrailerHub - Migration 041
-- Driver Mobile Sprint 2B: operational instructions.

begin;

create table if not exists public.driver_operational_instructions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  delivery_booking_id uuid null references public.delivery_bookings(id) on delete set null,
  trailer_id uuid null references public.trailers(id) on delete set null,
  trailer_number text null,
  instruction text not null,
  priority text not null default 'normal',
  sender_user_id uuid null references auth.users(id) on delete set null,
  sender_display_name text null,
  created_at timestamptz not null default now(),
  read_at timestamptz null,
  read_by uuid null references auth.users(id) on delete set null,
  constraint driver_operational_instructions_instruction_not_blank
    check (btrim(instruction) <> ''),
  constraint driver_operational_instructions_trailer_number_not_blank
    check (trailer_number is null or btrim(trailer_number) <> ''),
  constraint driver_operational_instructions_priority_check
    check (priority in ('normal', 'high', 'critical')),
  constraint driver_operational_instructions_read_pair_check
    check (
      (read_at is null and read_by is null)
      or (read_at is not null and read_by is not null)
    )
);

create index if not exists idx_driver_operational_instructions_driver_created
  on public.driver_operational_instructions (driver_id, created_at desc);

create index if not exists idx_driver_operational_instructions_recipient_created
  on public.driver_operational_instructions (recipient_user_id, created_at desc);

create index if not exists idx_driver_operational_instructions_unread
  on public.driver_operational_instructions (recipient_user_id, created_at desc)
  where read_at is null;

create index if not exists idx_driver_operational_instructions_booking
  on public.driver_operational_instructions (delivery_booking_id, created_at desc)
  where delivery_booking_id is not null;

create or replace function public.normalize_driver_operational_instruction_row()
returns trigger
language plpgsql
as $$
begin
  new.instruction := btrim(new.instruction);

  if new.trailer_number is not null then
    new.trailer_number := nullif(upper(btrim(new.trailer_number)), '');
  end if;

  if new.sender_display_name is not null then
    new.sender_display_name := nullif(btrim(new.sender_display_name), '');
  end if;

  new.priority := lower(btrim(coalesce(new.priority, 'normal')));

  if tg_op = 'UPDATE' then
    if new.driver_id is distinct from old.driver_id
      or new.recipient_user_id is distinct from old.recipient_user_id
      or new.delivery_booking_id is distinct from old.delivery_booking_id
      or new.trailer_id is distinct from old.trailer_id
      or new.trailer_number is distinct from old.trailer_number
      or new.instruction is distinct from old.instruction
      or new.priority is distinct from old.priority
      or new.sender_user_id is distinct from old.sender_user_id
      or new.sender_display_name is distinct from old.sender_display_name
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Operational instruction payload is immutable after creation.';
    end if;

    if old.read_at is not null and new.read_at is distinct from old.read_at then
      raise exception 'Instruction read timestamp cannot be changed once set.';
    end if;

    if old.read_by is not null and new.read_by is distinct from old.read_by then
      raise exception 'Instruction read actor cannot be changed once set.';
    end if;

    if old.read_at is null and new.read_at is not null then
      if auth.uid() is null or new.read_by is distinct from auth.uid() then
        raise exception 'Instruction read acknowledgement must match the authenticated user.';
      end if;
    end if;

    if new.read_at is null and new.read_by is not null then
      raise exception 'Instruction read actor requires a read timestamp.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists driver_operational_instructions_normalize_before_write on public.driver_operational_instructions;
create trigger driver_operational_instructions_normalize_before_write
before insert or update on public.driver_operational_instructions
for each row
execute function public.normalize_driver_operational_instruction_row();

alter table if exists public.driver_operational_instructions enable row level security;

drop policy if exists "Drivers can read own operational instructions" on public.driver_operational_instructions;
create policy "Drivers can read own operational instructions"
  on public.driver_operational_instructions
  for select
  to authenticated
  using (recipient_user_id = auth.uid());

drop policy if exists "Supervisors and admins can monitor operational instructions" on public.driver_operational_instructions;
create policy "Supervisors and admins can monitor operational instructions"
  on public.driver_operational_instructions
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

drop policy if exists "Supervisors and admins can create operational instructions" on public.driver_operational_instructions;
create policy "Supervisors and admins can create operational instructions"
  on public.driver_operational_instructions
  for insert
  to authenticated
  with check (
    sender_user_id = auth.uid()
    and exists (
      select 1
      from public.app_user_roles aur
      where aur.user_id = auth.uid()
        and aur.is_active = true
        and aur.role_key in ('administrator', 'supervisor')
    )
    and exists (
      select 1
      from public.drivers d
      where d.id = driver_id
        and d.user_id = recipient_user_id
        and d.active = true
    )
    and (
      delivery_booking_id is null
      or exists (
        select 1
        from public.delivery_bookings b
        where b.id = delivery_booking_id
          and b.driver_id = driver_id
      )
    )
  );

drop policy if exists "Direct updates to operational instructions are blocked" on public.driver_operational_instructions;
create policy "Direct updates to operational instructions are blocked"
  on public.driver_operational_instructions
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists "Deletes to operational instructions are blocked" on public.driver_operational_instructions;
create policy "Deletes to operational instructions are blocked"
  on public.driver_operational_instructions
  for delete
  to authenticated
  using (false);

create or replace function public.mark_driver_operational_instruction_read(
  p_instruction_id uuid
)
returns public.driver_operational_instructions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.driver_operational_instructions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user is required to mark instruction as read.';
  end if;

  update public.driver_operational_instructions
  set
    read_at = coalesce(read_at, now()),
    read_by = coalesce(read_by, auth.uid())
  where id = p_instruction_id
    and recipient_user_id = auth.uid()
  returning * into v_row;

  if found then
    return v_row;
  end if;

  select * into v_row
  from public.driver_operational_instructions
  where id = p_instruction_id
    and recipient_user_id = auth.uid()
  limit 1;

  if found then
    return v_row;
  end if;

  raise exception 'Operational instruction % was not found for the authenticated driver.', p_instruction_id;
end;
$$;

grant select, insert on public.driver_operational_instructions to authenticated, service_role;
grant execute on function public.mark_driver_operational_instruction_read(uuid) to authenticated, service_role;

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
      and tablename = 'driver_operational_instructions'
  ) then
    execute 'alter publication supabase_realtime add table public.driver_operational_instructions';
  end if;
end;
$$;

commit;
