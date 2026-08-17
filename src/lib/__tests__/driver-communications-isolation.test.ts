import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const serviceSource = readFileSync(path.resolve(process.cwd(), "src/lib/driver-operational-instructions.ts"), "utf8");
const readRouteSource = readFileSync(path.resolve(process.cwd(), "src/app/api/driver-mobile/instructions/read/route.ts"), "utf8");
const migrationSource = readFileSync(path.resolve(process.cwd(), "supabase/migrations/041_driver_operational_instructions.sql"), "utf8");

describe("Driver Communications lifecycle isolation", () => {
  it("keeps acknowledgement scoped to the instruction read RPC", () => {
    expect(readRouteSource).toContain("markDriverOperationalInstructionRead");
    expect(serviceSource).toContain('supabase.rpc("mark_driver_operational_instruction_read"');
    expect(readRouteSource).not.toContain('from("delivery_bookings")');
    expect(readRouteSource).not.toContain('from("trailers")');
  });

  it("does not change job, movement, compound, or physical load state", () => {
    const forbiddenWrites = [
      ".update({ status:",
      "load_status:",
      "compound_position:",
      "departure_date:",
      "collected_at:",
    ];

    for (const forbiddenWrite of forbiddenWrites) {
      expect(serviceSource).not.toContain(forbiddenWrite);
      expect(readRouteSource).not.toContain(forbiddenWrite);
    }
  });

  it("preserves write-once idempotent acknowledgement in the database contract", () => {
    expect(migrationSource).toContain("read_at = coalesce(read_at, now())");
    expect(migrationSource).toContain("read_by = coalesce(read_by, auth.uid())");
    expect(migrationSource).toContain("and recipient_user_id = auth.uid()");
  });
});