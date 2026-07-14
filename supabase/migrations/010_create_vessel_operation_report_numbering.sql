-- Ferryspeed TrailerHub — Migration 010
-- Adds safe server-side numbering for vessel operation reports.

create sequence if not exists public.vessel_operation_report_number_seq;

create or replace function public.next_vessel_operation_report_number()
returns text
language plpgsql
security definer
as $$
declare
  seq_value bigint;
  year_text text;
begin
  seq_value := nextval('public.vessel_operation_report_number_seq');
  year_text := to_char(now(), 'YYYY');

  return 'VOR-' || year_text || '-' || lpad(seq_value::text, 5, '0');
end;
$$;

grant execute on function public.next_vessel_operation_report_number() to authenticated;
grant execute on function public.next_vessel_operation_report_number() to service_role;
