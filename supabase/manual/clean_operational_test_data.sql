-- Ferryspeed TrailerHub
-- Manual operational test-data reset script
--
-- IMPORTANT:
-- 1) Review all preflight outputs before changing dry_run to false.
-- 2) This script does NOT drop tables/functions/indexes/policies.
-- 3) This script does NOT delete auth.users, public.profiles, or public.company_trailers.
-- 4) Storage object files are NOT deleted by SQL here; only metadata is removed.
--
-- Intended execution: Supabase SQL Editor, manually.

/*
===============================================================================
SECTION 0 - CONFIGURATION
===============================================================================
*/

-- Default is DRY RUN mode.
-- Change true -> false ONLY after reviewing all preflight outputs.
create temporary table if not exists pg_temp._reset_config (
  dry_run boolean not null
);

truncate pg_temp._reset_config;

insert into pg_temp._reset_config (dry_run)
values (true);

select
  dry_run,
  case
    when dry_run then 'DRY RUN MODE: no DELETE statements will execute.'
    else 'LIVE MODE: DELETE statements will execute in one transaction.'
  end as mode_message
from pg_temp._reset_config;

/*
===============================================================================
SECTION A - PRE-FLIGHT INVENTORY (NO DATA CHANGES)
===============================================================================
*/

-- A1) Protected tables that must never be deleted by this script.
create temporary table if not exists pg_temp._protected_tables (
  schema_name text not null,
  table_name text not null,
  reason text not null
);

truncate pg_temp._protected_tables;
insert into pg_temp._protected_tables (schema_name, table_name, reason)
values
  ('auth', 'users', 'Supabase Auth users'),
  ('public', 'profiles', 'Application user profiles (if present)'),
  ('public', 'company_trailers', 'Master trailer fleet (must be preserved)'),
  ('public', 'customers', 'Reference/master customer data (if present)'),
  ('public', 'app_settings', 'Application settings (if present)'),
  ('public', 'settings', 'Application settings (if present)'),
  ('public', 'compound_configuration', 'Compound static configuration (if present)'),
  ('public', 'compound_positions', 'Compound position definitions (if present)'),
  ('public', 'compound_position_definitions', 'Compound position definitions (if present)'),
  ('storage', 'buckets', 'Supabase Storage buckets'),
  ('supabase_migrations', 'schema_migrations', 'Migration history');

select
  schema_name || '.' || table_name as protected_table,
  reason,
  to_regclass(format('%I.%I', schema_name, table_name)) is not null as exists_in_db
from pg_temp._protected_tables
order by 1;

-- A2) Target operational tables to be cleared.
create temporary table if not exists pg_temp._tables_to_clear (
  schema_name text not null,
  table_name text not null,
  purpose text not null,
  delete_order integer not null
);

truncate pg_temp._tables_to_clear;
insert into pg_temp._tables_to_clear (schema_name, table_name, purpose, delete_order)
values
  ('public', 'vessel_inspection_photos', 'Inspection photo metadata', 10),
  ('public', 'vessel_inspection_damages', 'Inspection damage records', 20),
  ('public', 'vessel_inspection_temperatures', 'Inspection temperature records', 30),
  ('public', 'vessel_operation_reports', 'AI vessel report drafts/history', 40),
  ('public', 'vessel_operation_trailers', 'Vessel operation trailer records', 50),
  ('public', 'vessel_operations', 'Vessel operations', 60),
  ('public', 'export_allocation_movements', 'Export allocation movement history (optional)', 70),
  ('public', 'export_allocation_events', 'Export allocation event history (optional)', 80),
  ('public', 'export_allocations', 'Export allocations', 90),
  ('public', 'delivery_bookings', 'Deliveries and collection workflow rows', 100),
  ('public', 'arrivals', 'Arrival records (optional)', 110),
  ('public', 'collections', 'Collection records (optional)', 120),
  ('public', 'departures', 'Departure records (optional)', 130),
  ('public', 'deliveries', 'Delivery records (optional)', 140),
  ('public', 'operational_notifications', 'Operational notifications (optional)', 150),
  ('public', 'trailer_events', 'Trailer movement/event history', 160),
  ('public', 'trailers', 'Operational trailer rows only (filtered delete)', 170);

