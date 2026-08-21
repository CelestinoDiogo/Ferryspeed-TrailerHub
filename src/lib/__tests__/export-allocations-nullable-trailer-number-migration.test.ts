import { readFileSync } from "node:fs";
import path from "path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/056_export_allocations_nullable_trailer_number.sql"),
  "utf8",
);

describe("export allocations nullable trailer_number migration", () => {
  it("only drops trailer_number not-null", () => {
    expect(migrationSql).toContain("alter table public.export_allocations");
    expect(migrationSql).toContain("alter column trailer_number drop not null");
    expect(migrationSql).not.toContain("alter column trailer_id");
    expect(migrationSql).not.toContain("drop index");
    expect(migrationSql).not.toContain("delete from");
    expect(migrationSql).not.toContain("truncate");
    expect(migrationSql).not.toContain("create or replace function");
  });
});
