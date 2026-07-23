-- Sprint 14 extension: user role/status audit trail for RBAC administration.
-- Non-destructive migration to be executed manually in Supabase SQL editor.

create table if not exists public.app_user_role_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  previous_role_key text not null,
  new_role_key text not null,
  previous_is_active boolean not null,
  new_is_active boolean not null,
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint app_user_role_audit_log_previous_role_check check (previous_role_key in ('administrator', 'supervisor', 'operator', 'driver')),
  constraint app_user_role_audit_log_new_role_check check (new_role_key in ('administrator', 'supervisor', 'operator', 'driver'))
);

create index if not exists app_user_role_audit_log_user_id_idx
  on public.app_user_role_audit_log(user_id);

create index if not exists app_user_role_audit_log_changed_by_idx
  on public.app_user_role_audit_log(changed_by);

create index if not exists app_user_role_audit_log_changed_at_idx
  on public.app_user_role_audit_log(changed_at desc);

alter table if exists public.app_user_role_audit_log enable row level security;

drop policy if exists "Authenticated users can read app_user_role_audit_log" on public.app_user_role_audit_log;
create policy "Authenticated users can read app_user_role_audit_log"
  on public.app_user_role_audit_log
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert app_user_role_audit_log" on public.app_user_role_audit_log;
create policy "Authenticated users can insert app_user_role_audit_log"
  on public.app_user_role_audit_log
  for insert
  to authenticated
  with check (true);