select
  delete_order,
  schema_name || '.' || table_name as table_to_clear,
  purpose,
  to_regclass(format('%I.%I', schema_name, table_name)) is not null as exists_in_db
from pg_temp._tables_to_clear
order by delete_order;

-- A3) FK map for reviewed child -> parent dependencies in target scope.
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
    (ns_child.nspname = 'public' and child.relname in (select table_name from pg_temp._tables_to_clear where schema_name = 'public'))
    or
    (ns_parent.nspname = 'public' and parent.relname in (select table_name from pg_temp._tables_to_clear where schema_name = 'public'))
  )
order by 1, 2;

-- A4) Preflight row counts for every table that would be cleared.
create temporary table if not exists pg_temp._preflight_counts (
  table_fqn text not null,
  purpose text not null,
  exists_in_db boolean not null,
  row_count bigint,
  notes text
);

truncate pg_temp._preflight_counts;

do $$
declare
  r record;
  v_count bigint;
  v_sql text;
begin
  for r in
    select schema_name, table_name, purpose
    from pg_temp._tables_to_clear
    where not (schema_name = 'public' and table_name = 'trailers')
    order by delete_order
  loop
    if to_regclass(format('%I.%I', r.schema_name, r.table_name)) is null then
      insert into pg_temp._preflight_counts (table_fqn, purpose, exists_in_db, row_count, notes)
      values (r.schema_name || '.' || r.table_name, r.purpose, false, null, 'Table not present in this environment');
    else
      v_sql := format('select count(*) from %I.%I', r.schema_name, r.table_name);
      execute v_sql into v_count;

      insert into pg_temp._preflight_counts (table_fqn, purpose, exists_in_db, row_count, notes)
      values (r.schema_name || '.' || r.table_name, r.purpose, true, v_count, null);
    end if;
  end loop;
end
$$;

-- A5) Capture operational trailer IDs up-front.
-- This drives both dry-run preview and live deletion of public.trailers rows.
create temporary table if not exists pg_temp._operational_trailer_ids (
  trailer_id uuid primary key,
  source_reason text not null
);

truncate pg_temp._operational_trailer_ids;

do $$
begin
  -- IDs referenced by vessel workflow tables.
  if to_regclass('public.vessel_operation_trailers') is not null then
    insert into pg_temp._operational_trailer_ids (trailer_id, source_reason)
    select distinct trailer_id, 'referenced_by_vessel_operation_trailers.trailer_id'
    from public.vessel_operation_trailers
    where trailer_id is not null
    on conflict (trailer_id) do nothing;

    insert into pg_temp._operational_trailer_ids (trailer_id, source_reason)
    select distinct arrival_record_id, 'referenced_by_vessel_operation_trailers.arrival_record_id'
    from public.vessel_operation_trailers
    where arrival_record_id is not null
    on conflict (trailer_id) do nothing;
  end if;

  -- IDs referenced by delivery workflow rows.
  if to_regclass('public.delivery_bookings') is not null then
    insert into pg_temp._operational_trailer_ids (trailer_id, source_reason)
    select distinct trailer_id, 'referenced_by_delivery_bookings'
    from public.delivery_bookings
    where trailer_id is not null
    on conflict (trailer_id) do nothing;
  end if;

  -- IDs referenced by export allocations.
  if to_regclass('public.export_allocations') is not null then
    insert into pg_temp._operational_trailer_ids (trailer_id, source_reason)
    select distinct trailer_id, 'referenced_by_export_allocations'
    from public.export_allocations
    where trailer_id is not null
    on conflict (trailer_id) do nothing;
  end if;

  -- IDs referenced by trailer movement/events.
  if to_regclass('public.trailer_events') is not null then
    insert into pg_temp._operational_trailer_ids (trailer_id, source_reason)
    select distinct trailer_id, 'referenced_by_trailer_events'
    from public.trailer_events
    where trailer_id is not null
    on conflict (trailer_id) do nothing;
  end if;

  -- Operational/test row filter from public.trailers itself.
  if to_regclass('public.trailers') is not null then
    insert into pg_temp._operational_trailer_ids (trailer_id, source_reason)
    select
      t.id,
      'matched_operational_filter'
    from public.trailers t
    where
      t.source_vessel_operation_trailer_id is not null
      or nullif(btrim(coalesce(t.trailer_source, '')), '') is not null
      or nullif(btrim(coalesce(t.external_company, '')), '') is not null
      or nullif(btrim(coalesce(t.external_reference, '')), '') is not null
      or t.arrival_date is not null
      or t.departure_date is not null
      or coalesce(t.is_local, false) = true
      or nullif(btrim(coalesce(t.operational_status, '')), '') is not null
    on conflict (trailer_id) do nothing;
  end if;
