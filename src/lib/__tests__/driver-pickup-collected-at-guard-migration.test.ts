import { readFileSync } from "node:fs";
import path from "path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/059_driver_pickup_does_not_write_collected_at.sql"),
  "utf8",
);

describe("driver pickup collected_at guard migration", () => {
  it("stops requiring collected_at on scheduled/ready -> on_delivery", () => {
    expect(migrationSql).toContain("create or replace function public.enforce_driver_delivery_booking_update_guard()");
    expect(migrationSql).toContain("Customer collection timestamp cannot be set when moving to on_delivery.");
    expect(migrationSql).not.toContain("Collected timestamp is required when moving to on_delivery.");
  });

  it("still requires collected_at for final customer collection", () => {
    expect(migrationSql).toContain("Collected timestamp is required when moving to collected.");
    expect(migrationSql).toContain("waiting_collection");
    expect(migrationSql).toContain("new.status = 'collected'");
  });

  it("does not add a dedicated pickup timestamp column", () => {
    expect(migrationSql).not.toContain("picked_up_at");
    expect(migrationSql).not.toContain("driver_collected_at");
    expect(migrationSql).not.toContain("add column");
  });
});
