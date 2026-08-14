import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/046_fleet_transport_foundation.sql"), "utf8");

describe("Fleet / Transport migration 046 contract", () => {
  it("creates separate units and transport jobs while reusing drivers", () => {
    expect(sql).toContain("create table if not exists public.fleet_transport_units");
    expect(sql).toContain("create table if not exists public.transport_jobs");
    expect(sql).toContain("driver_id uuid null references public.drivers(id)");
    expect(sql).toContain("unit_id uuid null references public.fleet_transport_units(id)");
    expect(sql).toContain("trailer_id uuid null references public.trailers(id)");
    expect(sql).not.toContain("create table if not exists public.drivers");
  });

  it("protects identifiers, statuses, history, and inactive units", () => {
    expect(sql).toContain("fleet_units_registration_unique");
    expect(sql).toContain("fleet_units_internal_number_unique");
    expect(sql).toContain("transport_jobs_status_check");
    expect(sql).toContain("active boolean not null default true");
    expect(sql).toContain("on delete set null");
    expect(sql).not.toMatch(/delete\s+from\s+public\.(fleet_transport_units|transport_jobs)/);
    expect(sql).not.toMatch(/truncate\s+(table\s+)?public\.(fleet_transport_units|transport_jobs)/);
  });

  it("adds scoped Fleet RBAC without granting Drivers access", () => {
    expect(sql).toContain("fleet_transport");
    expect(sql).toContain("('administrator','fleet_transport'");
    expect(sql).toContain("('supervisor','fleet_transport'");
    expect(sql).toContain("('operator','fleet_transport'");
    expect(sql).not.toContain("('driver','fleet_transport'");
  });
});
