import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "supabase/migrations/051_allow_reception_after_mark_arrived.sql");
const migrationSql = readFileSync(migrationPath, "utf8");

describe("vessel reception after mark-arrived migration", () => {
  it("allows reception from both supported pre-reception states", () => {
    expect(migrationSql).toContain("coalesce(v_row.arrival_status, 'expected') not in ('available_for_arrival', 'arrived')");
    expect(migrationSql).not.toContain("Arrival already confirmed for this trailer.");
  });

  it("keeps the linked arrival record authoritative for idempotency", () => {
    expect(migrationSql).toContain("if v_row.arrival_record_id is not null then");
    expect(migrationSql).toContain("Arrival record already linked for this trailer.");
  });

  it("preserves canonical load state, compound locking, and manager authorization", () => {
    expect(migrationSql).toContain("public.resolve_trailer_physical_load_status(");
    expect(migrationSql).toContain("pg_advisory_xact_lock(hashtext('compound_position:'");
    expect(migrationSql).toContain("role_key in ('administrator', 'supervisor', 'operator')");
    expect(migrationSql).toContain("grant execute on function public.confirm_vessel_trailer_arrival");
  });
});