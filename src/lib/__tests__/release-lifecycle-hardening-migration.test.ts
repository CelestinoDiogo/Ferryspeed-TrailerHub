import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/052_release_lifecycle_hardening.sql"),
  "utf8",
);

describe("release lifecycle hardening migration", () => {
  it("replaces permissive public lifecycle policies with role-aware access", () => {
    for (const table of ["trailers", "vessel_operations", "vessel_operation_trailers", "export_allocations", "delivery_bookings"]) {
      expect(migrationSql).toContain(`alter table public.${table} enable row level security;`);
    }

    expect(migrationSql).toContain('drop policy if exists "Anyone can update trailers" on public.trailers;');
    expect(migrationSql).toContain('drop policy if exists "Allow update export allocations" on public.export_allocations;');
    expect(migrationSql).toContain('drop policy if exists "Allow vessel operations access" on public.vessel_operations;');
    expect(migrationSql).toContain('drop policy if exists "Allow delivery bookings update" on public.delivery_bookings;');
    expect(migrationSql).not.toContain("using (true)");
  });

  it("keeps assigned Driver Mobile access narrow and history append-only", () => {
    expect(migrationSql).toContain("assigned_driver.user_id = auth.uid()");
    expect(migrationSql).toContain("source_module = 'delivery'");
    expect(migrationSql).toContain("'driver_task_acknowledged', 'delivery_status_changed', 'delivery_completed'");
    expect(migrationSql).toContain("revoke update, delete on table public.trailer_events from authenticated;");
    expect(migrationSql).toContain("revoke update, delete on table public.trailer_activity_log from authenticated;");
  });

  it("provides a locked canonical export rollback", () => {
    expect(migrationSql).toContain("function public.undo_export_allocation_load_lifecycle");
    expect(migrationSql).toContain("for update;");
    expect(migrationSql).toContain("when v_allocation.status = 'collected_loaded' then 'Empty'");
    expect(migrationSql).toContain("else v_previous_load_status");
    expect(migrationSql).toContain("pg_advisory_xact_lock(hashtext('compound_position:'");
    expect(migrationSql).toContain("insert into public.trailer_activity_log");
  });

  it("does not modify protected historical migrations or operational trailers", () => {
    for (const trailerNumber of ["PFC18", "PFC20", "PFC32", "MFT73"]) {
      expect(migrationSql).not.toContain(trailerNumber);
    }
  });
});