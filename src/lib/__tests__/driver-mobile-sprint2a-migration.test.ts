import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "supabase/migrations/040_driver_mobile_sprint2a_security_acknowledgement.sql");
const migrationSql = readFileSync(migrationPath, "utf8");

describe("driver mobile sprint 2A migration", () => {
  it("adds persisted acknowledgement metadata columns", () => {
    expect(migrationSql).toContain("add column if not exists driver_acknowledged_at timestamptz");
    expect(migrationSql).toContain("add column if not exists driver_acknowledged_by uuid references auth.users(id)");
  });

  it("restricts app_role_permissions mutations to administrators", () => {
    expect(migrationSql).toContain('create policy "Authenticated users can update app_role_permissions"');
    expect(migrationSql).toContain("and aur.role_key = 'administrator'");
  });

  it("keeps self-bootstrap path while blocking arbitrary app_user_roles mutation", () => {
    expect(migrationSql).toContain('create policy "Authenticated users can insert app_user_roles"');
    expect(migrationSql).toContain("and role_key = 'operator'");
    expect(migrationSql).toContain("and role_key = 'administrator'");
    expect(migrationSql).toContain('create policy "Authenticated users can update app_user_roles"');
  });

  it("adds driver lifecycle guard trigger for delivery_bookings updates", () => {
    expect(migrationSql).toContain("create or replace function public.enforce_driver_delivery_booking_update_guard()");
    expect(migrationSql).toContain("Driver updates are restricted to lifecycle action fields only.");
    expect(migrationSql).toContain("Driver must acknowledge the booking before lifecycle status transitions.");
    expect(migrationSql).toContain("create trigger delivery_bookings_driver_update_guard");
  });
});
