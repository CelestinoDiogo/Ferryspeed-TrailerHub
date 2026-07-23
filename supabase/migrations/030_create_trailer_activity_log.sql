create table if not exists public.trailer_activity_log (
  id uuid primary key default gen_random_uuid(),
  trailer_id uuid null references public.trailers(id) on delete set null,
  trailer_number text not null,
  normalized_trailer_number text generated always as (upper(btrim(trailer_number))) stored,
  event_type text not null,
  event_title text not null,
  event_description text null,
  source_module text not null,
  source_record_id uuid null,
  previous_status text null,
  new_status text null,
  previous_compound_position text null,
  new_compound_position text null,
  metadata jsonb not null default '{}'::jsonb,
  performed_by text null,
  created_at timestamptz not null default now(),
  constraint trailer_activity_log_trailer_number_not_blank check (btrim(trailer_number) <> ''),
  constraint trailer_activity_log_event_type_not_blank check (btrim(event_type) <> ''),
  constraint trailer_activity_log_event_title_not_blank check (btrim(event_title) <> ''),
  constraint trailer_activity_log_source_module_not_blank check (btrim(source_module) <> '')
);

create or replace function public.normalize_trailer_activity_log_row()
returns trigger
language plpgsql
as $$
begin
  new.trailer_number := upper(btrim(new.trailer_number));

  if new.event_type is not null then
    new.event_type := btrim(new.event_type);
  end if;

  if new.event_title is not null then
    new.event_title := btrim(new.event_title);
  end if;

  if new.event_description is not null then
    new.event_description := nullif(btrim(new.event_description), '');
  end if;

  if new.source_module is not null then
    new.source_module := btrim(new.source_module);
  end if;

  if new.previous_status is not null then
    new.previous_status := nullif(btrim(new.previous_status), '');
  end if;

  if new.new_status is not null then
    new.new_status := nullif(btrim(new.new_status), '');
  end if;

  if new.previous_compound_position is not null then
    new.previous_compound_position := nullif(upper(btrim(new.previous_compound_position)), '');
  end if;

  if new.new_compound_position is not null then
    new.new_compound_position := nullif(upper(btrim(new.new_compound_position)), '');
  end if;

  if new.performed_by is not null then
    new.performed_by := nullif(btrim(new.performed_by), '');
  end if;

  if new.metadata is null then
    new.metadata := '{}'::jsonb;
  end if;

  return new;
end;
$$;

drop trigger if exists trailer_activity_log_normalize_before_write on public.trailer_activity_log;
create trigger trailer_activity_log_normalize_before_write
before insert or update on public.trailer_activity_log
for each row
execute function public.normalize_trailer_activity_log_row();

create index if not exists trailer_activity_log_trailer_id_idx
  on public.trailer_activity_log(trailer_id);

create index if not exists trailer_activity_log_normalized_trailer_number_idx
  on public.trailer_activity_log(normalized_trailer_number);

create index if not exists trailer_activity_log_created_at_desc_idx
  on public.trailer_activity_log(created_at desc);

create index if not exists trailer_activity_log_source_record_idx
  on public.trailer_activity_log(source_module, source_record_id);

create index if not exists trailer_activity_log_event_type_idx
  on public.trailer_activity_log(event_type);

alter table if exists public.trailer_activity_log enable row level security;

drop policy if exists "Authenticated users can read trailer_activity_log" on public.trailer_activity_log;
create policy "Authenticated users can read trailer_activity_log"
  on public.trailer_activity_log
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert trailer_activity_log" on public.trailer_activity_log;
create policy "Authenticated users can insert trailer_activity_log"
  on public.trailer_activity_log
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update trailer_activity_log" on public.trailer_activity_log;
create policy "Authenticated users can update trailer_activity_log"
  on public.trailer_activity_log
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can delete trailer_activity_log" on public.trailer_activity_log;
create policy "Authenticated users can delete trailer_activity_log"
  on public.trailer_activity_log
  for delete
  to authenticated
  using (true);