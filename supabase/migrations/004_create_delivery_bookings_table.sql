-- Ferryspeed TrailerHub delivery bookings table
-- Run this in the Supabase SQL Editor.

drop policy if exists "Authenticated users can read delivery_bookings" on public.delivery_bookings;
drop policy if exists "Authenticated users can insert delivery_bookings" on public.delivery_bookings;
drop policy if exists "Authenticated users can update delivery_bookings" on public.delivery_bookings;
drop policy if exists "Authenticated users can delete delivery_bookings" on public.delivery_bookings;

create table if not exists public.delivery_bookings (
  id uuid primary key default gen_random_uuid(),
  trailer_id uuid not null references trailers(id) on delete cascade,
  delivery_date date not null,
  delivery_time time,
  customer text,
  consignee text,
  delivery_location text,
  booking_reference text,
  escort_required boolean default false,
  status text not null default 'scheduled' check (status in ('scheduled', 'ready', 'on_delivery', 'delivered', 'waiting_collection', 'collected', 'cancelled')),
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.delivery_bookings enable row level security;

create policy "Authenticated users can read delivery_bookings"
  on public.delivery_bookings
  for select
  to authenticated
  using (true);

create policy "Authenticated users can insert delivery_bookings"
  on public.delivery_bookings
  for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update delivery_bookings"
  on public.delivery_bookings
  for update
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can delete delivery_bookings"
  on public.delivery_bookings
  for delete
  to authenticated
  using (true);
