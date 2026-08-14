import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/048_transport_job_events.sql"), "utf8");

describe("Fleet Transport Sprint 3 migration contract", () => {
  it("adds a dedicated append-only event table with safe historical references", () => {
    expect(sql).toContain("create table if not exists public.transport_job_events");
    expect(sql).toContain("transport_job_id uuid not null references public.transport_jobs(id) on delete restrict");
    expect(sql).toContain("previous_driver_id uuid null references public.drivers(id) on delete set null");
    expect(sql).toContain("new_unit_id uuid null references public.fleet_transport_units(id) on delete set null");
    expect(sql).toContain("previous_trailer_id uuid null references public.trailers(id) on delete set null");
    expect(sql).toContain("created_by_user_id uuid null references auth.users(id) on delete set null");
  });

  it("enforces Fleet RBAC and immutable history", () => {
    expect(sql).toContain("alter table public.transport_job_events enable row level security");
    expect(sql).toContain("role_key in ('administrator', 'supervisor', 'operator')");
    expect(sql).not.toContain("role_key in ('administrator', 'supervisor', 'operator', 'driver')");
    expect(sql).toContain("with check (false)");
    expect(sql).toContain("raise exception 'Transport job events are immutable.'");
    expect(sql).toContain("revoke insert, update, delete, truncate, references, trigger");
    expect(sql).not.toMatch(/drop\s+table|truncate\s+table|delete\s+from\s+public\./i);
  });

  it("generates creation, assignment, lifecycle, and general update events atomically", () => {
    expect(sql).toContain("create or replace function public.create_transport_job_with_event");
    expect(sql).toContain("create or replace function public.update_transport_job_with_event");
    expect(sql).toContain("for update");
    expect(sql).toContain("job_created");
    expect(sql).toContain("driver_reassigned");
    expect(sql).toContain("unit_unassigned");
    expect(sql).toContain("trailer_assigned");
    expect(sql).toContain("job_started");
    expect(sql).toContain("job_completed");
    expect(sql).toContain("job_cancelled");
    expect(sql).toContain("job_updated");
    expect(sql).toContain("jsonb_build_object('changed_fields', changed_fields)");
  });
});
