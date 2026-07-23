-- Ferryspeed TrailerHub - Migration 027
-- Ensures vessel_operation_reports exists with all fields required by AI report draft/final/sent lifecycle.
-- Safe to run in environments where previous migrations were partially applied.

create extension if not exists "pgcrypto";

create table if not exists public.vessel_operation_reports (
  id uuid primary key default gen_random_uuid(),
  vessel_operation_id uuid not null references public.vessel_operations(id) on delete cascade,
  report_type text not null default 'operational',
  report_status text not null default 'draft',
  report_number text,
  title text not null default 'Vessel Operations Report',
  subject text,
  recipients text[] not null default '{}'::text[],
  cc text[] not null default '{}'::text[],
  executive_summary text,
  operational_analysis text,
  recommendations text,
  conclusion text,
  generated_content text,
  edited_content text,
  structured_snapshot jsonb not null default '{}'::jsonb,
  structured_data_snapshot jsonb not null default '{}'::jsonb,
  generated_by_ai boolean not null default false,
  ai_model text,
  generated_at timestamptz,
  generated_by text,
  approved_at timestamptz,
  approved_by text,
  sent_at timestamptz,
  sent_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.vessel_operation_reports
  add column if not exists vessel_operation_id uuid,
  add column if not exists report_type text not null default 'operational',
  add column if not exists report_status text not null default 'draft',
  add column if not exists report_number text,
  add column if not exists title text not null default 'Vessel Operations Report',
  add column if not exists subject text,
  add column if not exists recipients text[] not null default '{}'::text[],
  add column if not exists cc text[] not null default '{}'::text[],
  add column if not exists executive_summary text,
  add column if not exists operational_analysis text,
  add column if not exists recommendations text,
  add column if not exists conclusion text,
  add column if not exists generated_content text,
  add column if not exists edited_content text,
  add column if not exists structured_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists structured_data_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists generated_by_ai boolean not null default false,
  add column if not exists ai_model text,
  add column if not exists generated_at timestamptz,
  add column if not exists generated_by text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by text,
  add column if not exists sent_at timestamptz,
  add column if not exists sent_by text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.vessel_operation_reports
  alter column title set default 'Vessel Operations Report',
  alter column report_type set default 'operational',
  alter column report_status set default 'draft',
  alter column recipients set default '{}'::text[],
  alter column cc set default '{}'::text[];

update public.vessel_operation_reports
set
  title = coalesce(nullif(title, ''), nullif(subject, ''), 'Vessel Operations Report'),
  subject = coalesce(nullif(subject, ''), nullif(title, ''), 'Vessel Operations Report'),
  generated_at = coalesce(generated_at, created_at),
  generated_content = coalesce(generated_content, executive_summary),
  edited_content = coalesce(edited_content, generated_content, executive_summary),
  structured_snapshot = coalesce(structured_snapshot, '{}'::jsonb),
  structured_data_snapshot = coalesce(structured_data_snapshot, structured_snapshot, '{}'::jsonb),
  recipients = coalesce(recipients, '{}'::text[]),
  cc = coalesce(cc, '{}'::text[]),
  report_type = coalesce(nullif(report_type, ''), 'operational'),
  report_status = case
    when report_status in ('approved', 'final') then 'final'
    when report_status = 'sent' then 'sent'
    else 'draft'
  end,
  updated_at = coalesce(updated_at, now())
where
  title is null
  or subject is null
  or generated_at is null
  or generated_content is null
  or edited_content is null
  or structured_snapshot is null
  or structured_data_snapshot is null
  or recipients is null
  or cc is null
  or report_type is null
  or report_status is null
  or updated_at is null
  or report_status in ('approved', 'generated', 'failed');

alter table if exists public.vessel_operation_reports
  alter column title set not null;

alter table if exists public.vessel_operation_reports
  drop constraint if exists vessel_operation_reports_status_check;

alter table if exists public.vessel_operation_reports
  add constraint vessel_operation_reports_status_check
  check (report_status in ('draft', 'final', 'sent'));

alter table if exists public.vessel_operation_reports
  drop constraint if exists vessel_operation_reports_vessel_operation_id_fkey;

alter table if exists public.vessel_operation_reports
  add constraint vessel_operation_reports_vessel_operation_id_fkey
  foreign key (vessel_operation_id)
  references public.vessel_operations(id)
  on delete cascade;

create index if not exists vessel_operation_reports_operation_idx
  on public.vessel_operation_reports(vessel_operation_id);

create index if not exists vessel_operation_reports_status_idx
  on public.vessel_operation_reports(report_status);

create index if not exists vessel_operation_reports_generated_at_idx
  on public.vessel_operation_reports(vessel_operation_id, generated_at desc);

create index if not exists vessel_operation_reports_operation_status_idx
  on public.vessel_operation_reports(vessel_operation_id, report_status);

alter table if exists public.vessel_operation_reports enable row level security;

drop policy if exists "Authenticated users can read vessel_operation_reports" on public.vessel_operation_reports;
drop policy if exists "Authenticated users can insert vessel_operation_reports" on public.vessel_operation_reports;
drop policy if exists "Authenticated users can update vessel_operation_reports" on public.vessel_operation_reports;
drop policy if exists "Authenticated users can delete vessel_operation_reports" on public.vessel_operation_reports;

create policy "Authenticated users can read vessel_operation_reports"
  on public.vessel_operation_reports
  for select
  to authenticated
  using (true);

create policy "Authenticated users can insert vessel_operation_reports"
  on public.vessel_operation_reports
  for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update vessel_operation_reports"
  on public.vessel_operation_reports
  for update
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can delete vessel_operation_reports"
  on public.vessel_operation_reports
  for delete
  to authenticated
  using (true);
