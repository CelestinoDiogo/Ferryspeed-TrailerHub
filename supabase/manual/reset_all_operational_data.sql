-- Ferryspeed TrailerHub
-- Production-safe operational data reset
--
-- This script removes operational/test rows while preserving schema, master/reference data,
-- auth identities, functions, indexes, policies, migrations, and storage buckets.
--
-- IMPORTANT:
-- 1) Run manually in Supabase SQL Editor.
-- 2) No DROP statements, no TRUNCATE ... CASCADE, no DELETE from storage.objects.
-- 3) public.trailers rows are deleted; public.trailers table is preserved.
-- 4) public.company_trailers is never modified.

/*
===============================================================================
SECTION 0 - CONFIGURATION
===============================================================================
*/

-- Change true to false only after reviewing the dry-run results.
create temporary table if not exists pg_temp._reset_config (
  dry_run boolean not null
);

truncate pg_temp._reset_config;

insert into pg_temp._reset_config (dry_run)
values (true);

select
  dry_run,
  case
    when dry_run then 'DRY RUN MODE: preflight only, no data deleted.'
    else 'LIVE MODE: full transactional delete and verification will run.'
  end as mode_message
from pg_temp._reset_config;

/*
===============================================================================
SECTION 1 - TARGETS / PROTECTED LISTS
===============================================================================
*/

create temporary table if not exists pg_temp._targets (
  delete_order integer not null,
  schema_name text not null,
  table_name text not null
);

truncate pg_temp._targets;
insert into pg_temp._targets (delete_order, schema_name, table_name)
values
  (10,  'public', 'vessel_inspection_photos'),
  (20,  'public', 'vessel_inspection_damages'),
  (30,  'public', 'vessel_inspection_temperatures'),
  (35,  'public', 'compound_waiting_list'),
  (40,  'public', 'vessel_operation_reports'),
  (50,  'public', 'vessel_operation_trailers'),
  (60,  'public', 'vessel_operations'),
  (70,  'public', 'export_allocation_movements'),
  (80,  'public', 'export_allocation_events'),
  (90,  'public', 'export_allocations'),
  (100, 'public', 'delivery_bookings'),
  (110, 'public', 'arrivals'),
  (120, 'public', 'deliveries'),
  (130, 'public', 'collections'),
  (140, 'public', 'departures'),
  (150, 'public', 'operational_notifications'),
  (160, 'public', 'trailer_events'),
  (170, 'public', 'trailers');

create temporary table if not exists pg_temp._protected (
  schema_name text not null,
  table_name text not null,
  reason text not null
);

truncate pg_temp._protected;
insert into pg_temp._protected (schema_name, table_name, reason)
values
  ('public', 'company_trailers', 'Permanent master fleet'),
  ('auth', 'users', 'Auth identities'),
  ('public', 'profiles', 'Application user profiles'),
  ('public', 'customers', 'Reference/master data (if present)'),
  ('public', 'app_settings', 'Application settings (if present)'),
  ('public', 'settings', 'Application settings (if present)'),
  ('public', 'compound_configuration', 'Static compound config (if present)'),
  ('public', 'compound_settings', 'Static compound settings (if present)'),
  ('public', 'compound_positions', 'Static compound positions (if present)'),
  ('public', 'compound_position_definitions', 'Static compound positions (if present)'),
  ('supabase_migrations', 'schema_migrations', 'Migration history'),
  ('storage', 'buckets', 'Storage bucket definitions');

select
  delete_order,
  schema_name || '.' || table_name as target_table,
  to_regclass(format('%I.%I', schema_name, table_name)) is not null as exists_in_db
from pg_temp._targets
order by delete_order;

select
  schema_name || '.' || table_name as protected_table,
  reason,
  to_regclass(format('%I.%I', schema_name, table_name)) is not null as exists_in_db
from pg_temp._protected
order by 1;

/*
===============================================================================
SECTION 2 - PRE-FLIGHT
===============================================================================
*/

-- 2.1 FK inspection for deletion targets.
select
  ns_child.nspname || '.' || child.relname as child_table,
  con.conname as fk_name,
  ns_parent.nspname || '.' || parent.relname as parent_table,
  case con.confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    else con.confdeltype::text
  end as on_delete_action
