-- Ferryspeed TrailerHub - Migration 057
-- Add a dedicated physical vessel discharge timestamp.
-- Discharge and Compound reception are separate events and must not share a timestamp.

begin;

alter table public.vessel_operation_trailers
  add column if not exists discharged_at timestamptz;

comment on column public.vessel_operation_trailers.discharged_at is
  'Physical vessel discharge time. Set once when the operator marks the trailer arrived/discharged. Never overwritten by Compound reception.';

commit;
