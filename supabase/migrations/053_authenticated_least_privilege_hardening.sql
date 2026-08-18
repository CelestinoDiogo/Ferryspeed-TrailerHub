-- Remove non-DML privileges that are unnecessary for authenticated application traffic.
-- Existing RLS policies and legitimate SELECT/INSERT/UPDATE/DELETE grants remain unchanged.

begin;

revoke truncate, references, trigger on table
  public.trailers,
  public.delivery_bookings,
  public.export_allocations,
  public.vessel_operations,
  public.vessel_operation_trailers,
  public.trailer_events,
  public.trailer_activity_log
from authenticated;

commit;