end
$$;

-- Add filtered public.trailers count into preflight table.
insert into pg_temp._preflight_counts (table_fqn, purpose, exists_in_db, row_count, notes)
select
  'public.trailers (operational filter)' as table_fqn,
  'Operational trailer rows only' as purpose,
  to_regclass('public.trailers') is not null as exists_in_db,
  case
    when to_regclass('public.trailers') is null then null
    else (select count(*) from pg_temp._operational_trailer_ids)
  end as row_count,
  'Filter includes source link/source fields/external refs/arrival/departure/is_local/operational_status and FK-referenced trailer IDs' as notes;

select *
from pg_temp._preflight_counts
order by table_fqn;

-- A6) Preview every public.trailers record that would be deleted.
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
from public.trailers t
join pg_temp._operational_trailer_ids op
  on op.trailer_id = t.id
order by t.created_at nulls last, t.id;

-- A7) Storage file audit for vessel inspection photos.
-- Metadata rows in public.vessel_inspection_photos WILL be deleted in live mode.
-- Physical files in Supabase Storage are NOT deleted by SQL and must be removed via Storage API/CLI.
create temporary table if not exists pg_temp._storage_photo_audit (
  photo_id uuid,
  vessel_operation_id uuid,
  vessel_operation_trailer_id uuid,
  uploaded_at timestamptz,
  storage_path text,
  file_name text,
  bucket_id text,
  object_name text,
  object_found boolean,
  note text
);

truncate pg_temp._storage_photo_audit;

do $$
begin
  if to_regclass('public.vessel_inspection_photos') is null then
    return;
  end if;

  if to_regclass('storage.objects') is null then
    insert into pg_temp._storage_photo_audit (
      photo_id, vessel_operation_id, vessel_operation_trailer_id, uploaded_at, storage_path, file_name,
      bucket_id, object_name, object_found, note
    )
    select
      p.id,
      p.vessel_operation_id,
      p.vessel_operation_trailer_id,
      p.uploaded_at,
      p.storage_path,
      p.file_name,
      null,
      null,
      false,
      'storage.objects not visible here; remove file via Storage API using storage_path/file_name'
    from public.vessel_inspection_photos p;
  else
    insert into pg_temp._storage_photo_audit (
      photo_id, vessel_operation_id, vessel_operation_trailer_id, uploaded_at, storage_path, file_name,
      bucket_id, object_name, object_found, note
    )
    select
      p.id,
      p.vessel_operation_id,
      p.vessel_operation_trailer_id,
      p.uploaded_at,
      p.storage_path,
      p.file_name,
      o.bucket_id,
      o.name,
      (o.id is not null) as object_found,
      case
        when o.id is null then 'No exact storage.objects match by path/name; verify manually in Storage'
        else 'Delete this file through Storage API/CLI'
      end
    from public.vessel_inspection_photos p
    left join storage.objects o
      on o.name = p.storage_path
      or (p.file_name is not null and o.name = p.file_name);
  end if;
end
$$;

select *
from pg_temp._storage_photo_audit
order by uploaded_at nulls last, photo_id;

/*
===============================================================================
SECTION B - RESET (TRANSACTIONAL, DATA DELETE ONLY)
===============================================================================
*/

