import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "supabase/migrations/041_driver_operational_instructions.sql");
const migrationSql = readFileSync(migrationPath, "utf8");

describe("driver mobile sprint 2B migration contract", () => {
  it("is additive and does not modify operational_alerts infrastructure", () => {
    expect(migrationSql).toContain("create table if not exists public.driver_operational_instructions");
    expect(migrationSql).not.toContain("drop table public.operational_alerts");
    expect(migrationSql).not.toContain("alter table public.operational_alerts");
  });

  it("defines recipient-isolated read policy and blocks direct write paths for drivers", () => {
    expect(migrationSql).toContain('create policy "Drivers can read own operational instructions"');
    expect(migrationSql).toContain("using (recipient_user_id = auth.uid())");
    expect(migrationSql).toContain('create policy "Direct updates to operational instructions are blocked"');
    expect(migrationSql).toContain('create policy "Deletes to operational instructions are blocked"');
    expect(migrationSql).toContain("for update");
    expect(migrationSql).toContain("for delete");
    expect(migrationSql).toContain("using (false)");
  });

  it("enforces immutable payload and write-once read receipt protection", () => {
    expect(migrationSql).toContain("Operational instruction payload is immutable after creation.");
    expect(migrationSql).toContain("Instruction read timestamp cannot be changed once set.");
    expect(migrationSql).toContain("Instruction read actor cannot be changed once set.");
  });

  it("uses secure mark-read RPC ownership filter and idempotent coalesce behavior", () => {
    expect(migrationSql).toContain("create or replace function public.mark_driver_operational_instruction_read(");
    expect(migrationSql).toContain("security definer");
    expect(migrationSql).toContain("set search_path = public");
    expect(migrationSql).toContain("where id = p_instruction_id");
    expect(migrationSql).toContain("and recipient_user_id = auth.uid()");
    expect(migrationSql).toContain("read_at = coalesce(read_at, now())");
    expect(migrationSql).toContain("read_by = coalesce(read_by, auth.uid())");
  });

  it("encodes controlled realtime publication strategy for the new table", () => {
    expect(migrationSql).toContain("from pg_publication");
    expect(migrationSql).toContain("from pg_publication_tables");
    expect(migrationSql).toContain("alter publication supabase_realtime add table public.driver_operational_instructions");
  });
});
