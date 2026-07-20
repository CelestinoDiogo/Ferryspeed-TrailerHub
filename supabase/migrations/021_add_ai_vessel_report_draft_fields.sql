-- Ferryspeed TrailerHub — Migration 021
-- Adds production AI report draft persistence fields and indexes.
-- Safe to run repeatedly via IF NOT EXISTS guards.

alter table if exists public.vessel_operation_reports
  add column if not exists generated_at timestamptz,
  add column if not exists generated_by text,
  add column if not exists subject text,
  add column if not exists recipients text[] not null default '{}'::text[],
  add column if not exists cc text[] not null default '{}'::text[],
  add column if not exists generated_content text,
  add column if not exists edited_content text,
  add column if not exists structured_data_snapshot jsonb not null default '{}'::jsonb;

update public.vessel_operation_reports
set
  generated_at = coalesce(generated_at, created_at),
  subject = coalesce(nullif(subject, ''), title),
  generated_content = coalesce(generated_content, executive_summary),
  edited_content = coalesce(edited_content, generated_content, executive_summary),
  structured_data_snapshot = case
    when structured_data_snapshot is null or structured_data_snapshot = '{}'::jsonb then coalesce(structured_snapshot, '{}'::jsonb)
    else structured_data_snapshot
  end
where
  generated_at is null
  or subject is null
  or generated_content is null
  or edited_content is null
  or structured_data_snapshot is null
  or structured_data_snapshot = '{}'::jsonb;

create index if not exists vessel_operation_reports_generated_at_idx
  on public.vessel_operation_reports (vessel_operation_id, generated_at desc);

create index if not exists vessel_operation_reports_report_status_idx
  on public.vessel_operation_reports (report_status);
