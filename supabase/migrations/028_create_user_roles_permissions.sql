-- Sprint 14 - User Management, Roles & Permissions
-- Minimal schema additions to support RBAC foundation.

create extension if not exists "pgcrypto";

create table if not exists public.app_roles (
  role_key text primary key,
  label text not null,
  description text,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_roles_role_key_check check (role_key in ('administrator', 'supervisor', 'operator', 'driver'))
);

create table if not exists public.app_permission_modules (
  module_key text primary key,
  label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_role_permissions (
  role_key text not null references public.app_roles(role_key) on delete cascade,
  module_key text not null references public.app_permission_modules(module_key) on delete cascade,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  can_reports boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (role_key, module_key)
);

create table if not exists public.app_user_roles (
  user_id uuid primary key,
  email text,
  display_name text,
  role_key text not null references public.app_roles(role_key),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_user_roles_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

create index if not exists app_user_roles_role_key_idx on public.app_user_roles(role_key);
create index if not exists app_role_permissions_module_key_idx on public.app_role_permissions(module_key);

insert into public.app_roles (role_key, label, description, is_system)
values
  ('administrator', 'Administrator', 'Full administrative access across all modules.', true),
  ('supervisor', 'Supervisor', 'Operational supervision with reporting and editing capabilities.', true),
  ('operator', 'Operator', 'Day-to-day operations access with limited administrative permissions.', true),
  ('driver', 'Driver', 'Read-focused access for assigned operational views.', true)
on conflict (role_key) do update
set
  label = excluded.label,
  description = excluded.description,
  is_system = excluded.is_system,
  updated_at = now();

insert into public.app_permission_modules (module_key, label)
values
  ('dashboard', 'Dashboard'),
  ('operations', 'Operations'),
  ('yard', 'Yard'),
  ('deliveries', 'Deliveries'),
  ('export_operations', 'Export Operations'),
  ('vessel_operations', 'Vessel Operations'),
  ('intelligence', 'Intelligence & Reports'),
  ('administration', 'Administration'),
  ('settings', 'Settings')
on conflict (module_key) do update
set
  label = excluded.label,
  updated_at = now();

insert into public.app_role_permissions (role_key, module_key, can_view, can_create, can_edit, can_delete, can_reports)
select
  role_key,
  module_key,
  true,
  true,
  true,
  true,
  true
from public.app_roles
cross join public.app_permission_modules
where role_key = 'administrator'
on conflict (role_key, module_key) do update
set
  can_view = excluded.can_view,
  can_create = excluded.can_create,
  can_edit = excluded.can_edit,
  can_delete = excluded.can_delete,
  can_reports = excluded.can_reports,
  updated_at = now();

insert into public.app_role_permissions (role_key, module_key, can_view, can_create, can_edit, can_delete, can_reports)
select
  role_key,
  module_key,
  true,
  true,
  true,
  false,
  true
from public.app_roles
cross join public.app_permission_modules
where role_key = 'supervisor'
on conflict (role_key, module_key) do update
set
  can_view = excluded.can_view,
  can_create = excluded.can_create,
  can_edit = excluded.can_edit,
  can_delete = excluded.can_delete,
  can_reports = excluded.can_reports,
  updated_at = now();

insert into public.app_role_permissions (role_key, module_key, can_view, can_create, can_edit, can_delete, can_reports)
select
  role_key,
  module_key,
  true,
  true,
  true,
  false,
  false
from public.app_roles
cross join public.app_permission_modules
where role_key = 'operator'
on conflict (role_key, module_key) do update
set
  can_view = excluded.can_view,
  can_create = excluded.can_create,
  can_edit = excluded.can_edit,
  can_delete = excluded.can_delete,
  can_reports = excluded.can_reports,
  updated_at = now();

insert into public.app_role_permissions (role_key, module_key, can_view, can_create, can_edit, can_delete, can_reports)
select
  role_key,
  module_key,
  true,
  false,
  false,
  false,
  false
from public.app_roles
cross join public.app_permission_modules
where role_key = 'driver'
on conflict (role_key, module_key) do update
set
  can_view = excluded.can_view,
  can_create = excluded.can_create,
  can_edit = excluded.can_edit,
  can_delete = excluded.can_delete,
  can_reports = excluded.can_reports,
  updated_at = now();

create or replace function public.touch_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_roles_touch_updated_at on public.app_roles;
create trigger app_roles_touch_updated_at
before update on public.app_roles
for each row execute function public.touch_updated_at_column();

drop trigger if exists app_permission_modules_touch_updated_at on public.app_permission_modules;
create trigger app_permission_modules_touch_updated_at
before update on public.app_permission_modules
for each row execute function public.touch_updated_at_column();

drop trigger if exists app_role_permissions_touch_updated_at on public.app_role_permissions;
create trigger app_role_permissions_touch_updated_at
before update on public.app_role_permissions
for each row execute function public.touch_updated_at_column();

drop trigger if exists app_user_roles_touch_updated_at on public.app_user_roles;
create trigger app_user_roles_touch_updated_at
before update on public.app_user_roles
for each row execute function public.touch_updated_at_column();

alter table if exists public.app_roles enable row level security;
alter table if exists public.app_permission_modules enable row level security;
alter table if exists public.app_role_permissions enable row level security;
alter table if exists public.app_user_roles enable row level security;

drop policy if exists "Authenticated users can read app_roles" on public.app_roles;
drop policy if exists "Authenticated users can mutate app_roles" on public.app_roles;
create policy "Authenticated users can read app_roles"
  on public.app_roles
  for select
  to authenticated
  using (true);
create policy "Authenticated users can mutate app_roles"
  on public.app_roles
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can read app_permission_modules" on public.app_permission_modules;
drop policy if exists "Authenticated users can mutate app_permission_modules" on public.app_permission_modules;
create policy "Authenticated users can read app_permission_modules"
  on public.app_permission_modules
  for select
  to authenticated
  using (true);
create policy "Authenticated users can mutate app_permission_modules"
  on public.app_permission_modules
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can read app_role_permissions" on public.app_role_permissions;
drop policy if exists "Authenticated users can mutate app_role_permissions" on public.app_role_permissions;
create policy "Authenticated users can read app_role_permissions"
  on public.app_role_permissions
  for select
  to authenticated
  using (true);
create policy "Authenticated users can mutate app_role_permissions"
  on public.app_role_permissions
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can read app_user_roles" on public.app_user_roles;
drop policy if exists "Authenticated users can mutate app_user_roles" on public.app_user_roles;
create policy "Authenticated users can read app_user_roles"
  on public.app_user_roles
  for select
  to authenticated
  using (true);
create policy "Authenticated users can mutate app_user_roles"
  on public.app_user_roles
  for all
  to authenticated
  using (true)
  with check (true);
