-- Ferryspeed TrailerHub - Migration 045
-- Driver Communications translation cache/storage foundation.
-- Canonical instruction and response event text remains unchanged.

begin;

create table if not exists public.driver_operational_instruction_translations (
  id uuid primary key default gen_random_uuid(),
  instruction_id uuid not null references public.driver_operational_instructions(id) on delete cascade,
  target_language text not null,
  translated_text text null,
  source_text_hash text not null,
  provider text null,
  model text null,
  translation_status text not null default 'translated',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_instruction_translations_language_check
    check (target_language in ('en', 'pt', 'lv', 'ru')),
  constraint driver_instruction_translations_hash_not_blank
    check (btrim(source_text_hash) <> ''),
  constraint driver_instruction_translations_status_check
    check (translation_status in ('translated', 'failed')),
  constraint driver_instruction_translations_text_check
    check (translation_status = 'failed' or (translated_text is not null and btrim(translated_text) <> '')),
  constraint driver_instruction_translations_lookup_unique
    unique (instruction_id, target_language, source_text_hash)
);

create index if not exists idx_driver_instruction_translations_instruction_language
  on public.driver_operational_instruction_translations (instruction_id, target_language, updated_at desc);

create table if not exists public.driver_operational_instruction_event_translations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.driver_operational_instruction_events(id) on delete cascade,
  target_language text not null,
  translated_text text null,
  source_text_hash text not null,
  provider text null,
  model text null,
  translation_status text not null default 'translated',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_instruction_event_translations_language_check
    check (target_language in ('en', 'pt', 'lv', 'ru')),
  constraint driver_instruction_event_translations_hash_not_blank
    check (btrim(source_text_hash) <> ''),
  constraint driver_instruction_event_translations_status_check
    check (translation_status in ('translated', 'failed')),
  constraint driver_instruction_event_translations_text_check
    check (translation_status = 'failed' or (translated_text is not null and btrim(translated_text) <> '')),
  constraint driver_instruction_event_translations_lookup_unique
    unique (event_id, target_language, source_text_hash)
);

create index if not exists idx_driver_instruction_event_translations_event_language
  on public.driver_operational_instruction_event_translations (event_id, target_language, updated_at desc);

create or replace function public.touch_driver_communication_translation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists driver_instruction_translations_updated_at on public.driver_operational_instruction_translations;
create trigger driver_instruction_translations_updated_at
before update on public.driver_operational_instruction_translations
for each row
execute function public.touch_driver_communication_translation_updated_at();

drop trigger if exists driver_instruction_event_translations_updated_at on public.driver_operational_instruction_event_translations;
create trigger driver_instruction_event_translations_updated_at
before update on public.driver_operational_instruction_event_translations
for each row
execute function public.touch_driver_communication_translation_updated_at();

alter table if exists public.driver_operational_instruction_translations enable row level security;
alter table if exists public.driver_operational_instruction_event_translations enable row level security;

drop policy if exists "Drivers can read own instruction translations" on public.driver_operational_instruction_translations;
create policy "Drivers can read own instruction translations"
  on public.driver_operational_instruction_translations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.driver_operational_instructions instruction
      join public.drivers owned_driver on owned_driver.id = instruction.driver_id
      where instruction.id = driver_operational_instruction_translations.instruction_id
        and instruction.recipient_user_id = auth.uid()
        and owned_driver.user_id = auth.uid()
        and owned_driver.active = true
    )
  );

drop policy if exists "Supervisors and admins can read instruction translations" on public.driver_operational_instruction_translations;
create policy "Supervisors and admins can read instruction translations"
  on public.driver_operational_instruction_translations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_roles role_row
      where role_row.user_id = auth.uid()
        and role_row.is_active = true
        and role_row.role_key in ('administrator', 'supervisor')
    )
  );

drop policy if exists "Drivers can read own instruction event translations" on public.driver_operational_instruction_event_translations;
create policy "Drivers can read own instruction event translations"
  on public.driver_operational_instruction_event_translations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.driver_operational_instruction_events event_row
      join public.drivers owned_driver on owned_driver.id = event_row.driver_id
      where event_row.id = driver_operational_instruction_event_translations.event_id
        and event_row.recipient_user_id = auth.uid()
        and owned_driver.user_id = auth.uid()
        and owned_driver.active = true
    )
  );

drop policy if exists "Supervisors and admins can read instruction event translations" on public.driver_operational_instruction_event_translations;
create policy "Supervisors and admins can read instruction event translations"
  on public.driver_operational_instruction_event_translations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_roles role_row
      where role_row.user_id = auth.uid()
        and role_row.is_active = true
        and role_row.role_key in ('administrator', 'supervisor')
    )
  );

revoke all privileges on table public.driver_operational_instruction_translations from anon;
revoke all privileges on table public.driver_operational_instruction_event_translations from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.driver_operational_instruction_translations
  from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.driver_operational_instruction_event_translations
  from authenticated;
grant select on table public.driver_operational_instruction_translations to authenticated;
grant select on table public.driver_operational_instruction_event_translations to authenticated;
grant all privileges on table public.driver_operational_instruction_translations to service_role;
grant all privileges on table public.driver_operational_instruction_event_translations to service_role;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'driver_operational_instruction_translations'
    ) then
      execute 'alter publication supabase_realtime add table public.driver_operational_instruction_translations';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'driver_operational_instruction_event_translations'
    ) then
      execute 'alter publication supabase_realtime add table public.driver_operational_instruction_event_translations';
    end if;
  end if;
end;
$$;

commit;
