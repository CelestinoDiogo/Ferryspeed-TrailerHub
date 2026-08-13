import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "supabase/migrations/044_driver_operational_instruction_events_security_repair.sql",
);
const sql = readFileSync(migrationPath, "utf8").toLowerCase();
const previewSource = readFileSync(
  path.resolve(process.cwd(), "src/components/mobile/driver-mobile-preview.tsx"),
  "utf8",
);

describe("migration 044 Driver Communication response security", () => {
  it("preserves existing response types and adds completed", () => {
    for (const responseType of ["ok", "arrived", "completed", "delayed", "problem", "call_me"]) {
      expect(sql).toContain(`'${responseType}'`);
    }
    expect(sql).toContain("validate constraint driver_instruction_events_type_check");
  });

  it("requires the authenticated user to hold an active Driver application role", () => {
    expect(sql).toContain("driver_role.user_id = auth.uid()");
    expect(sql).toContain("driver_role.role_key = 'driver'");
    expect(sql).toContain("driver_role.is_active = true");
    expect(sql).not.toContain(" as current_role");
  });

  it("binds every response to the authenticated Driver and parent instruction", () => {
    expect(sql).toContain("created_by_user_id = auth.uid()");
    expect(sql).toContain("recipient_user_id = auth.uid()");
    expect(sql).toContain("parent_instruction.id = public.driver_operational_instruction_events.instruction_id");
    expect(sql).toContain("parent_instruction.driver_id = public.driver_operational_instruction_events.driver_id");
    expect(sql).toContain("parent_instruction.recipient_user_id = public.driver_operational_instruction_events.recipient_user_id");
    expect(sql).toContain("owned_driver.user_id = auth.uid()");
    expect(sql).toContain("owned_driver.active = true");
  });

  it("requires exact null-safe parent context snapshots", () => {
    expect(sql).toMatch(/parent_instruction\.delivery_booking_id\s+is not distinct from public\.driver_operational_instruction_events\.delivery_booking_id/);
    expect(sql).toMatch(/parent_instruction\.trailer_id\s+is not distinct from public\.driver_operational_instruction_events\.trailer_id/);
    expect(sql).toMatch(/parent_instruction\.trailer_number\s+is not distinct from public\.driver_operational_instruction_events\.trailer_number/);
  });

  it("contains no ambiguous ownership self-comparisons", () => {
    expect(sql).not.toMatch(/parent_instruction\.(driver_id|recipient_user_id|delivery_booking_id|trailer_id)\s*=\s*parent_instruction\.\1/);
    expect(sql).not.toContain("i.driver_id = i.driver_id");
    expect(sql).not.toContain("i.recipient_user_id = i.recipient_user_id");
  });

  it("restricts public roles to the minimum required event privileges", () => {
    expect(sql).toContain("revoke all privileges on table public.driver_operational_instruction_events from anon");
    expect(sql).toMatch(/revoke update, delete, truncate, references, trigger\s+on table public\.driver_operational_instruction_events\s+from authenticated/);
    expect(sql).toMatch(/grant select, insert\s+on table public\.driver_operational_instruction_events\s+to authenticated/);
  });

  it("does not weaken immutability or perform destructive data operations", () => {
    expect(sql).not.toContain("drop table");
    expect(sql).not.toMatch(/\btruncate\s+(table\s+)?public\.driver_operational_instruction_events/);
    expect(sql).not.toMatch(/delete\s+from\s+public\.driver_operational_instruction_events/);
    expect(sql).not.toContain("create table");
  });

  it("preserves realtime publication idempotently", () => {
    expect(sql).toContain("pg_publication_tables");
    expect(sql).toContain("alter publication supabase_realtime add table public.driver_operational_instruction_events");
    expect(sql).not.toContain("drop publication");
  });

  it("does not grant Driver response rights to Admin or Supervisor roles", () => {
    expect(sql).toContain("driver_role.role_key = 'driver'");
    expect(sql).not.toMatch(/driver_role\.role_key\s+in\s*\([^)]*(administrator|supervisor)/);
  });

  it("keeps Admin and Supervisor Driver Mobile Preview read-only", () => {
    expect(previewSource).toContain("READ-ONLY PREVIEW");
    expect(previewSource).not.toContain("/api/driver-mobile/instructions/respond");
    expect(previewSource).not.toContain("/api/driver-mobile/instructions/read");
    expect(previewSource).not.toContain("/api/driver-mobile/tasks/action");
  });
});
