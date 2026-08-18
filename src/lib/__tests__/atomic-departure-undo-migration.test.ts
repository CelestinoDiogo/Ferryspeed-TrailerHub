import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/054_atomic_departure_undo.sql"),
  "utf8",
);

describe("atomic Departure Undo migration", () => {
  it("locks and validates the exact departed state", () => {
    expect(migrationSql).toContain("function public.undo_trailer_departure");
    expect(migrationSql).toContain("for update;");
    expect(migrationSql).toContain("is distinct from p_expected_departure_at");
    expect(migrationSql).toContain("'already_restored'");
    expect(migrationSql).toContain("'stale_state'");
  });

  it("recovers the pre-departure state from the matching forward event", () => {
    expect(migrationSql).toContain("event.event_type = 'departure_registered'");
    expect(migrationSql).toContain("(event.new_value ->> 'departure_date')::timestamptz = v_trailer.departure_date");
    expect(migrationSql).toContain("event.old_value ->> 'compound_position'");
    expect(migrationSql).toContain("event.old_value ->> 'operational_status'");
  });

  it("fails safely when the original Compound position is occupied", () => {
    expect(migrationSql).toContain("pg_advisory_xact_lock(hashtext('compound_position:'");
    expect(migrationSql).toContain("'position_occupied'");
    expect(migrationSql).toContain("when unique_violation then");
  });

  it("does not reactivate a duplicate physical trailer number", () => {
    expect(migrationSql).toContain("pg_advisory_xact_lock(hashtext('active_trailer_number:'");
    expect(migrationSql).toContain("active_trailer.departure_date is null");
    expect(migrationSql).toContain("then 'stale_state' else 'position_occupied' end");
  });

  it("preserves physical load, ownership, customer, and independent lifecycles", () => {
    const trailerUpdate = migrationSql.match(/update public\.trailers[\s\S]*?where id = v_trailer\.id;/i)?.[0] ?? "";
    expect(trailerUpdate).not.toContain("load_status");
    expect(trailerUpdate).not.toContain("trailer_source");
    expect(trailerUpdate).not.toContain("external_company");
    expect(trailerUpdate).not.toContain("customer");
    expect(migrationSql).not.toContain("delivery_bookings");
    expect(migrationSql).not.toContain("export_allocations");
    expect(migrationSql).not.toContain("driver_operational_instructions");
    expect(migrationSql).not.toContain("vessel_operation_trailers");
  });

  it("writes one immutable undo event and one activity record", () => {
    expect(migrationSql.match(/insert into public\.trailer_events/g)).toHaveLength(1);
    expect(migrationSql.match(/insert into public\.trailer_activity_log/g)).toHaveLength(1);
    expect(migrationSql).toContain("'departure_undone'");
    expect(migrationSql).toContain("'movement_undone'");
    expect(migrationSql).not.toMatch(/delete\s+from\s+public\.trailer_events/i);
  });

  it("restores eligibility for a later legitimate departure without suppressing forward history", () => {
    expect(migrationSql).toContain("departure_date = null");
    expect(migrationSql).toContain("departure_time = null");
    expect(migrationSql).toContain("operational_status = v_restored_status");
    expect(migrationSql).not.toMatch(/update\s+public\.trailer_events/i);
  });

  it("keeps the RPC staff-only with a safe definer search path", () => {
    expect(migrationSql).toContain("security definer");
    expect(migrationSql).toContain("set search_path = pg_catalog, public");
    expect(migrationSql).toContain("public.is_active_operational_staff(array['administrator', 'supervisor', 'operator'])");
    expect(migrationSql).toContain("from anon;");
    expect(migrationSql).toContain("to authenticated;");
    expect(migrationSql).toContain("to service_role;");
  });
});