create temporary table if not exists pg_temp._delete_results (
  table_fqn text not null,
  deleted_rows bigint,
  notes text
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
  v_conflicts text;
  v_unexpected_fk text;
  v_deleted bigint;
  r record;
begin
  select dry_run into v_dry_run from pg_temp._reset_config limit 1;

  if v_dry_run then
    for r in
      select schema_name, table_name
      from pg_temp._tables_to_clear
      order by delete_order
    loop
      if r.schema_name = 'public' and r.table_name = 'trailers' then
        insert into pg_temp._delete_results (table_fqn, deleted_rows, notes)
        values (
          'public.trailers (operational filter)',
          (select count(*) from pg_temp._operational_trailer_ids),
          'DRY RUN: rows that would be deleted'
        );
      elsif to_regclass(format('%I.%I', r.schema_name, r.table_name)) is null then
        insert into pg_temp._delete_results (table_fqn, deleted_rows, notes)
        values (
          r.schema_name || '.' || r.table_name,
          null,
          'DRY RUN: table not present'
        );
      else
        execute format('select count(*) from %I.%I', r.schema_name, r.table_name) into v_deleted;
        insert into pg_temp._delete_results (table_fqn, deleted_rows, notes)
        values (
          r.schema_name || '.' || r.table_name,
          v_deleted,
          'DRY RUN: rows that would be deleted'
        );
      end if;
    end loop;

    insert into pg_temp._status_messages (status_level, status_message)
    values ('INFO', 'DRY RUN COMPLETE - NO DATA DELETED');

    return;
  end if;

  -- Safety assertion 1: never allow protected table in deletion list.
  if exists (
    select 1
    from pg_temp._tables_to_clear c
    join pg_temp._protected_tables p
      on p.schema_name = c.schema_name
     and p.table_name = c.table_name
  ) then
    raise exception 'Safety assertion failed: deletion list contains protected table(s).';
  end if;

  -- Safety assertion 2: abort if deleting target tables could mutate protected tables via FK delete actions.
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
  into v_conflicts
  from pg_constraint con
  join pg_class child on child.oid = con.conrelid
  join pg_namespace ns_child on ns_child.oid = child.relnamespace
  join pg_class parent on parent.oid = con.confrelid
  join pg_namespace ns_parent on ns_parent.oid = parent.relnamespace
  where con.contype = 'f'
    and (ns_child.nspname, child.relname) in (
      select schema_name, table_name from pg_temp._protected_tables
    )
    and (ns_parent.nspname, parent.relname) in (
      select schema_name, table_name from pg_temp._tables_to_clear
    )
    and con.confdeltype in ('c', 'n', 'd');

  if v_conflicts is not null then
    raise exception using
      message = 'Safety assertion failed: target deletes would mutate protected tables via FK actions.',
      detail = v_conflicts,
      hint = 'Review FK relationships before running live mode.';
  end if;

  -- Safety assertion 3: abort on unexpected FK references into target tables from non-target tables.
  -- This prevents accidental orphaning/blocking from unreviewed dependencies.
  select string_agg(
    format(
      '%s.%s -> %s.%s (constraint %s, action %s)',
      ns_child.nspname,
      child.relname,
      ns_parent.nspname,
      parent.relname,
      con.conname,
      case con.confdeltype
        when 'a' then 'NO ACTION'
        when 'r' then 'RESTRICT'
        when 'c' then 'CASCADE'
        when 'n' then 'SET NULL'
        when 'd' then 'SET DEFAULT'
        else con.confdeltype::text
      end
    ),
    E'\n'
  )
  into v_unexpected_fk
  from pg_constraint con
  join pg_class child on child.oid = con.conrelid
  join pg_namespace ns_child on ns_child.oid = child.relnamespace
  join pg_class parent on parent.oid = con.confrelid
  join pg_namespace ns_parent on ns_parent.oid = parent.relnamespace
  where con.contype = 'f'
    and (ns_parent.nspname, parent.relname) in (
      select schema_name, table_name from pg_temp._tables_to_clear
    )
    and (ns_child.nspname, child.relname) not in (
      select schema_name, table_name from pg_temp._tables_to_clear
      union all
      select schema_name, table_name from pg_temp._protected_tables
    )
    and ns_child.nspname not in ('pg_catalog', 'information_schema');

  if v_unexpected_fk is not null then
    raise exception using
      message = 'Safety assertion failed: unexpected FK dependencies reference target tables.',
      detail = v_unexpected_fk,
      hint = 'Audit these dependencies before live deletion.';
  end if;

  -- Execute explicit deletes in child -> parent order.
  if to_regclass('public.vessel_inspection_photos') is not null then
    delete from public.vessel_inspection_photos;
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.vessel_inspection_photos', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.vessel_inspection_photos', null, 'Table not present');
  end if;

  if to_regclass('public.vessel_inspection_damages') is not null then
    delete from public.vessel_inspection_damages;
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.vessel_inspection_damages', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.vessel_inspection_damages', null, 'Table not present');
  end if;

  if to_regclass('public.vessel_inspection_temperatures') is not null then
    delete from public.vessel_inspection_temperatures;
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.vessel_inspection_temperatures', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.vessel_inspection_temperatures', null, 'Table not present');
  end if;

  if to_regclass('public.vessel_operation_reports') is not null then
    delete from public.vessel_operation_reports;
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.vessel_operation_reports', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.vessel_operation_reports', null, 'Table not present');
  end if;

  if to_regclass('public.vessel_operation_trailers') is not null then
    delete from public.vessel_operation_trailers;
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.vessel_operation_trailers', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.vessel_operation_trailers', null, 'Table not present');
  end if;

  if to_regclass('public.vessel_operations') is not null then
    delete from public.vessel_operations;
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.vessel_operations', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.vessel_operations', null, 'Table not present');
  end if;

  if to_regclass('public.export_allocation_movements') is not null then
    delete from public.export_allocation_movements;
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.export_allocation_movements', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.export_allocation_movements', null, 'Table not present');
  end if;

  if to_regclass('public.export_allocation_events') is not null then
    delete from public.export_allocation_events;
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.export_allocation_events', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.export_allocation_events', null, 'Table not present');
  end if;

  if to_regclass('public.export_allocations') is not null then
    delete from public.export_allocations;
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.export_allocations', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.export_allocations', null, 'Table not present');
  end if;

  if to_regclass('public.delivery_bookings') is not null then
    delete from public.delivery_bookings;
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.delivery_bookings', v_deleted, 'Includes delivery/collection workflow rows');
  else
    insert into pg_temp._delete_results values ('public.delivery_bookings', null, 'Table not present');
  end if;

  if to_regclass('public.arrivals') is not null then
    delete from public.arrivals;
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.arrivals', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.arrivals', null, 'Table not present');
  end if;

  if to_regclass('public.collections') is not null then
    delete from public.collections;
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.collections', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.collections', null, 'Table not present');
  end if;

  if to_regclass('public.departures') is not null then
    delete from public.departures;
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.departures', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.departures', null, 'Table not present');
  end if;

  if to_regclass('public.deliveries') is not null then
    delete from public.deliveries;
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.deliveries', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.deliveries', null, 'Table not present');
  end if;

  if to_regclass('public.operational_notifications') is not null then
    delete from public.operational_notifications;
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.operational_notifications', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.operational_notifications', null, 'Table not present');
  end if;

  if to_regclass('public.trailer_events') is not null then
    delete from public.trailer_events;
    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values ('public.trailer_events', v_deleted, null);
  else
    insert into pg_temp._delete_results values ('public.trailer_events', null, 'Table not present');
  end if;

  if to_regclass('public.trailers') is not null then
    delete from public.trailers t
    using pg_temp._operational_trailer_ids op
    where t.id = op.trailer_id;

    get diagnostics v_deleted = row_count;
    insert into pg_temp._delete_results values (
      'public.trailers (operational filter)',
      v_deleted,
      'Deleted only captured operational IDs'
    );
  else
    insert into pg_temp._delete_results values ('public.trailers (operational filter)', null, 'Table not present');
  end if;

  -- Reset owned integer/bigint sequences for cleared tables only.
  for r in
    select distinct
      n.nspname as seq_schema,
      s.relname as seq_name
    from pg_class s
    join pg_namespace n on n.oid = s.relnamespace
    join pg_depend d on d.objid = s.oid and d.deptype = 'a'
    join pg_class t on t.oid = d.refobjid
    join pg_namespace nt on nt.oid = t.relnamespace
    where s.relkind = 'S'
      and (nt.nspname, t.relname) in (
        select schema_name, table_name
        from pg_temp._tables_to_clear
      )
  loop
    execute format('alter sequence %I.%I restart with 1', r.seq_schema, r.seq_name);
  end loop;

  insert into pg_temp._status_messages (status_level, status_message)
  values ('INFO', 'LIVE RESET COMPLETE - DATA DELETED');
