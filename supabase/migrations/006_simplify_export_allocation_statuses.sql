-- Simplify export allocation lifecycle statuses while preserving historical fields.

alter table if exists public.export_allocations
  add column if not exists delivered_empty_at timestamptz,
  add column if not exists waiting_loading_at timestamptz,
  add column if not exists collected_loaded_at timestamptz,
  add column if not exists completed_at timestamptz;

update public.export_allocations
set
  delivered_empty_at = coalesce(delivered_empty_at, collected_by_haulier_at),
  waiting_loading_at = coalesce(waiting_loading_at, loading_started_at),
  collected_loaded_at = coalesce(collected_loaded_at, loaded_at),
  completed_at = coalesce(completed_at, returned_at, shipped_at),
  status = case status
    when 'collected_by_haulier' then 'delivered_empty'
    when 'loading' then 'waiting_loading'
    when 'loaded' then 'collected_loaded'
    when 'returned' then 'completed'
    when 'shipped' then 'completed'
    else status
  end
where status in ('collected_by_haulier', 'loading', 'loaded', 'returned', 'shipped')
   or delivered_empty_at is null
   or waiting_loading_at is null
   or collected_loaded_at is null
   or completed_at is null;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'export_allocations'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format('alter table public.export_allocations drop constraint if exists %I', constraint_row.conname);
  end loop;
end $$;

alter table public.export_allocations
  add constraint export_allocations_status_check
  check (
    status in (
      'allocated',
      'delivered_empty',
      'waiting_loading',
      'collected_loaded',
      'completed',
      'cancelled'
    )
  );

create unique index if not exists idx_export_allocations_one_active_per_trailer
  on public.export_allocations (trailer_id)
  where status in ('allocated', 'delivered_empty', 'waiting_loading', 'collected_loaded');

create index if not exists idx_export_allocations_status
  on public.export_allocations (status);