from pg_constraint con
join pg_class child on child.oid = con.conrelid
join pg_namespace ns_child on ns_child.oid = child.relnamespace
join pg_class parent on parent.oid = con.confrelid
join pg_namespace ns_parent on ns_parent.oid = parent.relnamespace
where con.contype = 'f'
  and (
    (ns_child.nspname, child.relname) in (select schema_name, table_name from pg_temp._targets)
    or
    (ns_parent.nspname, parent.relname) in (select schema_name, table_name from pg_temp._targets)
  )
order by 1, 2;

-- 2.2 Row counts for every target before deletion.
create temporary table if not exists pg_temp._preflight_counts (
  table_fqn text not null,
  exists_in_db boolean not null,
  row_count bigint,
  note text
);

truncate pg_temp._preflight_counts;

do $$
declare
  r record;
  v_count bigint;
begin
  for r in
    select * from pg_temp._targets order by delete_order
  loop
    if to_regclass(format('%I.%I', r.schema_name, r.table_name)) is null then
      insert into pg_temp._preflight_counts (table_fqn, exists_in_db, row_count, note)
      values (r.schema_name || '.' || r.table_name, false, null, 'Table not present');
    else
      execute format('select count(*) from %I.%I', r.schema_name, r.table_name) into v_count;
      insert into pg_temp._preflight_counts (table_fqn, exists_in_db, row_count, note)
      values (r.schema_name || '.' || r.table_name, true, v_count, null);
    end if;
  end loop;
end
$$;

select *
from pg_temp._preflight_counts
order by table_fqn;

-- 2.3 Show every public.trailers record that will be removed.
create temporary table if not exists pg_temp._trailers_to_remove_preview (
  id uuid,
  trailer_number text,
  compound_position text,
  arrival_date timestamptz,
  departure_date timestamptz,
  is_local boolean,
  trailer_source text,
  external_company text,
  external_reference text,
  source_vessel_operation_trailer_id uuid
);

truncate pg_temp._trailers_to_remove_preview;

do $$
begin
  if to_regclass('public.trailers') is null then
    return;
  end if;

  insert into pg_temp._trailers_to_remove_preview (
    id,
    trailer_number,
    compound_position,
    arrival_date,
    departure_date,
    is_local,
    trailer_source,
    external_company,
    external_reference,
    source_vessel_operation_trailer_id
  )
  select
    t.id,
    t.trailer_number,
    t.compound_position,
    t.arrival_date,
    t.departure_date,
    t.is_local,
    t.trailer_source,
    t.external_company,
    t.external_reference,
    t.source_vessel_operation_trailer_id
  from public.trailers t;
end
$$;

select *
from pg_temp._trailers_to_remove_preview
order by trailer_number nulls last, id;

-- 2.4 Capture storage paths from inspection photo metadata.
-- Physical files are NOT deleted by SQL and must be removed manually via Storage API/CLI.
create temporary table if not exists pg_temp._storage_paths_to_delete (
  photo_id uuid,
  vessel_operation_id uuid,
  vessel_operation_trailer_id uuid,
  uploaded_at timestamptz,
  storage_path text,
  file_name text,
  note text
);

truncate pg_temp._storage_paths_to_delete;

do $$
begin
  if to_regclass('public.vessel_inspection_photos') is null then
    return;
  end if;

  insert into pg_temp._storage_paths_to_delete (
    photo_id,
    vessel_operation_id,
    vessel_operation_trailer_id,
    uploaded_at,
    storage_path,
    file_name,
    note
  )
  select
    p.id,
    p.vessel_operation_id,
    p.vessel_operation_trailer_id,
    p.uploaded_at,
    p.storage_path,
    p.file_name,
    'Delete physical file using Supabase Storage API/CLI (not SQL).' as note
  from public.vessel_inspection_photos p;
end
$$;

select *
from pg_temp._storage_paths_to_delete
order by uploaded_at nulls last, photo_id;

/*
===============================================================================
SECTION 3 - RESET TRANSACTION
===============================================================================
*/

create temporary table if not exists pg_temp._delete_results (
  table_fqn text not null,
  deleted_rows bigint,
  note text
);

truncate pg_temp._delete_results;

create temporary table if not exists pg_temp._status_messages (
  status_level text not null,
  status_message text not null,
  created_at timestamptz not null default now()
);