end
$$;

commit;

/*
===============================================================================
SECTION C - POST-RUN VERIFICATION (OPTIONAL TABLE SAFE)
===============================================================================
*/

create temporary table if not exists pg_temp._verification_results (
  check_name text not null,
  table_fqn text,
  exists_in_db boolean not null,
  row_count bigint,
  expected text,
  note text
);

truncate pg_temp._verification_results;

do $$
declare
  r record;
  v_count bigint;
  v_sql text;
begin
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
    ('vessel_operations_zero', 'public', 'vessel_operations', '0', 'Vessel operations should be cleared'),
    ('vessel_operation_trailers_zero', 'public', 'vessel_operation_trailers', '0', 'Operational trailer rows should be cleared'),
    ('export_allocations_zero', 'public', 'export_allocations', '0', 'Export allocations should be cleared'),
    ('delivery_bookings_zero', 'public', 'delivery_bookings', '0', 'Deliveries/collections workflow rows should be cleared'),
    ('vessel_operation_reports_zero', 'public', 'vessel_operation_reports', '0', 'Report drafts/history should be cleared'),
    ('vessel_inspection_photos_zero', 'public', 'vessel_inspection_photos', '0', 'Photo metadata should be cleared'),
    ('vessel_inspection_damages_zero', 'public', 'vessel_inspection_damages', '0', 'Inspection damages should be cleared'),
    ('vessel_inspection_temperatures_zero', 'public', 'vessel_inspection_temperatures', '0', 'Inspection temperatures should be cleared'),
    ('trailer_events_zero', 'public', 'trailer_events', '0', 'Trailer movement/event history should be cleared'),
    ('arrivals_zero', 'public', 'arrivals', '0', 'Optional arrivals table should be cleared when present'),
    ('deliveries_zero', 'public', 'deliveries', '0', 'Optional deliveries table should be cleared when present'),
    ('collections_zero', 'public', 'collections', '0', 'Optional collections table should be cleared when present'),
    ('departures_zero', 'public', 'departures', '0', 'Optional departures table should be cleared when present'),
    ('operational_notifications_zero', 'public', 'operational_notifications', '0', 'Optional operational notifications should be cleared when present');

  for r in
    select *
    from pg_temp._verify_targets
    order by check_name
  loop
    if to_regclass(format('%I.%I', r.schema_name, r.table_name)) is null then
      insert into pg_temp._verification_results (check_name, table_fqn, exists_in_db, row_count, expected, note)
      values (r.check_name, r.schema_name || '.' || r.table_name, false, null, r.expected, 'Table not present');
    else
      v_sql := format('select count(*) from %I.%I', r.schema_name, r.table_name);
      execute v_sql into v_count;

      insert into pg_temp._verification_results (check_name, table_fqn, exists_in_db, row_count, expected, note)
      values (r.check_name, r.schema_name || '.' || r.table_name, true, v_count, r.expected, r.note);
    end if;
  end loop;

  -- Remaining operational trailers in public.trailers by current filter.
  if to_regclass('public.trailers') is null then
    insert into pg_temp._verification_results (check_name, table_fqn, exists_in_db, row_count, expected, note)
    values ('trailers_operational_remaining_zero', 'public.trailers (operational filter)', false, null, '0', 'public.trailers not present');
  else
    v_sql := $sql$
      select count(*)
      from public.trailers t
      where
        t.source_vessel_operation_trailer_id is not null
        or nullif(btrim(coalesce(t.trailer_source, '')), '') is not null
        or nullif(btrim(coalesce(t.external_company, '')), '') is not null
        or nullif(btrim(coalesce(t.external_reference, '')), '') is not null
        or t.arrival_date is not null
        or t.departure_date is not null
        or coalesce(t.is_local, false) = true
        or nullif(btrim(coalesce(t.operational_status, '')), '') is not null
    $sql$;
    execute v_sql into v_count;

    insert into pg_temp._verification_results (check_name, table_fqn, exists_in_db, row_count, expected, note)
    values (
      'trailers_operational_remaining_zero',
      'public.trailers (operational filter)',
      true,
      v_count,
      '0',
      'Operational/test trailer rows should be zero after live run'
    );
  end if;

  -- delivery_bookings statuses verification via dynamic SQL (optional-table-safe).
  if to_regclass('public.delivery_bookings') is null then
    insert into pg_temp._verification_results (check_name, table_fqn, exists_in_db, row_count, expected, note)
    values (
      'delivery_bookings_active_statuses_zero',
      'public.delivery_bookings',
      false,
      null,
      '0',
      'Table not present'
    );
  else
    v_sql := $$
      select count(*)
      from public.delivery_bookings
      where status in ('scheduled', 'ready', 'on_delivery', 'delivered', 'waiting_collection', 'collected')
    $$;
    execute v_sql into v_count;

    insert into pg_temp._verification_results (check_name, table_fqn, exists_in_db, row_count, expected, note)
    values (
      'delivery_bookings_active_statuses_zero',
      'public.delivery_bookings',
      true,
      v_count,
      '0',
      'Active workflow statuses should be zero'
    );
  end if;
