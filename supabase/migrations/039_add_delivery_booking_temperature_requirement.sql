-- Ferryspeed TrailerHub - Migration 039
-- Adds authoritative delivery-level temperature requirement fields for Driver Mobile.

alter table if exists public.delivery_bookings
  add column if not exists temperature_required boolean not null default false,
  add column if not exists collected_temperature_c numeric;

create index if not exists idx_delivery_bookings_temperature_required
  on public.delivery_bookings (temperature_required);
