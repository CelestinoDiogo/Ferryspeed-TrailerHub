import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/057_vessel_operation_trailers_discharged_at.sql"),
  "utf8",
);
const receptionSql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/051_allow_reception_after_mark_arrived.sql"),
  "utf8",
);

describe("vessel trailer discharged_at migration", () => {
  it("adds discharged_at without rewriting historical timestamps or the reception RPC", () => {
    expect(migrationSql).toContain("alter table public.vessel_operation_trailers");
    expect(migrationSql).toContain("add column if not exists discharged_at timestamptz");
    expect(migrationSql).toContain("Never overwritten by Compound reception");
    expect(migrationSql).not.toContain("update public.vessel_operation_trailers");
    expect(migrationSql).not.toContain("arrived_at");
    expect(migrationSql).not.toContain("create or replace function");
    expect(migrationSql).not.toContain("confirm_vessel_trailer_arrival");
  });

  it("does not copy arrived_at into discharged_at", () => {
    expect(migrationSql).not.toMatch(/discharged_at\s*=\s*arrived_at/i);
    expect(migrationSql).not.toMatch(/discharged_at\s*=\s*arrival_confirmed_at/i);
  });
});

describe("vessel reception RPC remains discharge-safe", () => {
  it("overwrites arrival/reception timestamps without assigning discharged_at", () => {
    expect(receptionSql).toContain("arrival_confirmed_at = p_received_at");
    expect(receptionSql).toContain("arrived_at = p_received_at");
    expect(receptionSql).not.toContain("discharged_at");
  });
});