end
$$;

-- Protected table counts (preservation checks).
create temporary table if not exists pg_temp._protected_counts (
  protected_table text not null,
  exists_in_db boolean not null,
  row_count bigint,
  note text
);

truncate pg_temp._protected_counts;

do $$
declare
  r record;
  v_count bigint;
  v_sql text;
begin
  create temporary table if not exists pg_temp._protected_count_targets (
    schema_name text not null,
    table_name text not null,
    note text
  );

  truncate pg_temp._protected_count_targets;

  insert into pg_temp._protected_count_targets (schema_name, table_name, note)
  values
    ('public', 'company_trailers', 'Must remain populated'),
    ('auth', 'users', 'Must not be deleted'),
    ('public', 'profiles', 'Must not be deleted when present'),
    ('public', 'app_settings', 'Settings/reference table should be preserved when present'),
    ('public', 'settings', 'Settings/reference table should be preserved when present'),
    ('supabase_migrations', 'schema_migrations', 'Migration history must remain');

  for r in
    select * from pg_temp._protected_count_targets
  loop
    if to_regclass(format('%I.%I', r.schema_name, r.table_name)) is null then
      insert into pg_temp._protected_counts (protected_table, exists_in_db, row_count, note)
      values (r.schema_name || '.' || r.table_name, false, null, 'Table not present');
    else
      v_sql := format('select count(*) from %I.%I', r.schema_name, r.table_name);
      execute v_sql into v_count;
      insert into pg_temp._protected_counts (protected_table, exists_in_db, row_count, note)
      values (r.schema_name || '.' || r.table_name, true, v_count, r.note);
    end if;
  end loop;
