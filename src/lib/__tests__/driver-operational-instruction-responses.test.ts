import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const servicePath = path.resolve(process.cwd(), "src/lib/driver-operational-instructions.ts");
const serviceSource = readFileSync(servicePath, "utf8");

describe("driver operational instruction response contract", () => {
  it("records driver responses as immutable child events", () => {
    expect(serviceSource).toContain('from("driver_operational_instruction_events")');
    expect(serviceSource).toContain("createDriverOperationalInstructionResponse");
    expect(serviceSource).toContain("instruction_id: instruction.id");
    expect(serviceSource).toContain("event_type: responseType");
    expect(serviceSource).toContain("created_by_user_id: userId");
    expect(serviceSource).not.toContain("update(payload)");
  });

  it("preserves ordered response history and latest response projection", () => {
    expect(serviceSource).toContain("buildResponseMap");
    expect(serviceSource).toContain("new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()");
    expect(serviceSource).toContain("latestResponse: responseHistory[0] ?? null");
    expect(serviceSource).toContain("responseHistory");
  });
});
