import { readFileSync } from "node:fs";
import path from "path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/055_export_allocations_nullable_trailer.sql"),
  "utf8",
);

describe("export allocations nullable trailer migration", () => {
  it("only drops trailer_id not-null and guards unassigned lifecycle advance", () => {
    expect(migrationSql).toContain("alter table public.export_allocations");
    expect(migrationSql).toContain("alter column trailer_id drop not null");
    expect(migrationSql).not.toContain("alter column trailer_number drop not null");
    expect(migrationSql).not.toContain("drop index");
    expect(migrationSql).toContain("idx_export_allocations_one_active_per_trailer");
    expect(migrationSql).toContain("Assign a trailer before continuing this operation.");
    expect(migrationSql).toContain("function public.advance_export_allocation_load_lifecycle");
  });

  it("does not apply itself or rewrite unrelated tables", () => {
    expect(migrationSql).not.toContain("create table");
    expect(migrationSql).not.toContain("delivery_bookings");
    expect(migrationSql).not.toContain("vessel_operation_trailers");
  });
});