end
$$;

/*
===============================================================================
SECTION D - OUTPUTS
===============================================================================
*/

-- D1) Deletion results.
select *
from pg_temp._delete_results
order by table_fqn;

-- D2) Verification results.
select *
from pg_temp._verification_results
order by check_name;

-- D3) Protected table counts.
select *
from pg_temp._protected_counts
order by protected_table;

-- D4) Guardrail index verification.
select
  idx_name,
  to_regclass(idx_name) is not null as index_present
from (
  values
    ('public.idx_trailers_active_compound_position_unique'),
    ('public.idx_trailers_active_normalized_trailer_number_unique'),
    ('public.idx_export_allocations_one_active_per_trailer')
) as i(idx_name)
order by 1;

-- D5) RPC/function verification.
select
  function_name,
  to_regprocedure(function_signature) is not null as function_present
from (
  values
    ('normalize_compound_position', 'public.normalize_compound_position(text)'),
    ('confirm_vessel_operation_list', 'public.confirm_vessel_operation_list(uuid,text)'),
    ('reopen_vessel_operation_list', 'public.reopen_vessel_operation_list(uuid,text)'),
    ('confirm_vessel_trailer_arrival', 'public.confirm_vessel_trailer_arrival(uuid,timestamptz,text,text,text,text)'),
    ('next_vessel_operation_report_number', 'public.next_vessel_operation_report_number()'),
    ('set_export_allocation_delivered_empty', 'public.set_export_allocation_delivered_empty(uuid,text)'),
    ('undo_export_allocation_delivered_empty', 'public.undo_export_allocation_delivered_empty(uuid,text,text)')
) as f(function_name, function_signature)
order by 1;

-- D6) Storage files requiring manual deletion through Supabase Storage API/CLI.
select
  photo_id,
  storage_path,
  file_name,
  uploaded_at,
  bucket_id,
  object_name,
  object_found,
  note,
  'Delete physical file via Storage API/CLI. Do not DELETE from storage.objects directly.' as action_required
from pg_temp._storage_photo_audit
order by uploaded_at nulls last, photo_id;

-- D7) Final status.
select
  status_level,
  status_message,
  created_at
from pg_temp._status_messages
order by created_at, status_level;
