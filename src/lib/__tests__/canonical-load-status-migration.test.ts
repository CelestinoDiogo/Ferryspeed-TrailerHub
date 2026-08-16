import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "supabase/migrations/050_canonical_trailer_load_status_lifecycle.sql");
const migrationSql = readFileSync(migrationPath, "utf8");

describe("canonical trailer load-status migration", () => {
  it("preserves unknown vessel load state instead of manufacturing Empty", () => {
    expect(migrationSql).toContain("create or replace function public.resolve_trailer_physical_load_status");
    expect(migrationSql).toContain("when p_existing_load_status in ('Empty', 'Loaded') then p_existing_load_status");
    expect(migrationSql).toContain("else null");
    expect(migrationSql).not.toContain("coalesce(v_row.load_status, 'Empty')");
  });

  it("supports explicit desktop reception and shared mobile resolution", () => {
    expect(migrationSql).toContain("p_explicit_load_status text");
    expect(migrationSql).toContain("coalesce(p_explicit_load_status, v_row.load_status)");
    expect(migrationSql).toContain("select public.confirm_vessel_trailer_arrival(");
    expect(migrationSql).toContain("pg_advisory_xact_lock(hashtext('compound_position:'");
    expect(migrationSql).toContain("when p_destination = 'compound' then 'In Compound'");
  });

  it("updates export lifecycle and canonical state in one RPC", () => {
    expect(migrationSql).toContain("function public.advance_export_allocation_load_lifecycle");
    expect(migrationSql).toContain("when p_target_status = 'delivered_empty' then 'Empty'");
    expect(migrationSql).toContain("when p_target_status = 'collected_loaded' then 'Loaded'");
    expect(migrationSql).toContain("for update;");
  });

  it("requires an explicit delivery collection physical outcome", () => {
    expect(migrationSql).toContain("function public.complete_delivery_customer_collection");
    expect(migrationSql).toContain("Collection physical outcome must be Empty or Loaded.");
    expect(migrationSql).toContain("set load_status = p_resulting_load_status");
  });

  it("versions the stock-check canonical load-state RPC", () => {
    expect(migrationSql).toContain("function public.change_stock_check_trailer_load_status");
    expect(migrationSql).toContain("initcap(lower(trim(p_new_load_status)))");
    expect(migrationSql).toContain("Canonical load status changed during Compound stock check.");
    expect(migrationSql).toContain("if v_trailer.load_status = v_new_load_status then");
    expect(migrationSql).toContain("update public.compound_stock_checks");
    expect(migrationSql).toContain("then 'matched'");
  });

  it("contains no reconciliation of protected production trailers", () => {
    for (const trailerNumber of ["PFC18", "PFC20", "PFC32", "MFT73"]) {
      expect(migrationSql).not.toContain(trailerNumber);
    }
  });

  it("prevents anonymous execution and preserves service-role access", () => {
    expect(migrationSql).toContain("from public;");
    expect(migrationSql).toContain("from anon;");
    expect(migrationSql).toContain("to authenticated;");
    expect(migrationSql).toContain("to service_role;");
    expect(migrationSql).toContain("set search_path = pg_catalog, public");
  });

  it("excludes drivers from non-delivery lifecycle functions", () => {
    expect(migrationSql).toContain("raise exception 'Vessel arrival permission denied.'");
    expect(migrationSql).toContain("raise exception 'Export lifecycle permission denied.'");
    expect(migrationSql).toContain("raise exception 'Stock check permission denied.'");
    expect(migrationSql).toContain("assigned_driver.user_id = auth.uid()");
  });
});