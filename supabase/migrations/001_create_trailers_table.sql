-- Ferryspeed TrailerHub trailers table
-- Run this in the Supabase SQL Editor.

create extension if not exists "pgcrypto";

drop policy if exists "Authenticated users can read trailers" on public.trailers;
drop policy if exists "Authenticated users can insert trailers" on public.trailers;
drop policy if exists "Authenticated users can update trailers" on public.trailers;
drop policy if exists "Authenticated users can delete trailers" on public.trailers;

create table if not exists public.trailers (
  id uuid primary key default gen_random_uuid(),
  trailer_number text not null,
  trailer_type text,
  load_status text check (load_status in ('Empty', 'Loaded')),
  load_description text,
  customer text,
  consignee text,
  container_number text,
  compound_position text,
  arrival_date timestamp with time zone,
  departure_date timestamp with time zone,
  notes text,
  created_at timestamp with time zone default now()
);

alter table public.trailers enable row level security;

create policy "Authenticated users can read trailers"
  on public.trailers
  for select
  to authenticated
  using (true);

create policy "Authenticated users can insert trailers"
  on public.trailers
  for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update trailers"
  on public.trailers
  for update
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can delete trailers"
  on public.trailers
  for delete
  to authenticated
  using (true);
Update the Dashboard to fetch live statistics from Supabase trailers table.
