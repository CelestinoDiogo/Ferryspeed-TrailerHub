-- Ferryspeed TrailerHub - Migration 049
-- Reconciles repository source with the Fleet RPC execute hardening applied manually.
-- This migration has already been applied manually and must not be rerun.

begin;

revoke execute
on function public.create_transport_job_with_event(jsonb, uuid)
from public;

revoke execute
on function public.create_transport_job_with_event(jsonb, uuid)
from anon;

grant execute
on function public.create_transport_job_with_event(jsonb, uuid)
to authenticated;

grant execute
on function public.create_transport_job_with_event(jsonb, uuid)
to service_role;

revoke execute
on function public.update_transport_job_with_event(uuid, jsonb, uuid)
from public;

revoke execute
on function public.update_transport_job_with_event(uuid, jsonb, uuid)
from anon;

grant execute
on function public.update_transport_job_with_event(uuid, jsonb, uuid)
to authenticated;

grant execute
on function public.update_transport_job_with_event(uuid, jsonb, uuid)
to service_role;

revoke execute
on function public.require_fleet_transport_actor(uuid)
from public;

revoke execute
on function public.require_fleet_transport_actor(uuid)
from anon;

revoke execute
on function public.require_fleet_transport_actor(uuid)
from authenticated;

revoke execute
on function public.prevent_transport_job_event_mutation()
from public;

revoke execute
on function public.prevent_transport_job_event_mutation()
from anon;

revoke execute
on function public.prevent_transport_job_event_mutation()
from authenticated;

commit;
