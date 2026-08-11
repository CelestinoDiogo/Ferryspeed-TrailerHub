begin;

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  display_name text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.drivers enable row level security;

drop trigger if exists drivers_touch_updated_at on public.drivers;
create trigger drivers_touch_updated_at
before update on public.drivers
for each row execute function public.touch_updated_at_column();

drop policy if exists "Authenticated users can read drivers" on public.drivers;
drop policy if exists "Authenticated users can insert drivers" on public.drivers;
drop policy if exists "Authenticated users can update drivers" on public.drivers;
drop policy if exists "Authenticated users can delete drivers" on public.drivers;

create policy "Authenticated users can read drivers"
  on public.drivers
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_roles aur
      where aur.user_id = auth.uid()
        and aur.is_active = true
        and aur.role_key in ('administrator', 'supervisor', 'operator')
    )
    or (user_id = auth.uid() and active = true)
  );

create policy "Authenticated users can insert drivers"
  on public.drivers
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.app_user_roles aur
      where aur.user_id = auth.uid()
        and aur.is_active = true
        and aur.role_key in ('administrator', 'supervisor')
    )
  );

create policy "Authenticated users can update drivers"
  on public.drivers
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_roles aur
      where aur.user_id = auth.uid()
        and aur.is_active = true
        and aur.role_key in ('administrator', 'supervisor')
    )
  )
  with check (
    exists (
      select 1
      from public.app_user_roles aur
      where aur.user_id = auth.uid()
        and aur.is_active = true
        and aur.role_key in ('administrator', 'supervisor')
    )
  );

create policy "Authenticated users can delete drivers"
  on public.drivers
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_roles aur
      where aur.user_id = auth.uid()
        and aur.is_active = true
        and aur.role_key = 'administrator'
    )
  );

alter table public.delivery_bookings
  add column if not exists driver_id uuid references public.drivers(id) on delete set null;

create index if not exists idx_delivery_bookings_driver_id
  on public.delivery_bookings (driver_id);

drop policy if exists "Authenticated users can read delivery_bookings" on public.delivery_bookings;
drop policy if exists "Authenticated users can insert delivery_bookings" on public.delivery_bookings;
drop policy if exists "Authenticated users can update delivery_bookings" on public.delivery_bookings;
drop policy if exists "Authenticated users can delete delivery_bookings" on public.delivery_bookings;

create policy "Authenticated users can read delivery_bookings"
  on public.delivery_bookings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_roles aur
      where aur.user_id = auth.uid()
        and aur.is_active = true
        and aur.role_key in ('administrator', 'supervisor', 'operator')
    )
    or exists (
      select 1
      from public.drivers d
      where d.user_id = auth.uid()
        and d.active = true
        and d.id = driver_id
    )
  );

create policy "Authenticated users can insert delivery_bookings"
  on public.delivery_bookings
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.app_user_roles aur
      where aur.user_id = auth.uid()
        and aur.is_active = true
        and aur.role_key in ('administrator', 'supervisor', 'operator')
    )
  );

create policy "Authenticated users can update delivery_bookings"
  on public.delivery_bookings
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_roles aur
      where aur.user_id = auth.uid()
        and aur.is_active = true
        and aur.role_key in ('administrator', 'supervisor', 'operator')
    )
    or exists (
      select 1
      from public.drivers d
      where d.user_id = auth.uid()
        and d.active = true
        and d.id = driver_id
    )
  )
  with check (
    exists (
      select 1
      from public.app_user_roles aur
      where aur.user_id = auth.uid()
        and aur.is_active = true
        and aur.role_key in ('administrator', 'supervisor', 'operator')
    )
    or exists (
      select 1
      from public.drivers d
      where d.user_id = auth.uid()
        and d.active = true
        and d.id = driver_id
    )
  );

create policy "Authenticated users can delete delivery_bookings"
  on public.delivery_bookings
  for delete
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

insert into public.app_permission_modules (module_key, label)
values ('driver_mobile', 'Driver Mobile')
on conflict (module_key) do update
set label = excluded.label,
    updated_at = now();

insert into public.app_role_permissions (role_key, module_key, can_view, can_create, can_edit, can_delete, can_reports)
values ('driver', 'driver_mobile', true, false, false, false, false)
on conflict (role_key, module_key) do update
set can_view = excluded.can_view,
    can_create = excluded.can_create,
    can_edit = excluded.can_edit,
    can_delete = excluded.can_delete,
    can_reports = excluded.can_reports,
    updated_at = now();

commit;