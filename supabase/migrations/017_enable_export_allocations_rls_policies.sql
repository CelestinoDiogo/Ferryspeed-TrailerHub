-- Export allocations RLS policies (idempotent)
-- Safe to run multiple times.
-- Preserves existing data and does not alter table structure.

alter table if exists public.export_allocations enable row level security;

drop policy if exists "Authenticated users can read export_allocations" on public.export_allocations;
drop policy if exists "Authenticated users can insert export_allocations" on public.export_allocations;
drop policy if exists "Authenticated users can update export_allocations" on public.export_allocations;
drop policy if exists "Authenticated users can delete export_allocations" on public.export_allocations;

create policy "Authenticated users can read export_allocations"
  on public.export_allocations
  for select
  to authenticated
  using (true);

create policy "Authenticated users can insert export_allocations"
  on public.export_allocations
  for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update export_allocations"
  on public.export_allocations
  for update
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can delete export_allocations"
  on public.export_allocations
  for delete
  to authenticated
  using (true);

-- Note:
-- The update policy permits authenticated updates to status and timestamp columns,
-- including allocated_at, delivered_empty_at, waiting_loading_at,
-- collected_loaded_at, completed_at, and cancelled_at.