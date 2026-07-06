create table if not exists public.company_trailers (
  id uuid primary key default gen_random_uuid(),
  trailer_number text not null unique,
  prefix text,
  numeric_part integer,
  trailer_type text,
  notes text,
  original_value text,
  active boolean default true,
  created_at timestamp with time zone default now()
);

alter table public.company_trailers enable row level security;

drop policy if exists "Allow read access to company trailers" on public.company_trailers;

create policy "Allow read access to company trailers"
on public.company_trailers
for select
to public
using (true);

drop policy if exists "Allow insert access to company trailers" on public.company_trailers;

create policy "Allow insert access to company trailers"
on public.company_trailers
for insert
to public
with check (true);

drop policy if exists "Allow update access to company trailers" on public.company_trailers;

create policy "Allow update access to company trailers"
on public.company_trailers
for update
to public
using (true)
with check (true);