-- Sprint 11: Production Stabilisation and Operational Readiness
-- Read-only audit queries. Review results before taking any corrective action.

-- 1) Duplicate active trailer numbers
select
  upper(trim(trailer_number)) as trailer_number_key,
  count(*) as active_count,
  array_agg(id order by created_at desc) as trailer_ids
from public.trailers
where departure_date is null
  and trailer_number is not null
  and trim(trailer_number) <> ''
group by upper(trim(trailer_number))
having count(*) > 1
order by active_count desc, trailer_number_key;

-- 2) Duplicate occupied compound positions
select
  upper(trim(compound_position)) as compound_position_key,
  count(*) as occupied_count,
  array_agg(id order by created_at desc) as trailer_ids
from public.trailers
where departure_date is null
  and compound_position is not null
  and trim(compound_position) <> ''
group by upper(trim(compound_position))
having count(*) > 1
order by occupied_count desc, compound_position_key;

-- 3) Active trailers with a departure date recorded
select
  id,
  trailer_number,
  load_status,
  operational_status,
  compound_position,
  departure_date,
  created_at,
  updated_at
from public.trailers
where departure_date is not null
  and coalesce(lower(operational_status), '') <> 'departed'
order by departure_date desc nulls last, trailer_number;

-- 4) Departed trailers still occupying compound positions
select
  id,
  trailer_number,
  load_status,
  operational_status,
  compound_position,
  departure_date,
  created_at,
  updated_at
from public.trailers
where departure_date is not null
  and compound_position is not null
  and trim(compound_position) <> ''
order by departure_date desc nulls last, trailer_number;

-- 5) Arrived vessel trailers missing a linked trailer record
select
  v.id as vessel_trailer_id,
  v.vessel_operation_id,
  v.trailer_id,
  v.trailer_number,
  v.arrival_status,
  v.arrived_at,
  v.inspection_started_at,
  v.inspection_completed_at,
  v.created_at
from public.vessel_operation_trailers v
left join public.trailers t on t.id = v.trailer_id
where lower(v.arrival_status) = 'arrived'
  and (v.trailer_id is null or t.id is null)
order by v.arrived_at desc nulls last, v.created_at desc nulls last;

-- 6) Completed inspections missing temperature readings or photos
with completed_inspections as (
  select
    v.id,
    v.vessel_operation_id,
    v.trailer_id,
    v.trailer_number,
    v.inspection_started_at,
    v.inspection_completed_at
  from public.vessel_operation_trailers v
  where v.inspection_completed_at is not null
     or lower(coalesce(v.status, '')) = 'inspected'
)
select
  c.id as vessel_trailer_id,
  c.vessel_operation_id,
  c.trailer_id,
  c.trailer_number,
  c.inspection_started_at,
  c.inspection_completed_at,
  count(distinct temp.id) as temperature_rows,
  count(distinct photo.id) as photo_rows
from completed_inspections c
left join public.vessel_inspection_temperatures temp on temp.vessel_trailer_id = c.id
left join public.vessel_inspection_photos photo on photo.vessel_trailer_id = c.id
group by c.id, c.vessel_operation_id, c.trailer_id, c.trailer_number, c.inspection_started_at, c.inspection_completed_at
having count(distinct temp.id) = 0
    or count(distinct photo.id) = 0
order by c.inspection_completed_at desc nulls last, c.trailer_number;

-- 7) Inspection photos missing trailer_number metadata
select
  id,
  vessel_trailer_id,
  trailer_id,
  vessel_operation_id,
  category,
  storage_path,
  file_name,
  uploaded_at,
  uploaded_by
from public.vessel_inspection_photos
where trailer_number is null
   or trim(trailer_number) = ''
order by uploaded_at desc nulls last, id desc;

-- 8) Export allocations inconsistent with trailer state
select
  e.id as export_allocation_id,
  e.trailer_id,
  e.trailer_number,
  e.status,
  e.collection_date,
  e.expected_return_at,
  t.departure_date,
  t.compound_position,
  t.operational_status,
  t.load_status
from public.export_allocations e
left join public.trailers t on t.id = e.trailer_id
where e.status in ('allocated', 'delivered_empty', 'waiting_loading', 'collected_loaded')
  and (
    e.trailer_id is null
    or t.id is null
    or (t.departure_date is not null and e.status <> 'completed')
    or (t.departure_date is null and t.compound_position is null and e.status in ('allocated', 'waiting_loading'))
  )
order by e.updated_at desc nulls last, e.created_at desc nulls last;

-- 9) Unresolved stock check discrepancies
select
  id,
  stock_check_id,
  trailer_id,
  trailer_number,
  discrepancy_type,
  expected_position,
  actual_position,
  resolution_status,
  resolution_action,
  checked_at,
  resolved_at,
  resolved_by
from public.compound_stock_check_items
where discrepancy_type is not null
  and trim(discrepancy_type) <> ''
  and lower(coalesce(resolution_status, 'open')) not in ('resolved', 'closed')
order by checked_at desc nulls last, trailer_number;

-- 10) Orphaned inspection records
select 'vessel_inspection_damages' as source_table, id, vessel_trailer_id, trailer_id, trailer_number, vessel_operation_id, recorded_at
from public.vessel_inspection_damages
where vessel_trailer_id is null
   or trailer_id is null
   or trailer_number is null

union all

select 'vessel_inspection_temperatures' as source_table, id, vessel_trailer_id, trailer_id, trailer_number, null::uuid as vessel_operation_id, recorded_at
from public.vessel_inspection_temperatures
where vessel_trailer_id is null
   or trailer_id is null
   or trailer_number is null

union all

select 'vessel_inspection_photos' as source_table, id, vessel_trailer_id, trailer_id, trailer_number, vessel_operation_id, uploaded_at as recorded_at
from public.vessel_inspection_photos
where vessel_trailer_id is null
   or trailer_id is null
   or trailer_number is null
order by recorded_at desc nulls last, source_table, id;

-- 11) History records missing trailer references
select
  id,
  trailer_id,
  trailer_number,
  normalized_trailer_number,
  event_type,
  event_title,
  source_module,
  source_record_id,
  previous_status,
  new_status,
  previous_compound_position,
  new_compound_position,
  performed_by,
  created_at
from public.trailer_activity_log
where trailer_id is null
   or trim(trailer_number) = ''
   or trim(normalized_trailer_number) = ''
order by created_at desc nulls last, id desc;