truncate pg_temp._status_messages;

begin;

do $$
declare
  v_dry_run boolean;
  v_conflict text;
  v_blocking_fk text;
  v_deleted bigint;
begin
  select dry_run into v_dry_run from pg_temp._reset_config limit 1;

  if v_dry_run then
    insert into pg_temp._status_messages (status_level, status_message)
    values ('INFO', 'DRY RUN COMPLETE - NO DATA DELETED');
    return;
  end if;

  -- Safety 1: protected tables must never be in the target list.
  if exists (
    select 1
    from pg_temp._targets t
    join pg_temp._protected p
      on p.schema_name = t.schema_name
     and p.table_name = t.table_name
  ) then
    raise exception 'Safety check failed: protected table appears in deletion target list.';
  end if;

  -- Safety 2: target deletes must not mutate protected tables via FK delete actions.
  select string_agg(
    format(
      '%s.%s -> %s.%s (%s)',
      ns_child.nspname,
      child.relname,
      ns_parent.nspname,
      parent.relname,
      case con.confdeltype
        when 'c' then 'ON DELETE CASCADE'
        when 'n' then 'ON DELETE SET NULL'
        when 'd' then 'ON DELETE SET DEFAULT'
        else con.confdeltype::text
      end
    ),
    E'\n'
  )
  into v_conflict
  from pg_constraint con
  join pg_class child on child.oid = con.conrelid
  join pg_namespace ns_child on ns_child.oid = child.relnamespace
  join pg_class parent on parent.oid = con.confrelid
  join pg_namespace ns_parent on ns_parent.oid = parent.relnamespace
  where con.contype = 'f'
    and (ns_child.nspname, child.relname) in (select schema_name, table_name from pg_temp._protected)
    and (ns_parent.nspname, parent.relname) in (select schema_name, table_name from pg_temp._targets)
    and con.confdeltype in ('c', 'n', 'd');

  if v_conflict is not null then
    raise exception using
      message = 'Safety check failed: deleting targets could mutate protected tables via FK actions.',
      detail = v_conflict;
  end if;

  -- Safety 3: abort on unexpected blocking FK references from non-target tables.
  select string_agg(
    format(
      '%s.%s -> %s.%s (%s)',
      ns_child.nspname,
      child.relname,
      ns_parent.nspname,
      parent.relname,
      con.conname
    ),
    E'\n'
  )
  into v_blocking_fk
  from pg_constraint con
  join pg_class child on child.oid = con.conrelid
  join pg_namespace ns_child on ns_child.oid = child.relnamespace
  join pg_class parent on parent.oid = con.confrelid
  join pg_namespace ns_parent on ns_parent.oid = parent.relnamespace
  where con.contype = 'f'
    and (ns_parent.nspname, parent.relname) in (select schema_name, table_name from pg_temp._targets)
    and (ns_child.nspname, child.relname) not in (
      select schema_name, table_name from pg_temp._targets
      union all
      select schema_name, table_name from pg_temp._protected
    )
    and ns_child.nspname not in ('pg_catalog', 'information_schema')
    and con.confdeltype in ('a', 'r');

  if v_blocking_fk is not null then
    raise exception using
      message = 'Safety check failed: non-target FK references may block safe reset.',
      detail = v_blocking_fk;
  end if;

  -- Explicit child-to-parent deletes, optional-table-safe.
  if to_regclass('public.vessel_inspection_photos') is not null then
    execute 'delete from public.vessel_inspection_photos';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.vessel_inspection_photos', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.vessel_inspection_photos', null, 'Table not present');
  end if;

  if to_regclass('public.vessel_inspection_damages') is not null then
    execute 'delete from public.vessel_inspection_damages';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.vessel_inspection_damages', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.vessel_inspection_damages', null, 'Table not present');
  end if;

  if to_regclass('public.vessel_inspection_temperatures') is not null then
    execute 'delete from public.vessel_inspection_temperatures';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.vessel_inspection_temperatures', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.vessel_inspection_temperatures', null, 'Table not present');
  end if;

  if to_regclass('public.compound_waiting_list') is not null then
    execute 'delete from public.compound_waiting_list';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.compound_waiting_list', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.compound_waiting_list', null, 'Table not present');
  end if;

  if to_regclass('public.vessel_operation_reports') is not null then
    execute 'delete from public.vessel_operation_reports';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.vessel_operation_reports', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.vessel_operation_reports', null, 'Table not present');
  end if;

  if to_regclass('public.vessel_operation_trailers') is not null then
    execute 'delete from public.vessel_operation_trailers';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.vessel_operation_trailers', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.vessel_operation_trailers', null, 'Table not present');
  end if;

  if to_regclass('public.vessel_operations') is not null then
    execute 'delete from public.vessel_operations';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.vessel_operations', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.vessel_operations', null, 'Table not present');
  end if;

  if to_regclass('public.export_allocation_movements') is not null then
    execute 'delete from public.export_allocation_movements';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.export_allocation_movements', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.export_allocation_movements', null, 'Table not present');
  end if;

  if to_regclass('public.export_allocation_events') is not null then
    execute 'delete from public.export_allocation_events';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.export_allocation_events', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.export_allocation_events', null, 'Table not present');
  end if;

  if to_regclass('public.export_allocations') is not null then
    execute 'delete from public.export_allocations';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.export_allocations', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.export_allocations', null, 'Table not present');
  end if;

  if to_regclass('public.delivery_bookings') is not null then
    execute 'delete from public.delivery_bookings';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.delivery_bookings', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.delivery_bookings', null, 'Table not present');
  end if;

  if to_regclass('public.arrivals') is not null then
    execute 'delete from public.arrivals';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.arrivals', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.arrivals', null, 'Table not present');
  end if;

  if to_regclass('public.deliveries') is not null then
    execute 'delete from public.deliveries';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.deliveries', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.deliveries', null, 'Table not present');
  end if;

  if to_regclass('public.collections') is not null then
    execute 'delete from public.collections';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.collections', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.collections', null, 'Table not present');
  end if;

  if to_regclass('public.departures') is not null then
    execute 'delete from public.departures';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.departures', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.departures', null, 'Table not present');
  end if;

  if to_regclass('public.operational_notifications') is not null then
    execute 'delete from public.operational_notifications';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.operational_notifications', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.operational_notifications', null, 'Table not present');
  end if;

  if to_regclass('public.trailer_events') is not null then
    execute 'delete from public.trailer_events';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.trailer_events', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.trailer_events', null, 'Table not present');
  end if;

  if to_regclass('public.trailers') is not null then
    execute 'delete from public.trailers';
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.trailers', v_deleted, 'All operational trailer rows removed; table preserved');
  else
    insert into pg_temp._delete_results values ('public.trailers', null, 'Table not present');
  end if;

  insert into pg_temp._status_messages (status_level, status_message)
  values ('INFO', 'LIVE RESET COMPLETE - OPERATIONAL DATA DELETED');
