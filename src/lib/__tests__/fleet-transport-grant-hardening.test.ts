import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/047_fleet_transport_grant_hardening.sql"), "utf8");

describe("Fleet / Transport migration 047 grant hardening", () => {
  it("does not recreate Fleet tables or alter RLS/policies", () => {
    expect(sql).not.toMatch(/create table|alter table|create policy|drop policy|enable row level security/i);
    expect(sql).not.toMatch(/delete\s+from|truncate\s+(table\s+)?public\.(fleet_transport_units|transport_jobs)/i);
  });

  it("removes unnecessary anon and authenticated destructive privileges", () => {
    expect(sql).toContain("revoke all privileges on table public.fleet_transport_units from anon");
    expect(sql).toContain("revoke all privileges on table public.transport_jobs from anon");
    expect(sql).toContain("revoke delete, truncate, references, trigger");
    expect(sql).toContain("grant select, insert, update");
    expect(sql).not.toMatch(/grant\s+delete|grant\s+truncate|grant\s+references|grant\s+trigger/i);
  });

  it("documents that realtime is intentionally not required and preserves prior migrations", () => {
    expect(sql).toContain("does not consume realtime");
    expect(sql).not.toContain("042_driver_operational_instruction_events");
    expect(sql).not.toContain("044_driver_operational_instruction_events_security_repair");
    expect(sql).not.toContain("045_driver_communication_translations");
  });
});
