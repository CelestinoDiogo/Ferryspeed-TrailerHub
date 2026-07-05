create table if not exists public.company_trailers (
  id uuid primary key default gen_random_uuid(),
  trailer_number text not null unique,
  trailer_type text,
  notes text,
  active boolean default true,
  created_at timestamp with time zone default now()
);

alter table public.company_trailers enable row level security;

create policy if not exists "Allow read access to company trailers"
  on public.company_trailers
  for select
  using (true);

create policy if not exists "Allow insert access to company trailers"
  on public.company_trailers
  for insert
  with check (true);

create policy if not exists "Allow update access to company trailers"
  on public.company_trailers
  for update
  using (true)
  with check (true);
