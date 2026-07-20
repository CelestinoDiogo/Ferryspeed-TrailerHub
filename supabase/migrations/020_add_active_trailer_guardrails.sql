-- Ferryspeed TrailerHub - Migration 020
-- Safe production guardrails for active trailer uniqueness.
-- This migration does NOT delete/merge/deactivate data.
-- It aborts with clear errors when unresolved duplicates exist.

-- 1) Ensure required base table exists.
do $$
begin
  if to_regclass('public.trailers') is null then
    raise exception 'Guardrail migration aborted: public.trailers does not exist.';
  end if;
end
$$;

-- 2) Normalize compound position parsing to match application logic (P01..P50).
create or replace function public.normalize_compound_position(p_value text)
returns text
language plpgsql
immutable
as $$
declare
  v_trimmed text;
  v_number int;
begin
  v_trimmed := upper(trim(coalesce(p_value, '')));

  if v_trimmed = '' then
    return null;
  end if;

  if v_trimmed !~ '^(P|A)?0*[0-9]{1,2}$' then
    return null;
  end if;

  v_number := regexp_replace(v_trimmed, '^(P|A)?0*([0-9]{1,2})$', '\2')::int;

  if v_number < 1 or v_number > 50 then
    return null;
  end if;

  return 'P' || lpad(v_number::text, 2, '0');
end
$$;

-- 3) Clean obvious position blanks so they do not behave as occupied rows.
update public.trailers
set compound_position = null
where compound_position is not null
  and btrim(compound_position) = '';

-- 4) Validate schema assumptions and abort on unresolved duplicates before indexes.
do $$
declare
  has_id boolean;
  has_trailer_number boolean;
  has_compound_position boolean;
  has_departure_date boolean;
  has_is_local boolean;
  has_active boolean;
  has_arrival_date boolean;
  has_operational_status boolean;
  has_created_at boolean;

  active_predicate_with_alias text;
  active_predicate_no_alias text;
  operational_status_expr text;
  created_at_expr text;

  duplicate_compound_summary text;
  duplicate_number_summary text;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trailers' and column_name = 'id'
  ) into has_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trailers' and column_name = 'trailer_number'
  ) into has_trailer_number;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trailers' and column_name = 'compound_position'
  ) into has_compound_position;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trailers' and column_name = 'departure_date'
  ) into has_departure_date;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trailers' and column_name = 'is_local'
  ) into has_is_local;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trailers' and column_name = 'active'
  ) into has_active;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trailers' and column_name = 'arrival_date'
  ) into has_arrival_date;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trailers' and column_name = 'operational_status'
  ) into has_operational_status;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trailers' and column_name = 'created_at'
  ) into has_created_at;

  if not (has_id and has_trailer_number and has_compound_position and has_departure_date and has_is_local) then
    raise exception
      'Guardrail migration aborted: required trailers columns are missing. Required: id, trailer_number, compound_position, departure_date, is_local. Optional: active.';
  end if;

  active_predicate_with_alias := 't.departure_date is null';
  active_predicate_no_alias := 'departure_date is null';

  if has_active then
    active_predicate_with_alias := active_predicate_with_alias || ' and coalesce(t.active, true) = true';
    active_predicate_no_alias := active_predicate_no_alias || ' and coalesce(active, true) = true';
  end if;

  operational_status_expr := case when has_operational_status then 't.operational_status' else 'null::text' end;
  created_at_expr := case when has_created_at then 't.created_at' else 'null::timestamptz' end;

  execute format($sql$
    with duplicate_positions as (
      select
        public.normalize_compound_position(t.compound_position) as normalized_compound_position,
        count(*) as duplicate_count,
        array_agg(t.id order by %2$s nulls last, t.id) as trailer_ids,
        json_agg(
          json_build_object(
            'id', t.id,
            'trailer_number', t.trailer_number,
            'raw_compound_position', t.compound_position,
            'normalized_compound_position', public.normalize_compound_position(t.compound_position),
            'arrival_date', %3$s,
            'departure_date', t.departure_date,
            'operational_status', %1$s
          )
          order by %2$s nulls last, t.id
        ) as affected_rows
      from public.trailers t
      where %4$s
        and coalesce(t.is_local, false) = false
        and public.normalize_compound_position(t.compound_position) is not null
      group by public.normalize_compound_position(t.compound_position)
      having count(*) > 1
    )
    select coalesce(json_agg(duplicate_positions), '[]'::json)::text
    from duplicate_positions
  $sql$,
  operational_status_expr,
  created_at_expr,
  case when has_arrival_date then 't.arrival_date' else 'null::date' end,
  active_predicate_with_alias)
  into duplicate_compound_summary;

  if duplicate_compound_summary <> '[]' then
    raise exception using
      message = 'Guardrail migration aborted: duplicate active occupied compound positions exist.',
      detail = duplicate_compound_summary,
      hint = 'Run preflight diagnostics, resolve duplicates manually, then rerun migration.';
  end if;

  execute format($sql$
    with duplicate_numbers as (
      select
        upper(regexp_replace(btrim(t.trailer_number), '\s+', ' ', 'g')) as normalized_trailer_number,
        count(*) as duplicate_count,
        array_agg(t.id order by %2$s nulls last, t.id) as trailer_ids,
        json_agg(
          json_build_object(
            'id', t.id,
            'trailer_number', t.trailer_number,
            'compound_position', t.compound_position,
            'arrival_date', %3$s,
            'departure_date', t.departure_date,
            'operational_status', %1$s,
            'is_local', t.is_local
          )
          order by %2$s nulls last, t.id
        ) as affected_rows
      from public.trailers t
      where %4$s
        and nullif(btrim(t.trailer_number), '') is not null
      group by upper(regexp_replace(btrim(t.trailer_number), '\s+', ' ', 'g'))
      having count(*) > 1
    )
    select coalesce(json_agg(duplicate_numbers), '[]'::json)::text
    from duplicate_numbers
  $sql$,
  operational_status_expr,
  created_at_expr,
  case when has_arrival_date then 't.arrival_date' else 'null::date' end,
  active_predicate_with_alias)
  into duplicate_number_summary;

  if duplicate_number_summary <> '[]' then
    raise exception using
      message = 'Guardrail migration aborted: duplicate active trailer numbers exist.',
      detail = duplicate_number_summary,
      hint = 'Run preflight diagnostics, resolve duplicates manually, then rerun migration.';
  end if;

  execute format(
    'create unique index if not exists idx_trailers_active_compound_position_unique on public.trailers (public.normalize_compound_position(compound_position)) where %s and coalesce(is_local, false) = false and public.normalize_compound_position(compound_position) is not null;',
    active_predicate_no_alias
  );

  execute format(
    'create unique index if not exists idx_trailers_active_normalized_trailer_number_unique on public.trailers ((upper(regexp_replace(btrim(trailer_number), ''\\s+'', '' '', ''g'')))) where %s and nullif(btrim(trailer_number), '''') is not null;',
    active_predicate_no_alias
  );
end
$$;
