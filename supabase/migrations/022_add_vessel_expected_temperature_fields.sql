-- Ferryspeed TrailerHub - Migration 022
-- Adds front/rear expected temperature support for vessel trailers.
-- Backward compatibility:
-- 1) keep legacy temperature_required column
-- 2) map legacy values into expected_front_temperature when possible
-- 3) leave expected_rear_temperature optional

alter table if exists public.vessel_operation_trailers
  add column if not exists expected_front_temperature numeric,
  add column if not exists expected_rear_temperature numeric,
  add column if not exists expected_temperature_unit text;

update public.vessel_operation_trailers
set expected_temperature_unit = 'C'
where expected_temperature_unit is null;

-- Legacy value compatibility:
-- The legacy field was effectively used as the front expected temperature.
-- We only backfill when the legacy value can be parsed into a single numeric value.
with parsed_legacy as (
  select
    id,
    (regexp_match(coalesce(temperature_required, ''), '(-?\d+(?:\.\d+)?)'))[1]::numeric as parsed_front
  from public.vessel_operation_trailers
  where expected_front_temperature is null
    and nullif(btrim(coalesce(temperature_required, '')), '') is not null
    and coalesce(temperature_required, '') ~ '-?\d+(?:\.\d+)?'
)
update public.vessel_operation_trailers t
set expected_front_temperature = p.parsed_front
from parsed_legacy p
where t.id = p.id
  and t.expected_front_temperature is null;

create index if not exists idx_vessel_operation_trailers_expected_front_temperature
  on public.vessel_operation_trailers (expected_front_temperature);

create index if not exists idx_vessel_operation_trailers_expected_rear_temperature
  on public.vessel_operation_trailers (expected_rear_temperature);
