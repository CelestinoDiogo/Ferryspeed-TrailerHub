-- Ferryspeed TrailerHub — Migration 009
-- Creates vessel_operation_reports table for AI Vessel Operational Reporting Phase 1.

create extension if not exists "pgcrypto";

create table if not exists public.vessel_operation_reports (
  id uuid primary key default gen_random_uuid(),

  vessel_operation_id uuid not null
    references public.vessel_operations(id)
    on delete cascade,

  report_type text not null default 'operational',
  report_status text not null default 'draft',

  report_number text,
  title text not null,

  executive_summary text,
  operational_analysis text,
  recommendations text,
  conclusion text,

  structured_snapshot jsonb not null default '{}'::jsonb,

  generated_by_ai boolean not null default false,
  ai_model text,

  approved_at timestamptz,
  approved_by text,

  sent_at timestamptz,
  sent_by text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint vessel_operation_reports_status_check
    check (report_status in ('draft', 'generated', 'approved', 'sent', 'failed'))
);

create index if not exists vessel_operation_reports_operation_idx
  on public.vessel_operation_reports(vessel_operation_id);

create index if not exists vessel_operation_reports_status_idx
  on public.vessel_operation_reports(report_status);

alter table public.vessel_operation_reports enable row level security;

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
