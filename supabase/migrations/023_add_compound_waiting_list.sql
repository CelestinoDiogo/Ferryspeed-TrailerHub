-- ============================================================
-- FERRYSPEED TRAILERHUB
-- WAITING FOR COMPOUND
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Tabela de configuração do Compound
-- ------------------------------------------------------------

create table if not exists public.compound_settings (
    id uuid primary key default gen_random_uuid(),
    compound_name text not null default 'Main Compound',
    physical_capacity integer not null default 50,
    warning_level integer not null default 45,
    critical_level integer not null default 48,
    automatic_assignment boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint compound_settings_capacity_check
        check (physical_capacity > 0),

    constraint compound_settings_warning_check
        check (
            warning_level >= 0
            and warning_level <= physical_capacity
        ),

    constraint compound_settings_critical_check
        check (
            critical_level >= warning_level
            and critical_level <= physical_capacity
        )
);


-- Garante que existe apenas uma configuração principal
create unique index if not exists compound_settings_single_main_idx
on public.compound_settings (compound_name);


insert into public.compound_settings (
    compound_name,
    physical_capacity,
    warning_level,
    critical_level,
    automatic_assignment
)
values (
    'Main Compound',
    50,
    45,
    48,
    false
)
on conflict (compound_name) do nothing;


-- ------------------------------------------------------------
-- 2. Tabela Waiting for Compound
-- ------------------------------------------------------------

create table if not exists public.compound_waiting_list (
    id uuid primary key default gen_random_uuid(),

    trailer_id uuid not null
        references public.trailers(id)
        on delete cascade,

    trailer_number text not null,

    vessel_operation_id uuid null
        references public.vessel_operations(id)
        on delete set null,

    vessel_trailer_id uuid null
        references public.vessel_operation_trailers(id)
        on delete set null,

    customer text null,

    load_status text null,

    waiting_reason text not null default 'compound_full',

    priority_level text not null default 'normal',

    priority_reason text null,

    arrived_at timestamptz not null default now(),

    waiting_since timestamptz not null default now(),

    assigned_at timestamptz null,

    assigned_position text null,

    assigned_by text null,

    status text not null default 'waiting',

    notes text null,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint compound_waiting_status_check
        check (
            status in (
                'waiting',
                'assigned',
                'cancelled'
            )
        ),

    constraint compound_waiting_priority_check
        check (
            priority_level in (
                'low',
                'normal',
                'high',
                'urgent'
            )
        )
);


-- Uma trela só pode ter uma entrada ativa na fila
create unique index if not exists compound_waiting_unique_active_trailer_idx
on public.compound_waiting_list (trailer_id)
where status = 'waiting';


create index if not exists compound_waiting_status_idx
on public.compound_waiting_list (status);


create index if not exists compound_waiting_priority_idx
on public.compound_waiting_list (
    priority_level,
    waiting_since
)
where status = 'waiting';


create index if not exists compound_waiting_arrived_at_idx
on public.compound_waiting_list (arrived_at desc);


-- ------------------------------------------------------------
-- 3. Função para atualizar updated_at
-- ------------------------------------------------------------

create or replace function public.set_compound_waiting_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;


drop trigger if exists compound_waiting_updated_at_trigger
on public.compound_waiting_list;


create trigger compound_waiting_updated_at_trigger
before update on public.compound_waiting_list
for each row
execute function public.set_compound_waiting_updated_at();


-- ------------------------------------------------------------
-- 4. Função que conta posições ocupadas
-- ------------------------------------------------------------

