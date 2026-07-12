-- Ferryspeed TrailerHub — Migration 005
-- Adds collection tracking, demurrage and status timestamp fields to delivery_bookings.
-- Run this in the Supabase SQL Editor.
-- All changes are purely additive (no existing columns altered or removed).

-- ─── Collection & delivery timestamp fields ───────────────────────────────────

alter table public.delivery_bookings
  add column if not exists delivered_at            timestamptz,
  add column if not exists waiting_collection_since timestamptz,
  add column if not exists collection_due_date      date,
  add column if not exists collected_at             timestamptz;

-- ─── Demurrage fields ─────────────────────────────────────────────────────────

alter table public.delivery_bookings
  add column if not exists demurrage_free_days  integer      not null default 0,
  add column if not exists demurrage_daily_rate numeric(10,2),
  add column if not exists demurrage_currency   text         not null default 'GBP',
  add column if not exists demurrage_notes      text;

-- ─── Helpful index for waiting collection queries ─────────────────────────────

create index if not exists idx_delivery_bookings_status
  on public.delivery_bookings (status);

create index if not exists idx_delivery_bookings_waiting_collection_since
  on public.delivery_bookings (waiting_collection_since)
  where status = 'waiting_collection';
