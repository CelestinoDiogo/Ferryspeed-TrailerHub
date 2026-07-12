create table if not exists public.trailer_events (
    id uuid primary key default gen_random_uuid(),
    trailer_id uuid references trailers(id) on delete cascade,
    trailer_number text not null,
    event_type text not null,
    event_description text,
    old_value jsonb,
    new_value jsonb,
    created_at timestamptz default now(),
    created_by text
);