create or replace function public.get_compound_occupancy()
returns table (
    physical_capacity integer,
    occupied_positions bigint,
    available_positions bigint,
    waiting_trailers bigint,
    occupancy_percentage numeric,
    compound_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_capacity integer;
    v_warning integer;
    v_critical integer;
    v_occupied bigint;
    v_waiting bigint;
begin
    select
        cs.physical_capacity,
        cs.warning_level,
        cs.critical_level
    into
        v_capacity,
        v_warning,
        v_critical
    from public.compound_settings cs
    where cs.compound_name = 'Main Compound'
    limit 1;

    v_capacity := coalesce(v_capacity, 50);
    v_warning := coalesce(v_warning, 45);
    v_critical := coalesce(v_critical, 48);

    select count(distinct public.normalize_compound_position(t.compound_position))
    into v_occupied
    from public.trailers t
    where t.departure_date is null
      and coalesce(t.active, true) = true
      and coalesce(t.is_local, false) = false
      and public.normalize_compound_position(t.compound_position)
            ~ '^P(0[1-9]|[1-4][0-9]|50)$';

    select count(*)
    into v_waiting
    from public.compound_waiting_list cwl
    where cwl.status = 'waiting';

    return query
    select
        v_capacity,
        v_occupied,
        greatest(v_capacity - v_occupied, 0)::bigint,
        v_waiting,
        round(
            (v_occupied::numeric / nullif(v_capacity, 0)::numeric) * 100,
            1
        ),
        case
            when v_occupied >= v_capacity then 'full'
            when v_occupied >= v_critical then 'critical'
            when v_occupied >= v_warning then 'warning'
            else 'available'
        end;
end;
$$;


-- ------------------------------------------------------------
-- 5. Função para obter a primeira posição disponível
-- ------------------------------------------------------------

create or replace function public.get_first_available_compound_position()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_capacity integer;
    v_position_number integer;
    v_position text;
begin
    select physical_capacity
    into v_capacity
    from public.compound_settings
    where compound_name = 'Main Compound'
    limit 1;

    v_capacity := least(coalesce(v_capacity, 50), 99);

    for v_position_number in 1..v_capacity loop

        v_position := 'P' || lpad(v_position_number::text, 2, '0');

        if not exists (
            select 1
            from public.trailers t
            where t.departure_date is null
              and coalesce(t.active, true) = true
              and coalesce(t.is_local, false) = false
              and public.normalize_compound_position(t.compound_position)
                    = v_position
        ) then
            return v_position;
        end if;

    end loop;

    return null;
end;
$$;


-- ------------------------------------------------------------
-- 6. Colocar uma trela em Waiting for Compound
-- ------------------------------------------------------------

create or replace function public.add_trailer_to_compound_waiting(
    p_trailer_id uuid,
    p_vessel_operation_id uuid default null,
    p_vessel_trailer_id uuid default null,
    p_priority_level text default 'normal',
    p_priority_reason text default null,
    p_waiting_reason text default 'compound_full',
    p_notes text default null
)
returns public.compound_waiting_list
language plpgsql
security definer
set search_path = public
as $$
declare
    v_trailer public.trailers;
    v_waiting public.compound_waiting_list;
begin
    select *
    into v_trailer
    from public.trailers
    where id = p_trailer_id
    for update;

    if not found then
        raise exception 'Trailer not found.';
    end if;

    if v_trailer.compound_position is not null
       and trim(v_trailer.compound_position) <> '' then
        raise exception
            'Trailer % already has compound position %.',
            v_trailer.trailer_number,
            v_trailer.compound_position;
    end if;

    if p_priority_level not in ('low', 'normal', 'high', 'urgent') then
        raise exception 'Invalid priority level: %', p_priority_level;
    end if;

    insert into public.compound_waiting_list (
        trailer_id,
        trailer_number,
        vessel_operation_id,
        vessel_trailer_id,
        customer,
        load_status,
        waiting_reason,
        priority_level,
        priority_reason,
        arrived_at,
        waiting_since,
        notes,
        status
    )
    values (
        v_trailer.id,
        v_trailer.trailer_number,
        p_vessel_operation_id,
        p_vessel_trailer_id,
        v_trailer.customer,
        v_trailer.load_status,
        coalesce(p_waiting_reason, 'compound_full'),
        coalesce(p_priority_level, 'normal'),
        p_priority_reason,
        coalesce(v_trailer.arrival_date::timestamptz, now()),
        now(),
        p_notes,
        'waiting'
    )
    on conflict (trailer_id)
    where status = 'waiting'
    do update set
        vessel_operation_id = excluded.vessel_operation_id,
        vessel_trailer_id = excluded.vessel_trailer_id,
        customer = excluded.customer,
        load_status = excluded.load_status,
        priority_level = excluded.priority_level,
        priority_reason = excluded.priority_reason,
        waiting_reason = excluded.waiting_reason,
        notes = excluded.notes,
        updated_at = now()
    returning *
    into v_waiting;

    update public.trailers
    set
        compound_position = null,
        operational_status = 'waiting_for_compound'
    where id = p_trailer_id;

    return v_waiting;
end;
$$;


-- ------------------------------------------------------------
-- 7. Atribuir posição a uma trela em espera
-- ------------------------------------------------------------

create or replace function public.assign_waiting_trailer_to_compound(
    p_waiting_id uuid,
    p_position text default null,
    p_assigned_by text default null
)
returns public.compound_waiting_list
language plpgsql
security definer
set search_path = public
as $$
declare
    v_waiting public.compound_waiting_list;
    v_position text;
    v_capacity integer;
    v_position_number integer;
begin
    select *
    into v_waiting
    from public.compound_waiting_list
    where id = p_waiting_id
    for update;

    if not found then
        raise exception 'Waiting record not found.';
    end if;

    if v_waiting.status <> 'waiting' then
        raise exception
            'Trailer % is not waiting. Current status: %.',
            v_waiting.trailer_number,
            v_waiting.status;
    end if;

    select physical_capacity
    into v_capacity
    from public.compound_settings
    where compound_name = 'Main Compound'
    limit 1;

    v_capacity := coalesce(v_capacity, 50);

    if p_position is null or trim(p_position) = '' then
        v_position := public.get_first_available_compound_position();
    else
        v_position := public.normalize_compound_position(p_position);
    end if;

    if v_position is null then
        raise exception 'Compound is full. No position is available.';
    end if;

    v_position_number :=
        nullif(regexp_replace(v_position, '[^0-9]', '', 'g'), '')::integer;

    if v_position_number is null
       or v_position_number < 1
       or v_position_number > v_capacity then
        raise exception
            'Position % is outside the configured compound capacity of %.',
            v_position,
            v_capacity;
    end if;

    if exists (
        select 1
        from public.trailers t
        where t.departure_date is null
          and coalesce(t.active, true) = true
          and coalesce(t.is_local, false) = false
          and public.normalize_compound_position(t.compound_position)
                = v_position
          and t.id <> v_waiting.trailer_id
    ) then
        raise exception 'Compound position % is already occupied.', v_position;
    end if;

    update public.trailers
    set
        compound_position = v_position,
        operational_status = 'in_compound',
        active = true
    where id = v_waiting.trailer_id;

    update public.compound_waiting_list
    set
        status = 'assigned',
        assigned_position = v_position,
        assigned_at = now(),
        assigned_by = p_assigned_by,
        updated_at = now()
    where id = p_waiting_id
    returning *
    into v_waiting;

    return v_waiting;
end;
$$;


-- ------------------------------------------------------------
-- 8. Atribuir automaticamente a próxima trela em espera
--
-- Ordem:
-- urgent -> high -> normal -> low
-- depois pela mais antiga
-- ------------------------------------------------------------

create or replace function public.assign_next_waiting_trailer(
    p_assigned_by text default null
)
returns public.compound_waiting_list
language plpgsql
security definer
set search_path = public
as $$
declare
    v_waiting_id uuid;
    v_result public.compound_waiting_list;
begin
    if public.get_first_available_compound_position() is null then
        raise exception 'Compound is full. No position is available.';
    end if;

    select cwl.id
    into v_waiting_id
    from public.compound_waiting_list cwl
    where cwl.status = 'waiting'
    order by
        case cwl.priority_level
            when 'urgent' then 1
            when 'high' then 2
            when 'normal' then 3
            when 'low' then 4
            else 5
        end,
        cwl.waiting_since asc
    limit 1
    for update skip locked;

    if v_waiting_id is null then
        raise exception 'There are no trailers waiting for compound.';
    end if;

    select *
    into v_result
    from public.assign_waiting_trailer_to_compound(
        v_waiting_id,
        null,
        p_assigned_by
    );

    return v_result;
end;
$$;


-- ------------------------------------------------------------
-- 9. Cancelar uma entrada da fila
-- ------------------------------------------------------------

create or replace function public.cancel_compound_waiting(
    p_waiting_id uuid,
    p_notes text default null
)
returns public.compound_waiting_list
language plpgsql
security definer
set search_path = public
as $$
declare
    v_result public.compound_waiting_list;
begin
    update public.compound_waiting_list
    set
        status = 'cancelled',
        notes = case
            when p_notes is null then notes
            when notes is null or trim(notes) = '' then p_notes
            else notes || E'\n' || p_notes
        end,
        updated_at = now()
    where id = p_waiting_id
      and status = 'waiting'
    returning *
    into v_result;

    if not found then
        raise exception 'Active waiting record not found.';
    end if;

    return v_result;
end;
$$;


-- ------------------------------------------------------------
-- 10. Vista pronta para a aplicação
-- ------------------------------------------------------------

create or replace view public.compound_waiting_active as
select
    cwl.id,
    cwl.trailer_id,
    cwl.trailer_number,
    cwl.customer,
    cwl.load_status,
    cwl.priority_level,
    cwl.priority_reason,
    cwl.waiting_reason,
    cwl.arrived_at,
    cwl.waiting_since,
    extract(
        epoch from (now() - cwl.waiting_since)
    ) / 60 as waiting_minutes,
    cwl.vessel_operation_id,
    cwl.vessel_trailer_id,
    cwl.notes,
    cwl.created_at
from public.compound_waiting_list cwl
where cwl.status = 'waiting';


-- ------------------------------------------------------------
-- 11. Permissões
-- ------------------------------------------------------------

alter table public.compound_settings enable row level security;
alter table public.compound_waiting_list enable row level security;


drop policy if exists "Authenticated users can read compound settings"
on public.compound_settings;

create policy "Authenticated users can read compound settings"
on public.compound_settings
for select
to authenticated
using (true);


drop policy if exists "Authenticated users can update compound settings"
on public.compound_settings;

create policy "Authenticated users can update compound settings"
on public.compound_settings
for update
to authenticated
using (true)
with check (true);


drop policy if exists "Authenticated users can read waiting list"
on public.compound_waiting_list;

create policy "Authenticated users can read waiting list"
on public.compound_waiting_list
for select
to authenticated
using (true);


drop policy if exists "Authenticated users can insert waiting trailers"
on public.compound_waiting_list;

create policy "Authenticated users can insert waiting trailers"
on public.compound_waiting_list
for insert
to authenticated
with check (true);


drop policy if exists "Authenticated users can update waiting trailers"
on public.compound_waiting_list;

create policy "Authenticated users can update waiting trailers"
on public.compound_waiting_list
for update
to authenticated
using (true)
with check (true);


grant select, update
on public.compound_settings
to authenticated;

grant select, insert, update
on public.compound_waiting_list
to authenticated;

grant select
on public.compound_waiting_active
to authenticated;

grant execute
on function public.get_compound_occupancy()
to authenticated;

grant execute
on function public.get_first_available_compound_position()
to authenticated;

grant execute
on function public.add_trailer_to_compound_waiting(
    uuid,
    uuid,
    uuid,
    text,
    text,
    text,
    text
)
to authenticated;

grant execute
on function public.assign_waiting_trailer_to_compound(
    uuid,
    text,
    text
)
to authenticated;

grant execute
on function public.assign_next_waiting_trailer(text)
to authenticated;

grant execute
on function public.cancel_compound_waiting(uuid, text)
to authenticated;

commit;
