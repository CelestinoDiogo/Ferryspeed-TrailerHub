-- Ferryspeed TrailerHub — Migration 061
-- Additive escort operational flags for Export Operations and Deliveries.
-- Planned escort is separate from escort actually used at delivery.

alter table if exists public.export_allocations
  add column if not exists escort_needed boolean not null default false,
  add column if not exists delivered_with_escort boolean not null default false;

alter table if exists public.delivery_bookings
  add column if not exists delivered_with_escort boolean not null default false;

comment on column public.export_allocations.escort_needed is
  'Planned operational flag: escort is needed for this export allocation. Default no.';
comment on column public.export_allocations.delivered_with_escort is
  'Actual outcome: empty/export delivery was completed with escort.';
comment on column public.delivery_bookings.delivered_with_escort is
  'Actual outcome: delivery was completed with escort. Planned escort remains escort_required.';

update public.export_allocations
set escort_needed = false
where escort_needed is distinct from true;

update public.export_allocations
set delivered_with_escort = false
where delivered_with_escort is distinct from true;

update public.delivery_bookings
set delivered_with_escort = false
where delivered_with_escort is distinct from true;
