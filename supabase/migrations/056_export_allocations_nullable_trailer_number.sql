-- Align live export_allocations.trailer_number with unassigned allocation semantics.
-- trailer_id was made nullable in 055; production trailer_number remained NOT NULL.

alter table public.export_allocations
  alter column trailer_number drop not null;

comment on column public.export_allocations.trailer_number is
  'Linked trailer number snapshot. Null means the export job is unassigned and waiting for an operator to select a trailer.';