end
$$;

commit;

/*
===============================================================================
SECTION 4 - POST-RESET VERIFICATION
===============================================================================
*/

create temporary table if not exists pg_temp._verification (
  check_name text not null,
  exists_in_db boolean not null,
  row_count bigint,
  expected text not null,
  note text
);

truncate pg_temp._verification;

do $$
declare
  v_dry_run boolean;
  r record;
  v_count bigint;
  v_query text;
begin
  select dry_run into v_dry_run from pg_temp._reset_config limit 1;

  if v_dry_run then
    insert into pg_temp._verification
      (check_name, exists_in_db, row_count, expected, note)
    values
      ('post_reset_verification', true, null, 'SKIPPED_IN_DRY_RUN', 'Set dry_run=false to run post-reset verification.');
    return;
  end if;

  create temporary table if not exists pg_temp._verify_targets (
    check_name text not null,
    schema_name text not null,
    table_name text not null,
    expected text not null,
    note text
  );

  truncate pg_temp._verify_targets;

  insert into pg_temp._verify_targets (check_name, schema_name, table_name, expected, note)
  values
    ('public.trailers', 'public', 'trailers', '0', 'Operational trailer instances must be zero'),
    ('public.vessel_operations', 'public', 'vessel_operations', '0', 'Vessel operations must be zero'),
    ('public.vessel_operation_trailers', 'public', 'vessel_operation_trailers', '0', 'Vessel operation trailers must be zero'),
    ('public.vessel_operation_reports', 'public', 'vessel_operation_reports', '0', 'AI vessel report history must be zero'),
    ('public.vessel_inspection_photos', 'public', 'vessel_inspection_photos', '0', 'Inspection photo metadata must be zero'),
    ('public.vessel_inspection_damages', 'public', 'vessel_inspection_damages', '0', 'Inspection damages must be zero'),
    ('public.vessel_inspection_temperatures', 'public', 'vessel_inspection_temperatures', '0', 'Inspection temperatures must be zero'),
    ('public.compound_waiting_list', 'public', 'compound_waiting_list', '0', 'Waiting-for-compound queue must be zero'),
    ('public.export_allocations', 'public', 'export_allocations', '0', 'Export operations must be zero'),
    ('public.delivery_bookings', 'public', 'delivery_bookings', '0', 'Deliveries/collections must be zero'),
    ('public.trailer_events', 'public', 'trailer_events', '0', 'Operational history must be zero'),
    ('public.arrivals', 'public', 'arrivals', '0', 'Optional arrivals table should be zero when present'),
    ('public.deliveries', 'public', 'deliveries', '0', 'Optional deliveries table should be zero when present'),
    ('public.collections', 'public', 'collections', '0', 'Optional collections table should be zero when present'),
    ('public.departures', 'public', 'departures', '0', 'Optional departures table should be zero when present'),
    ('public.company_trailers', 'public', 'company_trailers', '> 0', 'Master fleet must remain populated'),
    ('auth.users', 'auth', 'users', '> 0', 'Auth users must remain populated');

  -- Dynamic optional-table-safe verification.
  for r in
    select *
    from pg_temp._verify_targets
    order by check_name
  loop
    if to_regclass(format('%I.%I', r.schema_name, r.table_name)) is null then
      insert into pg_temp._verification (check_name, exists_in_db, row_count, expected, note)
      values (r.check_name, false, null, r.expected, 'Table not present');
    else
      v_query := format('select count(*) from %I.%I', r.schema_name, r.table_name);
      execute v_query into v_count;

      insert into pg_temp._verification (check_name, exists_in_db, row_count, expected, note)
      values (r.check_name, true, v_count, r.expected, r.note);
    end if;
  end loop;
