import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/053_authenticated_least_privilege_hardening.sql"),
  "utf8",
);
const executableSql = migrationSql.replace(/--.*$/gm, "");

describe("authenticated least-privilege migration", () => {
  it("revokes dangerous non-DML privileges from authenticated on explicit operational tables", () => {
    expect(migrationSql).toContain("revoke truncate, references, trigger on table");
    expect(migrationSql).toContain("from authenticated;");

    for (const table of [
      "trailers",
      "delivery_bookings",
      "export_allocations",
      "vessel_operations",
      "vessel_operation_trailers",
      "trailer_events",
      "trailer_activity_log",
    ]) {
      expect(migrationSql).toContain(`public.${table}`);
    }
  });

  it("does not grant anon, redesign RLS, or mutate operational rows", () => {
    expect(executableSql).not.toMatch(/grant\s+.+\s+to\s+anon/i);
    expect(executableSql).not.toMatch(/create\s+policy|drop\s+policy|row\s+level\s+security/i);
    expect(executableSql).not.toMatch(/truncate\s+table/i);
    expect(executableSql).not.toMatch(/\b(update|delete\s+from|insert\s+into)\b/i);
    expect(executableSql).not.toMatch(/drop\s+(table|column)/i);
  });

  it("does not reference protected trailers or historical lifecycle migrations", () => {
    for (const protectedValue of ["PFC18", "PFC20", "PFC32", "MFT73", "Migration 050", "Migration 051", "Migration 052"]) {
      expect(migrationSql).not.toContain(protectedValue);
    }
  });
});