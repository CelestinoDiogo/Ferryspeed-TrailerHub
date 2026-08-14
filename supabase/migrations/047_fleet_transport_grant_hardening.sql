-- Ferryspeed TrailerHub - Migration 047
-- Harden Fleet / Transport table privileges after Migration 046.
-- Fleet Sprint 1 has no hard-delete endpoint and does not consume realtime.

begin;

revoke all privileges on table public.fleet_transport_units from anon;
revoke all privileges on table public.transport_jobs from anon;

revoke delete, truncate, references, trigger
  on table public.fleet_transport_units
  from authenticated;
revoke delete, truncate, references, trigger
  on table public.transport_jobs
  from authenticated;

grant select, insert, update
  on table public.fleet_transport_units
  to authenticated;
grant select, insert, update
  on table public.transport_jobs
  to authenticated;

-- Do not add Fleet tables to supabase_realtime: Sprint 1 has no Fleet realtime consumer.
-- Existing RLS policies remain unchanged and enforce role-specific row access.

commit;