end
$$;

-- Guardrail index presence.
create temporary table if not exists pg_temp._index_verification (
  index_name text not null,
  index_present boolean not null
);

truncate pg_temp._index_verification;
insert into pg_temp._index_verification (index_name, index_present)
values
  ('public.idx_trailers_active_compound_position_unique', to_regclass('public.idx_trailers_active_compound_position_unique') is not null),
  ('public.idx_trailers_active_normalized_trailer_number_unique', to_regclass('public.idx_trailers_active_normalized_trailer_number_unique') is not null);

-- Function/RPC presence.
create temporary table if not exists pg_temp._function_verification (
  function_name text not null,
  exact_signature_present boolean,
  any_overload_present boolean not null
);

truncate pg_temp._function_verification;
insert into pg_temp._function_verification (function_name, exact_signature_present, any_overload_present)
values
  (
    'normalize_compound_position(text)',
    to_regprocedure('public.normalize_compound_position(text)') is not null,
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'normalize_compound_position')
  ),
  (
    'set_export_allocation_delivered_empty',
    null,
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'set_export_allocation_delivered_empty')
  ),
  (
    'undo_export_allocation_delivered_empty',
    null,
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'undo_export_allocation_delivered_empty')
  ),
  (
    'confirm_vessel_operation_list',
    null,
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'confirm_vessel_operation_list')
  ),
  (
    'reopen_vessel_operation_list',
    null,
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'reopen_vessel_operation_list')
  ),
  (
    'confirm_vessel_trailer_arrival',
    null,
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'confirm_vessel_trailer_arrival')
  );

/*
===============================================================================
SECTION 5 - OUTPUTS
===============================================================================
*/

select *
from pg_temp._delete_results
order by table_fqn;

select *
from pg_temp._verification
order by check_name;

select *
from pg_temp._index_verification
order by index_name;

select *
from pg_temp._function_verification
order by function_name;

select *
from pg_temp._storage_paths_to_delete
order by uploaded_at nulls last, photo_id;

select
  status_level,
  status_message,
  created_at
from pg_temp._status_messages
order by created_at, status_level;
