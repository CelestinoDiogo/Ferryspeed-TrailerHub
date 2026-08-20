import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(process.cwd(), "src/app/dashboard/vessel-operations/page.tsx"), "utf8");

describe("vessel operations list filter contract", () => {
  it("uses the shared local-date helper for both Today and Tomorrow", () => {
    expect(source).toContain("isVesselOperationScheduledOnLocalDate(item, todayKey)");
    expect(source).toContain("isVesselOperationScheduledOnLocalDate(item, tomorrowKey)");
    expect(source).not.toContain("return expectedKey === tomorrowKey;");
  });

  it("excludes cancelled operations from Upcoming as well as Today and Tomorrow", () => {
    expect(source).toContain('item.status !== "completed" && item.status !== "cancelled"');
  });
});
