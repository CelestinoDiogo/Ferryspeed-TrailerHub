import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const servicePath = path.resolve(process.cwd(), "src/lib/driver-operational-instructions.ts");
const serviceSource = readFileSync(servicePath, "utf8");

describe("driver-operational-instructions service contract", () => {
  it("enforces instruction max length and non-empty normalization", () => {
    expect(serviceSource).toContain("export const DRIVER_INSTRUCTION_MAX_LENGTH = 180");
    expect(serviceSource).toContain("Instruction text is required.");
    expect(serviceSource).toContain("Instruction must be ${DRIVER_INSTRUCTION_MAX_LENGTH} characters or less.");
  });

  it("uses recipient-scoped driver query and bounded history limits", () => {
    expect(serviceSource).toContain('.eq("recipient_user_id", userId)');
    expect(serviceSource).toContain("DEFAULT_HISTORY_LIMIT = 30");
    expect(serviceSource).toContain("Math.max(1, Math.min(input?.limit ?? DEFAULT_HISTORY_LIMIT, 100))");
  });

  it("keeps migration 042 optional for the minimum read loop", () => {
    expect(serviceSource).toContain("isMissingInstructionEventsTableError");
    expect(serviceSource).toContain('from("driver_operational_instruction_events")');
    expect(serviceSource).toContain("return [] as DriverOperationalInstructionEventRow[]");
  });

  it("uses mark-read RPC with controlled argument and no client read_by override", () => {
    expect(serviceSource).toContain('supabase.rpc("mark_driver_operational_instruction_read"');
    expect(serviceSource).toContain("p_instruction_id: input.instructionId");
    expect(serviceSource).not.toContain("read_by: input");
    expect(serviceSource).not.toContain("readBy: input");
    expect(serviceSource).not.toContain("read_at: input");
  });

  it("derives sender identity from authenticated user", () => {
    expect(serviceSource).toContain("sender_user_id: user.id");
    expect(serviceSource).toContain("const senderDisplayName = resolveSenderDisplayName(user)");
  });

  it("validates booking-driver and booking-trailer context consistency", () => {
    expect(serviceSource).toContain("Delivery booking is not assigned to the selected driver.");
    expect(serviceSource).toContain("Trailer context does not match the selected delivery booking.");
    expect(serviceSource).toContain("Driver was not found or is not linked to a user account.");
    expect(serviceSource).toContain("Trailer number does not match the selected trailer context.");
    expect(serviceSource).toContain("Trailer number requires a selected trailer context.");
    expect(serviceSource).toContain('if (trailerId) {');
  });

  it("rejects invalid priorities for direct service callers", () => {
    expect(serviceSource).toContain('throw new Error("Invalid instruction priority.")');
  });
});
