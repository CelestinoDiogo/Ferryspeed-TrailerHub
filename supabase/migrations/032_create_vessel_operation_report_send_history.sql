-- Ferryspeed TrailerHub - Migration 032
-- Adds vessel_operation_report_send_history for audit of AI report delivery attempts.

create extension if not exists "pgcrypto";

alter table if exists public.vessel_operation_reports
  add column if not exists bcc text[] not null default '{}'::text[];

alter table if exists public.vessel_operation_reports
  alter column bcc set default '{}'::text[];

create table if not exists public.vessel_operation_report_send_history (
  id uuid primary key default gen_random_uuid(),
  vessel_operation_id uuid not null references public.vessel_operations(id) on delete cascade,
  report_id uuid references public.vessel_operation_reports(id) on delete set null,
  subject text not null,
  recipients jsonb not null default '[]'::jsonb,
  report_content text not null,
  generated_at timestamptz not null,
  generated_by text,
  sent_at timestamptz,
  sent_by text,
  delivery_status text not null default 'queued',
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vessel_operation_report_send_history_status_check
    check (delivery_status in ('queued', 'sent', 'failed'))
);

create index if not exists vessel_operation_report_send_history_operation_idx
  on public.vessel_operation_report_send_history(vessel_operation_id);

create index if not exists vessel_operation_report_send_history_report_idx
  on public.vessel_operation_report_send_history(report_id);

create index if not exists vessel_operation_report_send_history_status_idx
  on public.vessel_operation_report_send_history(delivery_status);

create index if not exists vessel_operation_report_send_history_created_at_idx
  on public.vessel_operation_report_send_history(created_at desc);

alter table if exists public.vessel_operation_report_send_history enable row level security;

drop policy if exists "Authenticated users can read vessel_operation_report_send_history" on public.vessel_operation_report_send_history;
drop policy if exists "Authenticated users can insert vessel_operation_report_send_history" on public.vessel_operation_report_send_history;
drop policy if exists "Authenticated users can update vessel_operation_report_send_history" on public.vessel_operation_report_send_history;

create policy "Authenticated users can read vessel_operation_report_send_history"
  on public.vessel_operation_report_send_history
  for select
  to authenticated
  using (true);

create policy "Authenticated users can insert vessel_operation_report_send_history"
  on public.vessel_operation_report_send_history
  for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update vessel_operation_report_send_history"
  on public.vessel_operation_report_send_history
  for update
  to authenticated
  using (true)
  with check (true);
